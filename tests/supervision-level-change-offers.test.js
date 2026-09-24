/**
 * A level change of a tenant, end to end over the routes (tenant
 * supervision spec §2, §5.1, §8): the instance owner switches between
 * `free`, `supervised`, `pending` and `declined` in every direction; under
 * `supervised` every offer that is not approved - bookable or event -
 * leaves the public lists, the direct link and the checkout at once and
 * comes back with `free`; no switch ever writes a review; and the switch
 * to `supervised` announces the offers already pending in one occasion.
 */

const { expect } = require("chai");
const sinon = require("sinon");

const {
  installHarness,
  bookable,
  checkoutBody,
  TENANT,
  ADMIN,
  ROLE_HOLDER,
  CUSTOMER,
} = require("./helpers/booking-lifecycle-harness");
const { installRouteWorld } = require("./helpers/route-world");
const TenantManager = require("../src/commons/data-managers/tenant-manager");
const EventManager = require("../src/commons/data-managers/event-manager");
const {
  BookableManager,
} = require("../src/commons/data-managers/bookable-manager");
const { Event } = require("../src/commons/entities/event/event");
const {
  CHECKOUT_REASONS,
} = require("../src/commons/services/checkout/checkout-reasons");
const SupervisionHistoryManager = require("../src/commons/data-managers/supervision-history-manager");
const SupervisionNotificationManager = require("../src/commons/data-managers/supervision-notification-manager");

const SUBMITTED = new Date("2026-09-01T08:00:00.000Z");
const review = (status) => ({
  status,
  submittedAt: status === null ? null : SUBMITTED,
  decidedAt: null,
  decidedBy: null,
  reason: null,
});

const STATUSES = Object.freeze({
  none: null,
  pending: "pending",
  rejected: "rejected",
  approved: "approved",
});
const KEYS = Object.keys(STATUSES);
const UNAPPROVED = KEYS.filter((key) => key !== "approved");
const bookableId = (key) => `room-${key}`;
const eventId = (key) => `event-${key}`;
const eventName = (key) => `Konzert ${key}`;

describe("supervision: a level change and the tenant's offers", function () {
  this.timeout(30000);

  let h;
  let events;
  let reviewWrites;

  const restub = (Manager, name, impl) => {
    Manager[name].restore();
    return sinon.stub(Manager, name).callsFake(impl);
  };

  before(async function () {
    h = await installHarness({
      bookables: Object.fromEntries(
        KEYS.map((key) => [
          bookableId(key),
          bookable({
            id: bookableId(key),
            title: `Raum ${key}`,
            ownerUserId: ROLE_HOLDER,
            isPublic: true,
          }),
        ]),
      ),
    });
    installRouteWorld({
      tenantId: TENANT,
      tenant: h.tenant,
      ownerUserId: ROLE_HOLDER,
      bookables: h.bookables,
    });

    restub(TenantManager, "updateSupervisionLevel", async ({ from, to }) => {
      if ((h.tenant.supervisionLevel ?? "free") !== from) return null;
      h.tenant.supervisionLevel = to;
      return h.tenant;
    });
    restub(EventManager, "getEvent", async (id) => events[id] ?? null);
    restub(EventManager, "getEvents", async () => Object.values(events));
    const atStatus = (offers) => async (tenantId, status) =>
      tenantId === TENANT
        ? Object.values(offers()).filter(
            (offer) => (offer.review?.status ?? null) === status,
          )
        : [];
    restub(
      BookableManager,
      "getOffersByReviewStatus",
      atStatus(() => h.bookables),
    );
    restub(
      EventManager,
      "getOffersByReviewStatus",
      atStatus(() => events),
    );
    reviewWrites = [
      restub(BookableManager, "updateReview", async () => null),
      restub(EventManager, "updateReview", async () => null),
      BookableManager.storeBookable,
      EventManager.storeEvent,
    ];
  });

  after(async function () {
    sinon.restore();
    await h.close();
  });

  beforeEach(function () {
    h.tenant.supervisionLevel = "free";
    for (const key of KEYS) {
      h.bookables[bookableId(key)].review = review(STATUSES[key]);
    }
    events = Object.fromEntries(
      KEYS.map((key) => [
        eventId(key),
        new Event({
          id: eventId(key),
          tenantId: TENANT,
          ownerUserId: ROLE_HOLDER,
          isPublic: true,
          information: {
            name: eventName(key),
            startDate: "2027-06-21",
            startTime: "19:00",
            endDate: "2027-06-21",
            endTime: "22:00",
            tags: [],
            flags: [],
          },
          review: review(STATUSES[key]),
        }),
      ]),
    );
    // The harness's ticket is approved itself; what varies is its event.
    h.bookables.ticket.review = review("approved");
    h.bookables.ticket.isPublic = true;
    for (const write of reviewWrites) write.resetHistory();
    SupervisionHistoryManager.insert.resetHistory();
    SupervisionNotificationManager.record.resetHistory();
  });

  afterEach(function () {
    h.tenant.supervisionLevel = "free";
    h.bookables.ticket.review = review(null);
    h.bookables.ticket.eventId = "E1";
  });

  const call = (method, path, userId, body) => {
    let req = h.api()[method](path).timeout({ response: 5000 });
    if (userId) req = req.set(h.as(userId));
    if (body) req = req.send(body);
    return req;
  };
  const switchTo = async (level, reason) => {
    const res = await call(
      "put",
      `/api/tenants/${TENANT}/supervision`,
      ADMIN,
      reason === undefined ? { level } : { level, reason },
    );
    expect(res.status, `switch to ${level}`).to.equal(200);
    expect(res.body.supervisionLevel).to.equal(level);
  };

  /** What the public sees of one offer key right now. */
  const bookableSeen = async (key) => {
    const id = bookableId(key);
    const list = await call("get", `/api/${TENANT}/bookables/public`);
    const detail = await call("get", `/api/${TENANT}/bookables/public/${id}`);
    const checkout = await call(
      "post",
      `/api/v2/${TENANT}/checkout`,
      CUSTOMER,
      checkoutBody(id),
    );
    return {
      listed: list.status === 200 && list.body.some((b) => b.id === id),
      reachable: detail.status === 200,
      bookable: checkout.body.success === true,
      refusal: checkout.body.error?.reason ?? null,
    };
  };
  const eventSeen = async (key) => {
    const id = eventId(key);
    h.bookables.ticket.eventId = id;
    const list = await call("get", `/api/${TENANT}/events`);
    const detail = await call("get", `/api/${TENANT}/events/${id}`);
    const checkout = await call(
      "post",
      `/api/v2/${TENANT}/checkout`,
      CUSTOMER,
      checkoutBody("ticket", { timeBegin: null, timeEnd: null }),
    );
    return {
      listed: list.status === 200 && list.text.includes(eventName(key)),
      reachable: detail.status === 200,
      bookable: checkout.body.success === true,
      refusal: checkout.body.error?.reason ?? null,
    };
  };
  const OPEN = { listed: true, reachable: true, bookable: true, refusal: null };
  const CLOSED = {
    listed: false,
    reachable: false,
    bookable: false,
    refusal: CHECKOUT_REASONS.OFFER_NOT_REACHABLE,
  };
  const reviews = () =>
    structuredClone({
      bookables: KEYS.map((key) => h.bookables[bookableId(key)].review),
      events: KEYS.map((key) => events[eventId(key)].review),
    });

  for (const [type, seen] of [
    ["bookable", bookableSeen],
    ["event", eventSeen],
  ]) {
    it(`free → supervised hides every unapproved ${type} at once, supervised → free brings it back`, async function () {
      for (const key of KEYS) {
        expect(await seen(key), `free / ${key}`).to.deep.equal(OPEN);
      }

      await switchTo("supervised");
      for (const key of UNAPPROVED) {
        expect(await seen(key), `supervised / ${key}`).to.deep.equal(CLOSED);
      }
      // No approval comes with the switch; what was approved stays open.
      expect(await seen("approved")).to.deep.equal(OPEN);

      await switchTo("free");
      for (const key of KEYS) {
        expect(await seen(key), `free again / ${key}`).to.deep.equal(OPEN);
      }
    });
  }

  it("switches in every direction, by hand, and writes no review on the way", async function () {
    const before = reviews();
    const path = [
      "supervised",
      "pending",
      "supervised",
      "free",
      "pending",
      "declined",
      "supervised",
      "declined",
      "free",
    ];

    for (const level of path) {
      await switchTo(level, `nach ${level}`);
      expect(h.tenant.supervisionLevel).to.equal(level);
    }

    expect(reviews()).to.deep.equal(before);
    for (const write of reviewWrites) {
      expect(write.called).to.be.false;
    }
    const rows = SupervisionHistoryManager.insert
      .getCalls()
      .map((c) => c.args[0]);
    expect(rows.map((row) => [row.from, row.to, row.reason])).to.deep.equal([
      ["free", "supervised", "nach supervised"],
      ["supervised", "pending", "nach pending"],
      ["pending", "supervised", "nach supervised"],
      ["supervised", "free", "nach free"],
      ["free", "pending", "nach pending"],
      ["pending", "declined", "nach declined"],
      ["declined", "supervised", "nach supervised"],
      ["supervised", "declined", "nach declined"],
      ["declined", "free", "nach free"],
    ]);
    expect(rows.every((row) => row.eventType === "tenant.levelChanged")).to.be
      .true;
  });

  it("announces the pending offers of both types in one occasion on the switch to supervised, and none on the way back", async function () {
    const queueRows = () =>
      SupervisionNotificationManager.record
        .getCalls()
        .map((c) => c.args[0])
        .filter((row) => row.type === "review.queueEntered");

    await switchTo("supervised");

    expect(queueRows()).to.have.length(1);
    expect(queueRows()[0].tenantId).to.equal(TENANT);
    expect(queueRows()[0].payload.cause).to.equal("tenant.levelChanged");
    expect(queueRows()[0].payload.offers).to.deep.equal([
      {
        offerType: "bookable",
        offerId: bookableId("pending"),
        title: "Raum pending",
        submittedAt: SUBMITTED,
        isPublic: true,
      },
      {
        offerType: "event",
        offerId: eventId("pending"),
        title: eventName("pending"),
        submittedAt: SUBMITTED,
        isPublic: true,
      },
    ]);

    await switchTo("supervised");
    await switchTo("free");
    await switchTo("pending");
    await switchTo("declined");

    expect(queueRows()).to.have.length(1);
  });

  it("records no queue entry for a tenant without a pending offer", async function () {
    h.bookables[bookableId("pending")].review = review("approved");
    events[eventId("pending")].review = review("rejected");

    await switchTo("supervised");

    const types = SupervisionNotificationManager.record
      .getCalls()
      .map((c) => c.args[0].type);
    expect(types).to.deep.equal(["tenant.levelChanged"]);
  });
});
