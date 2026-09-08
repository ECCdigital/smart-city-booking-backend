/**
 * The transition `pay` of the booking lifecycle (spec part 2, section 8),
 * run over the in-memory adapters against its effect table as data:
 * `payment_due → confirmed` with grant, receipt, workflow event and the
 * confirmation mail, the receipt joined by the `mailAttach` documents.
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
const NOW = 1_756_800_000_000;

function booking(overrides = {}) {
  return {
    id: "B-1",
    tenantId: TENANT,
    status: "payment_due",
    priceEur: 40,
    mail: "erika@example.test",
    name: "Erika Muster",
    attachments: [],
    bookableItems: [
      { bookableId: "room", amount: 1, _bookableUsed: { type: "room" } },
    ],
    ...overrides,
  };
}

const PAY_TABLE = [
  "persist store.save ok",
  "provision access.provision ok",
  "document documents.issue ok",
  "notify workflow.emit ok",
  "notify mail.BOOKING_CONFIRMATION ok",
  "notify mail.NEW_BOOKING skipped",
  "notify mail.ACCESS_PROVISION_FAILED skipped",
];

describe("booking lifecycle: pay", function () {
  function lifecycleOver(options) {
    const adapters = inMemoryAdapters(options);
    return { adapters, lifecycle: createBookingLifecycle(adapters) };
  }

  it("pays a booking with payment due: state write, grant, receipt, workflow event, confirmation with the receipt", async function () {
    const { adapters, lifecycle } = lifecycleOver({ bookings: [booking()] });

    const outcome = await lifecycle.pay(TENANT, "B-1", {
      trigger: TRIGGER.ADMIN,
      paymentMethod: "CASH",
    });

    expect(effectTable(outcome)).to.deep.equal(PAY_TABLE);
    expect(outcome).to.include({
      transition: "pay",
      bookingId: "B-1",
      status: "confirmed",
      failure: null,
    });
    const stored = adapters.store.rows.get("B-1");
    expect(stored).to.include({
      status: "confirmed",
      isCommitted: true,
      isPayed: true,
      paymentMethod: "CASH",
      timePaid: NOW,
    });
    expect(stored.attachments.map((att) => att.receiptId)).to.deep.equal([
      "receipt-1",
    ]);
    expect(
      outcome.booking.attachments.map((att) => att.receiptId),
    ).to.deep.equal(["receipt-1"]);
    expect(adapters.store.calls).to.deep.equal([
      { op: "save", args: ["B-1", "payment_due"] },
    ]);
    expect(adapters.access.calls).to.deep.equal([
      { op: "provision", args: [TENANT, "B-1"] },
    ]);
    expect(adapters.workflow.calls).to.deep.equal([
      { op: "emit", args: [TENANT, "B-1", "onPay"] },
    ]);
    const [mail] = adapters.mail.calls;
    expect(mail.args[0]).to.equal("BOOKING_CONFIRMATION");
    expect(mail.args[1].bookingIds).to.deep.equal(["B-1"]);
    expect(mail.args[1].attachments.map((file) => file.name)).to.deep.equal([
      "receipt-1.pdf",
    ]);
    expect(mail.args[1].groupBookingId).to.equal(null);
  });

  it("keeps the time of the payment the caller names", async function () {
    const { adapters, lifecycle } = lifecycleOver({ bookings: [booking()] });

    await lifecycle.pay(TENANT, "B-1", {
      trigger: TRIGGER.PAYMENT,
      timePaid: 1_700_000_000_000,
    });

    expect(adapters.store.rows.get("B-1")).to.include({
      timePaid: 1_700_000_000_000,
    });
  });

  it("leaves the workflow event out when a workflow action triggered the payment", async function () {
    const { adapters, lifecycle } = lifecycleOver({ bookings: [booking()] });

    const outcome = await lifecycle.pay(TENANT, "B-1", {
      trigger: TRIGGER.WORKFLOW,
    });

    expect(effectTable(outcome)).to.deep.equal([
      "persist store.save ok",
      "provision access.provision ok",
      "document documents.issue ok",
      "notify workflow.emit skipped",
      "notify mail.BOOKING_CONFIRMATION ok",
      "notify mail.NEW_BOOKING skipped",
      "notify mail.ACCESS_PROVISION_FAILED skipped",
    ]);
    expect(adapters.workflow.calls).to.deep.equal([]);
  });

  it("mails the organizer of a ticket booking", async function () {
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

    const outcome = await lifecycle.pay(TENANT, "B-1", {
      trigger: TRIGGER.ADMIN,
    });

    expect(effectTable(outcome).at(-2)).to.equal("notify mail.NEW_BOOKING ok");
    expect(adapters.mail.calls.at(-1).args[1].bookingIds).to.deep.equal([
      "B-1",
    ]);
  });

  describe("the guard", function () {
    for (const status of ["requested", "confirmed", "rejected", "cancelled"]) {
      it(`refuses a booking that is ${status}, before any effect`, async function () {
        const { adapters, lifecycle } = lifecycleOver({
          bookings: [booking({ status })],
        });

        let error;
        try {
          await lifecycle.pay(TENANT, "B-1", { trigger: TRIGGER.ADMIN });
        } catch (err) {
          error = err;
        }

        expect(error).to.be.instanceOf(ConflictError);
        expect(error.code).to.equal("invalid_transition");
        expect(error.params).to.deep.equal({
          bookingId: "B-1",
          status,
          transition: "pay",
        });
        expect(adapters.store.writes).to.deep.equal([]);
        expect(adapters.access.calls).to.deep.equal([]);
        expect(adapters.documents.calls).to.deep.equal([]);
        expect(adapters.mail.calls).to.deep.equal([]);
      });
    }

    it("answers booking_not_found for a booking it does not know", async function () {
      const { lifecycle } = lifecycleOver({ bookings: [] });

      let error;
      try {
        await lifecycle.pay(TENANT, "B-9", { trigger: TRIGGER.ADMIN });
      } catch (err) {
        error = err;
      }

      expect(error).to.be.instanceOf(NotFoundError);
      expect(error.params).to.deep.equal({ bookingId: "B-9" });
    });

    it("refuses a booking of another tenant as not found", async function () {
      const { lifecycle } = lifecycleOver({ bookings: [booking()] });

      let error;
      try {
        await lifecycle.pay("tenant-2", "B-1", { trigger: TRIGGER.ADMIN });
      } catch (err) {
        error = err;
      }

      expect(error).to.be.instanceOf(NotFoundError);
    });

    it("demands a trigger", async function () {
      const { adapters, lifecycle } = lifecycleOver({ bookings: [booking()] });

      let error;
      try {
        await lifecycle.pay(TENANT, "B-1", {});
      } catch (err) {
        error = err;
      }

      expect(error).to.be.an("error");
      expect(error.message).to.match(/trigger/);
      expect(adapters.store.writes).to.deep.equal([]);
    });

    it("lets exactly one of two parallel payments through: one confirmed, one receipt, the other a 409", async function () {
      const { adapters, lifecycle } = lifecycleOver({ bookings: [booking()] });

      const results = await Promise.allSettled([
        lifecycle.pay(TENANT, "B-1", { trigger: TRIGGER.PAYMENT }),
        lifecycle.pay(TENANT, "B-1", { trigger: TRIGGER.PAYMENT }),
      ]);

      const fulfilled = results.filter((r) => r.status === "fulfilled");
      const rejected = results.filter((r) => r.status === "rejected");
      expect(fulfilled).to.have.length(1);
      expect(rejected).to.have.length(1);
      expect(rejected[0].reason).to.be.instanceOf(ConflictError);
      expect(rejected[0].reason.params).to.include({
        status: "confirmed",
        transition: "pay",
      });
      expect(adapters.store.writes).to.deep.equal([
        { id: "B-1", status: "confirmed" },
      ]);
      expect(adapters.store.rows.get("B-1").attachments).to.have.length(1);
      expect(adapters.documents.calls).to.have.length(1);
      expect(adapters.mail.calls).to.have.length(1);
    });
  });

  describe("the failure policy", function () {
    it("a grant that fails is recorded; receipt and mail follow, the booking is paid", async function () {
      const { adapters, lifecycle } = lifecycleOver({
        bookings: [booking()],
        failOn: { access: ["provision"] },
      });

      const outcome = await lifecycle.pay(TENANT, "B-1", {
        trigger: TRIGGER.ADMIN,
      });

      expect(effectTable(outcome)).to.deep.equal([
        "persist store.save ok",
        "provision access.provision recorded",
        "document documents.issue ok",
        "notify workflow.emit ok",
        "notify mail.BOOKING_CONFIRMATION ok",
        "notify mail.NEW_BOOKING skipped",
        "notify mail.ACCESS_PROVISION_FAILED ok",
      ]);
      expect(adapters.store.rows.get("B-1").status).to.equal("confirmed");
    });

    it("a receipt that fails is recorded; the booking is paid without a receipt, the mail goes out without it", async function () {
      const { adapters, lifecycle } = lifecycleOver({
        bookings: [booking()],
        failOn: { documents: ["issue"] },
      });

      const outcome = await lifecycle.pay(TENANT, "B-1", {
        trigger: TRIGGER.ADMIN,
      });

      expect(effectTable(outcome)).to.deep.equal([
        "persist store.save ok",
        "provision access.provision ok",
        "document documents.issue recorded",
        "notify workflow.emit ok",
        "notify mail.BOOKING_CONFIRMATION ok",
        "notify mail.NEW_BOOKING skipped",
        "notify mail.ACCESS_PROVISION_FAILED skipped",
      ]);
      expect(outcome.failure).to.equal(null);
      expect(adapters.store.rows.get("B-1").status).to.equal("confirmed");
      expect(adapters.store.rows.get("B-1").attachments).to.deep.equal([]);
      expect(adapters.mail.calls[0].args[1].attachments).to.deep.equal([]);
    });

    it("a mail that fails is recorded", async function () {
      const { lifecycle } = lifecycleOver({
        bookings: [booking()],
        failOn: { mail: ["BOOKING_CONFIRMATION"] },
      });

      const outcome = await lifecycle.pay(TENANT, "B-1", {
        trigger: TRIGGER.ADMIN,
      });

      expect(effectTable(outcome)[4]).to.equal(
        "notify mail.BOOKING_CONFIRMATION recorded",
      );
      expect(outcome.failure).to.equal(null);
    });

    it("a state write that fails aborts: nothing else runs, the booking stays with payment due", async function () {
      const { adapters, lifecycle } = lifecycleOver({
        bookings: [booking()],
        failOn: { store: ["save"] },
      });

      let error;
      try {
        await lifecycle.pay(TENANT, "B-1", { trigger: TRIGGER.ADMIN });
      } catch (err) {
        error = err;
      }

      expect(error).to.be.instanceOf(LifecycleError);
      expect(error.transition).to.equal("pay");
      expect(effectTable(error.outcome)).to.deep.equal([
        "persist store.save failed",
      ]);
      expect(error.outcome.failure.compensated).to.deep.equal([]);
      expect(error.outcome.booking.status).to.equal("payment_due");
      expect(adapters.access.calls).to.deep.equal([]);
      expect(adapters.documents.calls).to.deep.equal([]);
      expect(adapters.mail.calls).to.deep.equal([]);
    });
  });
});
