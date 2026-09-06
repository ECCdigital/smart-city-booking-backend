/**
 * The bookings that hold a live access at one access point: the answer the
 * delete dialog of the administration needs before it tears one down.
 *
 * Two halves. The derivation is `AccessService.getBookingsWithLiveAccess` -
 * which entry of a booking's `accessInfo` counts as a live grant, and which
 * booking is still running. The route is
 * `GET /api/:tenant/accesspoints/:id/bookings`, which caps the list and
 * counts the rest; who may call it is the route's marker and is pinned in
 * `authorization-access-routes.test.js`.
 */

const { expect } = require("chai");
const sinon = require("sinon");

const AccessPointController = require("../src/platform/api/controllers/access-point-controller");
const AccessPointManager = require("../src/commons/data-managers/access-point-manager");
const AccessService = require("../src/commons/services/access/access-service");
const BookingManager = require("../src/commons/data-managers/booking-manager");
const { AccessPoint } = require("../src/commons/entities/access/access-point");
const {
  installHarness,
  bookable,
  TENANT: HARNESS_TENANT,
  OWNER,
} = require("./helpers/booking-lifecycle-harness");
const { installRouteWorld, FIXTURE_ID } = require("./helpers/route-world");

const TENANT = "tenant-1";
const POINT = "point-1";
const NOW = 1_700_000_000_000;
const HOUR = 60 * 60 * 1000;

/** A granted, unrevoked entry at the access point under test. */
function grantedEntry(overrides = {}) {
  return {
    accessPointId: POINT,
    accessPointType: "door",
    provider: "nuki",
    isProvisioned: true,
    provisionedAt: NOW - HOUR,
    revokedAt: null,
    grant: { id: "grant-1" },
    ...overrides,
  };
}

function booking(overrides = {}) {
  return {
    id: "booking-1",
    tenantId: TENANT,
    name: "Erika Muster",
    mail: "erika@example.test",
    timeBegin: NOW - HOUR,
    timeEnd: NOW + HOUR,
    isRejected: false,
    accessInfo: [grantedEntry()],
    ...overrides,
  };
}

describe("AccessService.getBookingsWithLiveAccess", () => {
  let sandbox;
  let getBookings;

  beforeEach(() => {
    sandbox = sinon.createSandbox();
    getBookings = sandbox.stub(BookingManager, "getBookingsCustomFilter");
  });

  afterEach(() => {
    sandbox.restore();
  });

  const run = (bookings, options = {}) => {
    getBookings.resolves(bookings);
    return AccessService.getBookingsWithLiveAccess(TENANT, POINT, {
      now: NOW,
      ...options,
    });
  };

  // The whole predicate is in the query, so what is loaded is bounded by the
  // live grants and not by every booking the access point ever had - each of
  // those keeps its revoked entry for good.
  it("asks the database for the live grants alone, not for the access point's history", async () => {
    await run([]);

    expect(getBookings.calledOnce).to.be.true;
    const [tenant, filter] = getBookings.firstCall.args;
    expect(tenant).to.equal(TENANT);
    expect(filter).to.deep.equal({
      isRejected: { $ne: true },
      $or: [{ timeEnd: null }, { timeEnd: { $gte: NOW } }],
      accessInfo: {
        $elemMatch: {
          accessPointId: POINT,
          isProvisioned: true,
          revokedAt: null,
        },
      },
    });
  });

  it("names a booking whose grant at the access point is unrevoked", async () => {
    const result = await run([booking()]);

    expect(result.total).to.equal(1);
    expect(result.bookings).to.deep.equal([
      {
        id: "booking-1",
        name: "Erika Muster",
        mail: "erika@example.test",
        timeBegin: NOW - HOUR,
        timeEnd: NOW + HOUR,
      },
    ]);
  });

  it("counts a remote door, which is provisioned without a grant", async () => {
    const remote = booking({
      accessInfo: [grantedEntry({ mode: "remote", grant: null })],
    });

    expect((await run([remote])).total).to.equal(1);
  });

  it("leaves out a revoked entry, whose trace stays at the booking", async () => {
    const revoked = booking({
      accessInfo: [
        grantedEntry({ isProvisioned: false, revokedAt: NOW - HOUR }),
      ],
    });

    expect((await run([revoked])).total).to.equal(0);
  });

  it("leaves out a compartment that is only held, not granted", async () => {
    const held = booking({
      accessInfo: [
        grantedEntry({
          accessPointType: "locker",
          isProvisioned: false,
          provisionedAt: null,
          grant: null,
          hold: { until: NOW + HOUR },
        }),
      ],
    });

    expect((await run([held])).total).to.equal(0);
  });

  it("leaves out an entry that belongs to another access point", async () => {
    const elsewhere = booking({
      accessInfo: [grantedEntry({ accessPointId: "point-2" })],
    });

    expect((await run([elsewhere])).total).to.equal(0);
  });

  it("leaves out a booking whose period is over", async () => {
    const past = booking({ timeBegin: NOW - 3 * HOUR, timeEnd: NOW - HOUR });

    expect((await run([past])).total).to.equal(0);
  });

  it("keeps a booking that has no end", async () => {
    const open = booking({ timeBegin: NOW - HOUR, timeEnd: null });

    expect((await run([open])).total).to.equal(1);
  });

  it("names each booking once, however many compartments it holds", async () => {
    const twoCompartments = booking({
      accessInfo: [
        grantedEntry({ accessPointType: "locker", compartment: "A1" }),
        grantedEntry({ accessPointType: "locker", compartment: "A2" }),
      ],
    });

    const result = await run([twoCompartments]);

    expect(result.total).to.equal(1);
    expect(result.bookings).to.have.lengthOf(1);
  });

  it("caps the list and counts the rest", async () => {
    const many = Array.from({ length: 12 }, (_, index) =>
      booking({
        id: `booking-${String(index).padStart(2, "0")}`,
        timeBegin: NOW + (12 - index) * HOUR,
        timeEnd: NOW + (24 - index) * HOUR,
      }),
    );

    const result = await run(many, { limit: 10 });

    expect(result.total).to.equal(12);
    expect(result.bookings).to.have.lengthOf(10);
    expect(result.bookings[0].id).to.equal("booking-11");
    expect(result.bookings[9].id).to.equal("booking-02");
  });

  // The ones already running are the ones the deletion cuts off mid-use, so
  // they are the ones that survive the cap.
  it("names the bookings already running before those still to come", async () => {
    const future = booking({
      id: "future",
      timeBegin: NOW + HOUR,
      timeEnd: NOW + 2 * HOUR,
    });
    const runningNow = booking({
      id: "running-now",
      timeBegin: NOW - HOUR,
      timeEnd: NOW + HOUR,
    });

    const result = await run([future, runningNow]);

    expect(result.bookings.map((b) => b.id)).to.deep.equal([
      "running-now",
      "future",
    ]);
  });
});

describe("AccessPointController.getAccessPointBookings", () => {
  let sandbox;
  let request;
  let response;
  let next;

  beforeEach(() => {
    sandbox = sinon.createSandbox();
    sandbox.stub(AccessPointManager, "getAccessPoint").resolves(
      AccessPoint.create({
        id: POINT,
        tenantId: TENANT,
        provider: "nuki",
        externalId: "lock-1",
        label: "Haupteingang",
      }),
    );
    sandbox
      .stub(AccessService, "getBookingsWithLiveAccess")
      .resolves({ total: 0, bookings: [] });

    request = {
      params: { tenant: TENANT, id: POINT },
      query: {},
      body: {},
      user: { id: "user-1" },
      reach: "any",
    };
    response = {
      status: sandbox.stub().returnsThis(),
      json: sandbox.stub(),
      send: sandbox.stub(),
      sendStatus: sandbox.stub(),
    };
    next = sandbox.stub();
  });

  afterEach(() => {
    sandbox.restore();
  });

  it("answers the bookings of the access point in the path", async () => {
    AccessService.getBookingsWithLiveAccess.resolves({
      total: 3,
      bookings: [{ id: "booking-1" }],
    });

    await AccessPointController.getAccessPointBookings(request, response, next);

    expect(
      AccessService.getBookingsWithLiveAccess.calledOnceWith(TENANT, POINT),
    ).to.be.true;
    expect(response.status.calledWith(200)).to.be.true;
    expect(response.json.firstCall.args[0]).to.deep.equal({
      total: 3,
      bookings: [{ id: "booking-1" }],
    });
  });

  // The cap is the route's, not the caller's: a request that could ask for
  // more would be asking for a booking export.
  it("names ten bookings, whatever the request asks for", async () => {
    request.query.limit = "100";

    await AccessPointController.getAccessPointBookings(request, response, next);

    expect(
      AccessService.getBookingsWithLiveAccess.firstCall.args[2],
    ).to.deep.equal({ limit: 10 });
  });

  it("answers 404 for an access point the tenant does not have", async () => {
    AccessPointManager.getAccessPoint.resolves(null);

    await AccessPointController.getAccessPointBookings(request, response, next);

    expect(response.sendStatus.calledWith(404)).to.be.true;
    expect(AccessService.getBookingsWithLiveAccess.called).to.be.false;
  });

  it("hands an error on rather than answering an empty list", async () => {
    const boom = new Error("boom");
    AccessService.getBookingsWithLiveAccess.rejects(boom);

    await AccessPointController.getAccessPointBookings(request, response, next);

    expect(next.calledOnceWith(boom)).to.be.true;
  });
});

/**
 * The two halves together: the real route over the real controller and the
 * real derivation, with only the database behind them. The tests above stub
 * at the seam between them, so a route wired to the wrong access point - or a
 * derivation whose answer never reaches the body - would pass all of them.
 */
describe("GET /api/:tenant/accesspoints/:id/bookings, end to end", function () {
  this.timeout(20000);

  let h;

  before(async function () {
    h = await installHarness({
      bookables: {
        [FIXTURE_ID]: bookable({ id: FIXTURE_ID, title: "Fixture" }),
      },
    });
    installRouteWorld({
      tenantId: HARNESS_TENANT,
      tenant: h.tenant,
      ownerUserId: OWNER,
      bookables: h.bookables,
    });
  });

  // The route world already stands behind every manager, so the database is
  // steered by re-answering its stub rather than by wrapping it again.
  afterEach(function () {
    BookingManager.getBookingsCustomFilter.resetBehavior();
    BookingManager.getBookingsCustomFilter.resetHistory();
    BookingManager.getBookingsCustomFilter.callsFake(async () => []);
  });

  after(async function () {
    sinon.restore();
    await h.close();
  });

  it("carries the derivation's answer into the response body", async function () {
    const begin = Date.now();
    const end = begin + 60 * 60 * 1000;
    const query = BookingManager.getBookingsCustomFilter;
    query.resolves([
      {
        id: "booking-live",
        tenantId: HARNESS_TENANT,
        name: "Erika Muster",
        mail: "erika@example.test",
        timeBegin: begin,
        timeEnd: end,
        isRejected: false,
        accessInfo: [
          {
            accessPointId: FIXTURE_ID,
            isProvisioned: true,
            revokedAt: null,
            grant: { id: "grant-1" },
          },
        ],
      },
      // A revoked entry at the same access point: loaded, but not named.
      {
        id: "booking-revoked",
        tenantId: HARNESS_TENANT,
        name: "Max Muster",
        mail: "max@example.test",
        timeBegin: begin,
        timeEnd: end,
        isRejected: false,
        accessInfo: [
          {
            accessPointId: FIXTURE_ID,
            isProvisioned: false,
            revokedAt: begin,
          },
        ],
      },
    ]);

    const res = await h
      .api()
      .get(`/api/${HARNESS_TENANT}/accesspoints/${FIXTURE_ID}/bookings`)
      .set(h.as(OWNER))
      .send();

    expect(res.status).to.equal(200);
    expect(res.body).to.deep.equal({
      total: 1,
      bookings: [
        {
          id: "booking-live",
          name: "Erika Muster",
          mail: "erika@example.test",
          timeBegin: begin,
          timeEnd: end,
        },
      ],
    });

    // The access point of the path, and no other, is the one asked about.
    expect(query.firstCall.args[0]).to.equal(HARNESS_TENANT);
    expect(
      query.firstCall.args[1].accessInfo.$elemMatch.accessPointId,
    ).to.equal(FIXTURE_ID);
  });
});
