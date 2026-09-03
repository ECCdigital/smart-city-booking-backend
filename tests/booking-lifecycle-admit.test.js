/**
 * The transition `admit` of the booking lifecycle (spec part 1, 5.2; part
 * 2, section 8; glossary "Aufnahme"), run over the in-memory adapters
 * against its effect table as data: the checkout stored the booking in
 * its initial state, the admission runs the effects of that state - the
 * hold of an unpaid booking or the grant of a confirmed one, the receipt
 * of a booking confirmed and paid at once, the workflow event `onCreate`,
 * exactly one mail to the customer, then the tenant's and the supervisors'
 * notice and the organizer of a ticket. Nothing is written: a hold that
 * fails aborts with nothing to restore, the checkout deletes the booking.
 */

const { expect } = require("chai");

const {
  createBookingLifecycle,
} = require("../src/commons/services/booking-lifecycle/booking-lifecycle");
const {
  LifecycleError,
} = require("../src/commons/services/booking-lifecycle/pipeline");
const {
  TRIGGER,
} = require("../src/commons/services/booking-lifecycle/booking-state");
const { ConflictError, NotFoundError } = require("../src/errors/BaseError");
const {
  inMemoryAdapters,
  effectTable,
} = require("./helpers/in-memory-lifecycle-adapters");

const TENANT = "tenant-1";

function booking(overrides = {}) {
  return {
    id: "B-1",
    tenantId: TENANT,
    status: "requested",
    priceEur: 40,
    paymentProvider: "giroCockpit",
    mail: "erika@example.test",
    name: "Erika Muster",
    assignedUserId: "erika@example.test",
    attachments: [],
    hooks: [],
    accessInfo: [],
    bookableItems: [
      { bookableId: "room", amount: 1, _bookableUsed: { type: "room" } },
    ],
    ...overrides,
  };
}

function lifecycleOver(options) {
  const adapters = inMemoryAdapters(options);
  return { adapters, lifecycle: createBookingLifecycle(adapters) };
}

async function failing(promise) {
  try {
    await promise;
  } catch (err) {
    return err;
  }
  return null;
}

describe("booking lifecycle: admit", function () {
  it("admits a request: the hold, the workflow event, the request confirmation, the tenant's and the supervisors' notice", async function () {
    const { adapters, lifecycle } = lifecycleOver({ bookings: [booking()] });

    const outcome = await lifecycle.admit(TENANT, "B-1", {
      trigger: TRIGGER.CUSTOMER,
    });

    expect(effectTable(outcome)).to.deep.equal([
      "provision access.hold ok",
      "provision access.provision skipped",
      "document documents.issue skipped",
      "notify workflow.emit ok",
      "notify mail.BOOKING_REQUEST_CONFIRMATION ok",
      "notify payment.requestPayment skipped",
      "notify mail.PAYMENT_LINK_AFTER_APPROVAL skipped",
      "notify mail.INVOICE_AFTER_APPROVAL skipped",
      "notify mail.BOOKING_CONFIRMED_INVOICE_PENDING skipped",
      "notify mail.BOOKING_CONFIRMATION skipped",
      "notify mail.FREE_BOOKING_CONFIRMATION skipped",
      "notify mail.INCOMING_BOOKING ok",
      "notify mail.SUPERVISOR_BOOKING_NOTIFICATION ok",
      "notify mail.NEW_BOOKING skipped",
    ]);
    expect(outcome).to.include({
      transition: "admit",
      bookingId: "B-1",
      status: "requested",
      failure: null,
    });
    expect(adapters.store.calls).to.deep.equal([]);
    expect(adapters.access.calls).to.deep.equal([
      { op: "hold", args: [TENANT, "B-1"] },
    ]);
    expect(adapters.workflow.calls).to.deep.equal([
      { op: "emit", args: [TENANT, "B-1", "onCreate"] },
    ]);
    expect(adapters.payment.calls).to.deep.equal([]);
    expect(adapters.mail.calls.map((call) => call.args[0])).to.deep.equal([
      "BOOKING_REQUEST_CONFIRMATION",
      "INCOMING_BOOKING",
      "SUPERVISOR_BOOKING_NOTIFICATION",
    ]);
    for (const call of adapters.mail.calls) {
      expect(call.args[1].bookingIds).to.deep.equal(["B-1"]);
      expect(call.args[1]).to.include({ groupBookingId: null });
    }
  });

  it("admits a manual booking awaiting payment: the hold, then the payment request instead of a mail", async function () {
    const { adapters, lifecycle } = lifecycleOver({
      bookings: [booking({ status: "payment_due" })],
    });

    const outcome = await lifecycle.admit(TENANT, "B-1", {
      trigger: TRIGGER.ADMIN,
    });

    expect(effectTable(outcome)).to.deep.equal([
      "provision access.hold ok",
      "provision access.provision skipped",
      "document documents.issue skipped",
      "notify workflow.emit ok",
      "notify mail.BOOKING_REQUEST_CONFIRMATION skipped",
      "notify payment.requestPayment ok",
      "notify mail.PAYMENT_LINK_AFTER_APPROVAL skipped",
      "notify mail.INVOICE_AFTER_APPROVAL skipped",
      "notify mail.BOOKING_CONFIRMED_INVOICE_PENDING skipped",
      "notify mail.BOOKING_CONFIRMATION skipped",
      "notify mail.FREE_BOOKING_CONFIRMATION skipped",
      "notify mail.INCOMING_BOOKING ok",
      "notify mail.SUPERVISOR_BOOKING_NOTIFICATION ok",
      "notify mail.NEW_BOOKING skipped",
    ]);
    expect(outcome.status).to.equal("payment_due");
    expect(adapters.payment.calls).to.deep.equal([
      {
        op: "requestPayment",
        args: [
          {
            tenantId: TENANT,
            bookingIds: ["B-1"],
            paymentProvider: "giroCockpit",
            groupBookingId: null,
          },
        ],
      },
    ]);
    expect(adapters.mail.calls.map((call) => call.args[0])).to.deep.equal([
      "INCOMING_BOOKING",
      "SUPERVISOR_BOOKING_NOTIFICATION",
    ]);
  });

  it("leaves the payment request out for a customer's booking awaiting payment: the checkout asks for the payment itself", async function () {
    const { adapters, lifecycle } = lifecycleOver({
      bookings: [booking({ status: "payment_due" })],
    });

    const outcome = await lifecycle.admit(TENANT, "B-1", {
      trigger: TRIGGER.CUSTOMER,
    });

    expect(effectTable(outcome)).to.include(
      "notify payment.requestPayment skipped",
      "notify mail.PAYMENT_LINK_AFTER_APPROVAL skipped",
      "notify mail.INVOICE_AFTER_APPROVAL skipped",
      "notify mail.BOOKING_CONFIRMED_INVOICE_PENDING skipped",
    );
    expect(adapters.payment.calls).to.deep.equal([]);
    expect(adapters.mail.calls.map((call) => call.args[0])).to.deep.equal([
      "INCOMING_BOOKING",
      "SUPERVISOR_BOOKING_NOTIFICATION",
    ]);
  });

  it("admits a booking confirmed and paid at once: the hold, the grant, the receipt, the confirmation with it", async function () {
    const { adapters, lifecycle } = lifecycleOver({
      bookings: [booking({ status: "confirmed" })],
    });

    const outcome = await lifecycle.admit(TENANT, "B-1", {
      trigger: TRIGGER.ADMIN,
    });

    expect(effectTable(outcome)).to.deep.equal([
      "provision access.hold ok",
      "provision access.provision ok",
      "document documents.issue ok",
      "notify workflow.emit ok",
      "notify mail.BOOKING_REQUEST_CONFIRMATION skipped",
      "notify payment.requestPayment skipped",
      "notify mail.PAYMENT_LINK_AFTER_APPROVAL skipped",
      "notify mail.INVOICE_AFTER_APPROVAL skipped",
      "notify mail.BOOKING_CONFIRMED_INVOICE_PENDING skipped",
      "notify mail.BOOKING_CONFIRMATION ok",
      "notify mail.FREE_BOOKING_CONFIRMATION skipped",
      "notify mail.INCOMING_BOOKING ok",
      "notify mail.SUPERVISOR_BOOKING_NOTIFICATION ok",
      "notify mail.NEW_BOOKING skipped",
    ]);
    expect(outcome.status).to.equal("confirmed");
    expect(adapters.access.calls).to.deep.equal([
      { op: "hold", args: [TENANT, "B-1"] },
      { op: "provision", args: [TENANT, "B-1"] },
    ]);
    expect(adapters.documents.calls[0].args[0]).to.include({
      tenantId: TENANT,
      type: "receipt",
    });
    expect(
      adapters.store.rows.get("B-1").attachments.map((att) => att.receiptId),
    ).to.deep.equal(["receipt-1"]);
    const [confirmation] = adapters.mail.calls;
    expect(confirmation.args[0]).to.equal("BOOKING_CONFIRMATION");
    expect(confirmation.args[1].attachments.map((f) => f.name)).to.deep.equal([
      "receipt-1.pdf",
    ]);
  });

  it("admits a free booking confirmed at once: the hold, the grant and the free booking confirmation, no receipt", async function () {
    const { adapters, lifecycle } = lifecycleOver({
      bookings: [booking({ status: "confirmed", priceEur: 0 })],
    });

    const outcome = await lifecycle.admit(TENANT, "B-1", {
      trigger: TRIGGER.CUSTOMER,
    });

    expect(effectTable(outcome)).to.deep.equal([
      "provision access.hold ok",
      "provision access.provision ok",
      "document documents.issue skipped",
      "notify workflow.emit ok",
      "notify mail.BOOKING_REQUEST_CONFIRMATION skipped",
      "notify payment.requestPayment skipped",
      "notify mail.PAYMENT_LINK_AFTER_APPROVAL skipped",
      "notify mail.INVOICE_AFTER_APPROVAL skipped",
      "notify mail.BOOKING_CONFIRMED_INVOICE_PENDING skipped",
      "notify mail.BOOKING_CONFIRMATION skipped",
      "notify mail.FREE_BOOKING_CONFIRMATION ok",
      "notify mail.INCOMING_BOOKING ok",
      "notify mail.SUPERVISOR_BOOKING_NOTIFICATION ok",
      "notify mail.NEW_BOOKING skipped",
    ]);
    expect(adapters.documents.calls).to.deep.equal([]);
  });

  it("tells the organizer of a ticket position", async function () {
    const { adapters, lifecycle } = lifecycleOver({
      bookings: [
        booking({
          bookableItems: [
            {
              bookableId: "ticket",
              amount: 1,
              _bookableUsed: { type: "ticket", eventId: "E1" },
            },
          ],
        }),
      ],
    });

    const outcome = await lifecycle.admit(TENANT, "B-1", {
      trigger: TRIGGER.CUSTOMER,
    });

    expect(effectTable(outcome)).to.include("notify mail.NEW_BOOKING ok");
    const organizer = adapters.mail.calls.find(
      (call) => call.args[0] === "NEW_BOOKING",
    );
    expect(organizer.args[1].bookingIds).to.deep.equal(["B-1"]);
  });

  it("leaves the workflow event out when a workflow action admitted the booking", async function () {
    const { adapters, lifecycle } = lifecycleOver({ bookings: [booking()] });

    const outcome = await lifecycle.admit(TENANT, "B-1", {
      trigger: TRIGGER.WORKFLOW,
    });

    expect(effectTable(outcome)).to.include("notify workflow.emit skipped");
    expect(adapters.workflow.calls).to.deep.equal([]);
  });

  it("a hold that fails aborts before any other effect, in every state: nothing was written, nothing is restored", async function () {
    for (const status of ["requested", "payment_due", "confirmed"]) {
      const { adapters, lifecycle } = lifecycleOver({
        bookings: [booking({ status })],
        failOn: { access: ["hold"] },
      });

      const error = await failing(
        lifecycle.admit(TENANT, "B-1", { trigger: TRIGGER.ADMIN }),
      );

      expect(error).to.be.instanceOf(LifecycleError);
      expect(effectTable(error.outcome)).to.deep.equal([
        "provision access.hold failed",
      ]);
      expect(adapters.documents.calls).to.deep.equal([]);
      expect(adapters.mail.calls).to.deep.equal([]);
    }

    const { adapters, lifecycle } = lifecycleOver({
      bookings: [booking()],
      failOn: { access: ["hold"] },
    });

    const error = await failing(
      lifecycle.admit(TENANT, "B-1", { trigger: TRIGGER.CUSTOMER }),
    );

    expect(error).to.be.instanceOf(LifecycleError);
    expect(error.transition).to.equal("admit");
    expect(effectTable(error.outcome)).to.deep.equal([
      "provision access.hold failed",
    ]);
    expect(error.outcome.failure.compensated).to.deep.equal([]);
    expect(adapters.store.calls).to.deep.equal([]);
    expect(adapters.workflow.calls).to.deep.equal([]);
    expect(adapters.mail.calls).to.deep.equal([]);
    expect(adapters.store.rows.get("B-1").status).to.equal("requested");
  });

  it("a grant that fails at a booking paid at once is recorded: receipt and mails follow", async function () {
    const { adapters, lifecycle } = lifecycleOver({
      bookings: [booking({ status: "confirmed" })],
      failOn: { access: ["provision"] },
    });

    const outcome = await lifecycle.admit(TENANT, "B-1", {
      trigger: TRIGGER.ADMIN,
    });

    expect(effectTable(outcome)).to.include.members([
      "provision access.provision recorded",
      "document documents.issue ok",
      "notify mail.BOOKING_CONFIRMATION ok",
    ]);
    expect(outcome.failure).to.equal(null);
    expect(adapters.mail.calls).to.have.length(3);
  });

  it("a mail that fails is recorded and the rest goes out; a tenant that wants no notice leaves that mail skipped", async function () {
    const { adapters, lifecycle } = lifecycleOver({
      bookings: [booking()],
      failOn: { mail: ["BOOKING_REQUEST_CONFIRMATION"] },
    });
    adapters.mail.skipOn.add("INCOMING_BOOKING");

    const outcome = await lifecycle.admit(TENANT, "B-1", {
      trigger: TRIGGER.CUSTOMER,
    });

    expect(effectTable(outcome)).to.include.members([
      "notify mail.BOOKING_REQUEST_CONFIRMATION recorded",
      "notify mail.INCOMING_BOOKING skipped",
      "notify mail.SUPERVISOR_BOOKING_NOTIFICATION ok",
    ]);
    expect(outcome.failure).to.equal(null);
  });

  for (const status of ["rejected", "cancelled"]) {
    it(`refuses a booking that is ${status}: 409 invalid_transition before any effect`, async function () {
      const { adapters, lifecycle } = lifecycleOver({
        bookings: [
          booking({
            status,
            cancellationRefund: { cancelledFrom: "confirmed" },
          }),
        ],
      });

      const error = await failing(
        lifecycle.admit(TENANT, "B-1", { trigger: TRIGGER.ADMIN }),
      );

      expect(error).to.be.instanceOf(ConflictError);
      expect(error.code).to.equal("invalid_transition");
      expect(error.params).to.deep.equal({
        bookingId: "B-1",
        status,
        transition: "admit",
      });
      expect(adapters.access.calls).to.deep.equal([]);
      expect(adapters.mail.calls).to.deep.equal([]);
    });
  }

  it("answers booking_not_found for a booking the store does not hold", async function () {
    const { lifecycle } = lifecycleOver({ bookings: [] });

    const error = await failing(
      lifecycle.admit(TENANT, "B-1", { trigger: TRIGGER.ADMIN }),
    );

    expect(error).to.be.instanceOf(NotFoundError);
    expect(error.code).to.equal("booking_not_found");
  });

  it("demands a trigger", async function () {
    const { lifecycle } = lifecycleOver({ bookings: [booking()] });

    const error = await failing(lifecycle.admit(TENANT, "B-1", {}));

    expect(error).to.be.instanceOf(Error);
    expect(error.message).to.match(/admit needs a trigger/);
  });
});
