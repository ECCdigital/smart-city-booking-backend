/**
 * The transition `acceptWithdrawal` of the booking lifecycle, run over the
 * in-memory adapters against their effect tables as data: a private
 * customer's withdrawal the staff accepted moves a live booking to
 * `withdrawn` for good, refunds in full what was paid and lets lapse what
 * was still to pay.
 */

const { expect } = require("chai");

const {
  createBookingLifecycle,
} = require("../src/commons/services/booking-lifecycle/booking-lifecycle");
const {
  TRIGGER,
} = require("../src/commons/services/booking-lifecycle/booking-state");
const { ConflictError, ForbiddenError } = require("../src/errors/BaseError");
const {
  inMemoryAdapters,
  effectTable,
} = require("./helpers/in-memory-lifecycle-adapters");

const TENANT = "tenant-1";
const NOW = 1_756_800_000_000;
const DAY = 24 * 60 * 60 * 1000;

function booking(overrides = {}) {
  return {
    id: "B-1",
    tenantId: TENANT,
    status: "confirmed",
    priceEur: 40,
    timeBegin: NOW + 10 * DAY,
    timeEnd: NOW + 10 * DAY + 2 * 60 * 60 * 1000,
    paymentProvider: "giroCockpit",
    mail: "erika@example.test",
    name: "Erika Muster",
    attachments: [],
    hooks: [],
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

async function accept(stored) {
  const { adapters, lifecycle } = lifecycleOver({ bookings: [stored] });
  const outcome = await lifecycle.acceptWithdrawal(TENANT, "B-1", {
    trigger: TRIGGER.ADMIN,
    cancelledByUserId: "admin-1",
  });
  return { adapters, outcome, stored: adapters.store.rows.get("B-1") };
}

describe("booking lifecycle: acceptWithdrawal", function () {
  it("withdraws a paid booking: state write with a full refund, revoke, the withdrawal receipt, workflow event, the withdrawal mail with the receipt", async function () {
    const { adapters, outcome, stored } = await accept(booking());

    expect(effectTable(outcome)).to.deep.equal([
      "persist store.save ok",
      "provision access.revoke ok",
      "document documents.issue ok",
      "notify workflow.emit ok",
      "notify mail.BOOKING_WITHDRAWAL ok",
    ]);
    expect(outcome).to.include({
      transition: "acceptWithdrawal",
      bookingId: "B-1",
      status: "withdrawn",
      failure: null,
    });
    expect(stored).to.include({
      status: "withdrawn",
      isCommitted: true,
      isPayed: true,
      isRejected: true,
    });
    expect(stored.cancellationRefund).to.include({
      origin: "admin",
      appliedRefundPercentage: 100,
      refundAmountEur: 40,
      cancellationFeeEur: 0,
      cancelledByUserId: "admin-1",
      cancelledFrom: "confirmed",
      refundState: "open",
    });
    expect(adapters.store.calls).to.deep.equal([
      { op: "save", args: ["B-1", "confirmed"] },
    ]);
    expect(adapters.access.calls).to.deep.equal([
      { op: "revoke", args: [TENANT, "B-1"] },
    ]);
    const [issue] = adapters.documents.calls;
    expect(issue.args[0]).to.include({ type: "withdrawal" });
    expect(issue.args[0].options).to.include({ alreadyPaid: true });
    expect(adapters.workflow.calls).to.deep.equal([
      { op: "emit", args: [TENANT, "B-1", "onReject"] },
    ]);
    const [mail] = adapters.mail.calls;
    expect(mail.args[0]).to.equal("BOOKING_WITHDRAWAL");
    expect(mail.args[1].bookingIds).to.deep.equal(["B-1"]);
    expect(mail.args[1].attachments).to.have.length(1);
  });

  it("lets an outstanding payment lapse: no refund state where nothing was paid", async function () {
    const { stored } = await accept(booking({ status: "payment_due" }));

    expect(stored).to.include({
      status: "withdrawn",
      isCommitted: true,
      isPayed: false,
      isRejected: true,
    });
    expect(stored.cancellationRefund).to.include({
      appliedRefundPercentage: 100,
      cancelledFrom: "payment_due",
    });
    expect(stored.cancellationRefund).to.not.have.property("refundState");
  });

  it("withdraws a request not yet decided", async function () {
    const { stored } = await accept(booking({ status: "requested" }));

    expect(stored).to.include({
      status: "withdrawn",
      isCommitted: false,
      isRejected: true,
    });
    expect(stored.cancellationRefund).to.include({
      cancelledFrom: "requested",
    });
    expect(stored.cancellationRefund).to.not.have.property("refundState");
  });

  it("issues no document for a free booking, and still mails", async function () {
    const { outcome } = await accept(booking({ priceEur: 0 }));

    expect(effectTable(outcome)).to.deep.equal([
      "persist store.save ok",
      "provision access.revoke ok",
      "document documents.issue skipped",
      "notify workflow.emit ok",
      "notify mail.BOOKING_WITHDRAWAL ok",
    ]);
  });

  for (const status of ["rejected", "cancelled", "withdrawn"]) {
    it(`refuses a ${status} booking before any effect: invalid_transition`, async function () {
      const { adapters, lifecycle } = lifecycleOver({
        bookings: [booking({ status })],
      });

      const err = await failing(
        lifecycle.acceptWithdrawal(TENANT, "B-1", { trigger: TRIGGER.ADMIN }),
      );

      expect(err).to.be.instanceOf(ConflictError);
      expect(err.code).to.equal("invalid_transition");
      expect(adapters.store.calls).to.deep.equal([]);
      expect(adapters.mail.calls).to.deep.equal([]);
    });
  }

  for (const [name, overrides] of [
    ["answered business", { isBusiness: true, company: "" }],
    ["with a company and no answer", { company: "Musterfirma GmbH" }],
  ]) {
    it(`refuses a business booking (${name}) before the state guard: booking_withdrawal_not_private`, async function () {
      const { adapters, lifecycle } = lifecycleOver({
        bookings: [booking(overrides)],
      });

      const err = await failing(
        lifecycle.acceptWithdrawal(TENANT, "B-1", { trigger: TRIGGER.ADMIN }),
      );

      expect(err).to.be.instanceOf(ForbiddenError);
      expect(err.code).to.equal("booking_withdrawal_not_private");
      expect(adapters.store.calls).to.deep.equal([]);
      expect(adapters.mail.calls).to.deep.equal([]);
    });
  }

  it("withdraws a booking answered private, whatever its company", async function () {
    const { stored } = await accept(
      booking({ isBusiness: false, company: "Musterfirma GmbH" }),
    );

    expect(stored.status).to.equal("withdrawn");
  });

  it("cannot be taken back: reinstate refuses a withdrawn booking", async function () {
    const { adapters, lifecycle } = lifecycleOver({ bookings: [booking()] });
    await lifecycle.acceptWithdrawal(TENANT, "B-1", { trigger: TRIGGER.ADMIN });

    const err = await failing(
      lifecycle.reinstate(TENANT, "B-1", { trigger: TRIGGER.ADMIN }),
    );

    expect(err).to.be.instanceOf(ConflictError);
    expect(adapters.store.rows.get("B-1").status).to.equal("withdrawn");
  });
});
