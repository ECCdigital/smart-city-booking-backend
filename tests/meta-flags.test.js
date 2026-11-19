/**
 * The flags of a tenant's offers as a suggestion list, like the tags
 * (ECCdigital/tickets#1114): `GET /:tenant/events/_meta/flags` and
 * `GET /:tenant/bookables/_meta/flags` answer each flag once, the
 * public's over the offers it sees in a list, the staff's over the
 * tenant's whole (`*.meta`, ADR 0003).
 */

const { expect } = require("chai");
const sinon = require("sinon");

const {
  installHarness,
  bookable,
  TENANT,
  ADMIN,
  CUSTOMER,
  OWNER,
  ROLE_HOLDER,
} = require("./helpers/booking-lifecycle-harness");
const {
  installRouteWorld,
  offerReads,
  FIXTURE_ID,
} = require("./helpers/route-world");
const EventManager = require("../src/commons/data-managers/event-manager");
const { Event } = require("../src/commons/entities/event/event");

describe("meta flags: the flags of a tenant's offers", function () {
  this.timeout(30000);

  let h;
  let events;

  const event = (id, { flags, isPublic = true }) =>
    new Event({
      id,
      tenantId: TENANT,
      ownerUserId: ROLE_HOLDER,
      isPublic,
      information: {
        name: `Veranstaltung ${id}`,
        startDate: "2027-06-21",
        startTime: "19:00",
        endDate: "2027-06-21",
        endTime: "22:00",
        tags: ["konzert"],
        flags,
      },
      eventLocation: { name: "Stadthalle" },
      eventOrganizer: { contactPersonEmailAddress: "orga@example.test" },
    });

  before(async function () {
    h = await installHarness({
      bookables: {
        [FIXTURE_ID]: bookable({
          id: FIXTURE_ID,
          title: "Fixture",
          ownerUserId: ROLE_HOLDER,
          isPublic: true,
        }),
      },
    });
    installRouteWorld({
      tenantId: TENANT,
      tenant: h.tenant,
      ownerUserId: ROLE_HOLDER,
      bookables: h.bookables,
    });
    EventManager.getEvents.restore();
    sinon
      .stub(EventManager, "getEvents")
      .callsFake(offerReads(() => events, "event").many);
  });

  after(async function () {
    sinon.restore();
    await h.close();
  });

  afterEach(function () {
    h.tenant.supervisionLevel = "free";
  });

  // The two levels without a public projection, as for the tags.
  const HIDDEN_LEVELS = ["pending", "declined"];

  const get = (path, userId) => {
    let req = h.api().get(path).timeout({ response: 3000 });
    if (userId) req = req.set(h.as(userId));
    return req;
  };

  describe("GET /:tenant/events/_meta/flags", function () {
    const path = `/api/${TENANT}/events/_meta/flags`;

    beforeEach(function () {
      events = [
        event("e1", { flags: ["barrierefrei", "kinder"] }),
        event("e2", { flags: ["kinder", "draussen"] }),
        event("e3", { flags: ["intern"], isPublic: false }),
        event("e4", { flags: undefined }),
      ];
    });

    it("answers each flag of the events the public sees once", async function () {
      for (const userId of [undefined, CUSTOMER]) {
        const res = await get(path, userId);

        expect(res.status, userId).to.equal(200);
        expect(res.body, userId).to.have.members([
          "barrierefrei",
          "kinder",
          "draussen",
        ]);
        expect(res.body, userId).to.have.lengthOf(3);
      }
    });

    it("answers the staff the flags of all the tenant's events", async function () {
      for (const userId of [OWNER, ROLE_HOLDER, ADMIN]) {
        const res = await get(path, userId);

        expect(res.status, userId).to.equal(200);
        expect(res.body, userId).to.have.members([
          "barrierefrei",
          "kinder",
          "draussen",
          "intern",
        ]);
        expect(res.body, userId).to.have.lengthOf(4);
      }
    });

    for (const level of HIDDEN_LEVELS) {
      it(`keeps the flags of a ${level} tenant from the public, not from the instance owner`, async function () {
        h.tenant.supervisionLevel = level;

        expect((await get(path)).status).to.equal(404);
        expect((await get(path, CUSTOMER)).status).to.equal(404);
        expect((await get(path, ADMIN)).body).to.have.lengthOf(4);
      });
    }
  });

  describe("GET /:tenant/bookables/_meta/flags", function () {
    const path = `/api/${TENANT}/bookables/_meta/flags`;

    const ids = ["b1", "b2", "b3", "b4"];

    beforeEach(function () {
      const offer = (id, flags, isPublic = true) =>
        bookable({ id, title: id, ownerUserId: ROLE_HOLDER, isPublic, flags });
      h.bookables[FIXTURE_ID].flags = ["parkplatz"];
      h.bookables.b1 = offer("b1", ["barrierefrei", "parkplatz"]);
      h.bookables.b2 = offer("b2", ["barrierefrei", "kueche"]);
      h.bookables.b3 = offer("b3", ["intern"], false);
      h.bookables.b4 = offer("b4", undefined);
    });

    afterEach(function () {
      for (const id of ids) delete h.bookables[id];
    });

    it("answers each flag of the bookables the public sees once", async function () {
      for (const userId of [undefined, CUSTOMER]) {
        const res = await get(path, userId);

        expect(res.status, userId).to.equal(200);
        expect(res.body, userId).to.have.members([
          "parkplatz",
          "barrierefrei",
          "kueche",
        ]);
        expect(res.body, userId).to.have.lengthOf(3);
      }
    });

    it("answers the staff the flags of all the tenant's bookables", async function () {
      for (const userId of [OWNER, ROLE_HOLDER, ADMIN]) {
        const res = await get(path, userId);

        expect(res.status, userId).to.equal(200);
        expect(res.body, userId).to.have.members([
          "parkplatz",
          "barrierefrei",
          "kueche",
          "intern",
        ]);
        expect(res.body, userId).to.have.lengthOf(4);
      }
    });

    for (const level of HIDDEN_LEVELS) {
      it(`keeps the flags of a ${level} tenant from the public, not from the instance owner`, async function () {
        h.tenant.supervisionLevel = level;

        expect((await get(path)).status).to.equal(404);
        expect((await get(path, CUSTOMER)).status).to.equal(404);
        expect((await get(path, ADMIN)).body).to.have.lengthOf(4);
      });
    }
  });
});
