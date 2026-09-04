/**
 * The transitions `cancel`, `requestCancel` and `reinstate` of the booking
 * lifecycle (spec part 2, section 8), run over the in-memory adapters
 * against their effect tables as data: the cancellation with its state
 * write first and the cancellation document after it, the cancellation
 * request as a hook with the verification mail, the reinstatement back to
 * the state cancelled from with the grant or the hold.
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
const {
  ConflictError,
  ForbiddenError,
  NotFoundError,
} = require("../src/errors/BaseError");
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
    cancellationPolicy: { userCancellable: true, contactHint: "" },
    bookableItems: [
      { bookableId: "room", amount: 1, _bookableUsed: { type: "room" } },
    ],
    ...overrides,
  };
}

function cancelled(overrides = {}) {
  return booking({
    status: "cancelled",
    rejectionReason: "Irrtum",
    cancellationRefund: {
      cancelledAt: NOW,
      daysBeforeStart: 10,
      originalAmountEur: 40,
      suggestedRefundPercentage: 100,
      appliedRefundPercentage: 50,
      refundAmountEur: 20,
      cancellationFeeEur: 20,
      appliedTierDays: null,
      origin: "admin",
      adminOverride: true,
      cancelledByUserId: "admin-1",
      cancelledFrom: "confirmed",
    },
    ...overrides,
  });
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

describe("booking lifecycle: cancel", function () {
  it("cancels a paid booking: state write with the refund audit, revoke, the cancellation document, workflow event, the cancel mail with the document", async function () {
    const { adapters, lifecycle } = lifecycleOver({ bookings: [booking()] });

    const outcome = await lifecycle.cancel(TENANT, "B-1", {
      trigger: TRIGGER.ADMIN,
      reason: "Raum gesperrt",
      cancelledByUserId: "admin-1",
    });

    expect(effectTable(outcome)).to.deep.equal([
      "persist store.save ok",
      "provision access.revoke ok",
      "document documents.issue ok",
      "notify workflow.emit ok",
      "notify mail.BOOKING_REJECTION skipped",
      "notify mail.BOOKING_CANCEL ok",
    ]);
    expect(outcome).to.include({
      transition: "cancel",
      bookingId: "B-1",
      status: "cancelled",
      failure: null,
    });
    const stored = adapters.store.rows.get("B-1");
    expect(stored).to.include({
      status: "cancelled",
      rejectionReason: "Raum gesperrt",
      isCommitted: true,
      isPayed: true,
      isRejected: true,
    });
    expect(stored.cancellationRefund).to.include({
      origin: "admin",
      cancelledAt: NOW,
      appliedRefundPercentage: 100,
      refundAmountEur: 40,
      cancelledByUserId: "admin-1",
      cancelledFrom: "confirmed",
    });
    expect(stored.attachments.map((att) => att.type)).to.deep.equal([
      "cancellation",
    ]);
    expect(adapters.store.calls).to.deep.equal([
      { op: "save", args: ["B-1", "confirmed"] },
    ]);
    expect(adapters.access.calls).to.deep.equal([
      { op: "revoke", args: [TENANT, "B-1"] },
    ]);
    const [issue] = adapters.documents.calls;
    expect(issue.args[0]).to.include({
      tenantId: TENANT,
      type: "cancellation",
    });
    expect(issue.args[0].bookingIds).to.deep.equal(["B-1"]);
    expect(issue.args[0].options).to.include({
      alreadyPaid: true,
      cancellationReason: "Raum gesperrt",
    });
    expect(issue.args[0].options.refundCalculation).to.include({
      origin: "admin",
      refundAmountEur: 40,
    });
    expect(adapters.workflow.calls).to.deep.equal([
      { op: "emit", args: [TENANT, "B-1", "onReject"] },
    ]);
    const [mail] = adapters.mail.calls;
    expect(mail.args[0]).to.equal("BOOKING_CANCEL");
    expect(mail.args[1].bookingIds).to.deep.equal(["B-1"]);
    expect(mail.args[1].reason).to.equal("Raum gesperrt");
    expect(mail.args[1].groupBookingId).to.equal(null);
    expect(mail.args[1].attachments.map((f) => f.name)).to.deep.equal([
      "cancellation-1.pdf",
    ]);
  });

  it("cancels a booking awaiting payment: cancelled from payment_due, not paid, document without alreadyPaid", async function () {
    const { adapters, lifecycle } = lifecycleOver({
      bookings: [booking({ status: "payment_due" })],
    });

    const outcome = await lifecycle.cancel(TENANT, "B-1", {
      trigger: TRIGGER.ADMIN,
    });

    expect(outcome.status).to.equal("cancelled");
    const stored = adapters.store.rows.get("B-1");
    expect(stored).to.include({ isCommitted: true, isPayed: false });
    expect(stored.cancellationRefund.cancelledFrom).to.equal("payment_due");
    expect(adapters.documents.calls[0].args[0].options.alreadyPaid).to.equal(
      false,
    );
  });

  it("rejects a priced request: rejected, the document and the rejection mail", async function () {
    const { adapters, lifecycle } = lifecycleOver({
      bookings: [booking({ status: "requested" })],
    });

    const outcome = await lifecycle.cancel(TENANT, "B-1", {
      trigger: TRIGGER.ADMIN,
      reason: "Kein Platz",
    });

    expect(effectTable(outcome)).to.deep.equal([
      "persist store.save ok",
      "provision access.revoke ok",
      "document documents.issue ok",
      "notify workflow.emit ok",
      "notify mail.BOOKING_REJECTION ok",
      "notify mail.BOOKING_CANCEL skipped",
    ]);
    const stored = adapters.store.rows.get("B-1");
    expect(stored).to.include({
      status: "rejected",
      isCommitted: false,
      isRejected: true,
    });
    expect(stored.cancellationRefund).to.not.have.property("cancelledFrom");
    const [mail] = adapters.mail.calls;
    expect(mail.args[0]).to.equal("BOOKING_REJECTION");
    expect(mail.args[1].attachments.map((f) => f.name)).to.deep.equal([
      "cancellation-1.pdf",
    ]);
  });

  it("cancels a free booking without a document", async function () {
    const { adapters, lifecycle } = lifecycleOver({
      bookings: [booking({ priceEur: 0 })],
    });

    const outcome = await lifecycle.cancel(TENANT, "B-1", {
      trigger: TRIGGER.ADMIN,
    });

    expect(effectTable(outcome)).to.deep.equal([
      "persist store.save ok",
      "provision access.revoke ok",
      "document documents.issue skipped",
      "notify workflow.emit ok",
      "notify mail.BOOKING_REJECTION skipped",
      "notify mail.BOOKING_CANCEL ok",
    ]);
    expect(adapters.documents.calls).to.deep.equal([]);
    expect(adapters.mail.calls[0].args[1].attachments).to.deep.equal([]);
  });

  it("leaves the document out where the caller says so, and mails without attachment", async function () {
    const { adapters, lifecycle } = lifecycleOver({ bookings: [booking()] });

    const outcome = await lifecycle.cancel(TENANT, "B-1", {
      trigger: TRIGGER.ADMIN,
      withDocument: false,
    });

    expect(effectTable(outcome)[2]).to.equal(
      "document documents.issue skipped",
    );
    expect(adapters.store.rows.get("B-1").attachments).to.deep.equal([]);
    expect(adapters.store.rows.get("B-1").cancellationRefund).to.include({
      origin: "admin",
    });
    expect(adapters.mail.calls[0].args[1].attachments).to.deep.equal([]);
  });

  it("releases a cancellation request: the hook goes with the state write, the refund is the customer's, the cancel mail goes out even for a request", async function () {
    const { adapters, lifecycle } = lifecycleOver({
      bookings: [
        booking({
          status: "requested",
          hooks: [
            {
              id: "H-1",
              type: "REJECT",
              payload: { reason: "Krank" },
              timeCreated: NOW,
            },
          ],
        }),
      ],
      tenant: {
        id: TENANT,
        cancellationRefundTiers: [{ daysBeforeStart: 0, refundPercentage: 50 }],
      },
    });

    const outcome = await lifecycle.cancel(TENANT, "B-1", {
      trigger: TRIGGER.CUSTOMER,
      reason: "Krank",
      hookId: "H-1",
      bankDetails: { accountHolder: " Erika ", iban: "de12 3456", bic: "" },
    });

    expect(effectTable(outcome)).to.deep.equal([
      "persist store.save ok",
      "provision access.revoke ok",
      "document documents.issue ok",
      "notify workflow.emit ok",
      "notify mail.BOOKING_REJECTION skipped",
      "notify mail.BOOKING_CANCEL ok",
    ]);
    const stored = adapters.store.rows.get("B-1");
    expect(stored.status).to.equal("rejected");
    expect(stored.hooks).to.deep.equal([]);
    expect(stored.cancellationRefund).to.include({
      origin: "user",
      appliedRefundPercentage: 50,
      refundAmountEur: 20,
    });
    expect(
      adapters.documents.calls[0].args[0].options.bankDetails,
    ).to.deep.equal({
      accountHolder: "Erika",
      bankName: "",
      iban: "DE123456",
      bic: "",
    });
  });

  it("an admin refund percentage overrides the tiers; a system trigger refunds in full", async function () {
    const tenant = {
      id: TENANT,
      cancellationRefundTiers: [{ daysBeforeStart: 0, refundPercentage: 50 }],
    };
    const admin = lifecycleOver({ bookings: [booking()], tenant });
    await admin.lifecycle.cancel(TENANT, "B-1", {
      trigger: TRIGGER.ADMIN,
      refundPercentage: 25,
    });
    expect(admin.adapters.store.rows.get("B-1").cancellationRefund).to.include({
      origin: "admin",
      appliedRefundPercentage: 25,
      refundAmountEur: 10,
      adminOverride: true,
    });

    const system = lifecycleOver({ bookings: [booking()], tenant });
    await system.lifecycle.cancel(TENANT, "B-1", { trigger: TRIGGER.SYSTEM });
    expect(system.adapters.store.rows.get("B-1").cancellationRefund).to.include(
      { origin: "system", appliedRefundPercentage: 100 },
    );
  });

  it("leaves the workflow event out when a workflow action triggered the cancellation, and refunds in full", async function () {
    const { adapters, lifecycle } = lifecycleOver({ bookings: [booking()] });

    const outcome = await lifecycle.cancel(TENANT, "B-1", {
      trigger: TRIGGER.WORKFLOW,
    });

    expect(effectTable(outcome)[3]).to.equal("notify workflow.emit skipped");
    expect(adapters.workflow.calls).to.deep.equal([]);
    expect(adapters.store.rows.get("B-1").cancellationRefund).to.include({
      origin: "system",
      appliedRefundPercentage: 100,
    });
  });

  it("takes the moment of the cancellation from the caller, else from the clock", async function () {
    const given = lifecycleOver({ bookings: [booking()] });
    await given.lifecycle.cancel(TENANT, "B-1", {
      trigger: TRIGGER.ADMIN,
      cancelledAt: NOW - DAY,
    });
    expect(
      given.adapters.store.rows.get("B-1").cancellationRefund.cancelledAt,
    ).to.equal(NOW - DAY);

    const clocked = lifecycleOver({ bookings: [booking()], clock: () => 42 });
    await clocked.lifecycle.cancel(TENANT, "B-1", { trigger: TRIGGER.ADMIN });
    expect(
      clocked.adapters.store.rows.get("B-1").cancellationRefund.cancelledAt,
    ).to.equal(42);
  });

  describe("the guard", function () {
    for (const status of ["rejected", "cancelled"]) {
      it(`refuses to cancel a booking that is ${status}: 409 invalid_transition before any effect`, async function () {
        const { adapters, lifecycle } = lifecycleOver({
          bookings: [cancelled({ status })],
        });

        const error = await failing(
          lifecycle.cancel(TENANT, "B-1", { trigger: TRIGGER.ADMIN }),
        );

        expect(error).to.be.instanceOf(ConflictError);
        expect(error.params).to.include({
          bookingId: "B-1",
          status,
          transition: "cancel",
        });
        expect(adapters.store.writes).to.deep.equal([]);
        expect(adapters.documents.calls).to.deep.equal([]);
        expect(adapters.mail.calls).to.deep.equal([]);
      });
    }

    it("answers booking_not_found for a booking it does not know", async function () {
      const { lifecycle } = lifecycleOver({ bookings: [booking()] });

      const error = await failing(
        lifecycle.cancel(TENANT, "B-2", { trigger: TRIGGER.ADMIN }),
      );

      expect(error).to.be.instanceOf(NotFoundError);
      expect(error.code).to.equal("booking_not_found");
    });

    it("answers tenant_not_found where the tenant is gone", async function () {
      const { lifecycle } = lifecycleOver({
        bookings: [booking()],
        tenant: null,
      });

      const error = await failing(
        lifecycle.cancel(TENANT, "B-1", { trigger: TRIGGER.ADMIN }),
      );

      expect(error).to.be.instanceOf(NotFoundError);
      expect(error.code).to.equal("tenant_not_found");
    });

    it("demands a trigger", async function () {
      const { adapters, lifecycle } = lifecycleOver({ bookings: [booking()] });

      const error = await failing(lifecycle.cancel(TENANT, "B-1", {}));

      expect(error.message).to.match(/trigger/);
      expect(adapters.store.writes).to.deep.equal([]);
    });

    it("lets exactly one of two parallel cancellations through: one document, the other a 409", async function () {
      const { adapters, lifecycle } = lifecycleOver({ bookings: [booking()] });

      const results = await Promise.allSettled([
        lifecycle.cancel(TENANT, "B-1", { trigger: TRIGGER.ADMIN }),
        lifecycle.cancel(TENANT, "B-1", { trigger: TRIGGER.SYSTEM }),
      ]);

      expect(results.filter((r) => r.status === "fulfilled")).to.have.length(1);
      const [rejected] = results.filter((r) => r.status === "rejected");
      expect(rejected.reason).to.be.instanceOf(ConflictError);
      expect(adapters.store.writes).to.deep.equal([
        { id: "B-1", status: "cancelled" },
      ]);
      expect(adapters.documents.calls).to.have.length(1);
      expect(
        adapters.store.rows.get("B-1").attachments.map((att) => att.type),
      ).to.deep.equal(["cancellation"]);
    });
  });

  describe("the failure policy", function () {
    it("a revoke that fails is recorded; document and mail follow", async function () {
      const { lifecycle } = lifecycleOver({
        bookings: [booking()],
        failOn: { access: ["revoke"] },
      });

      const outcome = await lifecycle.cancel(TENANT, "B-1", {
        trigger: TRIGGER.ADMIN,
      });

      expect(effectTable(outcome)).to.deep.equal([
        "persist store.save ok",
        "provision access.revoke recorded",
        "document documents.issue ok",
        "notify workflow.emit ok",
        "notify mail.BOOKING_REJECTION skipped",
        "notify mail.BOOKING_CANCEL ok",
      ]);
      expect(outcome.failure).to.equal(null);
    });

    it("a cancellation document that fails is recorded: the booking is cancelled without it, the mail goes out without attachment", async function () {
      const { adapters, lifecycle } = lifecycleOver({
        bookings: [booking()],
        failOn: { documents: ["issue"] },
      });

      const outcome = await lifecycle.cancel(TENANT, "B-1", {
        trigger: TRIGGER.ADMIN,
      });

      expect(effectTable(outcome)[2]).to.equal(
        "document documents.issue recorded",
      );
      expect(outcome.failure).to.equal(null);
      const stored = adapters.store.rows.get("B-1");
      expect(stored.status).to.equal("cancelled");
      expect(stored.attachments).to.deep.equal([]);
      expect(adapters.mail.calls[0].args[1].attachments).to.deep.equal([]);
    });

    it("a cancel mail that fails is recorded; the booking is cancelled", async function () {
      const { adapters, lifecycle } = lifecycleOver({
        bookings: [booking()],
        failOn: { mail: ["BOOKING_CANCEL"] },
      });

      const outcome = await lifecycle.cancel(TENANT, "B-1", {
        trigger: TRIGGER.ADMIN,
      });

      expect(effectTable(outcome).at(-1)).to.equal(
        "notify mail.BOOKING_CANCEL recorded",
      );
      expect(outcome.failure).to.equal(null);
      expect(adapters.store.rows.get("B-1").status).to.equal("cancelled");
    });

    it("a state write that fails aborts: nothing else runs, the booking stays as it was", async function () {
      const { adapters, lifecycle } = lifecycleOver({
        bookings: [booking()],
        failOn: { store: ["save"] },
      });

      const error = await failing(
        lifecycle.cancel(TENANT, "B-1", { trigger: TRIGGER.ADMIN }),
      );

      expect(error).to.be.instanceOf(LifecycleError);
      expect(error.transition).to.equal("cancel");
      expect(effectTable(error.outcome)).to.deep.equal([
        "persist store.save failed",
      ]);
      expect(adapters.store.rows.get("B-1").status).to.equal("confirmed");
      expect(adapters.store.rows.get("B-1").cancellationRefund).to.equal(
        undefined,
      );
      expect(adapters.access.calls).to.deep.equal([]);
      expect(adapters.documents.calls).to.deep.equal([]);
      expect(adapters.mail.calls).to.deep.equal([]);
    });
  });
});

describe("booking lifecycle: requestCancel", function () {
  it("writes a REJECT hook with reason and bank details, the state stays, and mails the verification with the customer's refund preview", async function () {
    const { adapters, lifecycle } = lifecycleOver({
      bookings: [booking()],
      tenant: {
        id: TENANT,
        cancellationRefundTiers: [{ daysBeforeStart: 0, refundPercentage: 50 }],
      },
    });

    const outcome = await lifecycle.requestCancel(TENANT, "B-1", {
      trigger: TRIGGER.CUSTOMER,
      reason: "Krank",
      bankDetails: { accountHolder: " Erika ", iban: "de12 3456", bic: "abc" },
    });

    expect(effectTable(outcome)).to.deep.equal([
      "persist store.save ok",
      "notify mail.VERIFY_BOOKING_REJECTION ok",
    ]);
    expect(outcome).to.include({
      transition: "requestCancel",
      status: "confirmed",
      failure: null,
    });
    const stored = adapters.store.rows.get("B-1");
    expect(stored.status).to.equal("confirmed");
    expect(stored.hooks).to.have.length(1);
    expect(stored.hooks[0]).to.include({ type: "REJECT" });
    expect(stored.hooks[0].payload).to.deep.equal({
      reason: "Krank",
      bankDetails: {
        accountHolder: "Erika",
        bankName: "",
        iban: "DE123456",
        bic: "ABC",
      },
    });
    expect(adapters.store.calls).to.deep.equal([
      { op: "save", args: ["B-1", "confirmed"] },
    ]);
    const [mail] = adapters.mail.calls;
    expect(mail.args[0]).to.equal("VERIFY_BOOKING_REJECTION");
    expect(mail.args[1].bookingIds).to.deep.equal(["B-1"]);
    expect(mail.args[1]).to.include({
      hookId: stored.hooks[0].id,
      reason: "Krank",
    });
    expect(mail.args[1].refundPreview).to.deep.equal({
      bookingId: "B-1",
      originalAmountEur: 40,
      refundAmountEur: 20,
      cancellationFeeEur: 20,
      suggestedRefundPercentage: 50,
      appliedRefundPercentage: 50,
      daysBeforeStart: 10,
      appliedTierDays: 0,
    });
    expect(adapters.access.calls).to.deep.equal([]);
    expect(adapters.documents.calls).to.deep.equal([]);
    expect(adapters.workflow.calls).to.deep.equal([]);
  });

  it("leaves the bank details out of the hook where none are given", async function () {
    const { adapters, lifecycle } = lifecycleOver({ bookings: [booking()] });

    await lifecycle.requestCancel(TENANT, "B-1", {
      trigger: TRIGGER.CUSTOMER,
      reason: "",
      bankDetails: { accountHolder: "  ", iban: "" },
    });

    expect(adapters.store.rows.get("B-1").hooks[0].payload).to.deep.equal({
      reason: "",
    });
  });

  it("refuses a booking whose policy is not user-cancellable: 403 before any effect", async function () {
    const { adapters, lifecycle } = lifecycleOver({
      bookings: [
        booking({
          cancellationPolicy: { userCancellable: false, contactHint: "" },
        }),
      ],
    });

    const error = await failing(
      lifecycle.requestCancel(TENANT, "B-1", { trigger: TRIGGER.CUSTOMER }),
    );

    expect(error).to.be.instanceOf(ForbiddenError);
    expect(error.code).to.equal("booking_user_cancellation_disabled");
    expect(adapters.store.writes).to.deep.equal([]);
    expect(adapters.mail.calls).to.deep.equal([]);
  });

  for (const status of ["rejected", "cancelled"]) {
    it(`refuses a booking that is ${status}: 409 invalid_transition`, async function () {
      const { adapters, lifecycle } = lifecycleOver({
        bookings: [cancelled({ status })],
      });

      const error = await failing(
        lifecycle.requestCancel(TENANT, "B-1", { trigger: TRIGGER.CUSTOMER }),
      );

      expect(error).to.be.instanceOf(ConflictError);
      expect(error.params).to.include({ status, transition: "requestCancel" });
      expect(adapters.store.writes).to.deep.equal([]);
    });
  }

  it("a verification mail that fails is recorded; the hook stands", async function () {
    const { adapters, lifecycle } = lifecycleOver({
      bookings: [booking()],
      failOn: { mail: ["VERIFY_BOOKING_REJECTION"] },
    });

    const outcome = await lifecycle.requestCancel(TENANT, "B-1", {
      trigger: TRIGGER.CUSTOMER,
    });

    expect(effectTable(outcome)).to.deep.equal([
      "persist store.save ok",
      "notify mail.VERIFY_BOOKING_REJECTION recorded",
    ]);
    expect(outcome.failure).to.equal(null);
    expect(adapters.store.rows.get("B-1").hooks).to.have.length(1);
  });
});

describe("booking lifecycle: reinstate", function () {
  it("reinstates a booking cancelled from confirmed: state write without the refund audit, then the grant; no document, no event, no mail", async function () {
    const { adapters, lifecycle } = lifecycleOver({
      bookings: [
        cancelled({
          attachments: [
            { type: "receipt", receiptId: "receipt-1", revision: 1 },
            {
              type: "cancellation",
              cancellationId: "cancellation-1",
              revision: 1,
            },
          ],
        }),
      ],
    });

    const outcome = await lifecycle.reinstate(TENANT, "B-1", {
      trigger: TRIGGER.ADMIN,
    });

    expect(effectTable(outcome)).to.deep.equal([
      "persist store.save ok",
      "provision access.hold skipped",
      "provision access.provision ok",
      "notify mail.ACCESS_PROVISION_FAILED skipped",
    ]);
    expect(outcome).to.include({
      transition: "reinstate",
      status: "confirmed",
      failure: null,
    });
    const stored = adapters.store.rows.get("B-1");
    expect(stored).to.include({
      status: "confirmed",
      priceEur: 40,
      rejectionReason: "",
      isCommitted: true,
      isPayed: true,
      isRejected: false,
    });
    expect(stored).to.not.have.property("cancellationRefund");
    expect(stored.attachments.map((att) => att.type)).to.deep.equal([
      "receipt",
      "cancellation",
    ]);
    expect(adapters.store.calls).to.deep.equal([
      { op: "save", args: ["B-1", "cancelled", ["cancellationRefund"]] },
    ]);
    expect(adapters.access.calls).to.deep.equal([
      { op: "provision", args: [TENANT, "B-1"] },
    ]);
    expect(adapters.documents.calls).to.deep.equal([]);
    expect(adapters.workflow.calls).to.deep.equal([]);
    expect(adapters.mail.calls).to.deep.equal([]);
  });

  it("reinstates a booking cancelled from payment_due: awaiting payment again, the compartments held", async function () {
    const { adapters, lifecycle } = lifecycleOver({
      bookings: [
        cancelled({
          cancellationRefund: {
            ...cancelled().cancellationRefund,
            cancelledFrom: "payment_due",
          },
        }),
      ],
    });

    const outcome = await lifecycle.reinstate(TENANT, "B-1", {
      trigger: TRIGGER.ADMIN,
    });

    expect(effectTable(outcome)).to.deep.equal([
      "persist store.save ok",
      "provision access.hold ok",
      "provision access.provision skipped",
      "notify mail.ACCESS_PROVISION_FAILED skipped",
    ]);
    expect(adapters.store.rows.get("B-1")).to.include({
      status: "payment_due",
      isCommitted: true,
      isPayed: false,
    });
    expect(adapters.access.calls).to.deep.equal([
      { op: "hold", args: [TENANT, "B-1"] },
    ]);
  });

  it("reinstates a rejected request as a request, the compartments held", async function () {
    const { adapters, lifecycle } = lifecycleOver({
      bookings: [
        cancelled({
          status: "rejected",
          cancellationRefund: {
            ...cancelled().cancellationRefund,
            cancelledFrom: undefined,
          },
        }),
      ],
    });

    const outcome = await lifecycle.reinstate(TENANT, "B-1", {
      trigger: TRIGGER.ADMIN,
    });

    expect(effectTable(outcome)).to.deep.equal([
      "persist store.save ok",
      "provision access.hold ok",
      "provision access.provision skipped",
      "notify mail.ACCESS_PROVISION_FAILED skipped",
    ]);
    expect(adapters.store.rows.get("B-1")).to.include({
      status: "requested",
      isCommitted: false,
      isRejected: false,
    });
  });

  it("a hold that fails aborts: the booking is cancelled again, with its refund audit", async function () {
    const { adapters, lifecycle } = lifecycleOver({
      bookings: [
        cancelled({
          cancellationRefund: {
            ...cancelled().cancellationRefund,
            cancelledFrom: "payment_due",
          },
        }),
      ],
      failOn: { access: ["hold"] },
    });

    const error = await failing(
      lifecycle.reinstate(TENANT, "B-1", { trigger: TRIGGER.ADMIN }),
    );

    expect(error).to.be.instanceOf(LifecycleError);
    expect(error.transition).to.equal("reinstate");
    expect(effectTable(error.outcome)).to.deep.equal([
      "persist store.save ok",
      "provision access.hold failed",
    ]);
    expect(error.outcome.failure.compensated).to.deep.equal(["B-1"]);
    const stored = adapters.store.rows.get("B-1");
    expect(stored.status).to.equal("cancelled");
    expect(stored.cancellationRefund).to.include({
      cancelledFrom: "payment_due",
    });
    expect(adapters.store.writes).to.deep.equal([
      { id: "B-1", status: "payment_due" },
      { id: "B-1", status: "cancelled", restored: true },
    ]);
  });

  it("a grant that fails is recorded; the booking is confirmed", async function () {
    const { adapters, lifecycle } = lifecycleOver({
      bookings: [cancelled()],
      failOn: { access: ["provision"] },
    });

    const outcome = await lifecycle.reinstate(TENANT, "B-1", {
      trigger: TRIGGER.ADMIN,
    });

    expect(effectTable(outcome).slice(-2)).to.deep.equal([
      "provision access.provision recorded",
      "notify mail.ACCESS_PROVISION_FAILED ok",
    ]);
    expect(outcome.failure).to.equal(null);
    expect(adapters.store.rows.get("B-1").status).to.equal("confirmed");
  });

  describe("the guard", function () {
    for (const status of ["requested", "payment_due", "confirmed"]) {
      it(`refuses to reinstate a booking that is ${status}: 409 invalid_transition`, async function () {
        const { adapters, lifecycle } = lifecycleOver({
          bookings: [booking({ status })],
        });

        const error = await failing(
          lifecycle.reinstate(TENANT, "B-1", { trigger: TRIGGER.ADMIN }),
        );

        expect(error).to.be.instanceOf(ConflictError);
        expect(error.params).to.include({ status, transition: "reinstate" });
        expect(adapters.store.writes).to.deep.equal([]);
        expect(adapters.access.calls).to.deep.equal([]);
      });
    }

    it("refuses a cancelled booking that does not record where it was cancelled from", async function () {
      const { lifecycle } = lifecycleOver({
        bookings: [
          cancelled({
            cancellationRefund: {
              ...cancelled().cancellationRefund,
              cancelledFrom: undefined,
            },
          }),
        ],
      });

      const error = await failing(
        lifecycle.reinstate(TENANT, "B-1", { trigger: TRIGGER.ADMIN }),
      );

      expect(error).to.be.instanceOf(ConflictError);
    });

    it("demands a trigger", async function () {
      const { lifecycle } = lifecycleOver({ bookings: [cancelled()] });

      const error = await failing(lifecycle.reinstate(TENANT, "B-1", {}));

      expect(error.message).to.match(/trigger/);
    });
  });
});
