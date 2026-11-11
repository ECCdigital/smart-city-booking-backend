/**
 * The Fach on Änderung, Wiederherstellung and Storno (tickets#1042): a
 * booking at a Schließfachanlage that carries its own list of Fächer keeps
 * its Fach while it is free and in service. What finds no free Fach fails
 * with `compartments_unavailable` and leaves the stored booking as it was.
 *
 * The lifecycle calls the access seam after the content write: the hold at
 * `requested | payment_due`, the Zuteilung (`allocateForBooking`) and then
 * the update at `confirmed`. These tests change the stored booking as the
 * content write does and call what the lifecycle calls. On the access seam
 * like `locker-system-allocation.test.js`: the Anlagen are real rows, the
 * service runs for real, and below it the data managers are stubbed with an
 * in-memory booking store.
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
const { Booking } = require("../src/commons/entities/booking/booking");
const {
  installInMemoryLockerSystemHolds,
} = require("./helpers/in-memory-locker-system-holds");

const TENANT = "tenant-1";
const HOUR = 60 * 60 * 1000;
const DAY = 24 * HOUR;

const BANK = { id: "bank-labor", name: "Labor Fachbank 1" };

const fach = (number, outOfService = false) => ({
  id: `uuid-${number}`,
  number,
  lockerBank: BANK,
  outOfService,
});

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

describe("Fach on Änderung, Wiederherstellung and Storno: a booking keeps its Fach while it can", function () {
  let store;
  let accessPoints;
  let bookables;
  let now;

  beforeEach(function () {
    now = Date.now();
    store = new Map();
    accessPoints = {
      labor: {
        id: "anlage-labor",
        tenantId: TENANT,
        type: "locker",
        provider: "open-locker",
        externalId: "",
        label: "Fächer Labor",
        mode: "remote",
        validationRules: [],
        scanCode: "code-anlage-labor",
        config: { compartments: [fach(1), fach(2), fach(3)] },
      },
      pareva: PAREVA_LOCKERS,
    };
    bookables = {
      faecher: bookable("faecher", [accessPoints.labor.id], 3),
      "locker-s": bookable("locker-s", [PAREVA_LOCKERS.id], 1),
    };
    installInMemoryLockerSystemHolds();
    stubDataManagers();
  });

  afterEach(function () {
    sinon.restore();
  });

  function bookable(id, accessPointIds, amount) {
    return {
      id,
      title: id,
      amount,
      accessPointDetails: { active: true, accessPointIds },
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
    sinon.stub(TenantManager, "getTenant").resolves({
      id: TENANT,
      mail: "stadt@example.test",
      applications: [],
    });
    sinon.stub(AccessLogService, "log").resolves();
    sinon.stub(mailModule, "notify").resolves([]);
  }

  function clone(value) {
    return JSON.parse(JSON.stringify(value));
  }

  /** A booking of `amount` of the bookable, stored, an hour from now. */
  function storeBooking(
    id,
    bookableId = "faecher",
    amount = 1,
    overrides = {},
  ) {
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

  /** A booking that got its Fächer in the Vormerkung. */
  async function holding(id, amount = 1, overrides = {}) {
    storeBooking(id, "faecher", amount, overrides);
    await AccessService.holdForBooking(TENANT, id);
    return store.get(id);
  }

  /** A booking that holds the Fach already. */
  function storeHolding(id, compartmentId, overrides = {}) {
    return storeBooking(id, "faecher", 1, {
      accessInfo: [entryAt(compartmentId)],
      ...overrides,
    });
  }

  /** A Fach-Eintrag of the Anlage, given the Fach. */
  function entryAt(compartmentId, extra = {}) {
    return {
      accessPointId: accessPoints.labor.id,
      accessPointType: "locker",
      provider: "open-locker",
      externalId: "",
      mode: "remote",
      bookableId: "faecher",
      hold: { holdId: null, expiresAt: null, compartment: null },
      assignedCompartment: {
        id: compartmentId,
        number: Number(compartmentId.split("-")[1]),
        lockerBank: BANK,
      },
      isProvisioned: false,
      provisionedAt: null,
      revokedAt: null,
      grant: null,
      ...extra,
    };
  }

  /** The content write of an Änderung: the stored booking, changed. */
  function amendStored(id, changes) {
    const booking = { ...store.get(id), ...changes };
    store.set(id, clone(booking));
    return booking;
  }

  /** The Fächer of the booking's entries not taken back, in entry order. */
  const assigned = (id) =>
    store
      .get(id)
      .accessInfo.filter(
        (entry) => entry.accessPointType === "locker" && !entry.revokedAt,
      )
      .map((entry) => entry.assignedCompartment?.id);

  const later = { timeBegin: now + DAY, timeEnd: now + DAY + HOUR };

  function logged(action) {
    return AccessLogService.log.args
      .map(([entry]) => entry)
      .filter((entry) => entry.action === action);
  }

  const noFreeFach = (err) => {
    expect(err.statusCode).to.equal(409);
    expect(err.code).to.equal("compartments_unavailable");
    return true;
  };

  describe("Änderung of an unpaid booking: the Vormerkung anew", function () {
    it("keeps the Fach when it is free in the new period", async function () {
      await holding("b1");
      amendStored("b1", later);

      await AccessService.holdForBooking(TENANT, "b1");

      expect(assigned("b1")).to.deep.equal(["uuid-1"]);
    });

    it("gives the first free Fach when another booking holds the old one in the new period", async function () {
      await holding("b1");
      storeHolding("b0", "uuid-1", later);
      amendStored("b1", later);

      await AccessService.holdForBooking(TENANT, "b1");

      expect(assigned("b1")).to.deep.equal(["uuid-2"]);
    });

    it("keeps the Fach through the Rücknahme the lifecycle runs right after the hold", async function () {
      await holding("b1");
      storeHolding("b0", "uuid-1", later);
      amendStored("b1", later);

      await AccessService.holdForBooking(TENANT, "b1");
      await AccessService.revokeForBooking(TENANT, "b1");

      expect(assigned("b1")).to.deep.equal(["uuid-2"]);
      expect(logged("revoke")).to.have.length(0);
    });

    it("gives the first free Fach when the old one went out of service", async function () {
      await holding("b1");
      accessPoints.labor.config.compartments[0].outOfService = true;
      amendStored("b1", later);

      await AccessService.holdForBooking(TENANT, "b1");

      expect(assigned("b1")).to.deep.equal(["uuid-2"]);
    });

    it("keeps the Fächer it has and gives free ones to the units added", async function () {
      storeHolding("b0", "uuid-1");
      storeHolding("b1", "uuid-3");
      amendStored("b1", {
        bookableItems: [{ bookableId: "faecher", amount: 2 }],
      });

      await AccessService.holdForBooking(TENANT, "b1");

      expect(assigned("b1")).to.deep.equal(["uuid-3", "uuid-2"]);
    });

    it("frees the Fächer assigned last when the units go down", async function () {
      await holding("b1", 3);
      expect(assigned("b1")).to.deep.equal(["uuid-1", "uuid-2", "uuid-3"]);
      amendStored("b1", {
        bookableItems: [{ bookableId: "faecher", amount: 1 }],
      });

      await AccessService.holdForBooking(TENANT, "b1");

      expect(assigned("b1")).to.deep.equal(["uuid-1"]);
      storeBooking("b2", "faecher", 2);
      await AccessService.holdForBooking(TENANT, "b2");
      expect(assigned("b2")).to.deep.equal(["uuid-2", "uuid-3"]);
    });

    it("fails with compartments_unavailable without a free Fach and leaves the stored Fach as it was", async function () {
      await holding("b1");
      for (const number of [1, 2, 3]) {
        storeHolding(`other-${number}`, `uuid-${number}`, later);
      }
      const before = clone(store.get("b1").accessInfo);
      amendStored("b1", later);

      await assert.rejects(
        AccessService.holdForBooking(TENANT, "b1"),
        noFreeFach,
      );

      expect(store.get("b1").accessInfo).to.deep.equal(before);
    });

    it("writes the new Fach into the access log, naming the one before", async function () {
      await holding("b1");
      storeHolding("b0", "uuid-1", later);
      amendStored("b1", later);
      AccessLogService.log.resetHistory();

      await AccessService.holdForBooking(TENANT, "b1");

      const [row] = logged("hold");
      expect(row).to.deep.include({
        accessPointId: "anlage-labor:uuid-2",
        result: "success",
      });
      expect(row.payload.compartment.id).to.equal("uuid-2");
      expect(row.payload.previous.id).to.equal("uuid-1");
    });
  });

  describe("Änderung of a confirmed booking: the Zuteilung, then the update", function () {
    /** A confirmed booking whose Fach is provisioned. */
    function storeConfirmed(id, compartmentId, overrides = {}) {
      return storeBooking(id, "faecher", 1, {
        status: "confirmed",
        accessInfo: [
          entryAt(compartmentId, {
            isProvisioned: true,
            provisionedAt: now - HOUR,
          }),
        ],
        ...overrides,
      });
    }

    it("keeps the Fach when it is free in the new period", async function () {
      storeConfirmed("b1", "uuid-2");
      amendStored("b1", later);

      await AccessService.allocateForBooking(TENANT, "b1");

      expect(assigned("b1")).to.deep.equal(["uuid-2"]);
      expect(store.get("b1").accessInfo[0].isProvisioned).to.equal(true);
    });

    it("gives the first free Fach when the old one is taken in the new period", async function () {
      storeConfirmed("b1", "uuid-1");
      storeHolding("b0", "uuid-1", later);
      amendStored("b1", later);

      await AccessService.allocateForBooking(TENANT, "b1");

      expect(assigned("b1")).to.deep.equal(["uuid-2"]);
    });

    it("fails with compartments_unavailable without a free Fach and leaves the stored Fach as it was", async function () {
      storeConfirmed("b1", "uuid-1");
      for (const number of [1, 2, 3]) {
        storeHolding(`other-${number}`, `uuid-${number}`, later);
      }
      const before = clone(store.get("b1").accessInfo);
      amendStored("b1", later);

      await assert.rejects(
        AccessService.allocateForBooking(TENANT, "b1"),
        noFreeFach,
      );

      expect(store.get("b1").accessInfo).to.deep.equal(before);
    });

    it("the update afterwards leaves the Fach as the Zuteilung gave it: nothing taken back, nothing assigned anew", async function () {
      const old = storeConfirmed("b1", "uuid-2");
      const changed = amendStored("b1", later);
      await AccessService.allocateForBooking(TENANT, "b1");

      await AccessService.updateForBooking(TENANT, old, changed);

      expect(assigned("b1")).to.deep.equal(["uuid-2"]);
      expect(store.get("b1").accessInfo).to.have.length(1);
      expect(store.get("b1").accessInfo[0]).to.deep.include({
        isProvisioned: true,
        revokedAt: null,
      });
    });

    it("the update afterwards provisions a Fach the Zuteilung moved, and one added for a new unit, without a grant", async function () {
      const old = storeConfirmed("b1", "uuid-1");
      storeHolding("b0", "uuid-1", later);
      const changed = amendStored("b1", {
        ...later,
        bookableItems: [{ bookableId: "faecher", amount: 2 }],
      });
      await AccessService.allocateForBooking(TENANT, "b1");

      await AccessService.updateForBooking(TENANT, old, changed);

      expect(assigned("b1")).to.deep.equal(["uuid-2", "uuid-3"]);
      for (const entry of store.get("b1").accessInfo) {
        expect(entry).to.deep.include({
          isProvisioned: true,
          revokedAt: null,
          grant: null,
        });
      }
    });

    it("leaves a booking without an Anlage of its own list alone: Pareva unchanged", async function () {
      storeBooking("b1", "locker-s", 1, { status: "confirmed" });

      await AccessService.allocateForBooking(TENANT, "b1");

      expect(BookingManager.storeBooking.called).to.equal(false);
      expect(BookingManager.getBookingsHoldingCompartments.called).to.equal(
        false,
      );
    });
  });

  describe("Wiederherstellung", function () {
    /** A cancelled booking; its Fach-Eintrag taken back, or not. */
    function storeCancelled(id, compartmentId, { revoked, ...overrides }) {
      return storeBooking(id, "faecher", 1, {
        status: "cancelled",
        accessInfo: [
          entryAt(compartmentId, revoked ? { revokedAt: now - HOUR } : {}),
        ],
        ...overrides,
      });
    }

    for (const revoked of [false, true]) {
      const how = revoked ? "taken back" : "left standing";
      it(`gives the old Fach back when it is free and in service (entry ${how} by the Storno)`, async function () {
        storeCancelled("b1", "uuid-3", { revoked });
        amendStored("b1", { status: "payment_due" });

        await AccessService.holdForBooking(TENANT, "b1");

        expect(assigned("b1")).to.deep.equal(["uuid-3"]);
      });

      it(`gives the first free Fach when the old one was taken in the meantime (entry ${how})`, async function () {
        storeCancelled("b1", "uuid-1", { revoked });
        storeHolding("b0", "uuid-1");
        amendStored("b1", { status: "confirmed" });

        await AccessService.allocateForBooking(TENANT, "b1");

        expect(assigned("b1")).to.deep.equal(["uuid-2"]);
      });
    }

    it("provisions the Fach the Zuteilung gave back, without a grant, when reinstated into confirmed", async function () {
      storeCancelled("b1", "uuid-3", {
        revoked: true,
        accessInfo: [
          entryAt("uuid-3", {
            provisionedAt: now - DAY,
            revokedAt: now - HOUR,
          }),
        ],
      });
      amendStored("b1", { status: "confirmed" });

      await AccessService.allocateForBooking(TENANT, "b1");
      await AccessService.provisionForBooking(TENANT, "b1");

      expect(assigned("b1")).to.deep.equal(["uuid-3"]);
      const live = store
        .get("b1")
        .accessInfo.filter((entry) => !entry.revokedAt);
      expect(live).to.have.length(1);
      expect(live[0]).to.deep.include({ isProvisioned: true, grant: null });
    });

    it("fails with compartments_unavailable without a free Fach, the stored Fach-Eintrag as it was", async function () {
      storeCancelled("b1", "uuid-1", { revoked: true });
      for (const number of [1, 2, 3]) {
        storeHolding(`other-${number}`, `uuid-${number}`);
      }
      const before = clone(store.get("b1").accessInfo);
      amendStored("b1", { status: "confirmed" });

      await assert.rejects(
        AccessService.allocateForBooking(TENANT, "b1"),
        noFreeFach,
      );

      expect(store.get("b1").accessInfo).to.deep.equal(before);
    });
  });

  describe("Storno", function () {
    it("frees the Fach at once: the next booking of the same period gets it", async function () {
      await holding("b1");
      amendStored("b1", { status: "cancelled" });

      storeBooking("b2");
      await AccessService.holdForBooking(TENANT, "b2");

      expect(assigned("b2")).to.deep.equal(["uuid-1"]);
    });
  });
});
