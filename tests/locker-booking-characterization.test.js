/**
 * Characterization of what the locker stack leaves behind: what stands in
 * `booking.lockerInfo` and at iFBS and Pareva after a booking is created,
 * held, paid, changed and cancelled. Pinned against booking outcomes and
 * the fake providers, never against `LockerService`, so the same tests
 * take the locker fold off once the checkout runs through `AccessService`
 * (Locker-Fold, ticket 3) - only the shape of `lockerInfo` the spec keeps
 * as a derived read field is asserted.
 *
 * The provider APIs are the fakes of `tests/helpers/`, installed at both
 * seams a locker client is built through, today and after the fold: the
 * locker client registry (`LockerService`) and the access provider registry
 * (`AccessService`). Below that everything is stubbed at the data managers,
 * with an in-memory booking store, so the services run for real.
 */

const assert = require("assert");
const { expect } = require("chai");
const sinon = require("sinon");

process.env.CRYPTO_SECRET =
  process.env.CRYPTO_SECRET || "0123456789abcdef0123456789abcdef";

const BookingService = require("../src/commons/services/checkout/booking-service");
const CheckoutController = require("../src/platform/api/v2/controllers/checkout.controller");
const PaymentController = require("../src/platform/api/controllers/payment-controller");
const BookingManager = require("../src/commons/data-managers/booking-manager");
const {
  BookableManager,
} = require("../src/commons/data-managers/bookable-manager");
const TenantManager = require("../src/commons/data-managers/tenant-manager");
const UserManager = require("../src/commons/data-managers/user-manager");
const EventManager = require("../src/commons/data-managers/event-manager");
const MembershipManager = require("../src/commons/data-managers/membership-manager");
const AccessPointManager = require("../src/commons/data-managers/access-point-manager");
const MediaManager = require("../src/commons/data-managers/media-manager");
const OpeningHoursManager = require("../src/commons/utilities/opening-hours-manager");
const PaymentUtils = require("../src/commons/utilities/payment-utils");
const CouponService = require("../src/commons/services/coupon-service");
const WorkflowService = require("../src/commons/services/workflow/workflow-service");
const MailController = require("../src/commons/mail-service/mail-controller");
const AccessLogService = require("../src/commons/services/access/access-log-service");
const {
  CANCELLATION_ORIGINS,
} = require("../src/commons/services/payment/cancellation-refund-service");
const { CheckoutError } = require("../src/errors/CheckoutError");
const {
  CHECKOUT_REASONS,
} = require("../src/commons/services/checkout/checkout-reasons");
const { Bookable } = require("../src/commons/entities/bookable/bookable");
const { Booking } = require("../src/commons/entities/booking/booking");
const {
  registerClient,
} = require("../src/commons/services/locker/clients/locker-client-registry");
const {
  registerAccessProvider,
} = require("../src/commons/services/access/providers/access-provider-registry");
const IfbsAccessProvider = require("../src/commons/services/access/providers/ifbs-access-provider");
const ParevaAccessProvider = require("../src/commons/services/access/providers/pareva-access-provider");
const IfbsApiClient = require("../src/commons/services/access/clients/ifbs-api-client");
const {
  registerLockerClients,
} = require("../src/commons/services/locker/clients");
const { FakeIfbsApiClient } = require("./helpers/fake-ifbs-api-client");
const { FakeParevaApiClient } = require("./helpers/fake-pareva-api-client");

const TENANT = "tenant-1";
const TENANT_MAIL = "stadt@example.test";
const CUSTOMER = "erika@example.test";
const CUSTOMER_DB_ID = "64f1";
const IFBS_LOCATION = "7";
const BOX_A = "62100103";
const BOX_B = "62100104";
const PAREVA_LOCKER_ID = "L1";
const SIZE_S = "S";
const MINUTE = 60 * 1000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;
const HOLD_TTL_MS = 2 * MINUTE;

// A weekday slot well in the future: what a customer books today.
const TIME_BEGIN = Date.UTC(2027, 5, 21, 10, 0, 0);
const TIME_END = Date.UTC(2027, 5, 21, 12, 0, 0);

const tenant = () => ({
  id: TENANT,
  mail: TENANT_MAIL,
  cancellationRefundTiers: [],
  applications: [
    {
      type: "locker",
      id: "ifbs",
      active: true,
      serverUrl: "https://ifbs.example.test",
      apiKey: "key",
      secretPhrase: "secret-phrase",
    },
    {
      type: "locker",
      id: "pareva",
      active: true,
      serverUrl: "https://pareva.example.test",
      lockerId: PAREVA_LOCKER_ID,
      user: "user",
      password: "password",
    },
  ],
});

function bookable(overrides = {}) {
  return new Bookable({
    tenantId: TENANT,
    type: "resource",
    isBookable: true,
    isScheduleRelated: true,
    autoCommitBooking: true,
    amount: 10,
    permittedUsers: [],
    permittedRoles: [],
    bookingDiscounts: { users: [], roles: [] },
    checkoutBookableIds: [],
    externalProviders: [],
    attachments: [],
    priceType: "per-item",
    priceValueAddedTax: 0,
    priceCategories: [{ priceEur: 5, interval: { start: null, end: null } }],
    ...overrides,
  });
}

/** A bike box bookable: iFBS location 7, two boxes on offer. */
const bikeBox = () =>
  bookable({
    id: "bikebox",
    title: "Fahrradbox",
    lockerDetails: {
      active: true,
      units: [{ lockerSystem: "ifbs", locationId: IFBS_LOCATION, amount: 2 }],
    },
  });

/** A locker bookable: Pareva size S, two compartments on offer. */
const lockerS = () =>
  bookable({
    id: "locker-s",
    title: "Schließfach S",
    lockerDetails: {
      active: true,
      units: [{ id: SIZE_S, lockerSystem: "pareva", amount: "2" }],
    },
  });

/** Installs a client instance in the locker client registry. */
function registerClientInstance(providerId, instance) {
  registerClient(
    providerId,
    class {
      constructor() {
        return instance;
      }
    },
    () => [],
  );
}

describe("locker booking outcomes: what the locker stack leaves at the booking and the providers", function () {
  let ifbs;
  let pareva;
  let store;
  let concurrentBookings;

  /**
   * The fakes, installed at both seams: the locker client registry the
   * `LockerService` path builds clients through, and the access provider
   * registry the `AccessService` path resolves adapters from.
   */
  function installFakeProviders() {
    registerClientInstance("ifbs", ifbs);
    registerClientInstance("pareva", pareva);
    registerAccessProvider(
      "ifbs",
      class extends IfbsAccessProvider {
        constructor() {
          super({ client: ifbs });
        }
      },
    );
    registerAccessProvider(
      "pareva",
      class extends ParevaAccessProvider {
        constructor() {
          super({ client: pareva });
        }
      },
    );
  }

  after(function () {
    registerLockerClients();
    registerAccessProvider("ifbs", IfbsAccessProvider);
    registerAccessProvider("pareva", ParevaAccessProvider);
  });

  beforeEach(function () {
    ifbs = new FakeIfbsApiClient({
      locations: [{ LocationID: IFBS_LOCATION, boxes: [BOX_A, BOX_B] }],
    });
    pareva = new FakeParevaApiClient({
      lockerId: PAREVA_LOCKER_ID,
      sizes: [SIZE_S],
    });
    installFakeProviders();
    store = new Map();
    concurrentBookings = [];
    stubDataManagers();
  });

  afterEach(function () {
    sinon.restore();
  });

  /**
   * The database boundary: an in-memory booking store that hands out copies,
   * as Mongo does, plus everything the checkout reads on the way.
   */
  function stubDataManagers() {
    const bookables = { bikebox: bikeBox(), "locker-s": lockerS() };

    sinon
      .stub(BookingManager, "getBooking")
      .callsFake(async (id) =>
        store.has(id) ? new Booking(clone(store.get(id))) : null,
      );
    sinon
      .stub(BookingManager, "getBookings")
      .callsFake(async (tenantId, ids) =>
        ids
          .filter((id) => store.has(id))
          .map((id) => new Booking(clone(store.get(id)))),
      );
    sinon.stub(BookingManager, "storeBooking").callsFake(async (booking) => {
      store.set(booking.id, clone(booking));
      return booking;
    });
    sinon.stub(BookingManager, "removeBooking").callsFake(async (id) => {
      store.delete(id);
    });
    sinon
      .stub(BookingManager, "getConcurrentBookings")
      .callsFake(async () => concurrentBookings);
    sinon.stub(BookingManager, "getRelatedBookings").resolves([]);
    sinon.stub(BookingManager, "getEventBookings").resolves([]);

    sinon
      .stub(BookableManager, "getBookable")
      .callsFake(async (id) => bookables[id] || null);
    sinon
      .stub(BookableManager, "getBookablesByIds")
      .callsFake(async (tenantId, ids) =>
        ids.map((id) => bookables[id]).filter(Boolean),
      );
    sinon.stub(BookableManager, "getAncestorBookables").resolves([]);
    sinon.stub(BookableManager, "getAllParentBookables").resolves([]);
    sinon.stub(BookableManager, "getRelatedBookables").resolves([]);
    sinon.stub(BookableManager, "getCustomFieldDefinitions").resolves({
      instanceFields: [],
      tenantFields: [],
    });

    sinon.stub(TenantManager, "getTenant").resolves(tenant());
    sinon
      .stub(TenantManager, "getTenantAppByType")
      .callsFake(async (tenantId, type) =>
        tenant().applications.filter((app) => app.type === type),
      );
    sinon.stub(UserManager, "getRawUser").resolves({ _id: CUSTOMER_DB_ID });
    sinon
      .stub(MembershipManager, "getMembershipByTenantAndUserID")
      .resolves({ userId: CUSTOMER, roles: [] });
    sinon
      .stub(MembershipManager, "getMembershipsByTenantAndRoles")
      .resolves([]);
    sinon.stub(EventManager, "getEvent").resolves(null);
    sinon.stub(OpeningHoursManager, "hasOpeningHoursConflict").resolves(false);
    sinon.stub(AccessPointManager, "getAccessPointsByIds").resolves([]);
    sinon.stub(MediaManager, "getBookingDocuments").resolves([]);

    sinon.stub(CouponService, "incrementCouponUsage").resolves();
    sinon.stub(CouponService, "decrementCouponUsage").resolves();
    sinon.stub(WorkflowService, "handleWorkflowEvent").resolves();
    sinon.stub(PaymentUtils, "checkInvoicePermission").resolves(true);
    sinon.stub(AccessLogService, "log").resolves();
    sinon.stub(BookingService, "handleSingleBookingConfirmation").resolves();
    sinon.stub(MailController, "sendBookingRejection").resolves();
    sinon.stub(MailController, "sendBookingCancel").resolves();
  }

  function clone(value) {
    return JSON.parse(JSON.stringify(value));
  }

  const stored = (id) => store.get(id);

  /** A customer's checkout of `amount` of the bookable, unpaid. */
  async function createUnpaidBooking(bookableId, amount = 1) {
    return BookingService.createBooking({
      tenantId: TENANT,
      user: { id: CUSTOMER },
      simulate: false,
      bookingAttempt: {
        timeBegin: TIME_BEGIN,
        timeEnd: TIME_END,
        bookableItems: [{ bookableId, amount }],
        name: "Erika Muster",
        mail: CUSTOMER,
        paymentProvider: "giroCockpit",
        attachmentStatus: [],
      },
    });
  }

  /** A customer's checkout, paid right away. */
  async function createPaidBooking(bookableId, amount = 1) {
    const booking = await createUnpaidBooking(bookableId, amount);
    await BookingService.setBookingPayed({
      tenantId: TENANT,
      bookingId: booking.id,
    });
    return stored(booking.id);
  }

  /** The stored booking, changed by an admin: same customer, new fields. */
  async function updateBooking(booking, changes) {
    return BookingService.updateBooking(TENANT, {
      ...booking,
      isCommitted: true,
      isPayed: true,
      isRejected: false,
      ...changes,
    });
  }

  function rejectBooking(bookingId) {
    return BookingService.rejectBooking(
      TENANT,
      bookingId,
      "Kunde",
      null,
      false,
      true,
      null,
      { origin: CANCELLATION_ORIGINS.SYSTEM },
    );
  }

  describe("creating an unpaid booking", function () {
    it("holds a box at iFBS for the booking's time and notes it at the booking, unconfirmed", async function () {
      const booking = await createUnpaidBooking("bikebox");

      const [info] = stored(booking.id).lockerInfo;
      expect(info).to.include({
        id: IFBS_LOCATION,
        lockerSystem: "ifbs",
        bookableId: "bikebox",
        isConfirmed: false,
        processId: null,
      });
      expect(info.ifbsMetadata).to.include({ nummer: BOX_A });
      const [held] = ifbs.bookingsInState("held");
      expect(held).to.include({
        Booking_ID: "100",
        nummer: BOX_A,
        from: IfbsApiClient.formatDate(TIME_BEGIN),
        to: IfbsApiClient.formatDate(TIME_END),
        userId: `01${CUSTOMER_DB_ID}`,
      });
    });

    it("rolls the booking back when iFBS has no box left", async function () {
      ifbs.locations.get(IFBS_LOCATION).boxes.length = 0;

      await assert.rejects(createUnpaidBooking("bikebox"));

      expect(store.size).to.equal(0);
      expect(ifbs.bookingsInState("held")).to.have.length(0);
    });

    it("notes one Pareva compartment per unit at the booking, unconfirmed, without touching Pareva", async function () {
      const booking = await createUnpaidBooking("locker-s", 2);

      const { lockerInfo } = stored(booking.id);
      expect(lockerInfo).to.have.length(2);
      for (const info of lockerInfo) {
        expect(info).to.include({
          id: SIZE_S,
          lockerSystem: "pareva",
          bookableId: "locker-s",
          isConfirmed: false,
          processId: null,
        });
      }
      expect(pareva.rentals.size).to.equal(0);
    });

    it("counts Pareva compartments against the concurrent bookings of the bookable", async function () {
      concurrentBookings = [
        { lockerInfo: [{ id: SIZE_S, lockerSystem: "pareva" }] },
      ];

      await assert.rejects(createUnpaidBooking("locker-s", 2));
      expect(store.size).to.equal(0);

      const booking = await createUnpaidBooking("locker-s", 1);

      expect(stored(booking.id).lockerInfo).to.have.length(1);
    });
  });

  describe("paying", function () {
    it("confirms the held box with iFBS and marks it confirmed at the booking", async function () {
      const booking = await createUnpaidBooking("bikebox");

      await BookingService.setBookingPayed({
        tenantId: TENANT,
        bookingId: booking.id,
      });

      const [info] = stored(booking.id).lockerInfo;
      expect(info).to.include({
        id: IFBS_LOCATION,
        lockerSystem: "ifbs",
        isConfirmed: true,
        processId: "100",
      });
      expect(info.ifbsMetadata).to.deep.include({
        boxId: `box-${BOX_A}`,
        nummer: BOX_A,
        price: "1.50",
        bookingId: "100",
      });
      expect(ifbs.bookings.get("100").state).to.equal("booked");
    });

    it("takes a fresh box when the hold lapsed before the payment", async function () {
      const clock = sinon.useFakeTimers({
        now: Date.now(),
        toFake: ["Date"],
      });
      const booking = await createUnpaidBooking("bikebox");
      clock.tick(HOLD_TTL_MS + 1);

      await BookingService.setBookingPayed({
        tenantId: TENANT,
        bookingId: booking.id,
      });

      const [info] = stored(booking.id).lockerInfo;
      expect(info).to.include({ isConfirmed: true, processId: "101" });
      expect(ifbs.bookings.get("101").state).to.equal("booked");
      clock.restore();
    });

    it("starts one Pareva rental per compartment, addressed to the customer from the tenant", async function () {
      const booking = await createUnpaidBooking("locker-s", 2);

      await BookingService.setBookingPayed({
        tenantId: TENANT,
        bookingId: booking.id,
      });

      const rentals = pareva.rentalsInState("open");
      expect(rentals).to.have.length(2);
      for (const rental of rentals) {
        expect(rental).to.include({
          size: SIZE_S,
          email: CUSTOMER,
          fromEmail: TENANT_MAIL,
          plannedBegin: String(TIME_BEGIN),
          date_estimate_delivery: String(TIME_END - TIME_BEGIN),
        });
      }
      const { lockerInfo } = stored(booking.id);
      expect(lockerInfo).to.have.length(2);
      for (const info of lockerInfo) {
        expect(info).to.include({ id: SIZE_S, isConfirmed: true });
        expect(rentals.map((rental) => rental.processId)).to.include(
          info.processId,
        );
      }
    });
  });

  describe("before the payment starts", function () {
    // The fake holds the superseded box until its two minutes are up, so a
    // renewal needs a second free box at the location - whether iFBS hands
    // the same box out again to the same user is not known here.
    function paymentServiceStub() {
      return sinon.stub(PaymentUtils, "getPaymentService").resolves({
        createPayment: async () => ({ url: "https://pay.example.test" }),
      });
    }

    it("renews the iFBS hold and notes the box iFBS chose", async function () {
      const booking = await createUnpaidBooking("bikebox");
      paymentServiceStub();

      await CheckoutController._initiatePayment({
        tenantId: TENANT,
        booking: stored(booking.id),
      });

      const [info] = stored(booking.id).lockerInfo;
      expect(info).to.include({ isConfirmed: false, processId: null });
      expect(info.ifbsMetadata).to.include({ nummer: BOX_B });
      expect(ifbs.bookings.get("101").state).to.equal("held");
    });

    it("answers 409 locker_unavailable from the checkout when the hold is lost and no box is left", async function () {
      const booking = await createUnpaidBooking("bikebox");
      // Somebody else booked the other box in the meantime.
      await ifbs.getBox(IFBS_LOCATION, "2027-06-21 10:00", "2027-06-21 12:00");
      paymentServiceStub();

      await assert.rejects(
        CheckoutController._initiatePayment({
          tenantId: TENANT,
          booking: stored(booking.id),
        }),
        (err) => {
          expect(err).to.be.instanceOf(CheckoutError);
          expect(err.reason).to.equal(CHECKOUT_REASONS.LOCKER_UNAVAILABLE);
          expect(err.statusCode).to.equal(409);
          return true;
        },
      );
      expect(PaymentUtils.getPaymentService.called).to.equal(false);
    });

    it("answers 409 from the payment endpoint when the hold is lost and no box is left", async function () {
      const booking = await createUnpaidBooking("bikebox");
      await ifbs.getBox(IFBS_LOCATION, "2027-06-21 10:00", "2027-06-21 12:00");
      const response = {
        status: sinon.stub().returnsThis(),
        send: sinon.stub().returnsThis(),
      };

      await PaymentController.createPayment(
        {
          params: { tenant: TENANT },
          body: { bookingIds: [booking.id], aggregated: false },
          user: { id: CUSTOMER },
        },
        response,
      );

      expect(response.status.firstCall.args).to.deep.equal([409]);
      expect(response.send.firstCall.args[0]).to.include({ code: 3 });
    });

    it("has nothing to renew for Pareva and goes on to the payment provider", async function () {
      const booking = await createUnpaidBooking("locker-s", 2);
      const paymentService = paymentServiceStub();

      const payment = await CheckoutController._initiatePayment({
        tenantId: TENANT,
        booking: stored(booking.id),
      });

      expect(payment.provider).to.equal("giroCockpit");
      expect(paymentService.calledOnce).to.equal(true);
      expect(pareva.rentals.size).to.equal(0);
    });
  });

  describe("changing a paid booking", function () {
    it("moving the booking gives the iFBS box back and books one for the new time", async function () {
      const booking = await createPaidBooking("bikebox");

      await updateBooking(booking, {
        timeBegin: TIME_BEGIN + DAY,
        timeEnd: TIME_END + DAY,
      });

      const [info] = stored(booking.id).lockerInfo;
      expect(info).to.include({
        id: IFBS_LOCATION,
        lockerSystem: "ifbs",
        isConfirmed: true,
        processId: "101",
      });
      expect(ifbs.bookings.get("100").state).to.equal("cancelled");
      expect(ifbs.bookings.get("101")).to.include({
        state: "booked",
        from: IfbsApiClient.formatDate(TIME_BEGIN + DAY),
        to: IfbsApiClient.formatDate(TIME_END + DAY),
      });
    });

    it("raising the amount starts one more Pareva rental", async function () {
      const booking = await createPaidBooking("locker-s", 1);

      await updateBooking(booking, {
        bookableItems: [{ bookableId: "locker-s", amount: 2 }],
      });

      expect(pareva.rentalsInState("open")).to.have.length(2);
      const { lockerInfo } = stored(booking.id);
      expect(lockerInfo).to.have.length(2);
      expect(lockerInfo.every((info) => info.isConfirmed)).to.equal(true);
    });
  });

  describe("cancelling", function () {
    it("gives an iFBS box back before the usage began and leaves the booking without a confirmed box", async function () {
      const booking = await createPaidBooking("bikebox");

      await rejectBooking(booking.id);

      const [info] = stored(booking.id).lockerInfo;
      expect(info).to.include({
        id: IFBS_LOCATION,
        lockerSystem: "ifbs",
        isConfirmed: false,
        processId: null,
      });
      expect(ifbs.bookings.get("100").state).to.equal("cancelled");
    });

    it("ends an iFBS usage that has begun, as of now", async function () {
      const booking = await createPaidBooking("bikebox");
      const clock = sinon.useFakeTimers({
        now: TIME_BEGIN + 10 * MINUTE,
        toFake: ["Date"],
      });

      await rejectBooking(booking.id);

      expect(stored(booking.id).lockerInfo[0]).to.include({
        isConfirmed: false,
        processId: null,
      });
      expect(ifbs.bookings.get("100")).to.include({
        state: "ended",
        endedAt: IfbsApiClient.formatDate(TIME_BEGIN + 10 * MINUTE),
      });
      clock.restore();
    });

    it("cancels the Pareva rental and leaves the booking without a confirmed compartment", async function () {
      const booking = await createPaidBooking("locker-s", 1);

      await rejectBooking(booking.id);

      const [info] = stored(booking.id).lockerInfo;
      expect(info).to.include({
        id: SIZE_S,
        lockerSystem: "pareva",
        isConfirmed: false,
        processId: null,
      });
      expect(pareva.rentalsInState("open")).to.have.length(0);
      expect(pareva.rentalsInState("cancelled")).to.have.length(1);
    });

    it("removing a booking gives its iFBS box back first", async function () {
      const booking = await createPaidBooking("bikebox");

      await BookingService.cancelBooking(TENANT, booking.id);

      expect(store.has(booking.id)).to.equal(false);
      expect(ifbs.bookings.get("100").state).to.equal("cancelled");
    });
  });

  /**
   * Found in passing and pinned as today's behaviour: the locker stack tells
   * the compartments of one size in one booking apart by `id` alone, which
   * is the size. With more than one, every entry of the size ends up with
   * the last rental, and whatever is done to "the" compartment of the size
   * hits all of them - rentals are orphaned at Pareva. The fold keys
   * compartments by (access point, grant) and turns these around.
   */
  describe("defects found in passing: more than one Pareva compartment of one size in one booking", function () {
    it("notes the last rental at every compartment of the size once paid, orphaning the first at Pareva", async function () {
      const booking = await createPaidBooking("locker-s", 2);

      expect(booking.lockerInfo.map((info) => info.processId)).to.deep.equal([
        "process-2",
        "process-2",
      ]);
    });

    it("lowering the amount drops every compartment of the size from the booking and cancels only the noted rental", async function () {
      const booking = await createPaidBooking("locker-s", 2);

      await updateBooking(booking, {
        bookableItems: [{ bookableId: "locker-s", amount: 1 }],
      });

      expect(stored(booking.id).lockerInfo).to.deep.equal([]);
      expect(pareva.rentals.get("process-1").state).to.equal("open");
      expect(pareva.rentals.get("process-2").state).to.equal("cancelled");
    });

    it("cancelling frees every compartment of the size at the booking but only the noted rental at Pareva", async function () {
      const booking = await createPaidBooking("locker-s", 2);

      await rejectBooking(booking.id);

      for (const info of stored(booking.id).lockerInfo) {
        expect(info).to.include({ isConfirmed: false, processId: null });
      }
      expect(pareva.rentals.get("process-1").state).to.equal("open");
      expect(pareva.rentals.get("process-2").state).to.equal("cancelled");
    });
  });
});
