/**
 * A failed Änderung and a Vormerkung at the same
 * Schließfachanlage at the same time (tickets#1042): the lifecycle saves the
 * new content, then gives the Fach (`access.allocate` at `confirmed`,
 * `access.hold` before) and restores the old content when no Fach is free.
 * Between the save and the restore the booking stands at its new period, so
 * its old Fach looks free in the old one. Save, Zuteilung and restore run
 * under the mutex of the Anlage, so no other Vormerkung gets that Fach in
 * between and the restored booking never shares it.
 *
 * On the lifecycle seam with the real access adapter: the lifecycle runs
 * over the in-memory adapters, `AccessService` for real behind it, the
 * data managers stubbed over the same in-memory booking store.
 */

const { expect } = require("chai");
const sinon = require("sinon");

process.env.CRYPTO_SECRET =
  process.env.CRYPTO_SECRET || "0123456789abcdef0123456789abcdef";

const AccessService = require("../src/commons/services/access/access-service");
const access = require("../src/commons/services/booking-lifecycle/adapters/access");
const {
  createBookingLifecycle,
} = require("../src/commons/services/booking-lifecycle/booking-lifecycle");
const {
  TRIGGER,
} = require("../src/commons/services/booking-lifecycle/booking-state");
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
  inMemoryAdapters,
  DEFAULT_TENANT,
} = require("./helpers/in-memory-lifecycle-adapters");
const {
  installInMemoryLockerSystemHolds,
} = require("./helpers/in-memory-locker-system-holds");

const TENANT = DEFAULT_TENANT.id;
const HOUR = 60 * 60 * 1000;
const DAY = 24 * HOUR;
const BANK = { id: "bank-labor", name: "Labor Fachbank 1" };

const fach = (number) => ({
  id: `uuid-${number}`,
  number,
  lockerBank: BANK,
  outOfService: false,
});

const ANLAGE = {
  id: "anlage-labor",
  tenantId: TENANT,
  type: "locker",
  provider: "open-locker",
  externalId: "",
  label: "Fächer Labor",
  mode: "remote",
  validationRules: [],
  scanCode: "code-anlage-labor",
  config: { compartments: [fach(1), fach(2)] },
};

const BOOKABLE = {
  id: "faecher",
  title: "Fächer",
  amount: 2,
  accessPointDetails: { active: true, accessPointIds: [ANLAGE.id] },
};

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

/** A promise with its `resolve` at hand. */
function deferred() {
  let resolve;
  const promise = new Promise((r) => {
    resolve = r;
  });
  return { promise, resolve };
}

/** Lets the calls started so far get as far as they get without waiting. */
const settle = () => new Promise((resolve) => setTimeout(resolve, 30));

describe("a failed Änderung next to a Vormerkung at the same Anlage", function () {
  let now;
  let adapters;
  let lifecycle;
  let rows;
  /** Resolves once the lifecycle's save is written; the save then waits. */
  let saved;
  /** Lets the lifecycle's save return, and the run go on. */
  let goOn;

  beforeEach(function () {
    now = Date.now();
    adapters = inMemoryAdapters({ clock: () => now });
    adapters.access = access;
    rows = adapters.store.rows;
    saved = deferred();
    goOn = deferred();
    const save = adapters.store.save;
    adapters.store.save = async (...args) => {
      const previous = await save(...args);
      saved.resolve();
      await goOn.promise;
      return previous;
    };
    lifecycle = createBookingLifecycle(adapters);
    installInMemoryLockerSystemHolds();
    stubDataManagers();
  });

  afterEach(function () {
    sinon.restore();
  });

  function stubDataManagers() {
    sinon
      .stub(BookingManager, "getBooking")
      .callsFake(async (id) =>
        rows.has(id) ? new Booking(clone(rows.get(id))) : null,
      );
    sinon.stub(BookingManager, "storeBooking").callsFake(async (booking) => {
      rows.set(booking.id, clone(booking));
      return booking;
    });
    sinon
      .stub(BookingManager, "getBookingsHoldingCompartments")
      .callsFake(async (tenantId, compartmentIds) =>
        [...rows.values()]
          .filter((booking) =>
            (booking.accessInfo || []).some((entry) =>
              compartmentIds.includes(entry.assignedCompartment?.id),
            ),
          )
          .map((booking) => new Booking(clone(booking))),
      );
    sinon.stub(BookingManager, "getConcurrentBookings").resolves([]);
    sinon
      .stub(BookableManager, "getBookablesByIds")
      .callsFake(async (tenantId, ids) =>
        ids.includes(BOOKABLE.id) ? [clone(BOOKABLE)] : [],
      );
    sinon.stub(BookableManager, "getRelatedBookables").resolves([]);
    sinon.stub(BookableManager, "getAllParentBookables").resolves([]);
    sinon
      .stub(AccessPointManager, "getAccessPointsByIds")
      .callsFake(async (tenantId, ids) =>
        ids.includes(ANLAGE.id) ? [clone(ANLAGE)] : [],
      );
    sinon.stub(TenantManager, "getTenant").resolves({
      id: TENANT,
      mail: "stadt@example.test",
      applications: [],
    });
    sinon.stub(AccessLogService, "log").resolves();
    sinon.stub(mailModule, "notify").resolves([]);
  }

  /** A booking of one Fach, stored; `holding` names the Fach it holds. */
  function storeBooking(id, { holding, ...overrides } = {}) {
    const booking = {
      id,
      tenantId: TENANT,
      assignedUserId: "user-1",
      mail: "erika@example.test",
      name: "Erika Muster",
      status: "payment_due",
      priceEur: 5,
      timeBegin: now + HOUR,
      timeEnd: now + 2 * HOUR,
      bookableItems: [{ bookableId: BOOKABLE.id, amount: 1 }],
      hooks: [],
      attachments: [],
      accessInfo: holding ? [entryAt(holding)] : [],
      ...overrides,
    };
    rows.set(id, clone(booking));
    return booking;
  }

  function entryAt(compartmentId) {
    return {
      accessPointId: ANLAGE.id,
      accessPointType: "locker",
      provider: "open-locker",
      externalId: "",
      mode: "remote",
      bookableId: BOOKABLE.id,
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
    };
  }

  const assigned = (id) =>
    rows
      .get(id)
      .accessInfo.filter((entry) => !entry.revokedAt)
      .map((entry) => entry.assignedCompartment?.id);

  /** Both Fächer taken in the period `later` by other bookings. */
  function bothTakenAt(later) {
    storeBooking("other-1", { holding: "uuid-1", ...later });
    storeBooking("other-2", { holding: "uuid-2", ...later });
  }

  /**
   * Runs the transition up to its save, a Vormerkung of `b2` in the old
   * period meanwhile, then lets the transition go on.
   */
  async function raceVormerkung(transition) {
    storeBooking("b2");
    const running = transition();
    await saved.promise;
    const holding = AccessService.holdForBooking(TENANT, "b2");
    await settle();
    goOn.resolve();
    return Promise.allSettled([running, holding]);
  }

  for (const status of ["confirmed", "payment_due"]) {
    it(`an Änderung at ${status} without a free Fach leaves its Fach to nobody else meanwhile`, async function () {
      const later = { timeBegin: now + DAY, timeEnd: now + DAY + HOUR };
      storeBooking("b1", { holding: "uuid-1", status });
      bothTakenAt(later);
      const changed = new Booking({ ...clone(rows.get("b1")), ...later });

      const [amended, held] = await raceVormerkung(() =>
        lifecycle.amend(TENANT, changed, { trigger: TRIGGER.ADMIN }),
      );

      expect(amended.status).to.equal("rejected");
      expect(amended.reason.code).to.equal("compartments_unavailable");
      expect(held.status).to.equal("fulfilled");
      expect(rows.get("b1").timeBegin).to.equal(now + HOUR);
      expect(assigned("b1")).to.deep.equal(["uuid-1"]);
      expect(assigned("b2")).to.deep.equal(["uuid-2"]);
    });
  }
});
