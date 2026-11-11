/**
 * The Zuteilung in der Vormerkung (tickets#1039): a booking at a
 * Schließfachanlage that carries its own list of Fächer gets, per booked
 * unit, the first free Fach in service - checked by the platform over every
 * booking of the tenant, with both buffers, under the mutex of the Anlage.
 *
 * On the access seam like `access-compartments.test.js`: the Anlagen are
 * real rows, the service runs for real, and below it the data managers are
 * stubbed with an in-memory booking store.
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
const AccessPointManager = require("../src/commons/data-managers/access-point-manager");
const AccessLogService = require("../src/commons/services/access/access-log-service");
const mailModule = require("../src/commons/mail-service");
const LockerSystemMutex = require("../src/commons/services/access/locker-system-mutex");
const LockerSystemRedistribution = require("../src/commons/services/access/locker-system-redistribution");
const { Booking } = require("../src/commons/entities/booking/booking");
const {
  installInMemoryLockerSystemHolds,
} = require("./helpers/in-memory-locker-system-holds");

const TENANT = "tenant-1";
/** The reach of the routes of the Umsetzen: Buchung bearbeiten, any. */
const MANAGER = { reach: "any", userId: "admin-1" };
const MINUTE = 60 * 1000;
const HOUR = 60 * MINUTE;

const LABOR = { id: "bank-labor", name: "Labor Fachbank 1" };
const HAFEN = { id: "bank-hafen", name: "Hafenschrank" };
/** A second Schließfachschrank of the same name, told apart by its id. */
const HAFEN_TOO = { id: "bank-hafen-2", name: "Hafenschrank" };

const fach = (id, number, lockerBank, outOfService = false) => ({
  id,
  number,
  lockerBank,
  outOfService,
});

/** An Anlage of Open Locker with its own Fächer, stored out of order. */
function anlage(id, label, compartments) {
  return {
    id,
    tenantId: TENANT,
    type: "locker",
    provider: "open-locker",
    externalId: "",
    label,
    mode: "remote",
    validationRules: [],
    scanCode: `code-${id}`,
    config: { compartments },
  };
}

const PAREVA_LOCKERS = {
  id: "size-s",
  tenantId: TENANT,
  type: "locker",
  provider: "pareva",
  externalId: "S",
  providerLocationId: "L1",
  label: "Schließfach S",
  mode: "authorization",
  validationRules: [],
  scanCode: "code-size-s",
};

const tenant = () => ({
  id: TENANT,
  mail: "stadt@example.test",
  applications: [],
});

describe("Zuteilung in der Vormerkung: the platform assigns a free Fach per unit", function () {
  let store;
  let accessPoints;
  let bookables;
  let now;

  beforeEach(function () {
    now = Date.now();
    store = new Map();
    accessPoints = {
      labor: anlage("anlage-labor", "Fächer Labor", [
        fach("uuid-labor-10", 10, LABOR),
        fach("uuid-hafen2-1", 1, HAFEN_TOO),
        fach("uuid-labor-2", 2, LABOR),
        fach("uuid-hafen-1", 1, HAFEN),
      ]),
      other: anlage("anlage-other", "Fächer Bahnhof", [
        fach("uuid-bahnhof-1", 1, LABOR),
      ]),
      pareva: PAREVA_LOCKERS,
    };
    bookables = {
      faecher: bookable("faecher", [accessPoints.labor.id], 4),
      bahnhof: bookable("bahnhof", [accessPoints.other.id], 1),
      "locker-s": bookable("locker-s", [PAREVA_LOCKERS.id], 1),
    };
    installInMemoryLockerSystemHolds();
    stubDataManagers();
  });

  afterEach(function () {
    sinon.restore();
  });

  function bookable(id, accessPointIds, amount, extra = {}) {
    return {
      id,
      title: id,
      amount,
      accessPointDetails: { active: true, accessPointIds },
      ...extra,
    };
  }

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
    // The database answers every booking of the tenant with one of the
    // Fächer in any entry; the rest is the service's to judge.
    sinon
      .stub(BookingManager, "getBookingsHoldingCompartments")
      .callsFake(async (tenantId, compartmentIds) =>
        [...store.values()]
          .filter(
            (booking) =>
              booking.tenantId === tenantId &&
              (booking.accessInfo || []).some((entry) =>
                compartmentIds.includes(entry.assignedCompartment?.id),
              ),
          )
          .map((booking) => new Booking(clone(booking))),
      );
    sinon
      .stub(BookingManager, "getConcurrentBookings")
      .callsFake(async () => []);
    sinon
      .stub(BookableManager, "getBookablesByIds")
      .callsFake(async (tenantId, ids) =>
        ids.map((id) => bookables[id]).filter(Boolean),
      );
    sinon.stub(BookableManager, "getRelatedBookables").resolves([]);
    sinon.stub(BookableManager, "getAllParentBookables").resolves([]);
    sinon
      .stub(AccessPointManager, "getAccessPointsByIds")
      .callsFake(async (tenantId, ids) =>
        Object.values(accessPoints).filter((row) => ids.includes(row.id)),
      );
    sinon.stub(TenantManager, "getTenant").resolves(tenant());
    sinon.stub(AccessLogService, "log").resolves();
    sinon.stub(mailModule, "notify").resolves([]);
  }

  function clone(value) {
    return JSON.parse(JSON.stringify(value));
  }

  /** An unpaid booking of `amount` of the bookable, stored, an hour from now. */
  function storeBooking(id, bookableId, amount = 1, overrides = {}) {
    const booking = {
      id,
      tenantId: TENANT,
      assignedUserId: "user-1",
      mail: "erika@example.test",
      status: "payment_due",
      priceEur: 5,
      timeBegin: now + HOUR,
      timeEnd: now + 2 * HOUR,
      bookableItems: [{ bookableId, amount }],
      accessInfo: [],
      ...overrides,
    };
    store.set(id, clone(booking));
    return booking;
  }

  /** A booking that holds the Fach already, at the Anlage of the bookable. */
  function storeHolding(id, compartmentId, overrides = {}, entry = {}) {
    const { bookableId = "faecher", ...rest } = overrides;
    const system = Object.values(accessPoints).find((row) =>
      (row.config?.compartments || []).some((c) => c.id === compartmentId),
    );
    return storeBooking(id, bookableId, 1, {
      accessInfo: [
        {
          accessPointId: system.id,
          accessPointType: "locker",
          provider: "open-locker",
          bookableId,
          hold: { holdId: null, expiresAt: null, compartment: null },
          assignedCompartment: { id: compartmentId },
          revokedAt: null,
          grant: null,
          ...entry,
        },
      ],
      ...rest,
    });
  }

  const assigned = (id) =>
    store
      .get(id)
      .accessInfo.filter((entry) => entry.accessPointType === "locker")
      .map((entry) => entry.assignedCompartment?.id);

  function logged(action) {
    return AccessLogService.log.args
      .map(([entry]) => entry)
      .filter((entry) => entry.action === action);
  }

  describe("which Fach a booking gets", function () {
    it("gives the first Fach by Schließfachschrank name, then its id, then the number - numerically", async function () {
      storeBooking("b1", "faecher", 4);

      await AccessService.holdForBooking(TENANT, "b1");

      expect(assigned("b1")).to.deep.equal([
        "uuid-hafen-1",
        "uuid-hafen2-1",
        "uuid-labor-2",
        "uuid-labor-10",
      ]);
    });

    it("notes the Fach on the entry - UUID, number and Schließfachschrank - held by the platform, without a handle or a deadline", async function () {
      storeBooking("b1", "faecher");

      await AccessService.holdForBooking(TENANT, "b1");

      const [entry] = store.get("b1").accessInfo;
      expect(entry).to.deep.include({
        accessPointId: "anlage-labor",
        accessPointType: "locker",
        provider: "open-locker",
        bookableId: "faecher",
        hold: { holdId: null, expiresAt: null, compartment: null },
        assignedCompartment: {
          id: "uuid-hafen-1",
          number: 1,
          lockerBank: { id: HAFEN.id, name: HAFEN.name },
        },
        grant: null,
        isProvisioned: false,
        revokedAt: null,
      });
    });

    it("gives each unit a Fach of its own, operated by an id of its own", async function () {
      storeBooking("b1", "faecher", 2);

      await AccessService.holdForBooking(TENANT, "b1");
      const views = await AccessService.getByBooking(TENANT, "b1");

      expect(new Set(assigned("b1")).size).to.equal(2);
      const ids = views.map((view) => view.id);
      expect(ids).to.have.length(2);
      expect(new Set(ids).size).to.equal(2);
    });

    it("never gives a Fach out of service", async function () {
      accessPoints.labor.config.compartments[3].outOfService = true;
      storeBooking("b1", "faecher");

      await AccessService.holdForBooking(TENANT, "b1");

      expect(assigned("b1")).to.deep.equal(["uuid-hafen2-1"]);
    });

    it("keeps the Fach on a second hold of the same booking", async function () {
      storeBooking("b1", "faecher");
      await AccessService.holdForBooking(TENANT, "b1");

      await AccessService.holdForBooking(TENANT, "b1");

      expect(assigned("b1")).to.deep.equal(["uuid-hafen-1"]);
    });

    it("writes the Zuteilung into the access log, at the Fach", async function () {
      storeBooking("b1", "faecher");

      await AccessService.holdForBooking(TENANT, "b1");

      const [row] = logged("hold");
      expect(row).to.deep.include({
        bookingId: "b1",
        accessPointId: "anlage-labor:uuid-hafen-1",
        accessPointType: "locker",
        provider: "open-locker",
        result: "success",
      });
      expect(row.payload.compartment).to.deep.equal({
        id: "uuid-hafen-1",
        number: 1,
        lockerBank: { id: HAFEN.id, name: HAFEN.name },
      });
    });
  });

  describe("when a Fach is occupied", function () {
    it("skips a Fach another booking holds at the same time, unpaid ones included", async function () {
      storeHolding("b0", "uuid-hafen-1", { status: "requested" });
      storeBooking("b1", "faecher");

      await AccessService.holdForBooking(TENANT, "b1");

      expect(assigned("b1")).to.deep.equal(["uuid-hafen2-1"]);
    });

    for (const status of ["rejected", "cancelled", "withdrawn"]) {
      it(`gives a Fach whose other booking is ${status}`, async function () {
        storeHolding("b0", "uuid-hafen-1", { status });
        storeBooking("b1", "faecher");

        await AccessService.holdForBooking(TENANT, "b1");

        expect(assigned("b1")).to.deep.equal(["uuid-hafen-1"]);
      });
    }

    it("gives a Fach whose entry at the other booking was taken back", async function () {
      storeHolding("b0", "uuid-hafen-1", {}, { revokedAt: now - HOUR });
      storeBooking("b1", "faecher");

      await AccessService.holdForBooking(TENANT, "b1");

      expect(assigned("b1")).to.deep.equal(["uuid-hafen-1"]);
    });

    it("gives a Fach whose other booking is over before this one starts", async function () {
      storeHolding("b0", "uuid-hafen-1", {
        timeBegin: now - HOUR,
        timeEnd: now + HOUR,
      });
      storeBooking("b1", "faecher");

      await AccessService.holdForBooking(TENANT, "b1");

      expect(assigned("b1")).to.deep.equal(["uuid-hafen-1"]);
    });

    it("skips a Fach whose access window touches this one's: the access buffer of either booking", async function () {
      bookables.faecher.accessPointDetails.accessBuffer = {
        before: 0,
        after: 30,
      };
      storeHolding("b0", "uuid-hafen-1", {
        timeBegin: now,
        timeEnd: now + HOUR - 10 * MINUTE,
      });
      storeBooking("b1", "faecher");

      await AccessService.holdForBooking(TENANT, "b1");

      expect(assigned("b1")).to.deep.equal(["uuid-hafen2-1"]);
    });

    it("skips a Fach while this booking falls into the booking buffer of the other one's bookable", async function () {
      bookables.faecher = {
        ...bookables.faecher,
        isScheduleRelated: true,
        bufferTimeAfterMinutes: 30,
      };
      storeHolding("b0", "uuid-hafen-1", {
        timeBegin: now,
        timeEnd: now + HOUR - 10 * MINUTE,
      });
      storeBooking("b1", "faecher");

      await AccessService.holdForBooking(TENANT, "b1");

      expect(assigned("b1")).to.deep.equal(["uuid-hafen2-1"]);
    });

    it("finds the Fach held by a booking at another Anlage - a Fach that moved", async function () {
      // The Fach stood in the other Anlage before it moved here; a booking
      // there holds it still.
      storeHolding("b0", "uuid-hafen-1", { bookableId: "bahnhof" });
      const moved = store.get("b0");
      moved.accessInfo[0].accessPointId = "anlage-other";
      store.set("b0", moved);
      storeBooking("b1", "faecher");

      await AccessService.holdForBooking(TENANT, "b1");

      expect(assigned("b1")).to.deep.equal(["uuid-hafen2-1"]);
    });
  });

  describe("when no Fach is free", function () {
    beforeEach(function () {
      accessPoints.labor.config.compartments = [fach("uuid-only", 1, LABOR)];
    });

    it("fails with compartments_unavailable and stores nothing", async function () {
      storeHolding("b0", "uuid-only");
      storeBooking("b1", "faecher");

      await assert.rejects(
        AccessService.holdForBooking(TENANT, "b1"),
        (err) => {
          expect(err.statusCode).to.equal(409);
          expect(err.code).to.equal("compartments_unavailable");
          return true;
        },
      );

      expect(store.get("b1").accessInfo).to.deep.equal([]);
      expect(logged("hold").map((row) => row.result)).to.deep.equal([
        "failure",
      ]);
    });

    it("fails when the booking books more units than there are free Fächer", async function () {
      storeBooking("b1", "faecher", 2);

      await assert.rejects(
        AccessService.holdForBooking(TENANT, "b1"),
        (err) => err.code === "compartments_unavailable",
      );

      expect(store.get("b1").accessInfo).to.deep.equal([]);
    });
  });

  describe("two checkouts at the same time", function () {
    it("get different Fächer", async function () {
      storeBooking("b1", "faecher");
      storeBooking("b2", "faecher");

      await Promise.all([
        AccessService.holdForBooking(TENANT, "b1"),
        AccessService.holdForBooking(TENANT, "b2"),
      ]);

      expect([...assigned("b1"), ...assigned("b2")].sort()).to.deep.equal([
        "uuid-hafen-1",
        "uuid-hafen2-1",
      ]);
    });

    it("leave the second without a Fach when only one is free", async function () {
      accessPoints.labor.config.compartments = [fach("uuid-only", 1, LABOR)];
      storeBooking("b1", "faecher");
      storeBooking("b2", "faecher");

      const outcomes = await Promise.allSettled([
        AccessService.holdForBooking(TENANT, "b1"),
        AccessService.holdForBooking(TENANT, "b2"),
      ]);

      expect(outcomes.map((o) => o.status).sort()).to.deep.equal([
        "fulfilled",
        "rejected",
      ]);
      const failed = outcomes.find((o) => o.status === "rejected");
      expect(failed.reason.code).to.equal("compartments_unavailable");
      expect([...assigned("b1"), ...assigned("b2")]).to.deep.equal([
        "uuid-only",
      ]);
    });
  });

  describe("waiting on the mutex: the Zuteilung reads the booking and the Anlage again once it holds it", function () {
    /** A promise with its `resolve` at hand: work that ends when the test says. */
    function deferred() {
      let resolve;
      const promise = new Promise((r) => {
        resolve = r;
      });
      return { promise, resolve };
    }

    /** Lets the calls started so far read what they read before they wait. */
    const settle = () => new Promise((resolve) => setTimeout(resolve, 20));

    /**
     * The save of the Anlage taking the first Fach out of service, under
     * its mutex, held open until `saved` resolves. The row is replaced, as
     * the database hands out a fresh one on every read.
     */
    function savingOutOfService(compartmentId, saved) {
      const before = accessPoints.labor;
      const after = clone(before);
      after.config.compartments.find(
        (compartment) => compartment.id === compartmentId,
      ).outOfService = true;
      return LockerSystemRedistribution.storeRedistributing(
        TENANT,
        before,
        after,
        async () => {
          await saved.promise;
          accessPoints.labor = after;
          return after;
        },
      );
    }

    it("a Vormerkung that waited while the save took a Fach out of service does not get it", async function () {
      storeBooking("b1", "faecher");
      const saved = deferred();

      const saving = savingOutOfService("uuid-hafen-1", saved);
      await settle();
      const holding = AccessService.holdForBooking(TENANT, "b1");
      await settle();
      saved.resolve();
      await Promise.all([saving, holding]);

      expect(assigned("b1")).to.deep.equal(["uuid-hafen2-1"]);
    });

    it("a Zuteilung at confirmed that waited while the save took a Fach out of service does not get it", async function () {
      storeBooking("b1", "faecher", 1, { status: "confirmed" });
      const saved = deferred();

      const saving = savingOutOfService("uuid-hafen-1", saved);
      await settle();
      const allocating = AccessService.allocateForBooking(TENANT, "b1");
      await settle();
      saved.resolve();
      await Promise.all([saving, allocating]);

      expect(assigned("b1")).to.deep.equal(["uuid-hafen2-1"]);
    });

    it("a hold anew that read the booking before an Umsetzen does not put the old Fach back", async function () {
      storeHolding("b1", "uuid-hafen-1");
      const read = deferred();

      const moving = LockerSystemMutex.hold(accessPoints.labor, async () => {
        await read.promise;
        await AccessService.reassignCompartment(
          TENANT,
          "b1",
          "anlage-labor:uuid-hafen-1",
          "anlage-labor:uuid-labor-2",
          { scope: MANAGER },
        );
      });
      await settle();
      const holding = AccessService.holdForBooking(TENANT, "b1");
      await settle();
      read.resolve();
      await Promise.all([moving, holding]);

      expect(assigned("b1")).to.deep.equal(["uuid-labor-2"]);
    });
  });

  describe("iFBS and Pareva", function () {
    it("keep the count against the amount of the bookable for Pareva, without a Fach of the platform", async function () {
      storeBooking("b1", "locker-s");

      await AccessService.holdForBooking(TENANT, "b1");

      const [entry] = store.get("b1").accessInfo;
      expect(entry.assignedCompartment).to.equal(undefined);
      expect(BookingManager.getConcurrentBookings.called).to.equal(true);
      expect(BookingManager.getBookingsHoldingCompartments.called).to.equal(
        false,
      );
    });
  });
});
