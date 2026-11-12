/**
 * A Fach goes out of service or out of its Schließfachanlage
 * (tickets#1043): on saving the Anlage, the future bookings at it get the
 * first free Fach in service, under the mutex of the Anlage; running ones
 * keep theirs, and the ones no Fach is free for stay and are named. Before
 * the save, the administration reads which running and future bookings
 * hang at those Fächer.
 *
 * On the access seam like `locker-system-allocation.test.js`: the Anlagen
 * are real rows, and below the service the data managers are stubbed with
 * an in-memory booking store.
 */

const { expect } = require("chai");
const sinon = require("sinon");

process.env.CRYPTO_SECRET =
  process.env.CRYPTO_SECRET || "0123456789abcdef0123456789abcdef";

const LockerSystemRedistribution = require("../src/commons/services/access/locker-system-redistribution");
const AccessService = require("../src/commons/services/access/access-service");
const LockerSystemMutex = require("../src/commons/services/access/locker-system-mutex");
const BookingManager = require("../src/commons/data-managers/booking-manager");
const {
  BookableManager,
} = require("../src/commons/data-managers/bookable-manager");
const TenantManager = require("../src/commons/data-managers/tenant-manager");
const AccessPointManager = require("../src/commons/data-managers/access-point-manager");
const AccessLogService = require("../src/commons/services/access/access-log-service");
const mailModule = require("../src/commons/mail-service");
const { Booking } = require("../src/commons/entities/booking/booking");
const {
  installInMemoryLockerSystemHolds,
} = require("./helpers/in-memory-locker-system-holds");

const TENANT = "tenant-1";
const MINUTE = 60 * 1000;
const HOUR = 60 * MINUTE;

const LABOR = { id: "bank-labor", name: "Labor Fachbank 1" };

const fach = (id, number, outOfService = false) => ({
  id,
  number,
  lockerBank: LABOR,
  outOfService,
});

function anlage(id, compartments) {
  return {
    id,
    tenantId: TENANT,
    type: "locker",
    provider: "open-locker",
    externalId: "",
    label: `Anlage ${id}`,
    mode: "remote",
    validationRules: [],
    scanCode: `code-${id}`,
    config: { compartments },
  };
}

describe("Fach außer Betrieb oder entfernt: future bookings move", function () {
  let store;
  let accessPoints;
  let bookables;
  let now;

  beforeEach(function () {
    now = Date.now();
    store = new Map();
    accessPoints = {
      labor: anlage("anlage-labor", [
        fach("uuid-1", 1),
        fach("uuid-2", 2),
        fach("uuid-3", 3),
      ]),
      other: anlage("anlage-other", [fach("uuid-9", 9)]),
    };
    bookables = {
      faecher: bookable("faecher", [accessPoints.labor.id]),
      bahnhof: bookable("bahnhof", [accessPoints.other.id]),
    };
    installInMemoryLockerSystemHolds();
    stubDataManagers();
  });

  afterEach(function () {
    sinon.restore();
  });

  function bookable(id, accessPointIds, extra = {}) {
    return {
      id,
      title: id,
      amount: 3,
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
    sinon
      .stub(TenantManager, "getTenant")
      .resolves({ id: TENANT, mail: "stadt@example.test", applications: [] });
    sinon.stub(AccessLogService, "log").resolves();
    sinon.stub(mailModule, "notify").resolves([]);
  }

  function clone(value) {
    return JSON.parse(JSON.stringify(value));
  }

  /**
   * A booking that holds the Fach at the Anlage of the bookable, an hour
   * from now unless told otherwise.
   */
  function storeHolding(id, compartmentId, overrides = {}, entry = {}) {
    const { bookableId = "faecher", ...rest } = overrides;
    const system = Object.values(accessPoints).find((row) =>
      row.config.compartments.some((c) => c.id === compartmentId),
    );
    const compartment = system.config.compartments.find(
      (c) => c.id === compartmentId,
    );
    const booking = {
      id,
      tenantId: TENANT,
      assignedUserId: "user-1",
      name: `Person ${id}`,
      mail: `${id}@example.test`,
      status: "payment_due",
      priceEur: 5,
      timeBegin: now + HOUR,
      timeEnd: now + 2 * HOUR,
      bookableItems: [{ bookableId, amount: 1 }],
      accessInfo: [
        {
          accessPointId: system.id,
          accessPointType: "locker",
          provider: "open-locker",
          bookableId,
          hold: { holdId: null, expiresAt: null, compartment: null },
          assignedCompartment: {
            id: compartmentId,
            number: compartment.number,
            lockerBank: LABOR,
          },
          revokedAt: null,
          grant: null,
          ...entry,
        },
      ],
      ...rest,
    };
    store.set(id, clone(booking));
    return booking;
  }

  const assigned = (id) =>
    store
      .get(id)
      .accessInfo.filter((entry) => entry.accessPointType === "locker")
      .map((entry) => entry.assignedCompartment?.id);

  /** The Anlage as the save leaves it. */
  function changed(row, change) {
    return {
      ...row,
      config: {
        ...row.config,
        compartments: change(row.config.compartments.map((c) => ({ ...c }))),
      },
    };
  }

  const outOfService =
    (...ids) =>
    (list) =>
      list.map((c) => (ids.includes(c.id) ? { ...c, outOfService: true } : c));

  const without =
    (...ids) =>
    (list) =>
      list.filter((c) => !ids.includes(c.id));

  /** Saves the Anlage as `change` leaves it, the way the controller does. */
  async function save(change, { at = now } = {}) {
    const before = accessPoints.labor;
    const after = changed(before, change);
    return LockerSystemRedistribution.storeRedistributing(
      TENANT,
      before,
      after,
      async () => {
        accessPoints.labor = after;
        return after;
      },
      { now: at, userId: "admin-1" },
    );
  }

  describe("on saving the Anlage", function () {
    it("gives a future booking at a Fach going out of service the first free Fach in service", async function () {
      storeHolding("b1", "uuid-1");

      const { unmoved } = await save(outOfService("uuid-1"));

      expect(assigned("b1")).to.deep.equal(["uuid-2"]);
      expect(unmoved).to.deep.equal([]);
    });

    for (const status of ["confirmed", "requested", "payment_due"]) {
      it(`moves a ${status} booking alike`, async function () {
        storeHolding("b1", "uuid-1", { status });

        await save(outOfService("uuid-1"));

        expect(assigned("b1")).to.deep.equal(["uuid-2"]);
      });
    }

    it("moves the future bookings at a Fach removed from the Anlage", async function () {
      storeHolding("b1", "uuid-1");

      const { unmoved } = await save(without("uuid-1"));

      expect(assigned("b1")).to.deep.equal(["uuid-2"]);
      expect(unmoved).to.deep.equal([]);
    });

    it("lets a running booking keep its Fach", async function () {
      storeHolding("b1", "uuid-1", {
        timeBegin: now - HOUR,
        timeEnd: now + HOUR,
      });

      const { unmoved } = await save(outOfService("uuid-1"));

      expect(assigned("b1")).to.deep.equal(["uuid-1"]);
      expect(unmoved).to.deep.equal([]);
    });

    it("counts a booking whose access buffer has begun as running", async function () {
      bookables.faecher.accessPointDetails.accessBuffer = { before: 90 };
      storeHolding("b1", "uuid-1");

      await save(outOfService("uuid-1"));

      expect(assigned("b1")).to.deep.equal(["uuid-1"]);
    });

    it("gives two future bookings at the leaving Fächer different free ones, skipping a Fach another booking holds", async function () {
      storeHolding("b1", "uuid-1");
      storeHolding("b2", "uuid-2", { timeBegin: now + 90 * MINUTE });
      storeHolding("other", "uuid-3", {
        timeBegin: now + 30 * MINUTE,
        timeEnd: now + 4 * HOUR,
      });
      accessPoints.labor = changed(accessPoints.labor, (list) => [
        ...list,
        fach("uuid-4", 4),
        fach("uuid-5", 5),
      ]);

      await save(outOfService("uuid-1", "uuid-2"));

      expect(assigned("b1")).to.deep.equal(["uuid-4"]);
      expect(assigned("b2")).to.deep.equal(["uuid-5"]);
      expect(assigned("other")).to.deep.equal(["uuid-3"]);
    });

    it("never gives a booking with several units a Fach it holds already", async function () {
      const booking = storeHolding("b1", "uuid-1", {
        bookableItems: [{ bookableId: "faecher", amount: 3 }],
      });
      const [entry] = booking.accessInfo;
      store.get("b1").accessInfo.push(
        clone({
          ...entry,
          assignedCompartment: { id: "uuid-2", number: 2, lockerBank: LABOR },
        }),
        clone({
          ...entry,
          assignedCompartment: { id: "uuid-3", number: 3, lockerBank: LABOR },
        }),
      );
      accessPoints.labor = changed(accessPoints.labor, (list) => [
        ...list,
        fach("uuid-4", 4),
        fach("uuid-5", 5),
      ]);

      await save(outOfService("uuid-1", "uuid-2"));

      expect(assigned("b1")).to.deep.equal(["uuid-4", "uuid-5", "uuid-3"]);
    });

    it("leaves a future booking no Fach is free for at its Fach and names it", async function () {
      storeHolding("b1", "uuid-1");
      storeHolding("b2", "uuid-2");

      const { unmoved } = await save(outOfService("uuid-1", "uuid-3"));

      expect(assigned("b1")).to.deep.equal(["uuid-1"]);
      expect(unmoved).to.deep.equal([
        {
          id: "b1",
          name: "Person b1",
          mail: "b1@example.test",
          timeBegin: now + HOUR,
          timeEnd: now + 2 * HOUR,
          compartment: { id: "uuid-1", number: 1, lockerBank: LABOR },
        },
      ]);
    });

    it("leaves bookings at Fächer that stay in service alone", async function () {
      storeHolding("b1", "uuid-2");

      await save(outOfService("uuid-1"));

      expect(assigned("b1")).to.deep.equal(["uuid-2"]);
    });

    it("leaves a cancelled booking and an entry taken back where they are", async function () {
      storeHolding("cancelled", "uuid-1", { status: "cancelled" });
      storeHolding("revoked", "uuid-1", {}, { revokedAt: now - MINUTE });

      const { unmoved } = await save(outOfService("uuid-1"));

      expect(assigned("cancelled")).to.deep.equal(["uuid-1"]);
      expect(assigned("revoked")).to.deep.equal(["uuid-1"]);
      expect(unmoved).to.deep.equal([]);
    });

    it("writes the move into the access log, at the new Fach", async function () {
      storeHolding("b1", "uuid-1");

      await save(outOfService("uuid-1"));

      const [row] = AccessLogService.log.args.map(([entry]) => entry);
      expect(row).to.deep.include({
        bookingId: "b1",
        accessPointId: "anlage-labor:uuid-2",
        action: "hold",
        result: "success",
        actor: { userId: "admin-1", source: "user" },
      });
      expect(row.payload.movedFrom.id).to.equal("uuid-1");
    });

    it("waits for the mutex of the Anlage before it stores and moves", async function () {
      storeHolding("b1", "uuid-1");
      const order = [];
      let release;
      const busy = LockerSystemMutex.hold(
        accessPoints.labor,
        () =>
          new Promise((resolve) => {
            release = () => {
              order.push("other work done");
              resolve();
            };
          }),
      );
      await new Promise((resolve) => setImmediate(resolve));

      const saving = save(outOfService("uuid-1")).then(() =>
        order.push("saved"),
      );
      await new Promise((resolve) => setTimeout(resolve, 20));
      expect(assigned("b1")).to.deep.equal(["uuid-1"]);
      release();
      await Promise.all([busy, saving]);

      expect(order).to.deep.equal(["other work done", "saved"]);
      expect(assigned("b1")).to.deep.equal(["uuid-2"]);
    });

    it("takes no mutex when no Fach leaves the Zuteilung", async function () {
      const hold = sinon.spy(LockerSystemMutex, "hold");

      await save((list) => list);

      expect(hold.called).to.equal(false);
    });
  });

  describe("a Fach back in service", function () {
    it("is given out again by the Vormerkung", async function () {
      accessPoints.labor = changed(accessPoints.labor, outOfService("uuid-1"));
      await save((list) =>
        list.map((c) =>
          c.id === "uuid-1" ? { ...c, outOfService: false } : c,
        ),
      );
      store.set("new", {
        id: "new",
        tenantId: TENANT,
        assignedUserId: "user-1",
        mail: "new@example.test",
        status: "payment_due",
        priceEur: 5,
        timeBegin: now + HOUR,
        timeEnd: now + 2 * HOUR,
        bookableItems: [{ bookableId: "faecher", amount: 1 }],
        accessInfo: [],
      });

      await AccessService.holdForBooking(TENANT, "new");

      expect(assigned("new")).to.deep.equal(["uuid-1"]);
    });
  });

  describe("which Fächer leave the Zuteilung", function () {
    it("are the ones removed and the ones newly out of service", function () {
      const before = anlage("a", [
        fach("in", 1),
        fach("out-before", 2, true),
        fach("goes-out", 3),
        fach("removed", 4),
        fach("removed-out", 5, true),
      ]);
      const after = anlage("a", [
        fach("in", 1),
        fach("out-before", 2, true),
        fach("goes-out", 3, true),
        fach("new", 6, true),
      ]);

      expect(
        LockerSystemRedistribution.leavingCompartmentIds(before, after),
      ).to.deep.equal(["goes-out", "removed", "removed-out"]);
    });

    it("are none for a new Anlage", function () {
      expect(
        LockerSystemRedistribution.leavingCompartmentIds(
          null,
          anlage("a", [fach("x", 1, true)]),
        ),
      ).to.deep.equal([]);
    });
  });

  describe("the preview before the save", function () {
    it("names the running and future bookings at the Fächer, earliest first", async function () {
      storeHolding("future", "uuid-1");
      storeHolding("running", "uuid-2", {
        timeBegin: now - HOUR,
        timeEnd: now + HOUR,
      });
      storeHolding("over", "uuid-1", {
        timeBegin: now - 3 * HOUR,
        timeEnd: now - 2 * HOUR,
      });
      storeHolding("elsewhere", "uuid-3");

      const result = await LockerSystemRedistribution.bookingsAt(
        TENANT,
        accessPoints.labor,
        ["uuid-1", "uuid-2"],
        { now },
      );

      expect(result.total).to.equal(2);
      expect(
        result.bookings.map(({ id, state, compartment }) => ({
          id,
          state,
          compartment: compartment.id,
        })),
      ).to.deep.equal([
        { id: "running", state: "running", compartment: "uuid-2" },
        { id: "future", state: "future", compartment: "uuid-1" },
      ]);
    });

    it("names only the entries at this Anlage - a Fach that moved keeps its old Anlage's bookings out", async function () {
      storeHolding("at-other", "uuid-9", { bookableId: "bahnhof" });
      accessPoints.labor = changed(accessPoints.labor, (list) => [
        ...list,
        fach("uuid-9", 9),
      ]);

      const result = await LockerSystemRedistribution.bookingsAt(
        TENANT,
        accessPoints.labor,
        ["uuid-9"],
        { now },
      );

      expect(result).to.deep.equal({ total: 0, bookings: [] });
    });

    it("names up to the limit and counts the rest", async function () {
      storeHolding("b1", "uuid-1");
      storeHolding("b2", "uuid-1", { timeBegin: now + 3 * HOUR });

      const result = await LockerSystemRedistribution.bookingsAt(
        TENANT,
        accessPoints.labor,
        ["uuid-1"],
        { now, limit: 1 },
      );

      expect(result.total).to.equal(2);
      expect(result.bookings.map((b) => b.id)).to.deep.equal(["b1"]);
    });
  });
});
