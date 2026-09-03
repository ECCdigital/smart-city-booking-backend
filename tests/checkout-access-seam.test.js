/**
 * The checkout on the access seam: where `BookingService` and the two
 * payment entry points call `AccessService` for the compartments of a
 * booking, and what happens when a call fails. Table tests with the seam
 * stubbed - the outcomes at the providers are the characterization test's
 * business (`locker-booking-characterization.test.js`).
 *
 * The policy: a hold that fails in the checkout rolls the booking back
 * (deleted, coupon given back, error rethrown); a grant that fails after
 * the payment leaves the booking as it is - the failure stands in the audit
 * log for the administration. A hold lost before the payment starts is
 * answered as the compartment being unavailable, 409.
 */

const assert = require("assert");
const { expect } = require("chai");
const sinon = require("sinon");

process.env.CRYPTO_SECRET =
  process.env.CRYPTO_SECRET || "0123456789abcdef0123456789abcdef";

const BookingService = require("../src/commons/services/checkout/booking-service");
const CheckoutController = require("../src/platform/api/v2/controllers/checkout.controller");
const PaymentController = require("../src/platform/api/controllers/payment-controller");
const AccessService = require("../src/commons/services/access/access-service");
const BookingManager = require("../src/commons/data-managers/booking-manager");
const {
  BookableManager,
} = require("../src/commons/data-managers/bookable-manager");
const GroupBookingManager = require("../src/commons/data-managers/group-booking-manager");
const CouponService = require("../src/commons/services/coupon-service");
const WorkflowService = require("../src/commons/services/workflow/workflow-service");
const PaymentUtils = require("../src/commons/utilities/payment-utils");
const {
  BundleCheckoutService,
} = require("../src/commons/services/checkout/bundle-checkout-service");
const {
  CheckoutPolicy,
} = require("../src/commons/services/checkout/checkout-policy");
const {
  CHECKOUT_REASONS,
} = require("../src/commons/services/checkout/checkout-reasons");
const { CheckoutError } = require("../src/errors/CheckoutError");
const { Booking } = require("../src/commons/entities/booking/booking");
const MailController = require("../src/commons/mail-service/mail-controller");
const lifecycleDocuments = require("../src/commons/services/booking-lifecycle/adapters/documents");

const TENANT = "tenant-1";
const COUPON = "SAVE10";

function booking(overrides = {}) {
  return new Booking({
    id: "B-1",
    tenantId: TENANT,
    mail: "erika@example.test",
    name: "Erika Muster",
    timeBegin: Date.UTC(2027, 5, 21, 10),
    timeEnd: Date.UTC(2027, 5, 21, 12),
    bookableItems: [{ bookableId: "bikebox", amount: 1 }],
    couponCode: COUPON,
    priceEur: 5,
    paymentProvider: "giroCockpit",
    isCommitted: true,
    isPayed: false,
    isRejected: false,
    accessInfo: [],
    ...overrides,
  });
}

describe("checkout on the access seam", function () {
  afterEach(function () {
    sinon.restore();
  });

  describe("creating a booking", function () {
    let store;
    let seam;

    beforeEach(function () {
      store = new Map();
      sinon.stub(BookingManager, "storeBooking").callsFake(async (value) => {
        store.set(value.id, value);
        return value;
      });
      sinon.stub(BookingManager, "removeBooking").callsFake(async (id) => {
        store.delete(id);
      });
      sinon.stub(BookingManager, "getBooking").resolves(null);
      sinon.stub(BookableManager, "getCustomFieldDefinitions").resolves({
        instanceFields: [],
        tenantFields: [],
      });
      sinon.stub(BookableManager, "getBookable").resolves(null);
      sinon.stub(CouponService, "incrementCouponUsage").resolves();
      sinon.stub(CouponService, "decrementCouponUsage").resolves();
      sinon.stub(WorkflowService, "handleWorkflowEvent").resolves();
      seam = {
        hold: sinon.stub(AccessService, "holdForBooking").resolves([]),
        provision: sinon
          .stub(AccessService, "provisionForBooking")
          .resolves([]),
      };
    });

    function create(prepared) {
      sinon
        .stub(BundleCheckoutService.prototype, "prepareBooking")
        .resolves(prepared);
      return BookingService.createBooking({
        tenantId: TENANT,
        user: { id: "erika@example.test" },
        simulate: false,
        policy: CheckoutPolicy.ADMIN_MANUAL,
        bookingAttempt: {
          timeBegin: prepared.timeBegin,
          timeEnd: prepared.timeEnd,
          bookableItems: prepared.bookableItems,
          couponCode: COUPON,
          mail: prepared.mail,
          isPayed: prepared.isPayed,
          isCommitted: prepared.isCommitted,
        },
      });
    }

    const cases = [
      {
        name: "an unpaid booking is held and kept, nothing granted",
        prepared: booking(),
        fails: null,
        kept: true,
        calls: ["hold"],
      },
      {
        name: "a booking paid at once is held, then granted",
        prepared: booking({ isPayed: true }),
        fails: null,
        kept: true,
        calls: ["hold", "provision"],
      },
      {
        name: "a hold that fails rolls the unpaid booking back",
        prepared: booking(),
        fails: "hold",
        kept: false,
        calls: ["hold"],
      },
      {
        name: "a hold that fails rolls the booking paid at once back, before any grant",
        prepared: booking({ isPayed: true }),
        fails: "hold",
        kept: false,
        calls: ["hold"],
      },
      {
        name: "a grant that fails at the creation rolls the booking back - it never existed for the customer",
        prepared: booking({ isPayed: true }),
        fails: "provision",
        kept: false,
        calls: ["hold", "provision"],
      },
    ];

    for (const { name, prepared, fails, kept, calls } of cases) {
      it(name, async function () {
        const failure = new Error(`${fails} refused`);
        if (fails) {
          seam[fails].rejects(failure);
        }

        if (fails) {
          await assert.rejects(create(prepared), failure);
        } else {
          await create(prepared);
        }

        expect(store.has(prepared.id)).to.equal(kept);
        expect(CouponService.decrementCouponUsage.called).to.equal(!kept);
        expect(
          ["hold", "provision"].filter((call) => seam[call].called),
        ).to.deep.equal(calls);
        if (calls.length === 2) {
          expect(seam.hold.calledBefore(seam.provision)).to.equal(true);
        }
      });
    }
  });

  describe("changing a booking that is not paid", function () {
    /** The stored booking as an admin updates it, the checkout stubbed. */
    function update(stored, changes) {
      sinon.stub(BookingManager, "getBooking").resolves(stored);
      sinon.stub(BookingManager, "storeBooking").callsFake(async (v) => v);
      sinon.stub(WorkflowService, "handleWorkflowEvent").resolves();
      sinon
        .stub(BundleCheckoutService.prototype, "prepareBooking")
        .resolves(new Booking({ ...stored, ...changes }));
      return BookingService.updateBooking(TENANT, { ...stored, ...changes });
    }

    it("takes the grants back and holds the compartments for what it books now", async function () {
      const revoke = sinon.stub(AccessService, "revokeForBooking").resolves([]);
      const hold = sinon.stub(AccessService, "holdForBooking").resolves([]);

      await update(booking(), {
        bookableItems: [{ bookableId: "bikebox", amount: 2 }],
      });

      expect(revoke.calledOnceWith(TENANT, "B-1")).to.equal(true);
      expect(hold.calledOnceWith(TENANT, "B-1")).to.equal(true);
      expect(revoke.calledBefore(hold)).to.equal(true);
    });

    it("holds nothing for a booking that is rejected", async function () {
      sinon.stub(AccessService, "revokeForBooking").resolves([]);
      const hold = sinon.stub(AccessService, "holdForBooking").resolves([]);

      await update(booking({ isRejected: true }), { name: "Erika M." });

      expect(hold.called).to.equal(false);
    });
  });

  describe("after the payment", function () {
    it("leaves a booking paid whose grant fails, the failure being the audit log's", async function () {
      const paid = booking();
      sinon.stub(BookingManager, "getBooking").resolves(paid);
      const stored = sinon
        .stub(BookingManager, "storeBookingIfStatus")
        .callsFake(async (value) => ({ ...value }));
      sinon.stub(WorkflowService, "handleWorkflowEvent").resolves();
      sinon
        .stub(AccessService, "provisionForBooking")
        .rejects(new Error("iFBS refused the box"));
      const issue = sinon.stub(lifecycleDocuments, "issue").resolves({
        attachment: { type: "receipt" },
        file: { name: "RE-1.pdf", buffer: Buffer.from("%PDF") },
      });
      const confirmation = sinon
        .stub(MailController, "sendBookingConfirmation")
        .resolves();

      const result = await BookingService.setBookingPayed({
        tenantId: TENANT,
        bookingId: paid.id,
        trigger: "admin",
      });

      expect(result).to.deep.equal({ success: true });
      expect(stored.firstCall.args[0].isPayed).to.equal(true);
      expect(stored.firstCall.args[1]).to.equal("payment_due");
      expect(issue.calledOnce).to.equal(true);
      expect(confirmation.calledOnce).to.equal(true);
    });

    it("leaves every booking of an aggregated payment paid when one grant fails", async function () {
      const first = booking({ id: "B-1" });
      const second = booking({ id: "B-2" });
      sinon.stub(BookingManager, "getBookings").resolves([first, second]);
      sinon.stub(BookingManager, "storeBooking").callsFake(async (v) => v);
      const provision = sinon.stub(AccessService, "provisionForBooking");
      provision.withArgs(TENANT, "B-1").rejects(new Error("refused"));
      provision.withArgs(TENANT, "B-2").resolves([]);
      sinon
        .stub(BookingService, "handleAggregatedBookingConfirmation")
        .resolves();

      const result = await BookingService.setAggregatedBookingPayed({
        tenantId: TENANT,
        bookingIds: ["B-1", "B-2"],
      });

      expect(result).to.deep.equal({ success: true });
      expect(provision.callCount).to.equal(2);
      expect(first.isPayed).to.equal(true);
      expect(second.isPayed).to.equal(true);
    });
  });

  describe("before the payment starts", function () {
    function paymentService() {
      return sinon.stub(PaymentUtils, "getPaymentService").resolves({
        createPayment: async () => ({ url: "https://pay.example.test" }),
      });
    }

    const refreshOutcomes = [
      { name: "with the holds renewed", lost: false },
      { name: "with a hold lost", lost: true },
    ];

    for (const { name, lost } of refreshOutcomes) {
      it(`the single checkout ${name} ${lost ? "answers 409 locker_unavailable without asking the payment provider" : "goes on to the payment provider"}`, async function () {
        const refresh = sinon.stub(AccessService, "refreshHolds");
        if (lost) {
          refresh.rejects(new Error("No box available"));
        } else {
          refresh.resolves();
        }
        const service = paymentService();

        const attempt = CheckoutController._initiatePayment({
          tenantId: TENANT,
          booking: booking(),
        });

        if (lost) {
          await assert.rejects(attempt, (err) => {
            expect(err).to.be.instanceOf(CheckoutError);
            expect(err.reason).to.equal(CHECKOUT_REASONS.LOCKER_UNAVAILABLE);
            expect(err.statusCode).to.equal(409);
            return true;
          });
          expect(service.called).to.equal(false);
        } else {
          const payment = await attempt;
          expect(payment.provider).to.equal("giroCockpit");
        }
        expect(refresh.firstCall.args).to.deep.equal([TENANT, ["B-1"]]);
      });

      it(`the group checkout ${name} ${lost ? "answers 409 locker_unavailable for the group" : "goes on to the payment provider for every booking"}`, async function () {
        const refresh = sinon.stub(AccessService, "refreshHolds");
        if (lost) {
          refresh.rejects(new Error("No box available"));
        } else {
          refresh.resolves();
        }
        const service = paymentService();

        const attempt = CheckoutController._initiateGroupPayment({
          tenantId: TENANT,
          groupBooking: {
            id: "G-1",
            bookingIds: ["B-1", "B-2"],
            bookings: [booking({ id: "B-1" }), booking({ id: "B-2" })],
          },
          paymentProvider: "giroCockpit",
        });

        if (lost) {
          await assert.rejects(attempt, (err) => {
            expect(err.reason).to.equal(CHECKOUT_REASONS.LOCKER_UNAVAILABLE);
            expect(err.statusCode).to.equal(409);
            return true;
          });
          expect(service.called).to.equal(false);
        } else {
          await attempt;
          expect(service.calledOnce).to.equal(true);
        }
        expect(refresh.firstCall.args).to.deep.equal([TENANT, ["B-1", "B-2"]]);
      });

      it(`the payment endpoint ${name} ${lost ? "answers 409 with code 3" : "creates the payment"}`, async function () {
        sinon.stub(BookingManager, "getBookings").resolves([booking()]);
        sinon
          .stub(GroupBookingManager, "getGroupBookingsByBookingIds")
          .resolves([]);
        const refresh = sinon.stub(AccessService, "refreshHolds");
        if (lost) {
          refresh.rejects(new Error("No box available"));
        } else {
          refresh.resolves();
        }
        const service = paymentService();
        const response = {
          status: sinon.stub().returnsThis(),
          send: sinon.stub().returnsThis(),
          sendStatus: sinon.stub().returnsThis(),
        };

        await PaymentController.createPayment(
          {
            params: { tenant: TENANT },
            body: { bookingIds: ["B-1"], aggregated: false },
            user: { id: "erika@example.test" },
          },
          response,
        );

        if (lost) {
          expect(response.status.firstCall.args).to.deep.equal([409]);
          expect(response.send.firstCall.args[0]).to.include({ code: 3 });
          expect(service.called).to.equal(false);
        } else {
          expect(response.status.firstCall.args).to.deep.equal([200]);
          expect(response.send.firstCall.args[0].paymentData).to.deep.equal({
            url: "https://pay.example.test",
          });
        }
        expect(refresh.firstCall.args).to.deep.equal([TENANT, ["B-1"]]);
      });
    }
  });
});
