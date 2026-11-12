/**
 * The zugeteilte Fach of an Open Locker Schließfachanlage, seen and opened
 * (tickets#1040): the Bereitstellung marks it provisioned without a call to
 * Open Locker, the Rücknahme marks it revoked the same way, "Fach öffnen"
 * sends the UUID of the zugeteilte Fach - not the Anlage's - and the
 * projection names Anlage, Schließfachschrank and number from the
 * Vormerkung on, offering the open only with a running access.
 *
 * On the access seam like `locker-system-allocation.test.js`: the Anlage is
 * a real row, the service runs for real, Open Locker is the fake of
 * `tests/helpers/`, and below the service the data managers are stubbed with
 * an in-memory booking store.
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
const LockerSystemMutex = require("../src/commons/services/access/locker-system-mutex");
const mailModule = require("../src/commons/mail-service");
const { Booking } = require("../src/commons/entities/booking/booking");
const { ownCondition } = require("../src/commons/services/authorization");
const {
  registerAccessProvider,
} = require("../src/commons/services/access/providers/access-provider-registry");
const OpenLockerAccessProvider = require("../src/commons/services/access/providers/open-locker-access-provider");
const { AccessOpenError } = require("../src/errors/AccessOpenError");
const {
  FakeOpenLockerApiClient,
  COMPARTMENT_ID,
  OTHER_COMPARTMENT_ID,
  SECOND_COMPARTMENT_ID,
  LOCKER_BANK_ID,
  SECOND_LOCKER_BANK_ID,
} = require("./helpers/fake-open-locker-api-client");
const {
  installInMemoryLockerSystemHolds,
} = require("./helpers/in-memory-locker-system-holds");

const TENANT = "tenant-1";
/** The reach of the routes of the Umsetzen: Buchung bearbeiten, any. */
const MANAGER = { reach: "any", userId: "admin-1" };
const MINUTE = 60 * 1000;
const HOUR = 60 * MINUTE;

const LABOR = { id: LOCKER_BANK_ID, name: "Labor Fachbank 1" };
const HAFEN = { id: SECOND_LOCKER_BANK_ID, name: "Quartiersschrank Hafen" };

/** The Anlage: the tenant's two Fächer at Open Locker, no `externalId`. */
const anlage = () => ({
  id: "anlage-1",
  tenantId: TENANT,
  type: "locker",
  provider: "open-locker",
  externalId: "",
  label: "Fächer Bahnhof",
  mode: "remote",
  validationRules: [],
  scanCode: "code-anlage-1",
  config: {
    compartments: [
      { id: COMPARTMENT_ID, number: 1, lockerBank: LABOR, outOfService: false },
      {
        id: SECOND_COMPARTMENT_ID,
        number: 3,
        lockerBank: HAFEN,
        outOfService: false,
      },
    ],
  },
});

/** A fixed Fach of Open Locker: a door with the Fach's UUID. */
const FIXED_FACH = {
  id: "fixed-1",
  tenantId: TENANT,
  type: "door",
  provider: "open-locker",
  externalId: SECOND_COMPARTMENT_ID,
  label: "Quartiersschrank Hafen · Fach 3",
  mode: "remote",
  validationRules: [],
  scanCode: "code-fixed-1",
};

describe("Zugeteiltes Fach: provisioned, revoked, opened and projected", function () {
  let store;
  let accessPoints;
  let bookables;
  let client;
  let now;

  before(function () {
    // The registry keeps one instance; a new one reads the new fake.
    registerAccessProvider(
      "open-locker",
      class extends OpenLockerAccessProvider {
        constructor() {
          super({ client });
        }
      },
    );
  });

  after(function () {
    registerAccessProvider("open-locker", OpenLockerAccessProvider);
  });

  beforeEach(function () {
    now = Date.now();
    client = new FakeOpenLockerApiClient();
    registerAccessProvider(
      "open-locker",
      class extends OpenLockerAccessProvider {
        constructor() {
          super({ client });
        }
      },
    );
    store = new Map();
    accessPoints = [anlage(), FIXED_FACH];
    bookables = {
      faecher: {
        id: "faecher",
        title: "Fächer",
        amount: 2,
        accessPointDetails: { active: true, accessPointIds: ["anlage-1"] },
      },
      fixed: {
        id: "fixed",
        title: "Festes Fach",
        amount: 1,
        accessPointDetails: { active: true, accessPointIds: ["fixed-1"] },
      },
    };
    installInMemoryLockerSystemHolds();
    stubDataManagers();
  });

  afterEach(function () {
    sinon.restore();
  });

  function stubDataManagers() {
    // Within the reach, as the manager reads: none throws, `own` narrows.
    sinon
      .stub(BookingManager, "getBooking")
      .callsFake(async (id, tenantId, scope) => {
        const within = Object.entries(ownCondition("booking", scope));
        const row = store.get(id);
        return row && within.every(([key, value]) => row[key] === value)
          ? new Booking(clone(row))
          : null;
      });
    sinon.stub(BookingManager, "storeBooking").callsFake(async (booking) => {
      store.set(booking.id, clone(booking));
      return booking;
    });
    sinon
      .stub(BookingManager, "getBookingsHoldingCompartments")
      .callsFake(async (tenantId, compartmentIds) =>
        [...store.values()]
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
        ids.map((id) => bookables[id]).filter(Boolean),
      );
    sinon.stub(BookableManager, "getRelatedBookables").resolves([]);
    sinon.stub(BookableManager, "getAllParentBookables").resolves([]);
    sinon
      .stub(AccessPointManager, "getAccessPointsByIds")
      .callsFake(async (tenantId, ids) =>
        accessPoints.filter((row) => ids.includes(row.id)),
      );
    sinon
      .stub(AccessPointManager, "getAccessPoint")
      .callsFake(
        async (id) => accessPoints.find((row) => row.id === id) || null,
      );
    sinon
      .stub(TenantManager, "getTenant")
      .resolves({ id: TENANT, applications: [] });
    sinon.stub(AccessLogService, "log").resolves();
    sinon.stub(mailModule, "notify").resolves([]);
  }

  function clone(value) {
    return JSON.parse(JSON.stringify(value));
  }

  /**
   * A booking of the bookable, stored - running now and paid, unless the
   * overrides say otherwise.
   */
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
      status: "confirmed",
      isCommitted: true,
      isPayed: true,
      priceEur: 5,
      timeBegin: now - 5 * MINUTE,
      timeEnd: now + HOUR,
      bookableItems: [{ bookableId, amount }],
      accessInfo: [],
      ...overrides,
    };
    store.set(id, clone(booking));
    return booking;
  }

  /** A booking that went through the Vormerkung: its Fächer are assigned. */
  async function storeHeld(id, amount = 1, overrides = {}) {
    storeBooking(id, "faecher", amount, overrides);
    await AccessService.holdForBooking(TENANT, id);
  }

  /** A booking that went through the Vormerkung and the Bereitstellung. */
  async function storeProvisioned(id, amount = 1, overrides = {}) {
    await storeHeld(id, amount, overrides);
    await AccessService.provisionForBooking(TENANT, id);
  }

  const entries = (id) =>
    store
      .get(id)
      .accessInfo.filter((entry) => entry.accessPointType === "locker");

  function logged(action) {
    return AccessLogService.log.args
      .map(([entry]) => entry)
      .filter((entry) => entry.action === action);
  }

  describe("the Bereitstellung", function () {
    it("marks the zugeteilte Fach provisioned without a call to Open Locker", async function () {
      await storeHeld("b1");
      const before = client.requests.length;

      await AccessService.provisionForBooking(TENANT, "b1");

      const [entry] = entries("b1");
      expect(entry).to.deep.include({
        isProvisioned: true,
        revokedAt: null,
        grant: null,
      });
      expect(entry.provisionedAt).to.be.a("number");
      expect(entry.assignedCompartment.id).to.equal(COMPARTMENT_ID);
      expect(client.requests.length).to.equal(before);
    });

    it("writes the Bereitstellung into the access log, at the Fach", async function () {
      await storeHeld("b1");

      await AccessService.provisionForBooking(TENANT, "b1");

      const [row] = logged("provision");
      expect(row).to.deep.include({
        bookingId: "b1",
        accessPointId: `anlage-1:${COMPARTMENT_ID}`,
        accessPointType: "locker",
        provider: "open-locker",
        externalId: COMPARTMENT_ID,
        result: "success",
      });
      expect(row.payload.compartment).to.deep.equal({
        id: COMPARTMENT_ID,
        number: 1,
        lockerBank: LABOR,
      });
    });

    it("gives the booking a running access to every Fach it holds", async function () {
      await storeHeld("b1", 2);

      await AccessService.provisionForBooking(TENANT, "b1");

      const { points, accessEligibility } =
        await AccessService.getByBookingWithEligibility(TENANT, "b1", {
          userId: "user-1",
        });
      expect(points.map((point) => point.isProvisioned)).to.deep.equal([
        true,
        true,
      ]);
      expect(accessEligibility.remoteOperableAccessPointIds).to.deep.equal([
        `anlage-1:${COMPARTMENT_ID}`,
        `anlage-1:${SECOND_COMPARTMENT_ID}`,
      ]);
      expect(accessEligibility.blockingReasons).to.deep.equal([]);
    });

    it("provisions a Fach once, however often it runs", async function () {
      await storeHeld("b1");
      await AccessService.provisionForBooking(TENANT, "b1");

      await AccessService.provisionForBooking(TENANT, "b1");

      expect(logged("provision")).to.have.length(1);
    });
  });

  describe("Fach öffnen", function () {
    it("sends the UUID of the zugeteilte Fach to Open Locker, not the Anlage's", async function () {
      await storeProvisioned("b1", 2);

      const outcome = await AccessService.open(
        TENANT,
        "b1",
        `anlage-1:${SECOND_COMPARTMENT_ID}`,
        "user-1",
      );

      expect(outcome.success).to.equal(true);
      expect(client.requests).to.include(
        `POST /api/compartments/${SECOND_COMPARTMENT_ID}/open`,
      );
      const [row] = logged("open");
      expect(row).to.deep.include({
        accessPointId: `anlage-1:${SECOND_COMPARTMENT_ID}`,
        externalId: SECOND_COMPARTMENT_ID,
        result: "success",
      });
    });

    it("polls the progress of the open at the zugeteilte Fach", async function () {
      await storeProvisioned("b1");
      const id = `anlage-1:${COMPARTMENT_ID}`;
      const {
        data: { openProcessId },
      } = await AccessService.open(TENANT, "b1", id, "user-1");
      client.advance(openProcessId, "opened");

      const status = await AccessService.getOpenStatus(
        TENANT,
        "b1",
        id,
        openProcessId,
        "user-1",
      );

      expect(status).to.include({ confirmed: true });
    });

    it("refuses the open outside the access window", async function () {
      await storeProvisioned("b1", 1, {
        timeBegin: now + HOUR,
        timeEnd: now + 2 * HOUR,
      });

      const outcome = await AccessService.open(
        TENANT,
        "b1",
        `anlage-1:${COMPARTMENT_ID}`,
        "user-1",
      );

      expect(outcome.success).to.equal(false);
      expect(outcome.blockingReasons).to.include("outside_access_window");
      expect(client.openRequests.size).to.equal(0);
    });

    it("refuses the open of a Fach only held, before the Bereitstellung", async function () {
      await storeHeld("b1", 1, {
        status: "payment_due",
        isCommitted: true,
        isPayed: false,
      });

      const outcome = await AccessService.open(
        TENANT,
        "b1",
        `anlage-1:${COMPARTMENT_ID}`,
        "user-1",
      );

      expect(outcome.success).to.equal(false);
      expect(client.openRequests.size).to.equal(0);
    });

    it("writes a failed open into the access log", async function () {
      accessPoints[0].config.compartments = [
        { id: OTHER_COMPARTMENT_ID, number: 2, lockerBank: LABOR },
      ];
      await storeProvisioned("b1");

      await assert.rejects(
        AccessService.open(
          TENANT,
          "b1",
          `anlage-1:${OTHER_COMPARTMENT_ID}`,
          "user-1",
        ),
        AccessOpenError,
      );

      const [row] = logged("open");
      expect(row).to.deep.include({
        result: "failure",
        externalId: OTHER_COMPARTMENT_ID,
      });
    });
  });

  /**
   * The QR scan as evidence at a Fach (tickets#1055): the Anlage's rules
   * apply to all its Fächer, but the code checked is the Fach's own, so a
   * sticker opens its own Fach only.
   */
  describe("Fach öffnen with a QR scan", function () {
    const FACH = `anlage-1:${COMPARTMENT_ID}`;

    beforeEach(function () {
      const [first, second] = accessPoints[0].config.compartments;
      Object.assign(accessPoints[0], {
        validationRules: [{ type: "qrScan" }],
      });
      Object.assign(first, {
        scanCode: "code-fach-1",
        previousScanCodes: ["earlier-code-fach-1"],
      });
      Object.assign(second, {
        scanCode: "code-fach-3",
        previousScanCodes: [],
      });
    });

    function openWithScan(scanCode, userId = "user-1", options = {}) {
      return AccessService.open(TENANT, "b1", FACH, userId, {
        evidence: [{ type: "qrScan", scanCode }],
        channel: "qrScan",
        ...options,
      });
    }

    it("opens the Fach with the code of the Fach", async function () {
      await storeProvisioned("b1");

      const outcome = await openWithScan("code-fach-1");

      expect(outcome.success).to.equal(true);
      expect(client.requests).to.include(
        `POST /api/compartments/${COMPARTMENT_ID}/open`,
      );
      const [row] = logged("open");
      expect(row).to.deep.include({
        accessPointId: FACH,
        result: "success",
        evidenceBypassed: false,
      });
      expect(row.payload.validatedEvidence).to.deep.equal(["qrScan"]);
    });

    for (const [what, scanCode] of [
      ["another Fach of the same Anlage", "code-fach-3"],
      ["the Anlage itself", "code-anlage-1"],
      ["an earlier code of the Fach", "earlier-code-fach-1"],
    ]) {
      it(`refuses the code of ${what} as invalid evidence`, async function () {
        await storeProvisioned("b1");

        const outcome = await openWithScan(scanCode);

        expect(outcome).to.deep.equal({
          success: false,
          blockingReasons: ["evidence_invalid"],
        });
        expect(client.openRequests.size).to.equal(0);
        const [row] = logged("open");
        expect(row).to.deep.include({ accessPointId: FACH, result: "denied" });
      });
    }

    it("lets the management open a booking not theirs without a scan, as before", async function () {
      await storeProvisioned("b1");

      const outcome = await AccessService.open(TENANT, "b1", FACH, "admin-1", {
        scope: MANAGER,
      });

      expect(outcome.success).to.equal(true);
      const [row] = logged("open");
      expect(row).to.deep.include({
        result: "success",
        accessRole: "manager",
        evidenceBypassed: true,
      });
    });
  });

  describe("the Rücknahme", function () {
    it("marks the provisioned Fach revoked without a call to Open Locker", async function () {
      await storeProvisioned("b1");
      const before = client.requests.length;

      await AccessService.revokeForBooking(TENANT, "b1");

      const [entry] = entries("b1");
      expect(entry.isProvisioned).to.equal(false);
      expect(entry.revokedAt).to.be.a("number");
      expect(entry.assignedCompartment.id).to.equal(COMPARTMENT_ID);
      expect(client.requests.length).to.equal(before);
      const [row] = logged("revoke");
      expect(row).to.deep.include({
        accessPointId: `anlage-1:${COMPARTMENT_ID}`,
        externalId: COMPARTMENT_ID,
        result: "success",
      });
      expect(row.payload.compartment).to.deep.equal({
        id: COMPARTMENT_ID,
        number: 1,
        lockerBank: LABOR,
      });
    });

    it("locks the Fach afterwards", async function () {
      await storeProvisioned("b1");
      await AccessService.revokeForBooking(TENANT, "b1");

      const outcome = await AccessService.open(
        TENANT,
        "b1",
        `anlage-1:${COMPARTMENT_ID}`,
        "user-1",
      );

      expect(outcome.success).to.equal(false);
      expect(outcome.blockingReasons).to.include("authorization_revoked");
      expect(client.openRequests.size).to.equal(0);
    });

    it("frees the Fach for the next booking", async function () {
      bookables.faecher.amount = 1;
      accessPoints[0].config.compartments = [
        { id: COMPARTMENT_ID, number: 1, lockerBank: LABOR },
      ];
      await storeProvisioned("b1");
      await AccessService.revokeForBooking(TENANT, "b1");

      await storeHeld("b2");

      expect(entries("b2")[0].assignedCompartment.id).to.equal(COMPARTMENT_ID);
    });

    it("leaves a Fach only held alone - the unpaid change holds before it revokes", async function () {
      await storeHeld("b1", 1, { status: "payment_due", isPayed: false });

      await AccessService.revokeForBooking(TENANT, "b1");

      const [entry] = entries("b1");
      expect(entry.revokedAt).to.equal(null);
      expect(entry.assignedCompartment.id).to.equal(COMPARTMENT_ID);
      expect(logged("revoke")).to.deep.equal([]);
    });
  });

  describe("what the booking lists", function () {
    it("lists the Fach from the Vormerkung on, before the payment, with Anlage, Schließfachschrank and number - but offers no open yet", async function () {
      await storeHeld("b1", 1, { status: "payment_due", isPayed: false });

      const { points, accessEligibility } =
        await AccessService.getByBookingWithEligibility(TENANT, "b1", {
          userId: "user-1",
        });

      expect(points).to.have.length(1);
      expect(points[0]).to.deep.include({
        id: `anlage-1:${COMPARTMENT_ID}`,
        type: "locker",
        provider: "open-locker",
        label: "Fächer Bahnhof",
        isProvisioned: false,
        capabilities: ["open"],
        assignedCompartment: { number: 1, lockerBankName: "Labor Fachbank 1" },
      });
      expect(accessEligibility.remoteOperableAccessPointIds).to.deep.equal([]);
    });

    it("lets the booker and the management view the list of an unpaid booking holding a Fach", async function () {
      await storeHeld("b1", 1, { status: "payment_due", isPayed: false });

      expect(
        await AccessService.canView("user-1", TENANT, "b1", { reach: "own" }),
      ).to.equal(true);
      expect(
        await AccessService.canView("admin-1", TENANT, "b1", { reach: "any" }),
      ).to.equal(true);
      expect(
        await AccessService.canView("other-1", TENANT, "b1", { reach: "own" }),
      ).to.equal(false);
    });

    it("lists nothing of a cancelled booking that held a Fach", async function () {
      await storeHeld("b1", 1, { status: "payment_due", isPayed: false });
      const cancelled = store.get("b1");
      cancelled.status = "cancelled";
      store.set("b1", cancelled);

      expect(
        await AccessService.canView("user-1", TENANT, "b1", { reach: "own" }),
      ).to.equal(false);
    });

    it("keeps an unpaid booking at a door out of view, as before", async function () {
      storeBooking("f1", "fixed", 1, { status: "payment_due", isPayed: false });

      expect(
        await AccessService.canView("user-1", TENANT, "f1", { reach: "own" }),
      ).to.equal(false);
    });

    it("offers the open once the access runs", async function () {
      await storeProvisioned("b1");

      const { points, accessEligibility } =
        await AccessService.getByBookingWithEligibility(TENANT, "b1", {
          userId: "user-1",
        });

      expect(points[0].isProvisioned).to.equal(true);
      expect(accessEligibility.remoteOperableAccessPointIds).to.deep.equal([
        `anlage-1:${COMPARTMENT_ID}`,
      ]);
    });

    it("lists the Fach on the Mobile Key, under the same id", async function () {
      await storeProvisioned("b1");
      sinon
        .stub(BookingManager, "getUserBookingsFiltered")
        .callsFake(async () => [new Booking(clone(store.get("b1")))]);
      // The tenant snapshot of the answer: no tenant here.
      sinon.stub(TenantManager, "getTenantsByIds").resolves([]);
      sinon.stub(BookableManager, "getBookablesWithAccessPoints").resolves([
        {
          ...bookables.faecher,
          tenantId: TENANT,
          accessPoints: [anlage()],
        },
      ]);

      const [result] = await AccessService.getUserBookingsWithAccess("user-1", {
        includeAccessPoints: true,
        includeLockers: true,
        includeEligibility: true,
      });

      expect(result.accessPointIds).to.deep.equal([
        `anlage-1:${COMPARTMENT_ID}`,
      ]);
      expect(result.accessPoints[0].assignedCompartment).to.deep.equal({
        number: 1,
        lockerBankName: "Labor Fachbank 1",
      });
      expect(
        result.accessEligibility.remoteOperableAccessPointIds,
      ).to.deep.equal([`anlage-1:${COMPARTMENT_ID}`]);
    });

    it("keeps the fixed Fach a door with its label", async function () {
      storeBooking("f1", "fixed");
      await AccessService.provisionForBooking(TENANT, "f1");

      const points = await AccessService.getByBooking(TENANT, "f1", {
        userId: "user-1",
      });

      expect(points).to.have.length(1);
      expect(points[0]).to.include({
        id: "fixed-1",
        type: "door",
        label: "Quartiersschrank Hafen · Fach 3",
        isProvisioned: true,
      });
      expect(points[0]).to.not.have.property("assignedCompartment");
    });
  });

  describe("Fach umsetzen (tickets#1044)", function () {
    const FOURTH_COMPARTMENT_ID = "2e3f4a5b-6c7d-4e8f-a0b1-c2d3e4f5a6b7";
    const C1 = `anlage-1:${COMPARTMENT_ID}`;
    const C2 = `anlage-1:${OTHER_COMPARTMENT_ID}`;
    const C3 = `anlage-1:${SECOND_COMPARTMENT_ID}`;

    /**
     * Four Fächer, the fourth out of service; the access buffer reaches 30
     * minutes past the booking. "b2" begins 15 minutes after "b1" ends, so
     * it occupies its Fach for "b1" by the buffer alone. Held first, "b2"
     * gets Fach 1, "b1" then Fach 2; free for "b1" is Fach 3 alone.
     */
    beforeEach(async function () {
      accessPoints[0].config.compartments = [
        { id: COMPARTMENT_ID, number: 1, lockerBank: LABOR },
        { id: OTHER_COMPARTMENT_ID, number: 2, lockerBank: LABOR },
        { id: SECOND_COMPARTMENT_ID, number: 3, lockerBank: HAFEN },
        {
          id: FOURTH_COMPARTMENT_ID,
          number: 4,
          lockerBank: HAFEN,
          outOfService: true,
        },
      ];
      bookables.faecher.accessPointDetails.accessBuffer = {
        before: 0,
        after: 30,
      };
      await storeHeld("b2", 1, {
        assignedUserId: "user-2",
        timeBegin: now + HOUR + 15 * MINUTE,
        timeEnd: now + 2 * HOUR,
      });
      await storeProvisioned("b1");
      AccessLogService.log.resetHistory();
    });

    it("offers the Fächer of the same Anlage free for the period with its buffers and in service", async function () {
      expect(entries("b2")[0].assignedCompartment.id).to.equal(COMPARTMENT_ID);
      expect(entries("b1")[0].assignedCompartment.id).to.equal(
        OTHER_COMPARTMENT_ID,
      );

      const free = await AccessService.freeCompartmentsToReassign(
        TENANT,
        "b1",
        C2,
        { scope: MANAGER },
      );

      expect(free).to.deep.equal([
        { id: C3, number: 3, lockerBankName: "Quartiersschrank Hafen" },
      ]);
    });

    it("moves a running booking to the chosen Fach, and „Fach öffnen“ opens the new one", async function () {
      const moved = await AccessService.reassignCompartment(
        TENANT,
        "b1",
        C2,
        C3,
        { userId: "admin-1", scope: MANAGER },
      );

      expect(moved).to.deep.equal({
        id: C3,
        previousId: C2,
        assignedCompartment: {
          number: 3,
          lockerBankName: "Quartiersschrank Hafen",
        },
      });
      const [entry] = entries("b1");
      expect(entry.assignedCompartment).to.deep.equal({
        id: SECOND_COMPARTMENT_ID,
        number: 3,
        lockerBank: HAFEN,
      });
      expect(entry.isProvisioned).to.equal(true);

      const outcome = await AccessService.open(TENANT, "b1", C3, "user-1");
      expect(outcome.success).to.equal(true);
      expect(client.requests).to.include(
        `POST /api/compartments/${SECOND_COMPARTMENT_ID}/open`,
      );
      await assert.rejects(AccessService.open(TENANT, "b1", C2, "user-1"), {
        code: "access_point_not_in_booking",
      });
    });

    it("lists the new Fach for the booking and on the Mobile Key's projection", async function () {
      await AccessService.reassignCompartment(TENANT, "b1", C2, C3, {
        userId: "admin-1",
        scope: MANAGER,
      });

      const { points, accessEligibility } =
        await AccessService.getByBookingWithEligibility(TENANT, "b1", {
          userId: "user-1",
        });
      expect(points.map((point) => point.id)).to.deep.equal([C3]);
      expect(accessEligibility.remoteOperableAccessPointIds).to.deep.equal([
        C3,
      ]);
    });

    it("writes the Umsetzen into the access log, at the new Fach, and sends no mail", async function () {
      await AccessService.reassignCompartment(TENANT, "b1", C2, C3, {
        userId: "admin-1",
        scope: MANAGER,
      });

      const [row] = logged("reassign");
      expect(row).to.deep.include({
        bookingId: "b1",
        accessPointId: C3,
        externalId: SECOND_COMPARTMENT_ID,
        provider: "open-locker",
        result: "success",
        actor: { userId: "admin-1", source: "user" },
      });
      expect(row.payload).to.deep.equal({
        compartment: {
          id: SECOND_COMPARTMENT_ID,
          number: 3,
          lockerBank: HAFEN,
        },
        previous: { id: OTHER_COMPARTMENT_ID, number: 2, lockerBank: LABOR },
      });
      expect(mailModule.notify.called).to.equal(false);
    });

    it("refuses a Fach that is occupied, out of service or the booking's own, and keeps the Fach", async function () {
      for (const to of [
        C1,
        `anlage-1:${FOURTH_COMPARTMENT_ID}`,
        C2,
        "anlage-1:not-in-the-anlage",
        `anlage-2:${SECOND_COMPARTMENT_ID}`,
      ]) {
        await assert.rejects(
          AccessService.reassignCompartment(TENANT, "b1", C2, to, {
            userId: "admin-1",
            scope: MANAGER,
          }),
          { statusCode: 409, code: "compartment_taken" },
        );
      }

      expect(entries("b1")[0].assignedCompartment.id).to.equal(
        OTHER_COMPARTMENT_ID,
      );
      expect(logged("reassign")).to.deep.equal([]);
    });

    it("checks the occupancy again under the mutex and refuses a Fach taken in between", async function () {
      const free = await AccessService.freeCompartmentsToReassign(
        TENANT,
        "b1",
        C2,
        { scope: MANAGER },
      );
      expect(free.map((c) => c.id)).to.deep.equal([C3]);

      // Another Vormerkung holds the Anlage and takes Fach 3 meanwhile.
      let release;
      const other = LockerSystemMutex.hold(
        { tenantId: TENANT, id: "anlage-1" },
        () => new Promise((resolve) => (release = resolve)),
      );
      await new Promise((resolve) => setImmediate(resolve));
      const reassign = AccessService.reassignCompartment(TENANT, "b1", C2, C3, {
        userId: "admin-1",
        scope: MANAGER,
      });
      await new Promise((resolve) => setTimeout(resolve, 20));
      storeBooking("b3", "faecher", 1, {
        accessInfo: [
          {
            ...entries("b1")[0],
            assignedCompartment: {
              id: SECOND_COMPARTMENT_ID,
              number: 3,
              lockerBank: HAFEN,
            },
          },
        ],
      });
      release();
      await other;

      await assert.rejects(reassign, {
        statusCode: 409,
        code: "compartment_taken",
      });
      expect(entries("b1")[0].assignedCompartment.id).to.equal(
        OTHER_COMPARTMENT_ID,
      );
    });

    it("moves an unpaid booking's Fach, which stays held", async function () {
      await storeHeld("b4", 1, {
        status: "payment_due",
        isPayed: false,
        timeBegin: now + 5 * HOUR,
        timeEnd: now + 6 * HOUR,
      });
      const [held] = entries("b4");

      await AccessService.reassignCompartment(
        TENANT,
        "b4",
        `anlage-1:${held.assignedCompartment.id}`,
        C3,
        { userId: "admin-1", scope: MANAGER },
      );

      const [entry] = entries("b4");
      expect(entry.assignedCompartment.id).to.equal(SECOND_COMPARTMENT_ID);
      expect(entry.hold).to.deep.equal(held.hold);
      expect(entry.isProvisioned).to.not.equal(true);
    });

    it("answers 404 for an access point of the booking that is no zugeteiltes Fach", async function () {
      storeBooking("f1", "fixed");
      await AccessService.provisionForBooking(TENANT, "f1");

      await assert.rejects(
        AccessService.freeCompartmentsToReassign(TENANT, "f1", "fixed-1", {
          scope: MANAGER,
        }),
        { statusCode: 404, code: "compartment_not_in_booking" },
      );
      await assert.rejects(
        AccessService.reassignCompartment(TENANT, "b1", C1, C3, {
          userId: "admin-1",
          scope: MANAGER,
        }),
        { statusCode: 404, code: "compartment_not_in_booking" },
      );
      await assert.rejects(
        AccessService.freeCompartmentsToReassign(TENANT, "missing", C2, {
          scope: MANAGER,
        }),
        { statusCode: 404, code: "compartment_not_in_booking" },
      );
    });

    it("reads the booking within the reach of the route: a booking out of it holds no Fach to move", async function () {
      const elsewhere = { reach: "own", userId: "user-2" };

      await assert.rejects(
        AccessService.freeCompartmentsToReassign(TENANT, "b1", C2, {
          scope: elsewhere,
        }),
        { statusCode: 404, code: "compartment_not_in_booking" },
      );
      await assert.rejects(
        AccessService.reassignCompartment(TENANT, "b1", C2, C3, {
          userId: "user-2",
          scope: elsewhere,
        }),
        { statusCode: 404, code: "compartment_not_in_booking" },
      );
      expect(entries("b1")[0].assignedCompartment.id).to.equal(
        OTHER_COMPARTMENT_ID,
      );
    });
  });
});
