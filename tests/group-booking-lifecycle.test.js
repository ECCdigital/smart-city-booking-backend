/**
 * The group booking lifecycle (spec part 1, section 7; part 2, section 9),
 * run over the in-memory adapters against its effect tables as data: every
 * transition writes and provisions member by member, issues one document
 * and sends one mail for the group. A persist write that fails at member k
 * restores the members written before it; a grant that fails at one member
 * is a recorded row of that member; members in different states are the
 * guard's `ConflictError` with the deviating ids, before any effect.
 */

const { expect } = require("chai");

const {
  createGroupBookingLifecycle,
} = require("../src/commons/services/booking-lifecycle/group-booking-lifecycle");
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
const GROUP = "G-1";
const NOW = 1_756_800_000_000;
const DAY = 24 * 60 * 60 * 1000;

function member(id, overrides = {}) {
  return {
    id,
    tenantId: TENANT,
    groupBookingId: GROUP,
    status: "requested",
    priceEur: 40,
    timeBegin: NOW + 10 * DAY,
    timeEnd: NOW + 10 * DAY + 2 * 60 * 60 * 1000,
    paymentProvider: "giroCockpit",
    mail: "erika@example.test",
    name: "Erika Muster",
    attachments: [],
    hooks: [],
    accessInfo: [],
    bookableItems: [
      { bookableId: "room", amount: 1, _bookableUsed: { type: "room" } },
    ],
    ...overrides,
  };
}

function group(bookingIds, overrides = {}) {
  return {
    id: GROUP,
    tenantId: TENANT,
    bookingIds,
    mail: "erika@example.test",
    assignedUserId: "user-1",
    hooks: [],
    ...overrides,
  };
}

/** A lifecycle over a group of two members in the given state. */
function groupOf(status, { failOn, skipOn, members: overrides = {} } = {}) {
  const bookings = [
    member("B-1", { status, ...overrides }),
    member("B-2", { status, ...overrides }),
  ];
  const adapters = inMemoryAdapters({
    bookings,
    groups: [group(["B-1", "B-2"])],
    failOn,
    skipOn,
  });
  return { adapters, lifecycle: createGroupBookingLifecycle(adapters) };
}

async function failing(promise) {
  try {
    await promise;
  } catch (err) {
    return err;
  }
  return null;
}

const states = (adapters) =>
  ["B-1", "B-2"].map((id) => adapters.store.rows.get(id).status);

describe("group booking lifecycle: confirm", function () {
  it("confirms a priced group: the write and the workflow event per member, then one payment request for the group", async function () {
    const { adapters, lifecycle } = groupOf("requested");

    const outcome = await lifecycle.confirm(TENANT, GROUP, {
      trigger: TRIGGER.ADMIN,
    });

    expect(effectTable(outcome)).to.deep.equal([
      "persist store.save B-1 ok",
      "persist store.save B-2 ok",
      "provision access.provision B-1 skipped",
      "provision access.provision B-2 skipped",
      "notify workflow.emit B-1 ok",
      "notify workflow.emit B-2 ok",
      "notify mail.sendFreeBookingConfirmation skipped",
      "notify payment.requestPayment ok",
      "notify mail.sendEmailToOrganizer skipped",
    ]);
    expect(outcome).to.include({
      transition: "confirm",
      status: "payment_due",
      failure: null,
    });
    expect(outcome.bookingIds).to.deep.equal(["B-1", "B-2"]);
    expect(outcome.bookings.map((b) => b.id)).to.deep.equal(["B-1", "B-2"]);
    expect(states(adapters)).to.deep.equal(["payment_due", "payment_due"]);
    expect(adapters.store.calls).to.deep.equal([
      { op: "save", args: ["B-1", "requested"] },
      { op: "save", args: ["B-2", "requested"] },
    ]);
    expect(adapters.workflow.calls).to.deep.equal([
      { op: "emit", args: [TENANT, "B-1", "onCommit"] },
      { op: "emit", args: [TENANT, "B-2", "onCommit"] },
    ]);
    expect(adapters.payment.calls).to.deep.equal([
      {
        op: "requestPayment",
        args: [
          {
            tenantId: TENANT,
            bookingIds: ["B-1", "B-2"],
            paymentProvider: "giroCockpit",
            groupBookingId: GROUP,
          },
        ],
      },
    ]);
    expect(adapters.access.calls).to.deep.equal([]);
    expect(adapters.mail.calls).to.deep.equal([]);
  });
});

describe("group booking lifecycle: confirm, the other cases", function () {
  it("confirms a free group: every member confirmed and granted, one free booking confirmation, no payment request", async function () {
    const { adapters, lifecycle } = groupOf("requested", {
      members: { priceEur: 0 },
    });

    const outcome = await lifecycle.confirm(TENANT, GROUP, {
      trigger: TRIGGER.ADMIN,
    });

    expect(effectTable(outcome)).to.deep.equal([
      "persist store.save B-1 ok",
      "persist store.save B-2 ok",
      "provision access.provision B-1 ok",
      "provision access.provision B-2 ok",
      "notify workflow.emit B-1 ok",
      "notify workflow.emit B-2 ok",
      "notify mail.sendFreeBookingConfirmation ok",
      "notify payment.requestPayment skipped",
      "notify mail.sendEmailToOrganizer skipped",
    ]);
    expect(outcome.status).to.equal("confirmed");
    expect(states(adapters)).to.deep.equal(["confirmed", "confirmed"]);
    expect(adapters.access.calls).to.deep.equal([
      { op: "provision", args: [TENANT, "B-1"] },
      { op: "provision", args: [TENANT, "B-2"] },
    ]);
    const [free] = adapters.mail.calls;
    expect(free.op).to.equal("sendFreeBookingConfirmation");
    expect(free.args[0].map((b) => b.id)).to.deep.equal(["B-1", "B-2"]);
    expect(free.args[1]).to.deep.equal({ aggregated: true });
  });

  it("a group of a priced and a free member: the free one confirmed and granted, the payment request for the group, no shared state afterwards", async function () {
    const { adapters, lifecycle } = groupOf("requested");
    adapters.store.rows.get("B-2").priceEur = 0;

    const outcome = await lifecycle.confirm(TENANT, GROUP, {
      trigger: TRIGGER.ADMIN,
    });

    expect(effectTable(outcome)).to.deep.equal([
      "persist store.save B-1 ok",
      "persist store.save B-2 ok",
      "provision access.provision B-1 skipped",
      "provision access.provision B-2 ok",
      "notify workflow.emit B-1 ok",
      "notify workflow.emit B-2 ok",
      "notify mail.sendFreeBookingConfirmation skipped",
      "notify payment.requestPayment ok",
      "notify mail.sendEmailToOrganizer skipped",
    ]);
    expect(outcome.status).to.equal(null);
    expect(states(adapters)).to.deep.equal(["payment_due", "confirmed"]);
  });

  it("leaves the workflow events out when a workflow action confirmed the group", async function () {
    const { adapters, lifecycle } = groupOf("requested");

    const outcome = await lifecycle.confirm(TENANT, GROUP, {
      trigger: TRIGGER.WORKFLOW,
    });

    expect(effectTable(outcome).slice(4, 6)).to.deep.equal([
      "notify workflow.emit B-1 skipped",
      "notify workflow.emit B-2 skipped",
    ]);
    expect(adapters.workflow.calls).to.deep.equal([]);
  });

  it("mails the organizers of a group with a ticket member, once for the group", async function () {
    const { adapters, lifecycle } = groupOf("requested");
    adapters.store.rows.get("B-2").bookableItems = [
      {
        bookableId: "ticket",
        amount: 1,
        _bookableUsed: { type: "ticket", eventId: "E-1" },
      },
    ];

    const outcome = await lifecycle.confirm(TENANT, GROUP, {
      trigger: TRIGGER.ADMIN,
    });

    expect(effectTable(outcome).at(-1)).to.equal(
      "notify mail.sendEmailToOrganizer ok",
    );
    const organizer = adapters.mail.calls.find(
      (call) => call.op === "sendEmailToOrganizer",
    );
    expect(organizer.args[0].map((b) => b.id)).to.deep.equal(["B-1", "B-2"]);
  });

  it("a tenant without a payment service leaves the payment request skipped; the group awaits payment", async function () {
    const { adapters, lifecycle } = groupOf("requested", {
      skipOn: { payment: ["requestPayment"] },
    });

    const outcome = await lifecycle.confirm(TENANT, GROUP, {
      trigger: TRIGGER.ADMIN,
    });

    expect(effectTable(outcome)).to.include(
      "notify payment.requestPayment skipped",
    );
    expect(states(adapters)).to.deep.equal(["payment_due", "payment_due"]);
  });

  it("a grant that fails at one member of a free group is a recorded row of that member; the group is confirmed and mailed", async function () {
    const { adapters, lifecycle } = groupOf("requested", {
      members: { priceEur: 0 },
    });
    adapters.access.provision = async (tenantId, bookingId) => {
      adapters.access.calls.push({
        op: "provision",
        args: [tenantId, bookingId],
      });
      if (bookingId === "B-2") {
        throw new Error("access.provision failed (simulated)");
      }
      return [];
    };

    const outcome = await lifecycle.confirm(TENANT, GROUP, {
      trigger: TRIGGER.ADMIN,
    });

    expect(effectTable(outcome)).to.deep.equal([
      "persist store.save B-1 ok",
      "persist store.save B-2 ok",
      "provision access.provision B-1 ok",
      "provision access.provision B-2 recorded",
      "notify workflow.emit B-1 ok",
      "notify workflow.emit B-2 ok",
      "notify mail.sendFreeBookingConfirmation ok",
      "notify payment.requestPayment skipped",
      "notify mail.sendEmailToOrganizer skipped",
    ]);
    const recorded = outcome.effects.find((e) => e.status === "recorded");
    expect(recorded.bookingId).to.equal("B-2");
    expect(recorded.error.message).to.equal(
      "access.provision failed (simulated)",
    );
    expect(outcome.failure).to.equal(null);
    expect(states(adapters)).to.deep.equal(["confirmed", "confirmed"]);
  });

  it("a write that fails at member 2 restores member 1 and aborts: nothing else runs, the group is still requested", async function () {
    const { adapters, lifecycle } = groupOf("requested", {
      failOn: { store: ["save B-2"] },
    });

    const error = await failing(
      lifecycle.confirm(TENANT, GROUP, { trigger: TRIGGER.ADMIN }),
    );

    expect(error).to.be.instanceOf(LifecycleError);
    expect(error.transition).to.equal("confirm");
    expect(error.effect).to.include({
      adapter: "store",
      op: "save",
      bookingId: "B-2",
    });
    expect(effectTable(error.outcome)).to.deep.equal([
      "persist store.save B-1 ok",
      "persist store.save B-2 failed",
    ]);
    expect(error.outcome.bookingIds).to.deep.equal(["B-1", "B-2"]);
    expect(error.outcome.failure.compensated).to.deep.equal(["B-1"]);
    expect(error.outcome.status).to.equal("requested");
    expect(states(adapters)).to.deep.equal(["requested", "requested"]);
    expect(adapters.store.writes).to.deep.equal([
      { id: "B-1", status: "payment_due" },
      { id: "B-1", status: "requested", restored: true },
    ]);
    expect(adapters.workflow.calls).to.deep.equal([]);
    expect(adapters.payment.calls).to.deep.equal([]);
    expect(adapters.mail.calls).to.deep.equal([]);
  });
});

describe("group booking lifecycle: the guards", function () {
  it("refuses a group whose members differ in state: 409 invalid_transition naming the members that deviate from the first, before any effect", async function () {
    const { adapters, lifecycle } = groupOf("requested");
    adapters.store.rows.get("B-2").status = "payment_due";

    const error = await failing(
      lifecycle.confirm(TENANT, GROUP, { trigger: TRIGGER.ADMIN }),
    );

    expect(error).to.be.instanceOf(ConflictError);
    expect(error.code).to.equal("invalid_transition");
    expect(error.params).to.deep.equal({
      groupBookingId: GROUP,
      status: "requested",
      transition: "confirm",
      bookingIds: ["B-2"],
    });
    expect(adapters.store.calls).to.deep.equal([]);
    expect(adapters.workflow.calls).to.deep.equal([]);
  });

  for (const [transition, status] of [
    ["confirm", "payment_due"],
    ["pay", "requested"],
    ["cancel", "cancelled"],
    ["admit", "rejected"],
  ]) {
    it(`refuses to ${transition} a group that is ${status}: 409 invalid_transition before any effect`, async function () {
      const { adapters, lifecycle } = groupOf(status);
      if (status === "cancelled") {
        for (const id of ["B-1", "B-2"]) {
          adapters.store.rows.get(id).cancellationRefund = {
            cancelledFrom: "confirmed",
          };
        }
      }

      const error = await failing(
        lifecycle[transition](TENANT, GROUP, { trigger: TRIGGER.ADMIN }),
      );

      expect(error).to.be.instanceOf(ConflictError);
      expect(error.code).to.equal("invalid_transition");
      expect(adapters.store.calls).to.deep.equal([]);
      expect(adapters.documents.calls).to.deep.equal([]);
      expect(adapters.mail.calls).to.deep.equal([]);
    });
  }

  it("answers group_booking_not_found for a group it does not know", async function () {
    const { lifecycle } = groupOf("requested");

    const error = await failing(
      lifecycle.confirm(TENANT, "G-9", { trigger: TRIGGER.ADMIN }),
    );

    expect(error).to.be.instanceOf(NotFoundError);
    expect(error.code).to.equal("group_booking_not_found");
  });

  it("answers booking_not_found naming the members the store does not hold", async function () {
    const { adapters, lifecycle } = groupOf("requested");
    adapters.store.rows.delete("B-2");

    const error = await failing(
      lifecycle.pay(TENANT, GROUP, { trigger: TRIGGER.ADMIN }),
    );

    expect(error).to.be.instanceOf(NotFoundError);
    expect(error.code).to.equal("booking_not_found");
    expect(error.params.bookingIds).to.deep.equal(["B-2"]);
  });

  it("refuses a group of another tenant as not found", async function () {
    const { lifecycle } = groupOf("requested");

    const error = await failing(
      lifecycle.confirm("tenant-2", GROUP, { trigger: TRIGGER.ADMIN }),
    );

    expect(error).to.be.instanceOf(NotFoundError);
  });

  it("demands a trigger", async function () {
    const { adapters, lifecycle } = groupOf("requested");

    const error = await failing(lifecycle.confirm(TENANT, GROUP, {}));

    expect(error.message).to.match(/needs a trigger/);
    expect(adapters.store.calls).to.deep.equal([]);
  });

  it("lets exactly one of two parallel payments through: one receipt, the other a 409 with the first member written back", async function () {
    const { adapters, lifecycle } = groupOf("payment_due");

    const [first, second] = await Promise.allSettled([
      lifecycle.pay(TENANT, GROUP, { trigger: TRIGGER.PAYMENT }),
      lifecycle.pay(TENANT, GROUP, { trigger: TRIGGER.PAYMENT }),
    ]);

    const outcomes = [first, second].filter((r) => r.status === "fulfilled");
    const errors = [first, second].filter((r) => r.status === "rejected");
    expect(outcomes).to.have.length(1);
    expect(errors).to.have.length(1);
    expect(errors[0].reason).to.be.instanceOf(ConflictError);
    expect(states(adapters)).to.deep.equal(["confirmed", "confirmed"]);
    expect(
      adapters.documents.calls.filter((call) => call.op === "issue"),
    ).to.have.length(1);
    for (const id of ["B-1", "B-2"]) {
      expect(
        adapters.store.rows.get(id).attachments.map((att) => att.receiptId),
      ).to.deep.equal(["receipt-1"]);
    }
  });
});

describe("group booking lifecycle: pay", function () {
  it("pays a group: write and grant per member, one aggregated receipt at every member, the workflow event per member, one confirmation with the receipt", async function () {
    const { adapters, lifecycle } = groupOf("payment_due");

    const outcome = await lifecycle.pay(TENANT, GROUP, {
      trigger: TRIGGER.ADMIN,
      paymentMethod: "CASH",
    });

    expect(effectTable(outcome)).to.deep.equal([
      "persist store.save B-1 ok",
      "persist store.save B-2 ok",
      "provision access.provision B-1 ok",
      "provision access.provision B-2 ok",
      "document documents.issue ok",
      "notify workflow.emit B-1 ok",
      "notify workflow.emit B-2 ok",
      "notify mail.sendBookingConfirmation ok",
      "notify mail.sendEmailToOrganizer skipped",
    ]);
    expect(outcome).to.include({
      transition: "pay",
      status: "confirmed",
      failure: null,
    });
    expect(states(adapters)).to.deep.equal(["confirmed", "confirmed"]);
    for (const id of ["B-1", "B-2"]) {
      const stored = adapters.store.rows.get(id);
      expect(stored).to.include({
        status: "confirmed",
        isPayed: true,
        paymentMethod: "CASH",
        timePaid: NOW,
      });
      expect(stored.attachments.map((att) => att.receiptId)).to.deep.equal([
        "receipt-1",
      ]);
    }
    expect(outcome.bookings.map((b) => b.attachments.length)).to.deep.equal([
      1, 1,
    ]);
    expect(adapters.store.calls).to.deep.equal([
      { op: "save", args: ["B-1", "payment_due"] },
      { op: "save", args: ["B-2", "payment_due"] },
    ]);
    const [issue] = adapters.documents.calls;
    expect(issue.args[0]).to.include({
      tenantId: TENANT,
      type: "receipt",
      groupBookingId: GROUP,
    });
    expect(issue.args[0].bookingIds).to.deep.equal(["B-1", "B-2"]);
    expect(adapters.workflow.calls).to.deep.equal([
      { op: "emit", args: [TENANT, "B-1", "onPay"] },
      { op: "emit", args: [TENANT, "B-2", "onPay"] },
    ]);
    const [confirmation] = adapters.mail.calls;
    expect(confirmation.op).to.equal("sendBookingConfirmation");
    expect(confirmation.args[0].map((b) => b.id)).to.deep.equal(["B-1", "B-2"]);
    expect(confirmation.args[1].attachments.map((f) => f.name)).to.deep.equal([
      "receipt-1.pdf",
    ]);
    expect(confirmation.args[1].aggregated).to.equal(true);
  });

  it("keeps the time of the payment the caller names, the same for every member", async function () {
    const { adapters, lifecycle } = groupOf("payment_due");

    await lifecycle.pay(TENANT, GROUP, {
      trigger: TRIGGER.PAYMENT,
      timePaid: 1_700_000_000_000,
    });

    expect(
      ["B-1", "B-2"].map((id) => adapters.store.rows.get(id).timePaid),
    ).to.deep.equal([1_700_000_000_000, 1_700_000_000_000]);
  });

  it("a receipt that fails is recorded: the group is paid without it, the confirmation goes out without attachment", async function () {
    const { adapters, lifecycle } = groupOf("payment_due", {
      failOn: { documents: ["issue"] },
    });

    const outcome = await lifecycle.pay(TENANT, GROUP, {
      trigger: TRIGGER.PAYMENT,
    });

    expect(effectTable(outcome)).to.include(
      "document documents.issue recorded",
    );
    expect(states(adapters)).to.deep.equal(["confirmed", "confirmed"]);
    const [confirmation] = adapters.mail.calls;
    expect(confirmation.args[1].attachments).to.deep.equal([]);
  });

  it("a write that fails at member 2 restores member 1: no grant, no receipt, no mail, the group still awaits payment", async function () {
    const { adapters, lifecycle } = groupOf("payment_due", {
      failOn: { store: ["save B-2"] },
    });

    const error = await failing(
      lifecycle.pay(TENANT, GROUP, { trigger: TRIGGER.PAYMENT }),
    );

    expect(error).to.be.instanceOf(LifecycleError);
    expect(error.outcome.failure.compensated).to.deep.equal(["B-1"]);
    expect(states(adapters)).to.deep.equal(["payment_due", "payment_due"]);
    expect(adapters.store.rows.get("B-1").timePaid).to.equal(undefined);
    expect(adapters.access.calls).to.deep.equal([]);
    expect(adapters.documents.calls).to.deep.equal([]);
    expect(adapters.mail.calls).to.deep.equal([]);
  });
});

describe("group booking lifecycle: cancel", function () {
  const REFUND = {
    originalAmountEur: 40,
    appliedRefundPercentage: 100,
    refundAmountEur: 40,
  };

  it("cancels a paid group: write with the refund audit and revoke per member, one aggregated cancellation document, the workflow event per member, one cancel mail with the document", async function () {
    const { adapters, lifecycle } = groupOf("confirmed");

    const outcome = await lifecycle.cancel(TENANT, GROUP, {
      trigger: TRIGGER.ADMIN,
      reason: "Halle gesperrt",
      cancelledByUserId: "admin-1",
    });

    expect(effectTable(outcome)).to.deep.equal([
      "persist store.save B-1 ok",
      "persist store.save B-2 ok",
      "provision access.revoke B-1 ok",
      "provision access.revoke B-2 ok",
      "document documents.issue ok",
      "notify workflow.emit B-1 ok",
      "notify workflow.emit B-2 ok",
      "notify mail.sendBookingRejection skipped",
      "notify mail.sendBookingCancel ok",
    ]);
    expect(outcome.status).to.equal("cancelled");
    for (const id of ["B-1", "B-2"]) {
      const stored = adapters.store.rows.get(id);
      expect(stored).to.include({
        status: "cancelled",
        rejectionReason: "Halle gesperrt",
        isRejected: true,
        isPayed: true,
      });
      expect(stored.cancellationRefund).to.include({
        ...REFUND,
        origin: "admin",
        cancelledByUserId: "admin-1",
        cancelledAt: NOW,
        cancelledFrom: "confirmed",
      });
      expect(stored.attachments.map((att) => att.cancellationId)).to.deep.equal(
        ["cancellation-1"],
      );
    }
    expect(adapters.store.calls).to.deep.equal([
      { op: "save", args: ["B-1", "confirmed"] },
      { op: "save", args: ["B-2", "confirmed"] },
    ]);
    const [issue] = adapters.documents.calls;
    expect(issue.args[0]).to.include({
      type: "cancellation",
      groupBookingId: GROUP,
    });
    expect(issue.args[0].options).to.include({
      alreadyPaid: true,
      cancellationReason: "Halle gesperrt",
      bankDetails: undefined,
    });
    expect(
      issue.args[0].options.refundCalculations.map((r) => r.bookingId),
    ).to.deep.equal(["B-1", "B-2"]);
    expect(issue.args[0].options.refundCalculations[0]).to.include(REFUND);
    expect(adapters.workflow.calls).to.deep.equal([
      { op: "emit", args: [TENANT, "B-1", "onReject"] },
      { op: "emit", args: [TENANT, "B-2", "onReject"] },
    ]);
    const [cancelMail] = adapters.mail.calls;
    expect(cancelMail.op).to.equal("sendBookingCancel");
    expect(cancelMail.args[1].attachments.map((f) => f.name)).to.deep.equal([
      "cancellation-1.pdf",
    ]);
    expect(cancelMail.args[1]).to.include({
      aggregated: true,
      reason: "Halle gesperrt",
    });
  });

  it("cancels a group awaiting payment: cancelled from payment_due, the document without alreadyPaid", async function () {
    const { adapters, lifecycle } = groupOf("payment_due");

    const outcome = await lifecycle.cancel(TENANT, GROUP, {
      trigger: TRIGGER.ADMIN,
    });

    expect(outcome.status).to.equal("cancelled");
    for (const id of ["B-1", "B-2"]) {
      const stored = adapters.store.rows.get(id);
      expect(stored).to.include({ status: "cancelled", isPayed: false });
      expect(stored.cancellationRefund.cancelledFrom).to.equal("payment_due");
    }
    expect(adapters.documents.calls[0].args[0].options.alreadyPaid).to.equal(
      false,
    );
  });

  it("rejects a group of requests: rejected, the document, the rejection mail", async function () {
    const { adapters, lifecycle } = groupOf("requested");

    const outcome = await lifecycle.cancel(TENANT, GROUP, {
      trigger: TRIGGER.ADMIN,
      reason: "Kein Platz",
    });

    expect(effectTable(outcome).slice(-2)).to.deep.equal([
      "notify mail.sendBookingRejection ok",
      "notify mail.sendBookingCancel skipped",
    ]);
    expect(states(adapters)).to.deep.equal(["rejected", "rejected"]);
    expect(
      adapters.store.rows.get("B-1").cancellationRefund.cancelledFrom,
    ).to.equal(undefined);
    const [rejection] = adapters.mail.calls;
    expect(rejection.op).to.equal("sendBookingRejection");
    expect(rejection.args[1].attachments.map((f) => f.name)).to.deep.equal([
      "cancellation-1.pdf",
    ]);
  });

  it("cancels a free group without a document", async function () {
    const { adapters, lifecycle } = groupOf("confirmed", {
      members: { priceEur: 0 },
    });

    const outcome = await lifecycle.cancel(TENANT, GROUP, {
      trigger: TRIGGER.ADMIN,
    });

    expect(effectTable(outcome)).to.include("document documents.issue skipped");
    expect(adapters.documents.calls).to.deep.equal([]);
    expect(adapters.mail.calls[0].args[1].attachments).to.deep.equal([]);
  });

  it("leaves the document out where the caller says so", async function () {
    const { adapters, lifecycle } = groupOf("confirmed");

    const outcome = await lifecycle.cancel(TENANT, GROUP, {
      trigger: TRIGGER.ADMIN,
      withDocument: false,
    });

    expect(effectTable(outcome)).to.include("document documents.issue skipped");
    expect(adapters.documents.calls).to.deep.equal([]);
  });

  it("an admin refund percentage overrides the tiers for every member and the bank details reach the document", async function () {
    const { adapters, lifecycle } = groupOf("confirmed");

    await lifecycle.cancel(TENANT, GROUP, {
      trigger: TRIGGER.ADMIN,
      refundPercentage: 25,
      bankDetails: {
        iban: "de89 3704 0044 0532 0130 00",
        bic: " cobadeffxxx ",
      },
    });

    expect(
      ["B-1", "B-2"].map(
        (id) => adapters.store.rows.get(id).cancellationRefund,
      ),
    ).to.satisfy((audits) =>
      audits.every(
        (audit) =>
          audit.appliedRefundPercentage === 25 && audit.refundAmountEur === 10,
      ),
    );
    expect(adapters.documents.calls[0].args[0].options.bankDetails).to.include({
      iban: "DE89370400440532013000",
      bic: "COBADEFFXXX",
    });
  });

  it("takes the moment of the cancellation from the caller and leaves the workflow events out for a workflow action", async function () {
    const { adapters, lifecycle } = groupOf("confirmed");

    const outcome = await lifecycle.cancel(TENANT, GROUP, {
      trigger: TRIGGER.WORKFLOW,
      cancelledAt: NOW - DAY,
    });

    expect(effectTable(outcome).slice(5, 7)).to.deep.equal([
      "notify workflow.emit B-1 skipped",
      "notify workflow.emit B-2 skipped",
    ]);
    expect(adapters.store.rows.get("B-2").cancellationRefund).to.include({
      cancelledAt: NOW - DAY,
      origin: "system",
    });
  });

  it("a revoke that fails at one member is recorded; document and mail follow", async function () {
    const { adapters, lifecycle } = groupOf("confirmed");
    adapters.access.revoke = async (tenantId, bookingId) => {
      adapters.access.calls.push({ op: "revoke", args: [tenantId, bookingId] });
      if (bookingId === "B-1") {
        throw new Error("access.revoke failed (simulated)");
      }
      return [];
    };

    const outcome = await lifecycle.cancel(TENANT, GROUP, {
      trigger: TRIGGER.ADMIN,
    });

    expect(effectTable(outcome).slice(2, 5)).to.deep.equal([
      "provision access.revoke B-1 recorded",
      "provision access.revoke B-2 ok",
      "document documents.issue ok",
    ]);
    expect(adapters.mail.calls).to.have.length(1);
  });

  it("a cancel mail that fails is recorded; the group is cancelled", async function () {
    const { adapters, lifecycle } = groupOf("confirmed", {
      failOn: { mail: ["sendBookingCancel"] },
    });

    const outcome = await lifecycle.cancel(TENANT, GROUP, {
      trigger: TRIGGER.ADMIN,
    });

    expect(effectTable(outcome).at(-1)).to.equal(
      "notify mail.sendBookingCancel recorded",
    );
    expect(outcome.failure).to.equal(null);
    expect(states(adapters)).to.deep.equal(["cancelled", "cancelled"]);
  });

  it("a write that fails at member 2 restores member 1: no revoke, no document, no mail, the group stands", async function () {
    const { adapters, lifecycle } = groupOf("confirmed", {
      failOn: { store: ["save B-2"] },
    });

    const error = await failing(
      lifecycle.cancel(TENANT, GROUP, { trigger: TRIGGER.ADMIN }),
    );

    expect(error).to.be.instanceOf(LifecycleError);
    expect(error.outcome.failure.compensated).to.deep.equal(["B-1"]);
    expect(states(adapters)).to.deep.equal(["confirmed", "confirmed"]);
    expect(adapters.store.rows.get("B-1").cancellationRefund).to.equal(
      undefined,
    );
    expect(adapters.access.calls).to.deep.equal([]);
    expect(adapters.documents.calls).to.deep.equal([]);
    expect(adapters.mail.calls).to.deep.equal([]);
  });

  it("answers tenant_not_found where the tenant is gone", async function () {
    const bookings = [member("B-1"), member("B-2")];
    const adapters = inMemoryAdapters({
      bookings,
      groups: [group(["B-1", "B-2"])],
      tenant: null,
    });
    const lifecycle = createGroupBookingLifecycle(adapters);

    const error = await failing(
      lifecycle.cancel(TENANT, GROUP, { trigger: TRIGGER.ADMIN }),
    );

    expect(error).to.be.instanceOf(NotFoundError);
    expect(error.code).to.equal("tenant_not_found");
  });
});

describe("group booking lifecycle: admit", function () {
  it("admits a group of requests: one request confirmation, the tenant's and the supervisors' notice", async function () {
    const { adapters, lifecycle } = groupOf("requested");

    const outcome = await lifecycle.admit(TENANT, GROUP, {
      trigger: TRIGGER.CUSTOMER,
    });

    expect(effectTable(outcome)).to.deep.equal([
      "document documents.issue skipped",
      "notify mail.sendRequestConfirmation ok",
      "notify mail.sendBookingConfirmation skipped",
      "notify mail.sendTenantMail ok",
      "notify mail.sendSupervisorMail ok",
    ]);
    expect(outcome).to.include({
      transition: "admit",
      status: "requested",
      failure: null,
    });
    expect(adapters.store.calls).to.deep.equal([]);
    expect(adapters.mail.calls.map((call) => call.op)).to.deep.equal([
      "sendRequestConfirmation",
      "sendTenantMail",
      "sendSupervisorMail",
    ]);
    for (const call of adapters.mail.calls) {
      expect(call.args[0].map((b) => b.id)).to.deep.equal(["B-1", "B-2"]);
      expect(call.args[1].aggregated).to.equal(true);
    }
  });

  it("admits a group confirmed at once but unpaid: the confirmation without a receipt (as before; ticket 9 aligns it with the table)", async function () {
    const { adapters, lifecycle } = groupOf("payment_due");

    const outcome = await lifecycle.admit(TENANT, GROUP, {
      trigger: TRIGGER.CUSTOMER,
    });

    expect(effectTable(outcome)).to.deep.equal([
      "document documents.issue skipped",
      "notify mail.sendRequestConfirmation skipped",
      "notify mail.sendBookingConfirmation ok",
      "notify mail.sendTenantMail ok",
      "notify mail.sendSupervisorMail ok",
    ]);
    expect(adapters.mail.calls[0].args[1].attachments).to.deep.equal([]);
  });

  it("admits a group confirmed and paid at once: one aggregated receipt at every member, the confirmation with it", async function () {
    const { adapters, lifecycle } = groupOf("confirmed");

    const outcome = await lifecycle.admit(TENANT, GROUP, {
      trigger: TRIGGER.ADMIN,
    });

    expect(effectTable(outcome)).to.deep.equal([
      "document documents.issue ok",
      "notify mail.sendRequestConfirmation skipped",
      "notify mail.sendBookingConfirmation ok",
      "notify mail.sendTenantMail ok",
      "notify mail.sendSupervisorMail ok",
    ]);
    for (const id of ["B-1", "B-2"]) {
      expect(
        adapters.store.rows.get(id).attachments.map((att) => att.receiptId),
      ).to.deep.equal(["receipt-1"]);
    }
    expect(
      adapters.mail.calls[0].args[1].attachments.map((f) => f.name),
    ).to.deep.equal(["receipt-1.pdf"]);
  });

  it("admits a free group confirmed at once without a receipt", async function () {
    const { adapters, lifecycle } = groupOf("confirmed", {
      members: { priceEur: 0 },
    });

    const outcome = await lifecycle.admit(TENANT, GROUP, {
      trigger: TRIGGER.CUSTOMER,
    });

    expect(effectTable(outcome)[0]).to.equal(
      "document documents.issue skipped",
    );
    expect(adapters.documents.calls).to.deep.equal([]);
  });

  it("a tenant that wants no notice leaves that mail skipped; a mail that fails is recorded, the rest goes out", async function () {
    const { adapters, lifecycle } = groupOf("requested", {
      failOn: { mail: ["sendRequestConfirmation"] },
    });
    adapters.mail.skipOn.add("sendTenantMail");

    const outcome = await lifecycle.admit(TENANT, GROUP, {
      trigger: TRIGGER.CUSTOMER,
    });

    expect(effectTable(outcome)).to.deep.equal([
      "document documents.issue skipped",
      "notify mail.sendRequestConfirmation recorded",
      "notify mail.sendBookingConfirmation skipped",
      "notify mail.sendTenantMail skipped",
      "notify mail.sendSupervisorMail ok",
    ]);
    expect(outcome.failure).to.equal(null);
  });
});
