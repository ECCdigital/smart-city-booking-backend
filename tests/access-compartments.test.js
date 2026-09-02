/**
 * Compartments on the access seam: what `AccessService` leaves at the
 * booking's `accessInfo` and at the providers when a booking of a locker
 * system is held, renewed, provisioned, changed and revoked, and how the
 * compartments are listed and operated afterwards.
 *
 * Locker systems are real rows of the `accesspoints` collection here, one
 * per iFBS location and one per Pareva size, referenced by the bookables
 * like doors. The providers are the fakes of `tests/helpers/`; below them
 * the data managers are stubbed with an in-memory booking store, so the
 * service runs for real.
 */

const assert = require("assert");
const { expect } = require("chai");
const sinon = require("sinon");

process.env.CRYPTO_SECRET =
  process.env.CRYPTO_SECRET || "0123456789abcdef0123456789abcdef";

const AccessService = require("../src/commons/services/access/access-service");
const BookingManager = require("../src/commons/data-managers/booking-manager");
const {
  BookableManager,
} = require("../src/commons/data-managers/bookable-manager");
const TenantManager = require("../src/commons/data-managers/tenant-manager");
const UserManager = require("../src/commons/data-managers/user-manager");
const AccessPointManager = require("../src/commons/data-managers/access-point-manager");
const AccessLogService = require("../src/commons/services/access/access-log-service");
const PermissionsService = require("../src/commons/services/permission-service");
const MailController = require("../src/commons/mail-service/mail-controller");
const {
  registerAccessProvider,
} = require("../src/commons/services/access/providers/access-provider-registry");
const IfbsAccessProvider = require("../src/commons/services/access/providers/ifbs-access-provider");
const ParevaAccessProvider = require("../src/commons/services/access/providers/pareva-access-provider");
const {
  ACCESS_BLOCKING_REASONS,
} = require("../src/commons/services/access/access-blocking-reasons");
const { Booking } = require("../src/commons/entities/booking/booking");
const { FakeIfbsApiClient } = require("./helpers/fake-ifbs-api-client");
const { FakeParevaApiClient } = require("./helpers/fake-pareva-api-client");

const TENANT = "tenant-1";
const CUSTOMER = "erika@example.test";
const IFBS_LOCATION = "7";
const BOX_A = "62100103";
const BOX_B = "62100104";
const PAREVA_LOCKER_ID = "L1";
const SIZE_S = "S";
const MINUTE = 60 * 1000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;
const HOLD_TTL_MS = 2 * MINUTE;

const BIKE_BOXES = {
  id: "loc-7",
  tenantId: TENANT,
  type: "locker",
  provider: "ifbs",
  externalId: IFBS_LOCATION,
  providerLocationId: IFBS_LOCATION,
  label: "Fahrradboxen Bahnhof",
  mode: "remote",
  validationRules: [],
  scanCode: "code-loc-7",
};

const SIZE_S_LOCKERS = {
  id: "size-s",
  tenantId: TENANT,
  type: "locker",
  provider: "pareva",
  externalId: SIZE_S,
  providerLocationId: PAREVA_LOCKER_ID,
  label: "Schließfach S",
  mode: "authorization",
  validationRules: [],
  scanCode: "code-size-s",
};

const tenant = () => ({
  id: TENANT,
  mail: "stadt@example.test",
  applications: [
    {
      type: "access",
      id: "ifbs",
      active: true,
      serverUrl: "https://ifbs.example.test",
      apiKey: "key",
      secretPhrase: "secret-phrase",
    },
    {
      type: "access",
      id: "pareva",
      active: true,
      serverUrl: "https://pareva.example.test",
      lockerId: PAREVA_LOCKER_ID,
      user: "user",
      password: "password",
    },
  ],
});

/** A bookable of `amount` compartments at the given locker systems. */
function bookable(id, title, accessPointIds, amount = 2) {
  return {
    id,
    title,
    amount,
    accessPointDetails: { active: true, accessPointIds },
  };
}

const BOOKABLES = {
  bikebox: bookable("bikebox", "Fahrradbox", [BIKE_BOXES.id]),
  "locker-s": bookable("locker-s", "Schließfach S", [SIZE_S_LOCKERS.id]),
};

describe("Compartments on the access seam", function () {
  let ifbs;
  let pareva;
  let store;
  let concurrentBookings;
  let now;

  after(function () {
    registerAccessProvider("ifbs", IfbsAccessProvider);
    registerAccessProvider("pareva", ParevaAccessProvider);
  });

  beforeEach(function () {
    now = Date.now();
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

  /** The fakes, installed where the service resolves its adapters. */
  function installFakeProviders() {
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

  afterEach(function () {
    sinon.restore();
  });

  function stubDataManagers() {
    sinon
      .stub(BookingManager, "getBooking")
      .callsFake(async (id) =>
        store.has(id) ? new Booking(clone(store.get(id))) : null,
      );
    sinon.stub(BookingManager, "storeBooking").callsFake(async (booking) => {
      store.set(booking.id, clone(booking));
      return booking;
    });
    sinon
      .stub(BookingManager, "getConcurrentBookings")
      .callsFake(async () => concurrentBookings);
    sinon
      .stub(BookableManager, "getBookablesByIds")
      .callsFake(async (tenantId, ids) =>
        ids.map((id) => BOOKABLES[id]).filter(Boolean),
      );
    sinon.stub(BookableManager, "getRelatedBookables").resolves([]);
    sinon.stub(BookableManager, "getAllParentBookables").resolves([]);
    sinon
      .stub(AccessPointManager, "getAccessPointsByIds")
      .callsFake(async (tenantId, ids) =>
        [BIKE_BOXES, SIZE_S_LOCKERS].filter((row) => ids.includes(row.id)),
      );
    sinon.stub(TenantManager, "getTenant").resolves(tenant());
    sinon.stub(UserManager, "getRawUser").resolves({ _id: "64f1" });
    sinon.stub(AccessLogService, "log").resolves();
    sinon.stub(MailController, "sendAccessProvisioned").resolves();
    sinon.stub(PermissionsService, "_isOwner").returns(true);
  }

  function clone(value) {
    return JSON.parse(JSON.stringify(value));
  }

  /** A committed booking of `amount` of the bookable, stored, running now. */
  function storeBooking(bookableId, amount = 1, overrides = {}) {
    const booking = {
      id: "booking-1",
      tenantId: TENANT,
      assignedUserId: "user-1",
      mail: CUSTOMER,
      isCommitted: true,
      isPayed: true,
      isRejected: false,
      priceEur: 0,
      timeBegin: now - 5 * MINUTE,
      timeEnd: now + 55 * MINUTE,
      bookableItems: [{ bookableId, amount }],
      accessInfo: [],
      ...overrides,
    };
    store.set(booking.id, clone(booking));
    return booking;
  }

  const stored = () => store.get("booking-1");
  const compartments = () =>
    stored().accessInfo.filter((info) => info.accessPointType === "locker");

  function logged(action) {
    return AccessLogService.log.args
      .map(([entry]) => entry)
      .filter((entry) => entry.action === action);
  }

  describe("holdForBooking", function () {
    it("makes one entry per compartment at the iFBS location and holds a box for it, unconfirmed", async function () {
      storeBooking("bikebox");

      await AccessService.holdForBooking(TENANT, "booking-1");

      expect(compartments()).to.have.length(1);
      const [entry] = compartments();
      expect(entry).to.deep.include({
        accessPointId: BIKE_BOXES.id,
        accessPointType: "locker",
        provider: "ifbs",
        externalId: IFBS_LOCATION,
        bookableId: "bikebox",
        hold: {
          holdId: "100",
          expiresAt: entry.hold.expiresAt,
          compartment: BOX_A,
        },
        compartment: BOX_A,
        externalBookingId: null,
        grant: null,
        isProvisioned: false,
        revokedAt: null,
      });
      expect(entry.hold.expiresAt).to.be.within(
        now + HOLD_TTL_MS - MINUTE,
        now + HOLD_TTL_MS + MINUTE,
      );
      expect(ifbs.bookingsInState("held")).to.have.length(1);
    });

    it("fails, leaving the booking as it was, when iFBS has no box left", async function () {
      ifbs.locations.get(IFBS_LOCATION).boxes.length = 0;
      storeBooking("bikebox");

      await assert.rejects(AccessService.holdForBooking(TENANT, "booking-1"));

      expect(stored().accessInfo).to.deep.equal([]);
      expect(logged("hold").map((entry) => entry.result)).to.deep.equal([
        "failure",
      ]);
    });

    it("makes one entry per Pareva compartment with an empty hold - the stored booking is the claim - without touching Pareva", async function () {
      storeBooking("locker-s", 2);

      await AccessService.holdForBooking(TENANT, "booking-1");

      expect(compartments()).to.have.length(2);
      for (const entry of compartments()) {
        expect(entry).to.deep.include({
          accessPointId: SIZE_S_LOCKERS.id,
          provider: "pareva",
          bookableId: "locker-s",
          hold: { holdId: null, expiresAt: null, compartment: null },
          compartment: null,
          grant: null,
          isProvisioned: false,
        });
      }
      expect(pareva.rentals.size).to.equal(0);
    });

    it("refuses Pareva compartments beyond the amount of the bookable, counting the concurrent bookings and its own", async function () {
      concurrentBookings = [
        {
          id: "booking-0",
          bookableItems: [{ bookableId: "locker-s", amount: 1 }],
        },
      ];
      storeBooking("locker-s", 2);

      await assert.rejects(
        AccessService.holdForBooking(TENANT, "booking-1"),
        (err) => {
          expect(err.statusCode).to.equal(409);
          return true;
        },
      );
    });

    it("lets a Pareva booking through that fits the amount of the bookable", async function () {
      concurrentBookings = [
        {
          id: "booking-0",
          bookableItems: [{ bookableId: "locker-s", amount: 1 }],
        },
      ];
      storeBooking("locker-s", 1);

      await AccessService.holdForBooking(TENANT, "booking-1");

      expect(compartments()).to.have.length(1);
    });

    it("holds nothing twice: entries that are held already are left alone", async function () {
      storeBooking("bikebox");
      await AccessService.holdForBooking(TENANT, "booking-1");

      await AccessService.holdForBooking(TENANT, "booking-1");

      expect(compartments()).to.have.length(1);
      expect(ifbs.bookingsInState("held")).to.have.length(1);
    });

    it("leaves a booking without a locker system untouched", async function () {
      storeBooking("bikebox", 1, {
        bookableItems: [{ bookableId: "room", amount: 1 }],
      });

      const accessInfo = await AccessService.holdForBooking(
        TENANT,
        "booking-1",
      );

      expect(accessInfo).to.deep.equal([]);
    });

    it("notes what iFBS said about the box beyond its number - id and price - for the booking's read field", async function () {
      storeBooking("bikebox");

      await AccessService.holdForBooking(TENANT, "booking-1");

      expect(compartments()[0].metadata).to.deep.equal({
        boxId: `box-${BOX_A}`,
        price: "1.50",
      });
    });

    it("drops compartments only held beyond what the booking books now - an unpaid booking lowered its amount", async function () {
      storeBooking("locker-s", 2);
      await AccessService.holdForBooking(TENANT, "booking-1");
      const booking = stored();
      booking.bookableItems = [{ bookableId: "locker-s", amount: 1 }];
      store.set(booking.id, booking);

      await AccessService.holdForBooking(TENANT, "booking-1");

      expect(compartments()).to.have.length(1);
    });

    it("drops the held compartments of a locker system the booking no longer books, and keeps granted ones for the revoke", async function () {
      storeBooking("bikebox");
      await AccessService.holdForBooking(TENANT, "booking-1");
      const booking = stored();
      booking.bookableItems = [{ bookableId: "room", amount: 1 }];
      store.set(booking.id, booking);

      await AccessService.holdForBooking(TENANT, "booking-1");

      expect(compartments()).to.have.length(0);
    });
  });

  describe("refreshHolds", function () {
    it("renews the iFBS hold and notes the box iFBS chose this time", async function () {
      storeBooking("bikebox");
      await AccessService.holdForBooking(TENANT, "booking-1");

      await AccessService.refreshHolds(TENANT, ["booking-1"]);

      const [entry] = compartments();
      expect(entry.hold).to.include({ holdId: "101", compartment: BOX_B });
      expect(entry.compartment).to.equal(BOX_B);
      expect(ifbs.bookings.get("101").state).to.equal("held");
    });

    it("fails when the hold is lost and no box is left", async function () {
      storeBooking("bikebox");
      await AccessService.holdForBooking(TENANT, "booking-1");
      await ifbs.getBox(IFBS_LOCATION, "2027-06-21 10:00", "2027-06-21 12:00");

      await assert.rejects(AccessService.refreshHolds(TENANT, ["booking-1"]));
    });

    it("takes a hold for a compartment the provider never held for - an entry made without one", async function () {
      storeBooking("bikebox");
      await AccessService.holdForBooking(TENANT, "booking-1");
      const booking = stored();
      booking.accessInfo[0].hold = null;
      store.set(booking.id, booking);

      await AccessService.refreshHolds(TENANT, ["booking-1"]);

      expect(compartments()[0].hold).to.include({ holdId: "101" });
      expect(ifbs.bookingsInState("held")).to.have.length(2);
    });

    it("has nothing to renew for Pareva and for compartments granted already", async function () {
      storeBooking("locker-s", 1);
      await AccessService.holdForBooking(TENANT, "booking-1");

      await AccessService.refreshHolds(TENANT, ["booking-1", "booking-gone"]);

      expect(compartments()[0].hold).to.deep.equal({
        holdId: null,
        expiresAt: null,
        compartment: null,
      });
      expect(pareva.rentals.size).to.equal(0);
    });
  });

  describe("provisionForBooking", function () {
    it("confirms the held iFBS box as the grant and consumes the hold", async function () {
      storeBooking("bikebox");
      await AccessService.holdForBooking(TENANT, "booking-1");

      await AccessService.provisionForBooking(TENANT, "booking-1");

      const [entry] = compartments();
      expect(entry).to.deep.include({
        isProvisioned: true,
        revokedAt: null,
        hold: null,
        compartment: BOX_A,
        externalBookingId: "100",
        grant: {
          authorizationId: "100",
          externalPrincipalId: null,
          secret: null,
        },
      });
      expect(ifbs.bookings.get("100").state).to.equal("booked");
      const [provision] = logged("provision");
      expect(provision).to.include({
        accessPointId: `${BIKE_BOXES.id}:100`,
        accessPointType: "locker",
        result: "success",
      });
    });

    it("takes a fresh box when the hold lapsed, and notes that box", async function () {
      storeBooking("bikebox");
      await AccessService.holdForBooking(TENANT, "booking-1");
      const clock = sinon.useFakeTimers({ now: now, toFake: ["Date"] });
      clock.tick(HOLD_TTL_MS + 1);

      await AccessService.provisionForBooking(TENANT, "booking-1");

      const [entry] = compartments();
      expect(entry.grant.authorizationId).to.equal("101");
      expect(entry.compartment).to.equal(ifbs.bookings.get("101").nummer);
      clock.restore();
    });

    it("grants a booking that was never held - it makes the entries and takes the box at once", async function () {
      storeBooking("bikebox");

      await AccessService.provisionForBooking(TENANT, "booking-1");

      const [entry] = compartments();
      expect(entry).to.include({ isProvisioned: true, compartment: BOX_A });
      expect(entry.grant.authorizationId).to.equal("100");
    });

    it("starts one Pareva rental per compartment, each its own grant", async function () {
      storeBooking("locker-s", 2);
      await AccessService.holdForBooking(TENANT, "booking-1");

      await AccessService.provisionForBooking(TENANT, "booking-1");

      const entries = compartments();
      expect(entries.map((entry) => entry.grant.authorizationId)).to.deep.equal(
        ["process-1", "process-2"],
      );
      expect(entries.every((entry) => entry.isProvisioned)).to.equal(true);
      expect(entries.every((entry) => entry.hold === null)).to.equal(true);
      expect(pareva.rentalsInState("open")).to.have.length(2);
      expect(MailController.sendAccessProvisioned.called).to.equal(false);
    });

    it("grants nothing twice", async function () {
      storeBooking("bikebox");
      await AccessService.provisionForBooking(TENANT, "booking-1");

      await AccessService.provisionForBooking(TENANT, "booking-1");

      expect(compartments()).to.have.length(1);
      expect(ifbs.bookings.size).to.equal(1);
    });

    it("keeps the grants made before one is refused, so the next attempt grants nothing twice", async function () {
      storeBooking("locker-s", 2);
      const startRental = pareva.startRental.bind(pareva);
      let calls = 0;
      pareva.startRental = async (...args) => {
        calls += 1;
        if (calls === 2) {
          throw new Error("Pareva is down");
        }
        return startRental(...args);
      };

      await assert.rejects(
        AccessService.provisionForBooking(TENANT, "booking-1"),
        /Pareva is down/,
      );

      const granted = compartments().filter((entry) => entry.grant);
      expect(granted).to.have.length(1);
      expect(granted[0].grant.authorizationId).to.equal("process-1");
      pareva.startRental = startRental;

      await AccessService.provisionForBooking(TENANT, "booking-1");

      expect(pareva.rentalsInState("open")).to.have.length(2);
      expect(
        compartments().map((entry) => entry.grant.authorizationId),
      ).to.deep.equal(["process-1", "process-2"]);
    });

    it("audits a refused grant and rethrows it", async function () {
      ifbs.locations.get(IFBS_LOCATION).boxes.length = 0;
      storeBooking("bikebox");

      await assert.rejects(
        AccessService.provisionForBooking(TENANT, "booking-1"),
      );

      expect(logged("provision").map((entry) => entry.result)).to.deep.equal([
        "failure",
      ]);
    });

    it("keeps the box facts of the hold it consumed, and takes those of a fresh box", async function () {
      storeBooking("bikebox");
      await AccessService.holdForBooking(TENANT, "booking-1");

      await AccessService.provisionForBooking(TENANT, "booking-1");

      expect(compartments()[0].metadata).to.deep.equal({
        boxId: `box-${BOX_A}`,
        price: "1.50",
      });

      const clock = sinon.useFakeTimers({ now: now, toFake: ["Date"] });
      clock.tick(HOLD_TTL_MS + 1);
      const booking = stored();
      booking.accessInfo[0].grant = null;
      booking.accessInfo[0].isProvisioned = false;
      booking.accessInfo[0].hold = {
        holdId: "100",
        expiresAt: 1,
        compartment: BOX_A,
      };
      store.set(booking.id, booking);

      await AccessService.provisionForBooking(TENANT, "booking-1");

      expect(compartments()[0].metadata).to.deep.equal({
        boxId: `box-${BOX_B}`,
        price: "1.50",
      });
      clock.restore();
    });
  });

  describe("revokeForBooking", function () {
    it("gives the iFBS box back and keeps the entry as revoked, without a hold", async function () {
      storeBooking("bikebox");
      await AccessService.provisionForBooking(TENANT, "booking-1");

      await AccessService.revokeForBooking(TENANT, "booking-1");

      const [entry] = compartments();
      expect(entry).to.include({ isProvisioned: false, hold: null });
      expect(entry.revokedAt).to.be.a("number");
      expect(entry.grant.authorizationId).to.equal("100");
      // The booking is in progress, so iFBS ends the usage rather than
      // cancelling it - the adapter's business, pinned in its own tests.
      expect(ifbs.bookings.get("100").state).to.equal("ended");
      expect(logged("revoke")[0]).to.include({
        accessPointId: `${BIKE_BOXES.id}:100`,
        result: "success",
      });
    });

    it("cancels every Pareva rental of the booking, each by its own grant", async function () {
      storeBooking("locker-s", 2);
      await AccessService.provisionForBooking(TENANT, "booking-1");

      await AccessService.revokeForBooking(TENANT, "booking-1");

      expect(pareva.rentalsInState("cancelled")).to.have.length(2);
      expect(compartments().every((entry) => entry.revokedAt)).to.equal(true);
    });

    it("leaves a compartment that is only held alone - the hold lapses by itself", async function () {
      storeBooking("bikebox");
      await AccessService.holdForBooking(TENANT, "booking-1");

      await AccessService.revokeForBooking(TENANT, "booking-1");

      const [entry] = compartments();
      expect(entry.revokedAt).to.equal(null);
      expect(entry.hold.holdId).to.equal("100");
      expect(ifbs.bookings.get("100").state).to.equal("held");
    });
  });

  describe("updateForBooking", function () {
    /** The booking as an admin stores it before the service is told. */
    async function change(changes) {
      const oldBooking = new Booking(clone(stored()));
      const newBooking = new Booking({ ...clone(stored()), ...changes });
      store.set(newBooking.id, clone(newBooking));
      await AccessService.updateForBooking(TENANT, oldBooking, newBooking);
      return { oldBooking, newBooking };
    }

    it("moving the booking gives the iFBS box back and books one for the new time, replacing the entry", async function () {
      storeBooking("bikebox");
      await AccessService.provisionForBooking(TENANT, "booking-1");

      await change({ timeBegin: now + DAY, timeEnd: now + DAY + HOUR });

      expect(compartments()).to.have.length(1);
      expect(compartments()[0]).to.include({
        isProvisioned: true,
        revokedAt: null,
        externalBookingId: "101",
      });
      expect(ifbs.bookings.get("100").state).to.equal("ended");
      expect(ifbs.bookings.get("101").state).to.equal("booked");
    });

    it("changing the amount revokes every Pareva compartment and rents the new amount", async function () {
      storeBooking("locker-s", 1);
      await AccessService.provisionForBooking(TENANT, "booking-1");

      await change({ bookableItems: [{ bookableId: "locker-s", amount: 2 }] });

      expect(pareva.rentalsInState("cancelled")).to.have.length(1);
      expect(pareva.rentalsInState("open")).to.have.length(2);
      const entries = compartments();
      expect(entries).to.have.length(2);
      expect(entries.map((entry) => entry.grant.authorizationId)).to.deep.equal(
        ["process-2", "process-3"],
      );
    });

    it("lowering the amount leaves only the new compartments at the booking", async function () {
      storeBooking("locker-s", 2);
      await AccessService.provisionForBooking(TENANT, "booking-1");

      await change({ bookableItems: [{ bookableId: "locker-s", amount: 1 }] });

      expect(compartments()).to.have.length(1);
      expect(pareva.rentalsInState("open")).to.have.length(1);
      expect(pareva.rentalsInState("cancelled")).to.have.length(2);
    });

    it("touches no compartment when neither time nor allocation changed", async function () {
      storeBooking("bikebox");
      await AccessService.provisionForBooking(TENANT, "booking-1");

      await change({ name: "Erika Muster" });

      expect(ifbs.bookings.size).to.equal(1);
      expect(ifbs.bookings.get("100").state).to.equal("booked");
    });
  });

  describe("locker systems still written at the bookable as lockerDetails", function () {
    it("gives no compartment for them - the rows of the migration are the only locker systems", async function () {
      BookableManager.getBookablesByIds.callsFake(async (tenantId, ids) =>
        ids.map((id) => ({
          id,
          title: "Fahrradbox",
          amount: 10,
          lockerDetails: {
            active: true,
            units: [
              { lockerSystem: "ifbs", locationId: IFBS_LOCATION, amount: 2 },
            ],
          },
        })),
      );
      storeBooking("bikebox-legacy");

      const accessInfo = await AccessService.holdForBooking(
        TENANT,
        "booking-1",
      );

      expect(accessInfo).to.deep.equal([]);
      expect(ifbs.bookings.size).to.equal(0);
    });
  });

  describe("listing and operating compartments", function () {
    it("lists a granted compartment under its opaque id, provisioned, with the box number", async function () {
      storeBooking("bikebox");
      await AccessService.provisionForBooking(TENANT, "booking-1");

      const [view] = await AccessService.getByBooking(TENANT, "booking-1", {
        userId: "user-1",
      });

      expect(view).to.deep.equal({
        id: `${BIKE_BOXES.id}:100`,
        tenantId: TENANT,
        type: "locker",
        provider: "ifbs",
        label: "Fahrradboxen Bahnhof",
        mode: "remote",
        validationRuleTypes: [],
        capabilities: ["open"],
        accessFrom: now - 5 * MINUTE,
        accessTo: now + 55 * MINUTE,
        accessBuffer: { beforeMs: 0, afterMs: 0 },
        isProvisioned: true,
        externalBookingId: "100",
        compartment: BOX_A,
      });
    });

    it("lists a held compartment as not provisioned, under the hold id", async function () {
      storeBooking("bikebox");
      await AccessService.holdForBooking(TENANT, "booking-1");

      const [view] = await AccessService.getByBooking(TENANT, "booking-1");

      expect(view).to.include({
        id: `${BIKE_BOXES.id}:hold`,
        isProvisioned: false,
        externalBookingId: null,
        compartment: BOX_A,
      });
    });

    it("lists every Pareva compartment of a booking, each with nothing to do", async function () {
      storeBooking("locker-s", 2);
      await AccessService.provisionForBooking(TENANT, "booking-1");

      const views = await AccessService.getByBooking(TENANT, "booking-1");

      expect(views.map((view) => view.id)).to.deep.equal([
        `${SIZE_S_LOCKERS.id}:process-1`,
        `${SIZE_S_LOCKERS.id}:process-2`,
      ]);
      expect(views[0].capabilities).to.deep.equal([]);
      expect(views[0].compartment).to.equal(null);
    });

    it("opens a granted box by its compartment id and audits under that id", async function () {
      storeBooking("bikebox");
      await AccessService.provisionForBooking(TENANT, "booking-1");

      const outcome = await AccessService.open(
        TENANT,
        "booking-1",
        `${BIKE_BOXES.id}:100`,
        "user-1",
      );

      expect(outcome.success).to.equal(true);
      expect(outcome.data.openProcessId).to.be.a("string");
      expect(logged("open")[0]).to.include({
        accessPointId: `${BIKE_BOXES.id}:100`,
        accessPointType: "locker",
        result: "success",
      });
    });

    it("refuses to open a compartment that is only held - it is not provisioned", async function () {
      storeBooking("bikebox");
      await AccessService.holdForBooking(TENANT, "booking-1");

      const outcome = await AccessService.open(
        TENANT,
        "booking-1",
        `${BIKE_BOXES.id}:hold`,
        "user-1",
      );

      expect(outcome).to.deep.equal({
        success: false,
        blockingReasons: [ACCESS_BLOCKING_REASONS.NOT_PROVISIONED],
      });
    });

    it("knows no compartment by the id of its locker system alone", async function () {
      storeBooking("bikebox");
      await AccessService.provisionForBooking(TENANT, "booking-1");

      await assert.rejects(
        AccessService.open(TENANT, "booking-1", BIKE_BOXES.id, "user-1"),
        (err) => {
          expect(err.code).to.equal("access_point_not_in_booking");
          return true;
        },
      );
    });
  });
});
