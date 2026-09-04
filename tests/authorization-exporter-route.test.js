/**
 * The CSV export on the authorization (authorize spec §3.1, §15, ticket 5).
 *
 * `GET /csv/:tenant/events/:id/bookings` carried `isSignedIn` and checked
 * the two update levels of the bookables in the controller; now the marker
 * `authorize("exporter", "export")` decides, and the reach loads the event.
 * These are the two things that changed: the controller hands the reach to
 * the `EventManager` instead of asking about rights, and an event out of
 * reach is a 404 rather than a 403.
 */

const { expect } = require("chai");
const sinon = require("sinon");

const {
  installHarness,
  TENANT,
  ROLE_HOLDER,
  CUSTOMER,
} = require("./helpers/booking-lifecycle-harness");
const { installRouteWorld, FIXTURE_ID } = require("./helpers/route-world");
const EventManager = require("../src/commons/data-managers/event-manager");

const FORBIDDEN = {
  error: "ForbiddenError",
  code: "forbidden",
  statusCode: 403,
  params: {},
};

describe("authorization on the CSV export route", function () {
  this.timeout(20000);

  let h;
  // The harness and the route world stub in `before` and stand for the whole
  // suite; `sinon.restore()` belongs in `after`, because it takes that world
  // down - calling it after every test would leave the second one running
  // against the real managers.
  //
  // Per-test isolation is `afterEach` instead: the one thing a test here
  // changes is the route world's own `EventManager.getEvent` stub, which it
  // re-answers rather than wrapping (a wrapped method cannot be wrapped
  // again), so putting the fixture answer back is what restores it.
  let fixtureEvent;
  const answerFixture = () =>
    EventManager.getEvent.callsFake(async () => fixtureEvent);

  before(async function () {
    h = await installHarness();
    installRouteWorld({
      tenantId: TENANT,
      tenant: h.tenant,
      ownerUserId: ROLE_HOLDER,
      bookables: h.bookables,
    });
    fixtureEvent = await EventManager.getEvent(FIXTURE_ID, TENANT);
  });

  beforeEach(function () {
    answerFixture();
    EventManager.getEvent.resetHistory();
  });

  afterEach(function () {
    answerFixture();
  });

  after(async function () {
    sinon.restore();
    await h.close();
  });

  const exportBookings = (userId) => {
    let req = h.api().get(`/csv/${TENANT}/events/${FIXTURE_ID}/bookings`);
    if (userId) req = req.set(h.as(userId));
    return req.send();
  };

  it("answers the anonymous 401, as `isSignedIn` did", async function () {
    const res = await exportBookings();

    expect(res.status).to.equal(401);
  });

  it("refuses a signed-in user without a bookable role, in the one form", async function () {
    const res = await exportBookings(CUSTOMER);

    expect(res.status).to.equal(403);
    expect(res.body).to.deep.equal(FORBIDDEN);
  });

  it("hands the reach to the event manager and exports the attendees", async function () {
    const res = await exportBookings(ROLE_HOLDER);

    expect(res.status).to.equal(200);
    expect(res.headers["content-type"]).to.match(/text\/csv/);
    // The role holder of the harness holds every level, so `updateAny` wins
    // and the manager is asked for every event of the tenant.
    expect(EventManager.getEvent.calledOnce).to.equal(true);
    expect(EventManager.getEvent.firstCall.args[2]).to.deep.equal({
      reach: "any",
      userId: ROLE_HOLDER,
    });
  });

  it("answers 404 for an event the reach does not cover", async function () {
    // What the manager answers under a reach that excludes the event: the
    // export cannot tell "gone" from "not yours", and says neither (§4.2).
    EventManager.getEvent.resolves(null);

    const res = await exportBookings(ROLE_HOLDER);

    expect(res.status).to.equal(404);
    expect(res.body).to.include({ code: "event_not_found" });
  });
});
