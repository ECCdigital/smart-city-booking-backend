/**
 * The transition `amend` of the booking lifecycle (spec part 2, section 8),
 * run over the in-memory adapters against its effect table as data: the
 * content write in the state the booking is in, then the access moved
 * along at `confirmed`, the compartments held anew at `requested |
 * payment_due`, nothing at `rejected | cancelled`. No document, no
 * workflow event, no mail.
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
const { Booking } = require("../src/commons/entities/booking/booking");
const {
  inMemoryAdapters,
  effectTable,
} = require("./helpers/in-memory-lifecycle-adapters");

const TENANT = "tenant-1";
const NOW = 1_756_800_000_000;
const DAY = 24 * 60 * 60 * 1000;
const HOUR = 60 * 60 * 1000;

function booking(overrides = {}) {
  return {
    id: "B-1",
    tenantId: TENANT,
    status: "confirmed",
    priceEur: 40,
    timeBegin: NOW + 10 * DAY,
    timeEnd: NOW + 10 * DAY + 2 * HOUR,
    paymentProvider: "giroCockpit",
    mail: "erika@example.test",
    name: "Erika Muster",
    comment: "",
    attachments: [],
    hooks: [],
    accessInfo: [],
    bookableItems: [
      { bookableId: "room", amount: 1, _bookableUsed: { type: "room" } },
    ],
    ...overrides,
  };
}

/** The booking as the admin PUT hands it in: moved by a day, a comment. */
function amended(overrides = {}) {
  return new Booking(
    booking({
      timeBegin: NOW + 11 * DAY,
      timeEnd: NOW + 11 * DAY + 2 * HOUR,
      comment: "Bitte Beamer",
      ...overrides,
    }),
  );
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

describe("booking lifecycle: amend", function () {
  it("amends a confirmed booking: the content write, then the access moved along; no document, no event, no mail", async function () {
    const { adapters, lifecycle } = lifecycleOver({ bookings: [booking()] });

    const outcome = await lifecycle.amend(TENANT, amended(), {
      trigger: TRIGGER.ADMIN,
    });

    expect(effectTable(outcome)).to.deep.equal([
      "persist store.save ok",
      "provision access.update ok",
      "provision access.hold skipped",
      "provision access.revoke skipped",
    ]);
    expect(outcome).to.include({
      transition: "amend",
      bookingId: "B-1",
      status: "confirmed",
      failure: null,
    });
    const stored = adapters.store.rows.get("B-1");
    expect(stored).to.include({
      status: "confirmed",
      timeBegin: NOW + 11 * DAY,
      comment: "Bitte Beamer",
      isCommitted: true,
      isPayed: true,
      isRejected: false,
    });
    expect(adapters.store.calls).to.deep.equal([
      { op: "save", args: ["B-1", "confirmed"] },
    ]);
    const [update] = adapters.access.calls;
    expect(update.op).to.equal("update");
    expect(update.args[0]).to.equal(TENANT);
    expect(update.args[1]).to.include({ id: "B-1", timeBegin: NOW + 10 * DAY });
    expect(update.args[2]).to.include({ id: "B-1", timeBegin: NOW + 11 * DAY });
    expect(adapters.documents.calls).to.deep.equal([]);
    expect(adapters.workflow.calls).to.deep.equal([]);
    expect(adapters.mail.calls).to.deep.equal([]);
  });

  for (const status of ["requested", "payment_due"]) {
    it(`amends a booking at ${status}: the content write, the compartments held anew, then what is granted taken back`, async function () {
      const { adapters, lifecycle } = lifecycleOver({
        bookings: [booking({ status })],
      });

      const outcome = await lifecycle.amend(TENANT, amended({ status }), {
        trigger: TRIGGER.ADMIN,
      });

      expect(effectTable(outcome)).to.deep.equal([
        "persist store.save ok",
        "provision access.update skipped",
        "provision access.hold ok",
        "provision access.revoke ok",
      ]);
      expect(outcome.status).to.equal(status);
      expect(adapters.store.rows.get("B-1")).to.include({
        status,
        comment: "Bitte Beamer",
      });
      expect(adapters.store.calls).to.deep.equal([
        { op: "save", args: ["B-1", status] },
      ]);
      expect(adapters.access.calls).to.deep.equal([
        { op: "hold", args: [TENANT, "B-1"] },
        { op: "revoke", args: [TENANT, "B-1"] },
      ]);
      expect(adapters.documents.calls).to.deep.equal([]);
      expect(adapters.workflow.calls).to.deep.equal([]);
      expect(adapters.mail.calls).to.deep.equal([]);
    });
  }

  it("amends a rejected request: the content write and nothing else", async function () {
    const { adapters, lifecycle } = lifecycleOver({
      bookings: [
        booking({
          status: "rejected",
          rejectionReason: "Kein Platz",
          cancellationRefund: { cancelledAt: NOW, origin: "admin" },
        }),
      ],
    });

    const outcome = await lifecycle.amend(
      TENANT,
      amended({ status: "rejected", rejectionReason: "Kein Platz" }),
      { trigger: TRIGGER.ADMIN },
    );

    expect(effectTable(outcome)).to.deep.equal([
      "persist store.save ok",
      "provision access.update skipped",
      "provision access.hold skipped",
      "provision access.revoke skipped",
    ]);
    expect(adapters.store.rows.get("B-1")).to.include({
      status: "rejected",
      comment: "Bitte Beamer",
      isRejected: true,
    });
    expect(adapters.access.calls).to.deep.equal([]);
  });

  it("amends a cancelled booking: the content write keeps the refund audit the form does not carry, nothing else", async function () {
    const audit = {
      cancelledAt: NOW,
      originalAmountEur: 40,
      appliedRefundPercentage: 50,
      refundAmountEur: 20,
      origin: "admin",
      cancelledFrom: "confirmed",
    };
    const { adapters, lifecycle } = lifecycleOver({
      bookings: [
        booking({
          status: "cancelled",
          rejectionReason: "Irrtum",
          cancellationRefund: audit,
        }),
      ],
    });

    const form = amended({ status: "cancelled", rejectionReason: "Irrtum" });
    delete form.cancellationRefund;
    const outcome = await lifecycle.amend(TENANT, form, {
      trigger: TRIGGER.ADMIN,
    });

    expect(effectTable(outcome)).to.deep.equal([
      "persist store.save ok",
      "provision access.update skipped",
      "provision access.hold skipped",
      "provision access.revoke skipped",
    ]);
    const stored = adapters.store.rows.get("B-1");
    expect(stored).to.include({
      status: "cancelled",
      comment: "Bitte Beamer",
      isCommitted: true,
      isPayed: true,
      isRejected: true,
    });
    expect(stored.cancellationRefund).to.deep.equal(audit);
    expect(adapters.access.calls).to.deep.equal([]);
  });

  it("writes the state the caller knows, the refund audit the store holds: an audit the form carries at a live booking is dropped", async function () {
    const { adapters, lifecycle } = lifecycleOver({
      bookings: [booking({ status: "requested" })],
    });

    const form = amended({ status: "requested" });
    form.cancellationRefund = { origin: "admin", cancelledFrom: "confirmed" };
    const outcome = await lifecycle.amend(TENANT, form, {
      trigger: TRIGGER.ADMIN,
    });

    expect(outcome.status).to.equal("requested");
    const stored = adapters.store.rows.get("B-1");
    expect(stored).to.include({
      status: "requested",
      isCommitted: false,
      isRejected: false,
    });
    expect(stored.cancellationRefund).to.equal(undefined);
  });

  it("refuses a caller whose state is stale: the form says requested, a payment moved the booking on - ConflictError, nothing written", async function () {
    const { adapters, lifecycle } = lifecycleOver({
      bookings: [booking({ status: "payment_due" })],
    });

    const err = await failing(
      lifecycle.amend(TENANT, amended({ status: "requested" }), {
        trigger: TRIGGER.ADMIN,
      }),
    );

    expect(err).to.be.instanceOf(ConflictError);
    expect(err.code).to.equal("invalid_transition");
    expect(err.params).to.deep.equal({
      bookingId: "B-1",
      status: "payment_due",
      transition: "amend",
    });
    expect(adapters.store.rows.get("B-1")).to.include({
      status: "payment_due",
      comment: "",
    });
    expect(adapters.store.calls).to.deep.equal([
      { op: "save", args: ["B-1", "requested"] },
    ]);
    expect(adapters.access.calls).to.deep.equal([]);
  });

  it("a hold that fails aborts before anything is revoked: the old content is back, LifecycleError", async function () {
    const { adapters, lifecycle } = lifecycleOver({
      bookings: [booking({ status: "payment_due" })],
      failOn: { access: ["hold"] },
    });

    const err = await failing(
      lifecycle.amend(TENANT, amended({ status: "payment_due" }), {
        trigger: TRIGGER.ADMIN,
      }),
    );

    expect(err).to.be.instanceOf(LifecycleError);
    expect(err.transition).to.equal("amend");
    expect(err.effect).to.include({ adapter: "access", op: "hold" });
    expect(effectTable(err.outcome)).to.deep.equal([
      "persist store.save ok",
      "provision access.update skipped",
      "provision access.hold failed",
    ]);
    expect(err.outcome.failure.compensated).to.deep.equal(["B-1"]);
    expect(err.outcome.status).to.equal("payment_due");
    expect(adapters.store.rows.get("B-1")).to.include({
      status: "payment_due",
      timeBegin: NOW + 10 * DAY,
      comment: "",
    });
    expect(adapters.store.calls).to.deep.equal([
      { op: "save", args: ["B-1", "payment_due"] },
      { op: "restore", args: ["B-1"] },
    ]);
    expect(adapters.access.calls).to.deep.equal([
      { op: "hold", args: [TENANT, "B-1"] },
    ]);
  });

  it("an update of the access that fails is recorded: the content stands", async function () {
    const { adapters, lifecycle } = lifecycleOver({
      bookings: [booking()],
      failOn: { access: ["update"] },
    });

    const outcome = await lifecycle.amend(TENANT, amended(), {
      trigger: TRIGGER.ADMIN,
    });

    expect(effectTable(outcome)).to.deep.equal([
      "persist store.save ok",
      "provision access.update recorded",
      "provision access.hold skipped",
      "provision access.revoke skipped",
    ]);
    expect(outcome.failure).to.equal(null);
    expect(adapters.store.rows.get("B-1")).to.include({
      comment: "Bitte Beamer",
    });
  });

  it("a content write that fails aborts with nothing else run", async function () {
    const { adapters, lifecycle } = lifecycleOver({
      bookings: [booking()],
      failOn: { store: ["save"] },
    });

    const err = await failing(
      lifecycle.amend(TENANT, amended(), { trigger: TRIGGER.ADMIN }),
    );

    expect(err).to.be.instanceOf(LifecycleError);
    expect(effectTable(err.outcome)).to.deep.equal([
      "persist store.save failed",
    ]);
    expect(adapters.store.rows.get("B-1").comment).to.equal("");
    expect(adapters.access.calls).to.deep.equal([]);
  });

  it("refuses an unknown booking before any effect", async function () {
    const { adapters, lifecycle } = lifecycleOver({ bookings: [] });

    const err = await failing(
      lifecycle.amend(TENANT, amended(), { trigger: TRIGGER.ADMIN }),
    );

    expect(err).to.be.instanceOf(NotFoundError);
    expect(err.code).to.equal("booking_not_found");
    expect(adapters.store.calls).to.deep.equal([]);
  });

  it("needs a trigger", async function () {
    const { lifecycle } = lifecycleOver({ bookings: [booking()] });

    const err = await failing(lifecycle.amend(TENANT, amended(), {}));

    expect(err).to.be.instanceOf(Error);
    expect(err.message).to.match(/amend needs a trigger/);
  });
});

describe("booking lifecycle: amend keeps an open cancellation request", function () {
  it("carries the hooks of the stored booking, whatever the form says: the cancellation request belongs to the lifecycle", async function () {
    const hook = { id: "H-1", type: "REJECT", payload: { reason: "Krank" } };
    const { adapters, lifecycle } = lifecycleOver({
      bookings: [booking({ hooks: [hook] })],
    });

    await lifecycle.amend(TENANT, amended({ hooks: [] }), {
      trigger: TRIGGER.ADMIN,
    });

    const stored = adapters.store.rows.get("B-1");
    expect(stored.comment).to.equal("Bitte Beamer");
    expect(stored.hooks.map((h) => h.id)).to.deep.equal(["H-1"]);
  });
});
