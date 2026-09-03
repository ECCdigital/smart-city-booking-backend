/**
 * The group booking lifecycle (spec part 1, section 7; part 2, section 9):
 * the transitions of a group booking, each declaring its effects as steps
 * of the same pipeline over the same six adapters the single lifecycle
 * runs on. A group has no state of its own; its state is the state its
 * members share (glossary "Gruppenzustand"). A transition writes and
 * provisions member by member - every row of a member carries its
 * `bookingId` - and issues one document and sends one mail for the group.
 * It never calls the transitions of the single lifecycle.
 *
 * `createGroupBookingLifecycle(adapters)` builds an instance over any
 * adapters; the default instance below runs over the production adapters.
 *
 * A transition takes `(tenantId, groupBookingId, options)`, `trigger` being
 * mandatory. It answers an `Outcome` with `bookingIds` and `bookings` or
 * throws: `NotFoundError group_booking_not_found | booking_not_found` and
 * the guard's `ConflictError invalid_transition` - with the `bookingIds` of
 * the members that deviate from the first, where the members differ in
 * state - before any effect; `LifecycleError` when an effect with abort
 * policy failed, the members written before it restored (spec part 2, 4.2).
 */

const { STATUS, TRANSITION, TRIGGER, nextState } = require("./booking-state");
const { PHASE, step, runPipeline } = require("./pipeline");
const {
  WORKFLOW_EVENT,
  REFUND_ORIGIN,
  assertTrigger,
  isPriced,
  hasTicketPosition,
} = require("./booking-lifecycle");
const {
  CancellationRefundService,
  sanitizeBankDetails,
} = require("../payment/cancellation-refund-service");
const { ConflictError, NotFoundError } = require("../../../errors/BaseError");

/** Whether the group as a whole has a price. */
function isPricedGroup(bookings) {
  return bookings.some((booking) => isPriced(booking));
}

function hasTicketMember(bookings) {
  return bookings.some((booking) => hasTicketPosition(booking));
}

/**
 * The guard of the group (spec part 1, section 7): all members in the same
 * state, else `ConflictError invalid_transition` naming the members that
 * deviate from the first. A shared state the transition does not allow is
 * the same error over every member (`nextStateOf`).
 */
function sharedStatusOf(transition, groupBookingId, bookings) {
  const status = bookings[0].status;
  const deviating = bookings
    .filter((booking) => booking.status !== status)
    .map((booking) => booking.id);
  if (deviating.length > 0) {
    throw new ConflictError("invalid_transition", {
      groupBookingId,
      status,
      transition,
      bookingIds: deviating,
    });
  }
  return status;
}

/**
 * The state a member lands on, or the guard's error in the group's form:
 * the transition table refuses the shared state for every member alike.
 */
function nextStateOf(group, from, transition, booking) {
  try {
    return nextState(from, transition, booking);
  } catch (err) {
    if (err instanceof ConflictError) {
      throw new ConflictError("invalid_transition", {
        groupBookingId: group.id,
        status: from,
        transition,
        bookingIds: group.bookingIds,
      });
    }
    throw err;
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
function createGroupBookingLifecycle(adapters) {
  const {
    store,
    access,
    documents,
    payment,
    mail,
    workflow,
    clock = Date.now,
  } = adapters;

  /**
   * The group and its members in the group's order, the members in one
   * shared state.
   */
  async function load(tenantId, groupBookingId, transition) {
    const group = await store.getGroup(tenantId, groupBookingId);
    if (!group) {
      throw new NotFoundError("group_booking_not_found", { groupBookingId });
    }
    const found = await store.getMany(tenantId, group.bookingIds);
    const byId = new Map(found.map((booking) => [booking.id, booking]));
    const missing = group.bookingIds.filter((id) => !byId.has(id));
    if (missing.length > 0 || group.bookingIds.length === 0) {
      throw new NotFoundError("booking_not_found", {
        groupBookingId,
        bookingIds: missing,
      });
    }
    const bookings = group.bookingIds.map((id) => byId.get(id));
    const from = sharedStatusOf(transition, groupBookingId, bookings);
    return { group, bookings, from };
  }

  async function loadTenant(tenantId) {
    const tenant = await store.getTenant(tenantId);
    if (!tenant) {
      throw new NotFoundError("tenant_not_found", { tenantId });
    }
    return tenant;
  }

  /** The persist write of every member, from the state it is in. */
  function saveEach(bookings, from, transition) {
    return bookings.map((booking) =>
      step(
        PHASE.PERSIST,
        "store",
        "save",
        () => store.save(booking, { expectStatus: from, transition }),
        { bookingId: booking.id },
      ),
    );
  }

  /** One access operation per member, under a condition read per member. */
  function accessEach(bookings, op, when = () => true) {
    return bookings.map((booking) =>
      step(
        PHASE.PROVISION,
        "access",
        op,
        () => access[op](booking.tenantId, booking.id),
        { bookingId: booking.id, when: () => when(booking) },
      ),
    );
  }

  /** The workflow event of every member, unless a workflow action set it off. */
  function emitEach(bookings, event, trigger) {
    return bookings.map((booking) =>
      step(
        PHASE.NOTIFY,
        "workflow",
        "emit",
        () => workflow.emit(booking.tenantId, booking.id, event),
        { bookingId: booking.id, when: () => trigger !== TRIGGER.WORKFLOW },
      ),
    );
  }

  function ctxOf(transition, tenantId, group, bookings) {
    return {
      transition,
      tenantId,
      bookingIds: group.bookingIds,
      bookings,
      store,
    };
  }

  /**
   * The admission of a group (spec part 1, 5.2 and 7; part 2, sections 8
   * and 9; glossary "Aufnahme"): the checkout stored the members in the
   * state it chose, the lifecycle runs the effects of that state - per
   * member the hold at `requested | payment_due` or the grant at
   * `confirmed`, one aggregated receipt for a group confirmed and paid at
   * once, the workflow event `onCreate` per member, then one mail for the
   * group - the receipt of a request, the payment request of a group
   * awaiting payment (for every trigger but `customer`, whose checkout
   * asks for the payment itself), the confirmation with the receipt of a
   * paid one, the free booking confirmation of a free one - and the
   * tenant's, the supervisors' and the organizer's notice. Nothing is
   * written; a hold that fails aborts with nothing to restore, the checkout
   * deletes the members and the group.
   *
   * @param {string} tenantId
   * @param {string} groupBookingId
   * @param {{ trigger: string }} options
   * @returns {Promise<Object>} The outcome
   */
  async function admit(tenantId, groupBookingId, { trigger } = {}) {
    const transition = TRANSITION.ADMIT;
    assertTrigger(transition, trigger);

    const { group, bookings, from } = await load(
      tenantId,
      groupBookingId,
      transition,
    );
    for (const booking of bookings) {
      nextStateOf(group, from, transition, booking);
    }
    const requested = () => from === STATUS.REQUESTED;
    const paymentDue = () => from === STATUS.PAYMENT_DUE;
    const confirmed = () => from === STATUS.CONFIRMED;
    const priced = () => isPricedGroup(bookings);
    const files = [];

    return runPipeline(ctxOf(transition, tenantId, group, bookings), [
      ...accessEach(bookings, "hold", () => !confirmed()),
      ...accessEach(bookings, "provision", confirmed),
      step(
        PHASE.DOCUMENT,
        "documents",
        "issue",
        async () => {
          const issued = await documents.issue({
            tenantId,
            bookingIds: group.bookingIds,
            type: "receipt",
            groupBookingId: group.id,
            bookings,
          });
          files.push(issued.file);
          return issued;
        },
        { when: () => confirmed() && priced() },
      ),
      ...emitEach(bookings, WORKFLOW_EVENT.CREATE, trigger),
      step(
        PHASE.NOTIFY,
        "mail",
        "sendRequestConfirmation",
        () => mail.sendRequestConfirmation(bookings, { aggregated: true }),
        { when: requested },
      ),
      step(
        PHASE.NOTIFY,
        "payment",
        "requestPayment",
        () =>
          payment.requestPayment({
            tenantId,
            bookingIds: group.bookingIds,
            paymentProvider: bookings[0].paymentProvider,
            groupBookingId: group.id,
          }),
        { when: () => paymentDue() && trigger !== TRIGGER.CUSTOMER },
      ),
      step(
        PHASE.NOTIFY,
        "mail",
        "sendBookingConfirmation",
        () =>
          mail.sendBookingConfirmation(bookings, {
            attachments: files,
            aggregated: true,
          }),
        { when: () => confirmed() && priced() },
      ),
      step(
        PHASE.NOTIFY,
        "mail",
        "sendFreeBookingConfirmation",
        () => mail.sendFreeBookingConfirmation(bookings, { aggregated: true }),
        { when: () => confirmed() && !priced() },
      ),
      step(PHASE.NOTIFY, "mail", "sendTenantMail", () =>
        mail.sendTenantMail(bookings, { aggregated: true }),
      ),
      step(PHASE.NOTIFY, "mail", "sendSupervisorMail", () =>
        mail.sendSupervisorMail(bookings, { aggregated: true }),
      ),
      step(
        PHASE.NOTIFY,
        "mail",
        "sendEmailToOrganizer",
        () => mail.sendEmailToOrganizer(bookings),
        { when: () => hasTicketMember(bookings) },
      ),
    ]);
  }

  /**
   * The confirmation of a group (spec part 2, sections 8 and 9): every
   * member `requested → payment_due | confirmed` by its own price, written
   * one by one; the confirmed ones granted; the workflow told per member;
   * then one free booking confirmation where every member is confirmed,
   * else one payment request for the group.
   *
   * @param {string} tenantId
   * @param {string} groupBookingId
   * @param {{ trigger: string }} options
   * @returns {Promise<Object>} The outcome
   */
  async function confirm(tenantId, groupBookingId, { trigger } = {}) {
    const transition = TRANSITION.CONFIRM;
    assertTrigger(transition, trigger);

    const { group, bookings, from } = await load(
      tenantId,
      groupBookingId,
      transition,
    );
    for (const booking of bookings) {
      booking.status = nextStateOf(group, from, transition, booking);
    }
    const confirmed = (booking) => booking.status === STATUS.CONFIRMED;
    const allConfirmed = () => bookings.every(confirmed);
    const paymentDue = () =>
      bookings.some((booking) => booking.status === STATUS.PAYMENT_DUE);

    return runPipeline(ctxOf(transition, tenantId, group, bookings), [
      ...saveEach(bookings, from, transition),
      ...accessEach(bookings, "provision", confirmed),
      ...emitEach(bookings, WORKFLOW_EVENT.COMMIT, trigger),
      step(
        PHASE.NOTIFY,
        "mail",
        "sendFreeBookingConfirmation",
        () => mail.sendFreeBookingConfirmation(bookings, { aggregated: true }),
        { when: allConfirmed },
      ),
      step(
        PHASE.NOTIFY,
        "payment",
        "requestPayment",
        () =>
          payment.requestPayment({
            tenantId,
            bookingIds: group.bookingIds,
            paymentProvider: bookings[0].paymentProvider,
            groupBookingId: group.id,
          }),
        { when: paymentDue },
      ),
      step(
        PHASE.NOTIFY,
        "mail",
        "sendEmailToOrganizer",
        () => mail.sendEmailToOrganizer(bookings),
        { when: () => hasTicketMember(bookings) },
      ),
    ]);
  }

  /**
   * The payment of a group (spec part 2, sections 8 and 9): every member
   * `payment_due → confirmed`, written one by one and granted; one
   * aggregated receipt attached to every member; the workflow told per
   * member (`onPay`, which the aggregated payment never fired before);
   * one confirmation with the receipt.
   *
   * @param {string} tenantId
   * @param {string} groupBookingId
   * @param {{ trigger: string, paymentMethod?: string, timePaid?: number }} options
   * @returns {Promise<Object>} The outcome
   */
  async function pay(
    tenantId,
    groupBookingId,
    { trigger, paymentMethod, timePaid } = {},
  ) {
    const transition = TRANSITION.PAY;
    assertTrigger(transition, trigger);

    const { group, bookings, from } = await load(
      tenantId,
      groupBookingId,
      transition,
    );
    const paidAt =
      typeof timePaid === "number" && timePaid > 0 ? timePaid : clock();
    for (const booking of bookings) {
      booking.status = nextStateOf(group, from, transition, booking);
      booking.timePaid = paidAt;
      if (paymentMethod) {
        booking.paymentMethod = paymentMethod;
      }
    }
    const files = [];

    return runPipeline(ctxOf(transition, tenantId, group, bookings), [
      ...saveEach(bookings, from, transition),
      ...accessEach(bookings, "provision"),
      step(
        PHASE.DOCUMENT,
        "documents",
        "issue",
        async () => {
          const issued = await documents.issue({
            tenantId,
            bookingIds: group.bookingIds,
            type: "receipt",
            groupBookingId: group.id,
            bookings,
          });
          files.push(issued.file);
          return issued;
        },
        { when: () => isPricedGroup(bookings) },
      ),
      ...emitEach(bookings, WORKFLOW_EVENT.PAY, trigger),
      step(PHASE.NOTIFY, "mail", "sendBookingConfirmation", () =>
        mail.sendBookingConfirmation(bookings, {
          attachments: files,
          aggregated: true,
        }),
      ),
      step(
        PHASE.NOTIFY,
        "mail",
        "sendEmailToOrganizer",
        () => mail.sendEmailToOrganizer(bookings),
        { when: () => hasTicketMember(bookings) },
      ),
    ]);
  }

  /**
   * The cancellation of a group (spec part 2, sections 8 and 9): every
   * member `requested → rejected`, `payment_due | confirmed → cancelled`,
   * each with the reason and its own refund audit with the state cancelled
   * from, written one by one and revoked; one aggregated cancellation
   * document for a priced group unless the caller leaves it out; the
   * workflow told per member; one rejection mail for a group of requests,
   * one cancel mail otherwise, with the document.
   *
   * @param {string} tenantId
   * @param {string} groupBookingId
   * @param {{ trigger: string, reason?: string, bankDetails?: Object|null, refundPercentage?: number, cancelledByUserId?: string|null, cancelledAt?: number, withDocument?: boolean }} options
   * @returns {Promise<Object>} The outcome
   */
  async function cancel(
    tenantId,
    groupBookingId,
    {
      trigger,
      reason = "",
      bankDetails = null,
      refundPercentage,
      cancelledByUserId = null,
      cancelledAt,
      withDocument = true,
    } = {},
  ) {
    const transition = TRANSITION.CANCEL;
    assertTrigger(transition, trigger);

    const [{ group, bookings, from }, tenant] = await Promise.all([
      load(tenantId, groupBookingId, transition),
      loadTenant(tenantId),
    ]);
    const at = cancelledAt ?? clock();
    const refunds = bookings.map((booking) => {
      booking.status = nextStateOf(group, from, transition, booking);
      booking.rejectionReason = reason;
      const refund = CancellationRefundService.calculate({
        tenant,
        booking,
        cancelledAt: at,
        origin: REFUND_ORIGIN[trigger],
        refundPercentage,
        cancelledByUserId,
      });
      booking.cancellationRefund =
        booking.status === STATUS.CANCELLED
          ? { ...refund, cancelledFrom: from }
          : { ...refund };
      return { bookingId: booking.id, ...refund };
    });
    const rejection = from === STATUS.REQUESTED;
    const files = [];

    return runPipeline(ctxOf(transition, tenantId, group, bookings), [
      ...saveEach(bookings, from, transition),
      ...accessEach(bookings, "revoke"),
      step(
        PHASE.DOCUMENT,
        "documents",
        "issue",
        async () => {
          const issued = await documents.issue({
            tenantId,
            bookingIds: group.bookingIds,
            type: "cancellation",
            groupBookingId: group.id,
            bookings,
            options: {
              alreadyPaid: from === STATUS.CONFIRMED,
              bankDetails: sanitizeBankDetails(bankDetails) || undefined,
              cancellationReason: reason,
              refundCalculations: refunds,
            },
          });
          files.push(issued.file);
          return issued;
        },
        { when: () => withDocument && isPricedGroup(bookings) },
      ),
      ...emitEach(bookings, WORKFLOW_EVENT.REJECT, trigger),
      step(
        PHASE.NOTIFY,
        "mail",
        "sendBookingRejection",
        () =>
          mail.sendBookingRejection(bookings, {
            attachments: files,
            aggregated: true,
            reason,
          }),
        { when: () => rejection },
      ),
      step(
        PHASE.NOTIFY,
        "mail",
        "sendBookingCancel",
        () =>
          mail.sendBookingCancel(bookings, {
            attachments: files,
            aggregated: true,
            reason,
          }),
        { when: () => !rejection },
      ),
    ]);
  }

  return { admit, confirm, pay, cancel };
}

/** The group lifecycle over the production adapters. */
const groupBookingLifecycle = createGroupBookingLifecycle(
  require("./adapters"),
);

module.exports = {
  createGroupBookingLifecycle,
  groupBookingLifecycle,
};
