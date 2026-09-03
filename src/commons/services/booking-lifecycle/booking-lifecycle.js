/**
 * The booking lifecycle (glossary "Buchungslebenszyklus"; spec part 1,
 * section 8 and part 2, section 8): the transitions of a single booking,
 * each declaring its effects as steps of the pipeline over the six adapters
 * of the seam - store, access, documents, payment, mail, workflow.
 *
 * `createBookingLifecycle(adapters)` builds an instance over any adapters;
 * the default instance below runs over the production adapters in
 * `adapters/`, tests build theirs over the in-memory ones. During the
 * migration `BookingService` delegates to the default instance transition
 * by transition; so far: `confirm`, `pay`, `cancel`, `requestCancel`,
 * `reinstate`.
 *
 * A transition takes `(tenantId, bookingId, options)`, `trigger` being
 * mandatory (glossary "Auslöser"): `workflow` says a workflow action set
 * it off and the workflow event is left out. It answers an `Outcome` or
 * throws: `NotFoundError booking_not_found` and the guard's `ConflictError
 * invalid_transition` before any effect, `LifecycleError` when an effect
 * with abort policy failed (persist writes restored).
 */

const {
  STATUS,
  TRANSITION,
  TRIGGER,
  TRIGGERS,
  nextState,
} = require("./booking-state");
const { PHASE, step, runPipeline } = require("./pipeline");
const {
  CancellationRefundService,
  CANCELLATION_ORIGINS,
  sanitizeBankDetails,
} = require("../payment/cancellation-refund-service");
const { BOOKING_HOOK_TYPES } = require("../../entities/booking/bookingHook");
const { NotFoundError, ForbiddenError } = require("../../../errors/BaseError");

const WORKFLOW_EVENT = Object.freeze({
  COMMIT: "onCommit",
  PAY: "onPay",
  REJECT: "onReject",
});

/**
 * The origin the refund rule of a cancellation reads, per trigger (spec
 * part 1, 4.2): the customer's cancellation follows the tenant's tiers, the
 * administration's may override them, everything else refunds in full.
 */
const REFUND_ORIGIN = Object.freeze({
  [TRIGGER.CUSTOMER]: CANCELLATION_ORIGINS.USER,
  [TRIGGER.ADMIN]: CANCELLATION_ORIGINS.ADMIN,
  [TRIGGER.PAYMENT]: CANCELLATION_ORIGINS.SYSTEM,
  [TRIGGER.WORKFLOW]: CANCELLATION_ORIGINS.SYSTEM,
  [TRIGGER.SYSTEM]: CANCELLATION_ORIGINS.SYSTEM,
});

function isPriced(booking) {
  return (Number(booking.priceEur) || 0) > 0;
}

/** Whether the booking books a ticket of an event. */
function hasTicketPosition(booking) {
  return (booking.bookableItems || []).some(
    (item) => item?._bookableUsed?.type === "ticket",
  );
}

function assertTrigger(transition, trigger) {
  if (!TRIGGERS.includes(trigger)) {
    throw new Error(
      `booking-lifecycle: ${transition} needs a trigger, one of ${TRIGGERS.join(", ")}; got ${trigger}`,
    );
  }
}

/**
 * @param {Object} adapters The seam (spec part 2, section 10)
 * @param {Object} adapters.store
 * @param {Object} adapters.access
 * @param {Object} adapters.documents
 * @param {Object} adapters.payment
 * @param {Object} adapters.mail
 * @param {Object} adapters.workflow
 * @param {function(): number} [adapters.clock]
 */
function createBookingLifecycle(adapters) {
  const {
    store,
    access,
    documents,
    payment,
    mail,
    workflow,
    clock = Date.now,
  } = adapters;

  async function load(tenantId, bookingId) {
    const booking = await store.get(tenantId, bookingId);
    if (!booking) {
      throw new NotFoundError("booking_not_found", { bookingId });
    }
    return booking;
  }

  async function loadTenant(tenantId) {
    const tenant = await store.getTenant(tenantId);
    if (!tenant) {
      throw new NotFoundError("tenant_not_found", { tenantId });
    }
    return tenant;
  }

  /**
   * The confirmation (spec part 2, section 8, `confirm`): `requested →
   * payment_due` for a priced booking, which is then asked to pay
   * (glossary "Zahlungsaufforderung"), `requested → confirmed` for a free
   * one, which is granted and told so. A tenant without a payment service
   * leaves the payment request skipped: the booking awaits payment all the
   * same.
   *
   * @param {string} tenantId
   * @param {string} bookingId
   * @param {{ trigger: string }} options
   * @returns {Promise<Object>} The outcome
   */
  async function confirm(tenantId, bookingId, { trigger } = {}) {
    const transition = TRANSITION.CONFIRM;
    assertTrigger(transition, trigger);

    const booking = await load(tenantId, bookingId);
    const from = booking.status;
    booking.status = nextState(from, transition, booking);
    const confirmed = () => booking.status === STATUS.CONFIRMED;
    const paymentDue = () => booking.status === STATUS.PAYMENT_DUE;

    return runPipeline({ transition, tenantId, bookingId, booking, store }, [
      step(PHASE.PERSIST, "store", "save", () =>
        store.save(booking, { expectStatus: from, transition }),
      ),
      step(
        PHASE.PROVISION,
        "access",
        "provision",
        () => access.provision(tenantId, bookingId),
        { when: confirmed },
      ),
      step(
        PHASE.NOTIFY,
        "workflow",
        "emit",
        () => workflow.emit(tenantId, bookingId, WORKFLOW_EVENT.COMMIT),
        { when: () => trigger !== TRIGGER.WORKFLOW },
      ),
      step(
        PHASE.NOTIFY,
        "mail",
        "sendFreeBookingConfirmation",
        () =>
          mail.sendFreeBookingConfirmation([booking], { aggregated: false }),
        { when: confirmed },
      ),
      step(
        PHASE.NOTIFY,
        "payment",
        "requestPayment",
        () =>
          payment.requestPayment({
            tenantId,
            bookingIds: [bookingId],
            paymentProvider: booking.paymentProvider,
            groupBookingId: null,
          }),
        { when: paymentDue },
      ),
      step(
        PHASE.NOTIFY,
        "mail",
        "sendEmailToOrganizer",
        () => mail.sendEmailToOrganizer([booking]),
        { when: () => hasTicketPosition(booking) },
      ),
    ]);
  }

  /**
   * The payment (spec part 2, section 8, `pay`): `payment_due → confirmed`.
   *
   * @param {string} tenantId
   * @param {string} bookingId
   * @param {{ trigger: string, paymentMethod?: string, timePaid?: number }} options
   * @returns {Promise<Object>} The outcome
   */
  async function pay(
    tenantId,
    bookingId,
    { trigger, paymentMethod, timePaid } = {},
  ) {
    const transition = TRANSITION.PAY;
    assertTrigger(transition, trigger);

    const booking = await load(tenantId, bookingId);
    const from = booking.status;
    booking.status = nextState(from, transition, booking);
    booking.timePaid =
      typeof timePaid === "number" && timePaid > 0 ? timePaid : clock();
    if (paymentMethod) {
      booking.paymentMethod = paymentMethod;
    }

    const files = [];

    return runPipeline({ transition, tenantId, bookingId, booking, store }, [
      step(PHASE.PERSIST, "store", "save", () =>
        store.save(booking, { expectStatus: from, transition }),
      ),
      step(PHASE.PROVISION, "access", "provision", () =>
        access.provision(tenantId, bookingId),
      ),
      step(
        PHASE.DOCUMENT,
        "documents",
        "issue",
        async () => {
          const issued = await documents.issue({
            tenantId,
            bookingIds: [bookingId],
            type: "receipt",
            bookings: [booking],
          });
          files.push(issued.file);
          return issued;
        },
        { when: () => isPriced(booking) },
      ),
      step(
        PHASE.NOTIFY,
        "workflow",
        "emit",
        () => workflow.emit(tenantId, bookingId, WORKFLOW_EVENT.PAY),
        { when: () => trigger !== TRIGGER.WORKFLOW },
      ),
      step(PHASE.NOTIFY, "mail", "sendBookingConfirmation", () =>
        mail.sendBookingConfirmation([booking], {
          attachments: files,
          aggregated: false,
        }),
      ),
      step(
        PHASE.NOTIFY,
        "mail",
        "sendEmailToOrganizer",
        () => mail.sendEmailToOrganizer([booking]),
        { when: () => hasTicketPosition(booking) },
      ),
    ]);
  }

  /**
   * The cancellation (spec part 2, section 8, `cancel`): `requested →
   * rejected`, `payment_due | confirmed → cancelled`. The state write
   * carries the reason, the refund audit with the state cancelled from
   * (glossary "Wiederherstellung" returns to it) and drops the hook of a
   * cancellation request; then the access is revoked, the cancellation
   * document issued for a priced booking unless the caller leaves it out,
   * the workflow told and the customer mailed - the rejection of a request,
   * the cancellation otherwise (a request the customer withdrew through a
   * hook reads as a cancellation, as before).
   *
   * @param {string} tenantId
   * @param {string} bookingId
   * @param {{ trigger: string, reason?: string, hookId?: string|null, bankDetails?: Object|null, refundPercentage?: number, cancelledByUserId?: string|null, cancelledAt?: number, withDocument?: boolean }} options
   * @returns {Promise<Object>} The outcome
   */
  async function cancel(
    tenantId,
    bookingId,
    {
      trigger,
      reason = "",
      hookId = null,
      bankDetails = null,
      refundPercentage,
      cancelledByUserId = null,
      cancelledAt,
      withDocument = true,
    } = {},
  ) {
    const transition = TRANSITION.CANCEL;
    assertTrigger(transition, trigger);

    const [booking, tenant] = await Promise.all([
      load(tenantId, bookingId),
      loadTenant(tenantId),
    ]);
    const from = booking.status;
    booking.status = nextState(from, transition, booking);
    booking.rejectionReason = reason;
    if (hookId) {
      booking.removeHook(hookId);
    }

    const refund = CancellationRefundService.calculate({
      tenant,
      booking,
      cancelledAt: cancelledAt ?? clock(),
      origin: REFUND_ORIGIN[trigger],
      refundPercentage,
      cancelledByUserId,
    });
    booking.cancellationRefund =
      booking.status === STATUS.CANCELLED
        ? { ...refund, cancelledFrom: from }
        : { ...refund };

    const rejection = booking.status === STATUS.REJECTED && !hookId;
    const files = [];

    return runPipeline({ transition, tenantId, bookingId, booking, store }, [
      step(PHASE.PERSIST, "store", "save", () =>
        store.save(booking, { expectStatus: from, transition }),
      ),
      step(PHASE.PROVISION, "access", "revoke", () =>
        access.revoke(tenantId, bookingId),
      ),
      step(
        PHASE.DOCUMENT,
        "documents",
        "issue",
        async () => {
          const issued = await documents.issue({
            tenantId,
            bookingIds: [bookingId],
            type: "cancellation",
            bookings: [booking],
            options: {
              alreadyPaid: from === STATUS.CONFIRMED,
              bankDetails: sanitizeBankDetails(bankDetails) || undefined,
              cancellationReason: reason,
              refundCalculation: refund,
            },
          });
          files.push(issued.file);
          return issued;
        },
        { when: () => withDocument && isPriced(booking) },
      ),
      step(
        PHASE.NOTIFY,
        "workflow",
        "emit",
        () => workflow.emit(tenantId, bookingId, WORKFLOW_EVENT.REJECT),
        { when: () => trigger !== TRIGGER.WORKFLOW },
      ),
      step(
        PHASE.NOTIFY,
        "mail",
        "sendBookingRejection",
        () =>
          mail.sendBookingRejection([booking], {
            attachments: files,
            aggregated: false,
            reason,
          }),
        { when: () => rejection },
      ),
      step(
        PHASE.NOTIFY,
        "mail",
        "sendBookingCancel",
        () =>
          mail.sendBookingCancel([booking], {
            attachments: files,
            aggregated: false,
            reason,
          }),
        { when: () => !rejection },
      ),
    ]);
  }

  /**
   * The cancellation request (spec part 2, section 8, `requestCancel`;
   * glossary "Stornoanfrage"): the state stays, a hook `REJECT` with the
   * reason and the bank details is written, and the customer is asked to
   * verify, with the refund the customer's cancellation would bring. Only
   * where the booking's cancellation policy allows it: otherwise
   * `ForbiddenError booking_user_cancellation_disabled`, the answer of
   * before, in front of the state guard.
   *
   * @param {string} tenantId
   * @param {string} bookingId
   * @param {{ trigger: string, reason?: string, bankDetails?: Object|null }} options
   * @returns {Promise<Object>} The outcome
   */
  async function requestCancel(
    tenantId,
    bookingId,
    { trigger, reason = "", bankDetails = null } = {},
  ) {
    const transition = TRANSITION.REQUEST_CANCEL;
    assertTrigger(transition, trigger);

    const booking = await load(tenantId, bookingId);
    if (booking.cancellationPolicy?.userCancellable !== true) {
      throw new ForbiddenError("booking_user_cancellation_disabled", {
        bookingId,
      });
    }
    const status = booking.status;
    nextState(status, transition, booking);

    const payload = { reason };
    const sanitizedBankDetails = sanitizeBankDetails(bankDetails);
    if (sanitizedBankDetails) {
      payload.bankDetails = sanitizedBankDetails;
    }
    const hook = booking.addHook(BOOKING_HOOK_TYPES.REJECT, payload);

    // The preview shows what the customer's cancellation would refund:
    // releasing the hook cancels as the customer, whoever asked.
    const tenant = await loadTenant(tenantId);
    const refundPreview = CancellationRefundService.toCustomerPreview(
      CancellationRefundService.calculate({
        tenant,
        booking,
        cancelledAt: clock(),
        origin: CANCELLATION_ORIGINS.USER,
      }),
      bookingId,
    );

    return runPipeline({ transition, tenantId, bookingId, booking, store }, [
      step(PHASE.PERSIST, "store", "save", () =>
        store.save(booking, { expectStatus: status, transition }),
      ),
      step(PHASE.NOTIFY, "mail", "sendVerifyBookingRejection", () =>
        mail.sendVerifyBookingRejection([booking], {
          hookId: hook.id,
          reason,
          refundPreview,
        }),
      ),
    ]);
  }

  /**
   * The reinstatement (spec part 2, section 8, `reinstate`; glossary
   * "Wiederherstellung"): `rejected → requested`, `cancelled → ` the state
   * it was cancelled from. Price, positions and coupon are what the stored
   * booking still carries from before the cancellation; the reason is
   * cleared and the refund audit removed. The access is granted again at
   * `confirmed`, held at `requested | payment_due` - a hold that fails
   * aborts, the booking is cancelled again. No document, no workflow
   * event, no mail.
   *
   * @param {string} tenantId
   * @param {string} bookingId
   * @param {{ trigger: string }} options
   * @returns {Promise<Object>} The outcome
   */
  async function reinstate(tenantId, bookingId, { trigger } = {}) {
    const transition = TRANSITION.REINSTATE;
    assertTrigger(transition, trigger);

    const booking = await load(tenantId, bookingId);
    const from = booking.status;
    booking.status = nextState(from, transition, booking);
    booking.rejectionReason = "";
    delete booking.cancellationRefund;
    const confirmed = () => booking.status === STATUS.CONFIRMED;

    return runPipeline({ transition, tenantId, bookingId, booking, store }, [
      step(PHASE.PERSIST, "store", "save", () =>
        store.save(booking, {
          expectStatus: from,
          transition,
          unset: ["cancellationRefund"],
        }),
      ),
      step(
        PHASE.PROVISION,
        "access",
        "hold",
        () => access.hold(tenantId, bookingId),
        { when: () => !confirmed() },
      ),
      step(
        PHASE.PROVISION,
        "access",
        "provision",
        () => access.provision(tenantId, bookingId),
        { when: confirmed },
      ),
    ]);
  }

  return { confirm, pay, cancel, requestCancel, reinstate };
}

/** The lifecycle over the production adapters. */
const bookingLifecycle = createBookingLifecycle(require("./adapters"));

module.exports = {
  createBookingLifecycle,
  bookingLifecycle,
  hasTicketPosition,
};
