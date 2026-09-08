/**
 * The notice the tenant gets when a grant fails (glossary "Mitteilung";
 * spec part 2, section 4.1): `access.provision` is a recorded operation -
 * the booking stays paid and the customer stands in front of a locked
 * door - so the transition tells the tenant's address that it did.
 *
 * The notice is the last notify step of every transition that grants, and
 * it only goes out where the grant of that run was recorded as failed.
 */

const { expect } = require("chai");

const {
  createBookingLifecycle,
} = require("../src/commons/services/booking-lifecycle/booking-lifecycle");
const {
  createGroupBookingLifecycle,
} = require("../src/commons/services/booking-lifecycle/group-booking-lifecycle");
const {
  TRIGGER,
} = require("../src/commons/services/booking-lifecycle/booking-state");
const {
  inMemoryAdapters,
  effectTable,
} = require("./helpers/in-memory-lifecycle-adapters");

const TENANT = "tenant-1";

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

describe("booking lifecycle: the notice of a failed grant", function () {
  function lifecycleOver(options) {
    const adapters = inMemoryAdapters(options);
    return { adapters, lifecycle: createBookingLifecycle(adapters) };
  }

  function noticeOf(adapters, type) {
    return adapters.mail.calls.find((call) => call.args[0] === type);
  }

  it("pay: a grant that fails tells the tenant, after the notices of the booking", async function () {
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

  it("pay: a grant that holds sends no notice", async function () {
    const { adapters, lifecycle } = lifecycleOver({
      bookings: [booking()],
    });

    const outcome = await lifecycle.pay(TENANT, "B-1", {
      trigger: TRIGGER.ADMIN,
    });

    expect(effectTable(outcome)).to.not.include.members([
      "notify mail.ACCESS_PROVISION_FAILED ok",
      "notify mail.ACCESS_PROVISION_FAILED skipped",
    ]);
    expect(noticeOf(adapters, "ACCESS_PROVISION_FAILED")).to.equal(undefined);
  });

  it("a group sends one notice, naming only the members whose grant failed", async function () {
    const members = ["B-1", "B-2"].map((id) =>
      booking({ id, groupBookingId: "G-1", status: "payment_due" }),
    );
    const adapters = inMemoryAdapters({
      bookings: members,
      groups: [
        {
          id: "G-1",
          tenantId: TENANT,
          bookingIds: ["B-1", "B-2"],
          mail: "erika@example.test",
          hooks: [],
        },
      ],
    });
    // Only the first member's door refuses the grant.
    adapters.access.provision = async (tenantId, bookingId) => {
      adapters.access.calls.push({
        op: "provision",
        args: [tenantId, bookingId],
      });
      if (bookingId === "B-1") {
        throw new Error("door refused");
      }
      return [];
    };
    const lifecycle = createGroupBookingLifecycle(adapters);

    const outcome = await lifecycle.pay(TENANT, "G-1", {
      trigger: TRIGGER.PAYMENT,
    });

    const notices = adapters.mail.calls.filter(
      (call) => call.args[0] === "ACCESS_PROVISION_FAILED",
    );
    expect(notices).to.have.length(1);
    expect(effectTable(outcome)).to.include(
      "notify mail.ACCESS_PROVISION_FAILED ok",
    );
    const [, ctx] = notices[0].args;
    expect(ctx.bookingIds).to.deep.equal(["B-1"]);
    expect(ctx.groupBookingId).to.equal("G-1");
    expect(ctx.reason).to.equal("door refused");
  });

  it("names the booking and the reason the grant gave", async function () {
    const { adapters, lifecycle } = lifecycleOver({
      bookings: [booking()],
      failOn: { access: ["provision"] },
    });

    await lifecycle.pay(TENANT, "B-1", { trigger: TRIGGER.ADMIN });

    const [, ctx] = noticeOf(adapters, "ACCESS_PROVISION_FAILED").args;
    expect(ctx).to.include({ tenantId: TENANT, groupBookingId: null });
    expect(ctx.bookingIds).to.deep.equal(["B-1"]);
    expect(ctx.transition).to.equal("pay");
    expect(ctx.reason).to.equal("access.provision failed (simulated)");
  });
});
