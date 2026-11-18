/**
 * The bookings of an event on the authorization.
 *
 * `GET /api/:tenant/events/:id/bookings` carried `public("booking", "list")`:
 * the reach of the booking list, so a user who may change the event but not
 * read bookings saw only the bookings assigned to them - mostly none -
 * while the attendee list of the same event (`GET /csv/...`) held them all.
 * Now the marker `authorize("event", "bookings")` decides at the levels of
 * that export, the reach loads the event, and its bookings the domain reads
 * whole.
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
const BookingManager = require("../src/commons/data-managers/booking-manager");
const { DOMAIN } = require("../src/commons/services/authorization/reach");

const FORBIDDEN = {
  error: "ForbiddenError",
  code: "forbidden",
  statusCode: 403,
  params: {},
};

describe("authorization on the bookings of an event", function () {
  this.timeout(20000);

  let h;
  // As in the export's suite: the world stands for the whole suite, a test
  // re-answers the route world's own stubs and `afterEach` puts them back.
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
    fixtureEvent = await EventManager.getEvent(FIXTURE_ID, TENANT, DOMAIN);
  });

  beforeEach(function () {
    answerFixture();
    EventManager.getEvent.resetHistory();
    BookingManager.getEventBookings.resetHistory();
  });

  afterEach(function () {
    answerFixture();
  });

  after(async function () {
    sinon.restore();
    await h.close();
  });

  const eventBookings = (userId) => {
    let req = h.api().get(`/api/${TENANT}/events/${FIXTURE_ID}/bookings`);
    if (userId) req = req.set(h.as(userId));
    return req.send();
  };

  it("answers the anonymous 401", async function () {
    const res = await eventBookings();

    expect(res.status).to.equal(401);
    expect(BookingManager.getEventBookings.called).to.equal(false);
  });

  it("refuses a signed-in user without a bookable role, in the one form", async function () {
    const res = await eventBookings(CUSTOMER);

    expect(res.status).to.equal(403);
    expect(res.body).to.deep.equal(FORBIDDEN);
  });

  it("loads the event under the reach and reads its bookings whole", async function () {
    const res = await eventBookings(ROLE_HOLDER);

    expect(res.status).to.equal(200);
    expect(EventManager.getEvent.firstCall.args[2]).to.deep.equal({
      reach: "any",
      userId: ROLE_HOLDER,
    });
    expect(BookingManager.getEventBookings.firstCall.args).to.deep.equal([
      TENANT,
      FIXTURE_ID,
      DOMAIN,
    ]);
  });

  it("answers 404 for an event the reach does not cover", async function () {
    EventManager.getEvent.resolves(null);

    const res = await eventBookings(ROLE_HOLDER);

    expect(res.status).to.equal(404);
    expect(res.body).to.include({ code: "event_not_found" });
    expect(BookingManager.getEventBookings.called).to.equal(false);
  });
});
