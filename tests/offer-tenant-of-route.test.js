/**
 * An offer belongs to the tenant of the route (ticket 137): the rights
 * are asked of the tenant in the path, so a bookable or an event - and
 * the ticket of an event - is written there, whatever `tenantId` the
 * body names.
 */

const { expect } = require("chai");
const sinon = require("sinon");

const {
  installHarness,
  bookable,
  TENANT,
  TENANT_B,
  OWNER,
  ROLE_HOLDER,
} = require("./helpers/booking-lifecycle-harness");
const {
  installRouteWorld,
  offerReads,
  FIXTURE_ID,
} = require("./helpers/route-world");
const {
  BookableManager,
} = require("../src/commons/data-managers/bookable-manager");
const EventManager = require("../src/commons/data-managers/event-manager");
const { Event } = require("../src/commons/entities/event/event");

/** The bookable of the tenant an edit starts from. */
const fixture = () =>
  bookable({ id: FIXTURE_ID, title: "Fixture", ownerUserId: OWNER });

/** The event of the tenant an edit starts from. */
const eventFixture = () =>
  new Event({
    id: FIXTURE_ID,
    tenantId: TENANT,
    ownerUserId: OWNER,
    isPublic: false,
    information: { name: "Sommerkonzert", teaserText: "" },
  });

describe("offers in the tenant of the route", function () {
  this.timeout(30000);

  let h;
  /** Every bookable write, as the manager got it. */
  let writtenBookables;
  /** The events of the test, by id. */
  let events;
  /** Every event write, as the manager got it. */
  let writtenEvents;

  before(async function () {
    h = await installHarness({ bookables: { [FIXTURE_ID]: fixture() } });
    installRouteWorld({
      tenantId: TENANT,
      tenant: h.tenant,
      ownerUserId: OWNER,
      bookables: h.bookables,
      tenants: { [TENANT_B]: h.tenantB },
    });
    // The bookable writes over the harness's catalogue: the whole one and
    // the conditional one of the review a publication wish submits.
    BookableManager.storeBookable.restore();
    sinon.stub(BookableManager, "storeBookable").callsFake(async (entity) => {
      writtenBookables.push({ ...entity });
      h.bookables[entity.id] = bookable({ ...entity });
      return entity;
    });
    BookableManager.updateReview.restore();
    sinon
      .stub(BookableManager, "updateReview")
      .callsFake(async ({ tenantId, id, review }) => {
        const target = h.bookables[id];
        if (!target || target.tenantId !== tenantId) {
          return null;
        }
        target.review = review;
        return target;
      });
    // The same over the events of the test.
    const restub = (name, impl) => {
      EventManager[name].restore();
      sinon.stub(EventManager, name).callsFake(impl);
    };
    restub("getEvent", offerReads(() => Object.values(events), "event").one);
    restub("storeEvent", async (entity) => {
      writtenEvents.push({ ...entity });
      events[entity.id] = new Event({ ...entity });
      return entity;
    });
    restub("updateReview", async ({ tenantId, id, review }) => {
      const target = events[id];
      if (!target || target.tenantId !== tenantId) {
        return null;
      }
      target.review = review;
      return target;
    });
  });

  after(async function () {
    sinon.restore();
    await h.close();
  });

  beforeEach(function () {
    writtenBookables = [];
    h.bookables[FIXTURE_ID] = fixture();
    writtenEvents = [];
    events = { [FIXTURE_ID]: eventFixture() };
  });

  afterEach(function () {
    for (const { id } of writtenBookables) {
      delete h.bookables[id];
    }
  });

  const call = (method, path, userId, body) =>
    h
      .api()
      [method](path)
      .timeout({ response: 5000 })
      .set(h.as(userId))
      .send(body);

  /** The tenant owner, and the holder of a role with `create`. */
  const CREATORS = { "tenant owner": OWNER, "role holder": ROLE_HOLDER };

  describe("POST /:tenant/bookables", function () {
    for (const [who, userId] of Object.entries(CREATORS)) {
      it(`creates the bookable of the ${who} in the tenant of the route`, async function () {
        const res = await call("post", `/api/${TENANT}/bookables`, userId, {
          tenantId: TENANT_B,
          title: "x",
          isPublic: true,
          isBookable: true,
        });

        expect(res.status).to.equal(201);
        expect(res.body.tenantId).to.equal(TENANT);
        expect(writtenBookables.map((written) => written.tenantId)).to.eql([
          TENANT,
        ]);
      });
    }
  });

  describe("PUT /:tenant/bookables", function () {
    it("keeps the bookable in the tenant of the route", async function () {
      const res = await call("put", `/api/${TENANT}/bookables`, OWNER, {
        ...JSON.parse(JSON.stringify(h.bookables[FIXTURE_ID])),
        tenantId: TENANT_B,
        title: "y",
      });

      expect(res.status).to.equal(201);
      expect(writtenBookables).to.have.length(1);
      expect(writtenBookables[0]).to.include({
        id: FIXTURE_ID,
        tenantId: TENANT,
        title: "y",
      });
    });
  });

  describe("POST /:tenant/events", function () {
    for (const [who, userId] of Object.entries(CREATORS)) {
      for (const query of ["", "?withTickets=true"]) {
        it(`creates the event of the ${who} in the tenant of the route${query && ", its ticket too"}`, async function () {
          const res = await call(
            "post",
            `/api/${TENANT}/events${query}`,
            userId,
            {
              tenantId: TENANT_B,
              isPublic: true,
              information: { name: "x", teaserText: "" },
            },
          );

          expect(res.status).to.equal(201);
          expect(writtenEvents.map((written) => written.tenantId)).to.eql([
            TENANT,
          ]);
          expect(
            writtenBookables.map(({ tenantId, eventId }) => ({
              tenantId,
              eventId,
            })),
          ).to.eql(
            query ? [{ tenantId: TENANT, eventId: writtenEvents[0].id }] : [],
          );
        });
      }
    }
  });

  describe("PUT /:tenant/events", function () {
    it("keeps the event in the tenant of the route", async function () {
      const res = await call("put", `/api/${TENANT}/events`, OWNER, {
        ...JSON.parse(JSON.stringify(events[FIXTURE_ID])),
        tenantId: TENANT_B,
        information: { name: "y", teaserText: "" },
      });

      expect(res.status).to.equal(201);
      expect(writtenEvents).to.have.length(1);
      expect(writtenEvents[0]).to.include({
        id: FIXTURE_ID,
        tenantId: TENANT,
      });
      expect(writtenEvents[0].information.name).to.equal("y");
    });
  });
});
