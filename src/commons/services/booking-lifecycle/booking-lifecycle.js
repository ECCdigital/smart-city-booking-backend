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
 * by transition; so far: `pay`.
 *
 * A transition takes `(tenantId, bookingId, options)`, `trigger` being
 * mandatory (glossary "Auslöser"): `workflow` says a workflow action set
 * it off and the workflow event is left out. It answers an `Outcome` or
 * throws: `NotFoundError booking_not_found` and the guard's `ConflictError
 * invalid_transition` before any effect, `LifecycleError` when an effect
 * with abort policy failed (persist writes restored).
 */

const { TRANSITION, TRIGGER, TRIGGERS, nextState } = require("./booking-state");
const { PHASE, step, runPipeline } = require("./pipeline");
const { NotFoundError } = require("../../../errors/BaseError");

const WORKFLOW_EVENT = Object.freeze({
  PAY: "onPay",
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

  return { pay };
}

/** The lifecycle over the production adapters. */
const bookingLifecycle = createBookingLifecycle(require("./adapters"));

module.exports = {
  createBookingLifecycle,
  bookingLifecycle,
  hasTicketPosition,
};
