/**
 * The initial state the checkout gives a booking (spec part 1, 5.1): the
 * checkout decides where a booking starts its life and writes it as
 * `status`, the flags of the HTTP form being read, never stored. A
 * self-service booking is a request, or - where every bookable confirms
 * at once - awaits payment or is confirmed for free; a manual booking
 * starts where the administration's flags say, and flags no state stands
 * for are refused before the booking exists.
 */

const assert = require("assert");
const sinon = require("sinon");
const {
  ItemCheckoutService,
} = require("../src/commons/services/checkout/item-checkout-service");
const {
  BundleCheckoutService,
} = require("../src/commons/services/checkout/bundle-checkout-service");
const {
  CheckoutPolicy,
} = require("../src/commons/services/checkout/checkout-policy");
const { Bookable } = require("../src/commons/entities/bookable/bookable");
const MembershipManager = require("../src/commons/data-managers/membership-manager");
const {
  BookableManager,
} = require("../src/commons/data-managers/bookable-manager");
const { BadRequestError } = require("../src/errors/BaseError");

const TENANT_ID = "tenant-1";
const TIME_BEGIN = 1788272933117;
const TIME_END = 1788280133117;

function room({ priceEur = 40, autoCommitBooking = false } = {}) {
  return new Bookable({
    id: "room-a",
    tenantId: TENANT_ID,
    title: "Raum",
    type: "room",
    isBookable: true,
    isScheduleRelated: true,
    autoCommitBooking,
    amount: 10,
    permittedUsers: [],
    permittedRoles: [],
    bookingDiscounts: { users: [], roles: [] },
    checkoutBookableIds: [],
    externalProviders: [],
    attachments: [],
    priceType: "per-item",
    priceValueAddedTax: 0,
    priceCategories: [{ priceEur, interval: { start: null, end: null } }],
    cancellationPolicy: { userCancellable: true },
  });
}

describe("the initial state of a booking at the checkout", function () {
  let bookable;

  beforeEach(function () {
    bookable = room();
    sinon
      .stub(MembershipManager, "getMembershipByTenantAndUserID")
      .resolves({ userId: "kunde@example.com", roles: [] });
    sinon
      .stub(MembershipManager, "getMembershipsByTenantAndRoles")
      .resolves([]);
    sinon.stub(BookableManager, "getBookable").callsFake(async () => bookable);
    sinon
      .stub(BundleCheckoutService.prototype, "generateBookingReference")
      .resolves("TEST-REF");
    sinon.stub(ItemCheckoutService.prototype, "checkAll").resolves(true);
  });

  afterEach(function () {
    sinon.restore();
  });

  function bundle(policy, adminOverrides) {
    return new BundleCheckoutService(
      {
        user: "kunde@example.com",
        tenant: TENANT_ID,
        timeBegin: TIME_BEGIN,
        timeEnd: TIME_END,
        bookableItems: [{ bookableId: "room-a", amount: 1 }],
        email: "kunde@example.com",
      },
      policy,
      adminOverrides,
    );
  }

  describe("a self-service booking", function () {
    it("of a room to be confirmed is a request", async function () {
      const booking = await bundle(
        CheckoutPolicy.SELF_SERVICE,
      ).prepareBooking();

      assert.strictEqual(booking.status, "requested");
      assert.strictEqual("isCommitted" in booking, false);
    });

    it("of a priced room confirmed at once awaits payment", async function () {
      bookable = room({ autoCommitBooking: true });

      const booking = await bundle(
        CheckoutPolicy.SELF_SERVICE,
      ).prepareBooking();

      assert.strictEqual(booking.status, "payment_due");
    });

    it("of a free room confirmed at once is confirmed", async function () {
      bookable = room({ autoCommitBooking: true, priceEur: 0 });

      const booking = await bundle(
        CheckoutPolicy.SELF_SERVICE,
      ).prepareBooking();

      assert.strictEqual(booking.status, "confirmed");
    });
  });

  describe("a manual booking", function () {
    const cases = [
      { flags: {}, status: "requested" },
      { flags: { isCommitted: true }, status: "payment_due" },
      { flags: { isCommitted: true, isPayed: true }, status: "confirmed" },
      {
        flags: { isCommitted: true, isPayed: true, priceEur: 0 },
        status: "confirmed",
      },
      { flags: { isCommitted: false, priceEur: 0 }, status: "requested" },
    ];

    for (const { flags, status } of cases) {
      it(`starts where the flags ${JSON.stringify(flags)} say: ${status}`, async function () {
        const { priceEur, ...adminFlags } = flags;
        if (priceEur !== undefined) {
          bookable = room({ priceEur });
        }

        const booking = await bundle(
          CheckoutPolicy.ADMIN_MANUAL,
          adminFlags,
        ).prepareBooking();

        assert.strictEqual(booking.status, status);
      });
    }

    it("refuses 'paid but not confirmed' with 400 invalid_status: no state stands for it", async function () {
      await assert.rejects(
        bundle(CheckoutPolicy.ADMIN_MANUAL, { isPayed: true }).prepareBooking(),
        (err) =>
          err instanceof BadRequestError &&
          err.code === "invalid_status" &&
          err.params.isPayed === true &&
          err.params.isCommitted === false,
      );
    });

    it("refuses a booking born cancelled with 400 invalid_status", async function () {
      await assert.rejects(
        bundle(CheckoutPolicy.ADMIN_MANUAL, {
          isCommitted: true,
          isRejected: true,
        }).prepareBooking(),
        (err) =>
          err instanceof BadRequestError && err.code === "invalid_status",
      );
    });
  });
});
