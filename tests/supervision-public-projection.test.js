/**
 * The public projection of the offers (tenant supervision spec §5.1, ADR
 * 0003): the one module that says what the public sees of a tenant's
 * offers, in lists (`listed`) and by direct link (`reached`). The rows
 * below are the spec table, written down as literals: level × review
 * status × publication wish, for a bookable, an event, and a ticket with
 * a reachable, an unreachable and a missing event. A tenant without a
 * public projection - pending, declined, unknown - is `tenant_not_found`
 * for both questions, and no offer leaves with its review.
 */

const { expect } = require("chai");
const sinon = require("sinon");

const {
  listed,
  reached,
  publicTenantCondition,
} = require("../src/commons/services/supervision/public-projection");
const TenantManager = require("../src/commons/data-managers/tenant-manager");
const EventManager = require("../src/commons/data-managers/event-manager");
const { Bookable } = require("../src/commons/entities/bookable/bookable");
const { Event } = require("../src/commons/entities/event/event");
const Tenant = require("../src/commons/entities/tenant/tenant");
const { DOMAIN } = require("../src/commons/services/authorization/reach");

const T = "t1";
const ANY_STATUS = [null, "pending", "approved", "rejected"];
const ANY_WISH = [false, true];

/** Spec §5.1: level × review status × publication wish → list, direct link. */
const SPEC_ROWS = [
  {
    level: "free",
    statuses: ANY_STATUS,
    wishes: [false],
    listed: false,
    reachable: true,
  },
  {
    level: "free",
    statuses: ANY_STATUS,
    wishes: [true],
    listed: true,
    reachable: true,
  },
  {
    level: "supervised",
    statuses: ["approved"],
    wishes: [false],
    listed: false,
    reachable: true,
  },
  {
    level: "supervised",
    statuses: ["approved"],
    wishes: [true],
    listed: true,
    reachable: true,
  },
  {
    level: "supervised",
    statuses: [null, "pending", "rejected"],
    wishes: ANY_WISH,
    listed: false,
    reachable: false,
  },
];

const review = (status) => ({
  status,
  submittedAt: null,
  decidedAt: null,
  decidedBy: "admin",
  reason: "Geheimgrund",
});

const bookable = (overrides = {}) =>
  new Bookable({
    id: "b1",
    tenantId: T,
    type: "room",
    title: "Raum",
    ...overrides,
  });
const ticket = (overrides = {}) =>
  new Bookable({
    id: "tk",
    tenantId: T,
    type: "ticket",
    eventId: "e1",
    title: "Ticket",
    ...overrides,
  });
const event = (overrides = {}) =>
  new Event({
    id: "e1",
    tenantId: T,
    information: {
      name: "Konzert",
      startDate: "2027-06-21",
      endDate: "2027-06-21",
    },
    ...overrides,
  });

describe("supervision: the public projection of the offers", function () {
  let tenant;
  let events;
  let getEvents;

  beforeEach(function () {
    tenant = new Tenant({ id: T, name: "Stadt", supervisionLevel: "free" });
    events = [];
    sinon
      .stub(TenantManager, "getTenant")
      .callsFake(async (id) => (id === T ? tenant : null));
    getEvents = sinon
      .stub(EventManager, "getEvents")
      .callsFake(async () => events);
  });

  afterEach(function () {
    sinon.restore();
  });

  const ids = (offers) => offers.map((offer) => offer.id);

  describe("the spec table (§5.1), for a bookable and for an event", function () {
    for (const row of SPEC_ROWS) {
      for (const status of row.statuses) {
        for (const isPublic of row.wishes) {
          it(`${row.level} / ${status ?? "no status"} / wish ${isPublic ? "on" : "off"}: listed ${row.listed}, reached ${row.reachable}`, async function () {
            tenant.supervisionLevel = row.level;
            const offers = [
              bookable({ isPublic, review: review(status) }),
              event({ isPublic, review: review(status) }),
            ];
            const inList = await listed(T, offers);
            const byLink = await reached(T, offers);
            expect(ids(inList)).to.deep.equal(row.listed ? ["b1", "e1"] : []);
            expect(ids(byLink)).to.deep.equal(
              row.reachable ? ["b1", "e1"] : [],
            );
          });
        }
      }
    }
  });

  describe("a tenant without a public projection", function () {
    for (const level of ["pending", "declined"]) {
      it(`throws tenant_not_found for a ${level} tenant, for the list and the direct link`, async function () {
        tenant.supervisionLevel = level;
        for (const ask of [listed, reached]) {
          let error = null;
          try {
            await ask(T, [
              bookable({ isPublic: true, review: review("approved") }),
            ]);
          } catch (err) {
            error = err;
          }
          expect(error?.code).to.equal("tenant_not_found");
          expect(error?.statusCode).to.equal(404);
        }
      });
    }

    it("throws tenant_not_found for an unknown tenant", async function () {
      let error = null;
      try {
        await listed("nobody", []);
      } catch (err) {
        error = err;
      }
      expect(error?.code).to.equal("tenant_not_found");
    });

    it("counts a tenant without a stored level as free", async function () {
      tenant = new Tenant({ id: T, name: "Alt" });
      expect(
        ids(await listed(T, [bookable({ isPublic: true })])),
      ).to.deep.equal(["b1"]);
      expect(
        ids(await reached(T, [bookable({ isPublic: false })])),
      ).to.deep.equal(["b1"]);
    });
  });

  describe("a ticket goes out with its event only", function () {
    beforeEach(function () {
      tenant.supervisionLevel = "supervised";
    });

    it("lists and reaches an approved ticket of an approved event", async function () {
      events = [event({ isPublic: false, review: review("approved") })];
      const offers = [ticket({ isPublic: true, review: review("approved") })];
      expect(ids(await listed(T, offers))).to.deep.equal(["tk"]);
      expect(ids(await reached(T, offers))).to.deep.equal(["tk"]);
    });

    it("drops the ticket of an unapproved event, from the list and the direct link", async function () {
      events = [event({ isPublic: true, review: review("pending") })];
      const offers = [ticket({ isPublic: true, review: review("approved") })];
      expect(await listed(T, offers)).to.deep.equal([]);
      expect(await reached(T, offers)).to.deep.equal([]);
    });

    it("lets a ticket whose event is gone through the event part", async function () {
      events = [];
      const offers = [ticket({ isPublic: true, review: review("approved") })];
      expect(ids(await listed(T, offers))).to.deep.equal(["tk"]);
      expect(ids(await reached(T, offers))).to.deep.equal(["tk"]);
    });

    it("loads the events of the tenant once, as the domain, and only when a ticket is among the offers", async function () {
      await listed(T, [
        bookable({ isPublic: true, review: review("approved") }),
      ]);
      expect(getEvents.called).to.equal(false);
      await reached(T, [
        ticket({ isPublic: true, review: review("approved") }),
        ticket({ id: "tk2", isPublic: true, review: review("approved") }),
      ]);
      expect(getEvents.callCount).to.equal(1);
      expect(getEvents.firstCall.args).to.deep.equal([T, DOMAIN]);
    });
  });

  describe("what leaves the module", function () {
    // The module decides records, not fields - the review is the one
    // field it removes, once, so asking twice answers the same.
    it("hands the entities back without their review, the records untouched", async function () {
      const offers = [
        bookable({ isPublic: true, review: review("approved") }),
        event({ isPublic: true, review: review("approved") }),
      ];
      const [b, e] = await listed(T, offers);
      expect(b).to.be.instanceOf(Bookable);
      expect(e).to.be.instanceOf(Event);
      expect(b).to.not.have.property("review");
      expect(e).to.not.have.property("review");
      expect(b.id).to.equal(offers[0].id);
      expect(offers[0].review.status).to.equal("approved");
      expect(offers[1].review.status).to.equal("approved");
      // Asking twice answers the same.
      expect(await reached(T, [b, e])).to.have.length(2);
    });

    it("loads the tenant once per call and answers an empty list without asking further", async function () {
      expect(await reached(T, [])).to.deep.equal([]);
      expect(TenantManager.getTenant.callCount).to.equal(1);
    });

    it("answers the query condition of the visible tenants as a positive list, a missing level included", function () {
      expect(publicTenantCondition()).to.deep.equal({
        supervisionLevel: { $in: ["free", "supervised", null] },
      });
    });
  });
});
