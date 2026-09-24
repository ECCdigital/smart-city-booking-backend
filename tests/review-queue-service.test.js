/**
 * The active review queue (glossary "Aktive Prüfliste", tenant supervision
 * spec §6.2) over an in-memory world behind the data managers: the offers
 * of supervised tenants that wait for a decision, computed on read.
 */

const { expect } = require("chai");
const sinon = require("sinon");

const TenantManager = require("../src/commons/data-managers/tenant-manager");
const {
  BookableManager,
} = require("../src/commons/data-managers/bookable-manager");
const EventManager = require("../src/commons/data-managers/event-manager");
const SupervisionHistoryManager = require("../src/commons/data-managers/supervision-history-manager");
const SupervisionNotificationManager = require("../src/commons/data-managers/supervision-notification-manager");
const ReviewQueueService = require("../src/commons/services/supervision/review-queue-service");
const ReviewService = require("../src/commons/services/supervision/review-service");
const SupervisionService = require("../src/commons/services/supervision/supervision-service");

const day = (n) => new Date(Date.UTC(2026, 8, n, 10, 0, 0));

const review = (status, submittedAt = null) => ({
  status,
  submittedAt,
  decidedAt: null,
  decidedBy: null,
  reason: null,
});

describe("ReviewQueueService.listActiveReviewQueue", function () {
  let tenants;
  let bookables;
  let events;

  const bookable = (overrides) => ({
    tenantId: "t-sup",
    title: "Saal",
    type: "room",
    isPublic: true,
    review: review("pending", day(1)),
    ...overrides,
  });
  const event = ({ name = "Konzert", ...overrides }) => ({
    tenantId: "t-sup",
    information: { name, startDate: "2030-01-01" },
    isPublic: true,
    review: review("pending", day(1)),
    ...overrides,
  });

  const pendingOf = (offers) => async (tenantIds) =>
    structuredClone(
      offers.filter(
        (offer) =>
          offer.review?.status === "pending" &&
          tenantIds.includes(offer.tenantId),
      ),
    );
  const updateReviewOf =
    (offers) =>
    async ({ tenantId, id, expectedStatus, review: next }) => {
      const offer = offers.find((o) => o.id === id && o.tenantId === tenantId);
      if (!offer || (offer.review?.status ?? null) !== expectedStatus) {
        return null;
      }
      offer.review = next;
      return structuredClone(offer);
    };
  const loadOf = (offers) => async (id, tenantId) =>
    structuredClone(
      offers.find((o) => o.id === id && o.tenantId === tenantId) ?? null,
    );

  beforeEach(function () {
    tenants = [
      { id: "t-sup", name: "Verein", supervisionLevel: "supervised" },
      { id: "t-sup2", name: "Club", supervisionLevel: "supervised" },
      { id: "t-free", name: "Stadt", supervisionLevel: "free" },
      { id: "t-pending", name: "Spam", supervisionLevel: "pending" },
      { id: "t-declined", name: "Declined", supervisionLevel: "declined" },
    ];
    bookables = [];
    events = [];

    sinon
      .stub(TenantManager, "getTenants")
      .callsFake(async (scope, { supervisionLevel } = {}) =>
        structuredClone(
          tenants.filter(
            (t) => !supervisionLevel || t.supervisionLevel === supervisionLevel,
          ),
        ),
      );
    sinon
      .stub(TenantManager, "getTenant")
      .callsFake(async (id) =>
        structuredClone(tenants.find((t) => t.id === id) ?? null),
      );
    sinon
      .stub(TenantManager, "updateSupervisionLevel")
      .callsFake(async ({ tenantId, from, to, changedAt }) => {
        const tenant = tenants.find((t) => t.id === tenantId);
        if (!tenant || tenant.supervisionLevel !== from) return null;
        tenant.supervisionLevel = to;
        tenant.supervisionChangedAt = changedAt;
        return structuredClone(tenant);
      });
    sinon
      .stub(BookableManager, "getPendingReviewOffers")
      .callsFake((ids) => pendingOf(bookables)(ids));
    sinon
      .stub(EventManager, "getPendingReviewOffers")
      .callsFake((ids) => pendingOf(events)(ids));
    sinon
      .stub(BookableManager, "getBookable")
      .callsFake((id, tenantId) => loadOf(bookables)(id, tenantId));
    sinon
      .stub(EventManager, "getEvent")
      .callsFake((id, tenantId) => loadOf(events)(id, tenantId));
    sinon
      .stub(BookableManager, "updateReview")
      .callsFake((params) => updateReviewOf(bookables)(params));
    sinon
      .stub(EventManager, "updateReview")
      .callsFake((params) => updateReviewOf(events)(params));
    sinon
      .stub(BookableManager, "getOffersByReviewStatus")
      .callsFake(async (tenantId, status) =>
        structuredClone(
          bookables.filter(
            (o) =>
              o.tenantId === tenantId && (o.review?.status ?? null) === status,
          ),
        ),
      );
    sinon
      .stub(EventManager, "getOffersByReviewStatus")
      .callsFake(async (tenantId, status) =>
        structuredClone(
          events.filter(
            (o) =>
              o.tenantId === tenantId && (o.review?.status ?? null) === status,
          ),
        ),
      );
    sinon.stub(SupervisionHistoryManager, "insert").resolves();
    sinon.stub(SupervisionNotificationManager, "record").resolves();
  });

  afterEach(function () {
    sinon.restore();
  });

  const list = (params = {}) =>
    ReviewQueueService.listActiveReviewQueue(params);
  const ids = (result) => result.items.map((row) => row.offerId);

  it("lists exactly the pending offers of supervised tenants, as one row each", async function () {
    bookables.push(
      bookable({ id: "b-pending" }),
      bookable({ id: "b-approved", review: review("approved", day(1)) }),
      bookable({ id: "b-rejected", review: review("rejected", day(1)) }),
      bookable({ id: "b-none", review: review(null) }),
      bookable({ id: "b-free", tenantId: "t-free" }),
      bookable({ id: "b-pending", tenantId: "t-pending" }),
      bookable({ id: "b-declined", tenantId: "t-declined" }),
    );

    const result = await list();

    expect(result).to.deep.equal({
      items: [
        {
          tenantId: "t-sup",
          tenantName: "Verein",
          offerType: "bookable",
          offerId: "b-pending",
          title: "Saal",
          submittedAt: day(1),
          isPublic: true,
          adminPath: "/rooms/edit?id=b-pending",
        },
      ],
      total: 1,
      page: 1,
      pageSize: 50,
    });
  });

  it("lists both offer types, past events and unlisted offers alike", async function () {
    bookables.push(bookable({ id: "b-unlisted", isPublic: false }));
    events.push(
      event({
        id: "e-past",
        name: "Sommerfest 2020",
        information: { name: "Sommerfest 2020", startDate: "2020-06-01" },
        review: review("pending", day(2)),
      }),
      event({
        id: "e-unlisted",
        isPublic: false,
        review: review("pending", day(3)),
      }),
    );

    const result = await list();

    expect(result.total).to.equal(3);
    expect(
      result.items.map(
        ({ offerType, offerId, title, isPublic, adminPath }) => ({
          offerType,
          offerId,
          title,
          isPublic,
          adminPath,
        }),
      ),
    ).to.deep.equal([
      {
        offerType: "bookable",
        offerId: "b-unlisted",
        title: "Saal",
        isPublic: false,
        adminPath: "/rooms/edit?id=b-unlisted",
      },
      {
        offerType: "event",
        offerId: "e-past",
        title: "Sommerfest 2020",
        isPublic: true,
        adminPath: "/events/edit?id=e-past",
      },
      {
        offerType: "event",
        offerId: "e-unlisted",
        title: "Konzert",
        isPublic: false,
        adminPath: "/events/edit?id=e-unlisted",
      },
    ]);
  });

  it("answers an offer without a name with a null title", async function () {
    events.push(event({ id: "e-unnamed", name: "" }));

    expect((await list()).items[0].title).to.equal(null);
  });

  it("derives the admin path of a bookable from the editor of its type", async function () {
    bookables.push(
      bookable({ id: "b1", type: "room" }),
      bookable({ id: "b2", type: "resource" }),
      bookable({ id: "b3", type: "ticket" }),
      bookable({ id: "b4", type: "event-location" }),
      bookable({ id: "b5", type: "location" }),
      bookable({ id: "b 6", type: "room" }),
      bookable({ id: "b7", type: "unknown" }),
    );

    const result = await list();

    expect(result.items.map((row) => row.adminPath)).to.deep.equal([
      "/rooms/edit?id=b%206",
      "/rooms/edit?id=b1",
      "/resources/edit?id=b2",
      "/tickets/edit?id=b3",
      "/event-locations/edit?id=b4",
      "/event-locations/edit?id=b5",
      null,
    ]);
  });

  it("sorts by the oldest submission across both types, with type and id breaking a tie", async function () {
    bookables.push(
      bookable({ id: "b-z", review: review("pending", day(5)) }),
      bookable({ id: "b-a", review: review("pending", day(5)) }),
      bookable({ id: "b-new", review: review("pending", day(9)) }),
    );
    events.push(
      event({ id: "e-old", review: review("pending", day(2)) }),
      event({ id: "a-tie", review: review("pending", day(5)) }),
      event({
        id: "e-club",
        tenantId: "t-sup2",
        review: review("pending", day(7)),
      }),
    );

    expect(ids(await list())).to.deep.equal([
      "e-old",
      "b-a",
      "b-z",
      "a-tie",
      "e-club",
      "b-new",
    ]);
    // The order does not depend on the order the managers answer in.
    bookables.reverse();
    events.reverse();
    expect(ids(await list())).to.deep.equal([
      "e-old",
      "b-a",
      "b-z",
      "a-tie",
      "e-club",
      "b-new",
    ]);
  });

  it("cuts pages out of the one merged order and counts every row", async function () {
    for (let n = 1; n <= 3; n += 1) {
      bookables.push(
        bookable({ id: `b${n}`, review: review("pending", day(2 * n)) }),
      );
      events.push(
        event({ id: `e${n}`, review: review("pending", day(2 * n + 1)) }),
      );
    }
    // Two rows of one moment sit on the page border.
    bookables.push(
      bookable({ id: "b2-twin", review: review("pending", day(4)) }),
    );

    const first = await list({ page: 1, pageSize: 3 });
    const second = await list({ page: "2", pageSize: "3" });
    const third = await list({ page: 3, pageSize: 3 });
    const beyond = await list({ page: 4, pageSize: 3 });

    expect(ids(first)).to.deep.equal(["b1", "e1", "b2"]);
    expect(ids(second)).to.deep.equal(["b2-twin", "e2", "b3"]);
    expect(ids(third)).to.deep.equal(["e3"]);
    expect(ids(beyond)).to.deep.equal([]);
    for (const result of [first, second, third, beyond]) {
      expect(result.total).to.equal(7);
      expect(result.pageSize).to.equal(3);
    }
    expect(second.page).to.equal(2);
  });

  it("falls back to the first page of 50 and caps the page size at 200", async function () {
    expect(await list({ page: "x", pageSize: "y" })).to.include({
      page: 1,
      pageSize: 50,
    });
    expect(await list({ page: 0, pageSize: 5000 })).to.include({
      page: 1,
      pageSize: 200,
    });
    expect(await list({ page: "1e999", pageSize: "2.9" })).to.include({
      page: 1,
      pageSize: 2,
    });
  });

  it("narrows to one tenant and to one offer type", async function () {
    bookables.push(
      bookable({ id: "b-verein" }),
      bookable({ id: "b-club", tenantId: "t-sup2" }),
      bookable({ id: "b-free", tenantId: "t-free" }),
    );
    events.push(
      event({ id: "e-verein" }),
      event({ id: "e-club", tenantId: "t-sup2" }),
    );

    const club = await list({ tenantId: "t-sup2" });
    expect(ids(club)).to.deep.equal(["b-club", "e-club"]);
    expect(club.total).to.equal(2);
    expect(club.items[0].tenantName).to.equal("Club");

    expect(ids(await list({ offerType: "event" }))).to.deep.equal([
      "e-club",
      "e-verein",
    ]);
    expect(
      ids(await list({ tenantId: "t-sup", offerType: "bookable" })),
    ).to.deep.equal(["b-verein"]);
    // A tenant that is not supervised has no rows, pending offers or not.
    expect(await list({ tenantId: "t-free" })).to.deep.include({
      items: [],
      total: 0,
    });
    expect((await list({ tenantId: "t-unknown" })).total).to.equal(0);
  });

  it("does not answer a failing read as an empty queue", async function () {
    EventManager.getPendingReviewOffers.rejects(new Error("mongo down"));

    let error = null;
    try {
      await list();
    } catch (err) {
      error = err;
    }
    expect(error?.message).to.equal("mongo down");
  });

  describe("the queue changes with what happens to its offers", function () {
    beforeEach(function () {
      bookables.push(
        bookable({ id: "b-first", review: review("pending", day(1)) }),
        bookable({ id: "b-second", review: review("pending", day(2)) }),
      );
      events.push(event({ id: "e-third", review: review("pending", day(3)) }));
    });

    const decide = (offerType, offerId, action, reason) =>
      ReviewService.decide({
        offerType,
        tenantId: "t-sup",
        offerId,
        action,
        reason,
        actorUserId: "admin@example.test",
        now: day(10),
      });

    it("drops a decided offer, whatever the decision", async function () {
      await decide("bookable", "b-first", "approve");
      expect(ids(await list())).to.deep.equal(["b-second", "e-third"]);

      await decide("event", "e-third", "reject", "Unvollständig");
      expect(ids(await list())).to.deep.equal(["b-second"]);
    });

    it("moves a resubmitted offer to the back with its new waiting time", async function () {
      await decide("bookable", "b-first", "reject", "Unvollständig");
      await ReviewService.submit({
        offerType: "bookable",
        tenantId: "t-sup",
        offerId: "b-first",
        actorUserId: "owner@example.test",
        now: day(11),
      });

      const result = await list();

      expect(ids(result)).to.deep.equal(["b-second", "e-third", "b-first"]);
      expect(result.items[2].submittedAt).to.deep.equal(day(11));
    });

    it("keeps the waiting time of a pending offer that is submitted again", async function () {
      await ReviewService.submit({
        offerType: "bookable",
        tenantId: "t-sup",
        offerId: "b-first",
        actorUserId: "owner@example.test",
        now: day(11),
      });

      expect(ids(await list())).to.deep.equal([
        "b-first",
        "b-second",
        "e-third",
      ]);
    });

    it("keeps an offer whose publication wish is switched off", async function () {
      bookables.find((b) => b.id === "b-first").isPublic = false;

      const result = await list();

      expect(ids(result)).to.deep.equal(["b-first", "b-second", "e-third"]);
      expect(result.items[0].isPublic).to.equal(false);
    });

    it("follows the level of the tenant in both directions, the offers staying pending", async function () {
      const changeLevel = (level) =>
        SupervisionService.changeTenantLevel({
          tenantId: "t-sup",
          level,
          actorUserId: "admin@example.test",
        });

      await changeLevel("free");
      expect((await list()).total).to.equal(0);

      await changeLevel("pending");
      expect((await list()).total).to.equal(0);

      await changeLevel("supervised");
      expect(ids(await list())).to.deep.equal([
        "b-first",
        "b-second",
        "e-third",
      ]);
    });
  });
});
