/**
 * An edit keeps the owner of an event (ECCdigital/tickets#300): an API
 * client that changes an event without `ownerUserId` does not empty it,
 * so a member who sees only their own events (`readOwn`) still sees it.
 */

const { expect } = require("chai");
const sinon = require("sinon");

const {
  installHarness,
  bookable,
  TENANT,
  OWNER,
  READ_OWN_HOLDER,
} = require("./helpers/booking-lifecycle-harness");
const {
  installRouteWorld,
  offerReads,
  FIXTURE_ID,
} = require("./helpers/route-world");
const EventManager = require("../src/commons/data-managers/event-manager");
const { Event } = require("../src/commons/entities/event/event");

/** The member's own event. */
const OWN_ID = "eigene-veranstaltung";
const ownEvent = () =>
  new Event({
    id: OWN_ID,
    tenantId: TENANT,
    ownerUserId: READ_OWN_HOLDER,
    isPublic: false,
    information: {
      name: "Eigenes",
      startDate: "2027-06-21",
      startTime: "19:00",
      endDate: "2027-06-21",
      endTime: "22:00",
      tags: [],
      flags: [],
    },
  });

describe("PUT /:tenant/events keeps the owner", function () {
  this.timeout(30000);

  let h;
  let events;
  /** Every event write, as the manager got it. */
  let writtenEvents;

  const restub = (name, impl) => {
    EventManager[name].restore();
    sinon.stub(EventManager, name).callsFake(impl);
  };

  before(async function () {
    h = await installHarness({
      bookables: {
        [FIXTURE_ID]: bookable({
          id: FIXTURE_ID,
          title: "Fixture",
          ownerUserId: OWNER,
        }),
      },
    });
    installRouteWorld({
      tenantId: TENANT,
      tenant: h.tenant,
      ownerUserId: OWNER,
      bookables: h.bookables,
    });
    const reads = offerReads(() => Object.values(events), "event");
    restub("getEvent", reads.one);
    restub("getEvents", reads.many);
    restub("storeEvent", async (entity) => {
      writtenEvents.push({ ...entity });
      events[entity.id] = new Event({ ...entity });
      return entity;
    });
  });

  after(async function () {
    sinon.restore();
    await h.close();
  });

  beforeEach(function () {
    writtenEvents = [];
    events = { [OWN_ID]: ownEvent() };
  });

  const call = (method, path, userId, body) =>
    h
      .api()
      [method](path)
      .timeout({ response: 5000 })
      .set(h.as(userId))
      .send(body);

  /** The stored event as a client sends it back, without its owner. */
  const withoutOwner = (information) => {
    const body = JSON.parse(JSON.stringify(events[OWN_ID]));
    body.information = { ...body.information, ...information };
    delete body.ownerUserId;
    return body;
  };

  const EDITORS = {
    "tenant owner": OWNER,
    "member with updateOwn": READ_OWN_HOLDER,
  };

  /** Bodies that name no owner: the field left out, `null`, empty, blank. */
  const NO_OWNER = {
    "leaves ownerUserId out": {},
    "sends ownerUserId null": { ownerUserId: null },
    'sends ownerUserId ""': { ownerUserId: "" },
    "sends a blank ownerUserId": { ownerUserId: "  " },
  };

  for (const [who, userId] of Object.entries(EDITORS)) {
    for (const [how, owner] of Object.entries(NO_OWNER)) {
      it(`keeps the owner when the ${who} ${how}`, async function () {
        const res = await call("put", `/api/${TENANT}/events`, userId, {
          ...withoutOwner({ name: "Geändert" }),
          ...owner,
        });

        expect(res.status).to.equal(201);
        expect(writtenEvents).to.have.length(1);
        expect(writtenEvents[0]).to.include({
          id: OWN_ID,
          ownerUserId: READ_OWN_HOLDER,
        });
        expect(writtenEvents[0].information.name).to.equal("Geändert");

        const list = await call(
          "get",
          `/api/${TENANT}/events`,
          READ_OWN_HOLDER,
        );
        expect(list.status).to.equal(200);
        expect(list.body.map((event) => event.id)).to.include(OWN_ID);

        const one = await call(
          "get",
          `/api/${TENANT}/events/${OWN_ID}`,
          READ_OWN_HOLDER,
        );
        expect(one.status).to.equal(200);
        expect(one.body.information.name).to.equal("Geändert");
      });
    }
  }

  it("stores the owner a body names, as before", async function () {
    const res = await call("put", `/api/${TENANT}/events`, OWNER, {
      ...withoutOwner({ name: "Übergeben" }),
      ownerUserId: OWNER,
    });

    expect(res.status).to.equal(201);
    expect(writtenEvents).to.have.length(1);
    expect(writtenEvents[0]).to.include({
      id: OWN_ID,
      ownerUserId: OWNER,
    });
  });
});
