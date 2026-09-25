/**
 * The review of an event over the routes (tenant supervision spec §4,
 * §5.1, §6.2): submission and decision, the write sovereignty of the
 * review, the first publication wish, an expired event, and every row of
 * the decision matrix over list, detail and checkout.
 */

const { expect } = require("chai");
const sinon = require("sinon");

const {
  installHarness,
  bookable,
  checkoutBody,
  TENANT,
  ADMIN,
  OWNER,
  ROLE_HOLDER,
  CUSTOMER,
} = require("./helpers/booking-lifecycle-harness");
const {
  installRouteWorld,
  offerReads,
  FIXTURE_ID,
} = require("./helpers/route-world");
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

const review = (status, overrides = {}) => ({
  status,
  submittedAt: null,
  decidedAt: null,
  decidedBy: null,
  reason: null,
  ...overrides,
});

/** The event the ticket of the harness belongs to. */
const EVENT_ID = "E1";

const eventFixture = (overrides = {}) =>
  new Event({
    id: EVENT_ID,
    tenantId: TENANT,
    ownerUserId: ROLE_HOLDER,
    isPublic: false,
    information: {
      name: "Sommerkonzert",
      startDate: "2027-06-21",
      startTime: "19:00",
      endDate: "2027-06-21",
      endTime: "22:00",
      tags: ["musik"],
      flags: [],
    },
    eventLocation: { name: "Stadthalle" },
    eventOrganizer: { contactPersonEmailAddress: "orga@example.test" },
    ...overrides,
  });

describe("event review routes", function () {
  this.timeout(30000);

  let h;
  let events;
  let ticketWasPublic;
  let storeSizeBefore;
  const createdTicketIds = [];

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
          ownerUserId: ROLE_HOLDER,
        }),
      },
    });
    installRouteWorld({
      tenantId: TENANT,
      tenant: h.tenant,
      ownerUserId: ROLE_HOLDER,
      bookables: h.bookables,
    });
    // The event store, over a catalogue of this test: reads within the
    // reach (the public's through the real projection, as the manager
    // does), the conditional review write, the whole-event write.
    const reads = offerReads(() => Object.values(events), "event");
    restub("getEvent", reads.one);
    restub("getEvents", reads.many);
    restub("updateReview", async ({ id, expectedStatus, review: next }) => {
      const target = events[id];
      if (!target || (target.review?.status ?? null) !== expectedStatus) {
        return null;
      }
      target.review = next;
      return target;
    });
    restub("storeEvent", async (entity) => {
      // As the manager does it: the review is written on insert only.
      const existing = events[entity.id];
      events[entity.id] = new Event({
        ...entity,
        review: existing ? existing.review : entity.review,
      });
      return entity;
    });
    // The ticket an event is created with lands in the harness's catalogue.
    BookableManager.storeBookable.restore();
    sinon.stub(BookableManager, "storeBookable").callsFake(async (entity) => {
      h.bookables[entity.id] = bookable({ ...entity });
      createdTicketIds.push(entity.id);
      return entity;
    });
  });

  after(async function () {
    sinon.restore();
    await h.close();
  });

  beforeEach(function () {
    storeSizeBefore = h.store.size;
    ticketWasPublic = h.bookables.ticket.isPublic;
    h.tenant.supervisionLevel = "supervised";
    events = { [EVENT_ID]: eventFixture() };
    h.bookables.ticket.review = review("approved");
    SupervisionHistoryManager.insert.resetHistory();
    SupervisionNotificationManager.record.resetHistory();
  });

  afterEach(function () {
    for (const id of createdTicketIds.splice(0)) {
      delete h.bookables[id];
    }
    h.tenant.supervisionLevel = "free";
    h.bookables.ticket.review = review(null);
    h.bookables.ticket.isPublic = ticketWasPublic;
  });

  const call = (method, path, userId, body) => {
    let req = h.api()[method](path).timeout({ response: 5000 });
    if (userId) req = req.set(h.as(userId));
    if (body) req = req.send(body);
    return req;
  };
  const submissions = `/api/${TENANT}/events/${EVENT_ID}/review/submissions`;
  const decisions = `/api/${TENANT}/events/${EVENT_ID}/review/decisions`;

  describe("POST …/review/submissions", function () {
    it("lets the tenant owner submit without a publication wish and answers the review", async function () {
      const res = await call("post", submissions, OWNER, {
        status: "approved",
      });

      expect(res.status).to.equal(200);
      expect(res.body.offerType).to.equal("event");
      expect(res.body.offerId).to.equal(EVENT_ID);
      expect(res.body.review.status).to.equal("pending");
      expect(new Date(res.body.review.submittedAt).getTime()).to.be.closeTo(
        Date.now(),
        5000,
      );
      expect(events[EVENT_ID].isPublic).to.equal(false);
      const row = SupervisionHistoryManager.insert.firstCall.args[0];
      expect(row).to.include({
        offerType: "event",
        offerId: EVENT_ID,
        eventType: "review.submitted",
        from: null,
        to: "pending",
      });
      expect(row.actor.userId).to.equal(OWNER);
      const occasion = SupervisionNotificationManager.record.firstCall.args[0];
      expect(occasion.type).to.equal("review.queueEntered");
      expect(occasion.payload.offers).to.deep.equal([
        {
          offerType: "event",
          offerId: EVENT_ID,
          title: "Sommerkonzert",
          submittedAt: occasion.payload.offers[0].submittedAt,
          isPublic: false,
        },
      ]);
    });

    it("records a queue entry only under a supervised tenant", async function () {
      for (const level of ["free", "pending"]) {
        h.tenant.supervisionLevel = level;
        events[EVENT_ID].review = review(null);

        const res = await call("post", submissions, OWNER);

        expect(res.body.review.status, level).to.equal("pending");
      }
      // A declined tenant's owner is behind the management gate (ticket
      // 15); the instance owner's submission is recorded without an
      // occasion as well.
      h.tenant.supervisionLevel = "declined";
      events[EVENT_ID].review = review(null);
      const refused = await call("post", submissions, OWNER);
      expect(refused.status).to.equal(403);
      expect(refused.body.code).to.equal("tenant_declined");
      const res = await call("post", submissions, ADMIN);
      expect(res.body.review.status, "declined").to.equal("pending");

      expect(SupervisionHistoryManager.insert.callCount).to.equal(3);
      expect(SupervisionNotificationManager.record.called).to.be.false;
    });

    it("repeats as a no-op 200 with the first submission time", async function () {
      const first = await call("post", submissions, OWNER);
      const second = await call("post", submissions, OWNER);

      expect(second.status).to.equal(200);
      expect(second.body.review.submittedAt).to.equal(
        first.body.review.submittedAt,
      );
      expect(SupervisionHistoryManager.insert.calledOnce).to.be.true;
      expect(SupervisionNotificationManager.record.calledOnce).to.be.true;
    });

    it("resubmits a rejected event with a new submission time", async function () {
      events[EVENT_ID].review = review("rejected", {
        submittedAt: new Date("2026-01-01T00:00:00.000Z"),
        reason: "nein",
      });

      const res = await call("post", submissions, OWNER);

      expect(res.body.review.status).to.equal("pending");
      expect(new Date(res.body.review.submittedAt).getTime()).to.be.closeTo(
        Date.now(),
        5000,
      );
    });

    it("lets the instance owner submit, refuses role holder, customer and anonymous", async function () {
      expect((await call("post", submissions, ADMIN)).status).to.equal(200);
      expect((await call("post", submissions, ROLE_HOLDER)).status).to.equal(
        403,
      );
      expect((await call("post", submissions, CUSTOMER)).status).to.equal(403);
      expect((await call("post", submissions)).status).to.equal(401);
    });

    it("answers 404 for an unknown event and 409 for an approved one", async function () {
      const unknown = await call(
        "post",
        `/api/${TENANT}/events/nope/review/submissions`,
        OWNER,
      );
      expect(unknown.status).to.equal(404);

      events[EVENT_ID].review = review("approved");
      const res = await call("post", submissions, OWNER);
      expect(res.status).to.equal(409);
      expect(res.body.code).to.equal("review_transition_invalid");
    });
  });

  describe("POST …/review/decisions", function () {
    it("lets the instance owner approve, withdraw and correct, with actor and reason", async function () {
      events[EVENT_ID].review = review("pending");
      events[EVENT_ID].isPublic = true;

      const approved = await call("post", decisions, ADMIN, {
        action: "approve",
        decidedBy: "someone-else",
      });
      expect(approved.status).to.equal(200);
      expect(approved.body.offerType).to.equal("event");
      expect(approved.body.review).to.include({
        status: "approved",
        decidedBy: ADMIN,
      });

      const withdrawn = await call("post", decisions, ADMIN, {
        action: "withdraw",
        reason: " Beschwerde ",
      });
      expect(withdrawn.body.review).to.include({
        status: "rejected",
        reason: "Beschwerde",
      });
      // Rejection and withdrawal keep the publication wish.
      expect(events[EVENT_ID].isPublic).to.equal(true);

      const corrected = await call("post", decisions, ADMIN, {
        action: "approve",
      });
      expect(corrected.body.review.status).to.equal("approved");

      expect(
        SupervisionHistoryManager.insert
          .getCalls()
          .map((c) => `${c.args[0].offerType} ${c.args[0].eventType}`),
      ).to.deep.equal([
        "event review.approved",
        "event review.withdrawn",
        "event review.approved",
      ]);
      expect(
        SupervisionNotificationManager.record
          .getCalls()
          .map((c) => `${c.args[0].type} ${c.args[0].payload.offerType}`),
      ).to.deep.equal([
        "review.decided event",
        "review.decided event",
        "review.decided event",
      ]);
    });

    it("rejects a pending event", async function () {
      events[EVENT_ID].review = review("pending");

      const res = await call("post", decisions, ADMIN, {
        action: "reject",
        reason: "unvollständig",
      });

      expect(res.body.review).to.include({
        status: "rejected",
        reason: "unvollständig",
      });
    });

    it("refuses everyone but the instance owner", async function () {
      events[EVENT_ID].review = review("pending");
      for (const [userId, status] of [
        [OWNER, 403],
        [ROLE_HOLDER, 403],
        [CUSTOMER, 403],
        [null, 401],
      ]) {
        const res = await call("post", decisions, userId, {
          action: "approve",
        });
        expect(res.status, String(userId)).to.equal(status);
      }
      expect(events[EVENT_ID].review.status).to.equal("pending");
    });

    it("answers 400 for an unknown action or submit, 409 for an invalid transition", async function () {
      events[EVENT_ID].review = review("pending");

      for (const action of ["submit", "publish", undefined]) {
        const res = await call("post", decisions, ADMIN, { action });
        expect(res.status).to.equal(400);
        expect(res.body.code).to.equal("invalid_review_action");
      }
      const res = await call("post", decisions, ADMIN, { action: "withdraw" });
      expect(res.status).to.equal(409);
      expect(res.body.params).to.deep.equal({
        from: "pending",
        action: "withdraw",
      });
    });

    it("answers a conflict for a decision overtaken by another, without a second history row", async function () {
      events[EVENT_ID].review = review("pending");
      // Both decisions read `pending`; the other one's write lands first.
      const write = EventManager.updateReview;
      let overtaken = false;
      restub("updateReview", async (params) => {
        if (!overtaken) {
          overtaken = true;
          events[EVENT_ID].review = review("rejected");
        }
        return write(params);
      });
      try {
        const res = await call("post", decisions, ADMIN, {
          action: "approve",
        });

        expect(res.status).to.equal(409);
        expect(res.body.code).to.equal("review_transition_invalid");
        expect(events[EVENT_ID].review.status).to.equal("rejected");
        expect(SupervisionHistoryManager.insert.called).to.be.false;
        expect(SupervisionNotificationManager.record.called).to.be.false;
      } finally {
        restub("updateReview", write);
      }
    });

    it("decides a pending event that has expired, and the expiry changes no status", async function () {
      events[EVENT_ID] = eventFixture({
        review: review("pending"),
        information: {
          name: "Vorjahreskonzert",
          startDate: "2020-06-21",
          startTime: "19:00",
          endDate: "2020-06-21",
          endTime: "22:00",
        },
      });
      expect(events[EVENT_ID].isPast()).to.equal(true);

      const admin = await call(
        "get",
        `/api/${TENANT}/events/${EVENT_ID}`,
        ADMIN,
      );
      expect(admin.body.review.status).to.equal("pending");

      const res = await call("post", decisions, ADMIN, { action: "approve" });

      expect(res.status).to.equal(200);
      expect(res.body.review.status).to.equal("approved");
    });
  });

  describe("write sovereignty and the first publication wish", function () {
    const form = (changes = {}) => ({
      ...JSON.parse(JSON.stringify(events[EVENT_ID])),
      ...changes,
    });
    const created = () =>
      Object.values(events).find((event) => event.id !== EVENT_ID);

    it("ignores a review in an update body and keeps the stored one", async function () {
      events[EVENT_ID].review = review("rejected", { reason: "nein" });

      const res = await call(
        "put",
        `/api/${TENANT}/events`,
        OWNER,
        form({
          information: { ...events[EVENT_ID].information, name: "Neu" },
          review: review("approved"),
        }),
      );

      expect(res.status).to.equal(201);
      expect(events[EVENT_ID].review).to.include({
        status: "rejected",
        reason: "nein",
      });
      expect(events[EVENT_ID].information.name).to.equal("Neu");
      expect(SupervisionHistoryManager.insert.called).to.be.false;
    });

    it("ignores a review in a creation body, with tickets too", async function () {
      for (const query of ["", "?withTickets=true"]) {
        events = { [EVENT_ID]: events[EVENT_ID] };
        const body = form({ review: review("approved"), isPublic: false });
        delete body.id;

        const res = await call(
          "put",
          `/api/${TENANT}/events${query}`,
          OWNER,
          body,
        );

        expect(res.status, query).to.equal(201);
        expect(created().review.status, query).to.equal(null);
      }
    });

    it("submits on creation with a publication wish, for a free tenant too", async function () {
      h.tenant.supervisionLevel = "free";
      const body = form({ isPublic: true });
      delete body.id;

      const res = await call("put", `/api/${TENANT}/events`, OWNER, body);

      expect(res.status).to.equal(201);
      expect(created().review.status).to.equal("pending");
      expect(SupervisionHistoryManager.insert.calledOnce).to.be.true;
      expect(SupervisionHistoryManager.insert.firstCall.args[0]).to.include({
        offerType: "event",
        offerId: created().id,
        eventType: "review.submitted",
      });
      expect(
        SupervisionHistoryManager.insert.firstCall.args[0].actor.userId,
      ).to.equal(OWNER);
      // A free tenant has no active review queue.
      expect(SupervisionNotificationManager.record.called).to.be.false;
    });

    it("submits on the first publication wish of an edit, for a pending tenant too", async function () {
      h.tenant.supervisionLevel = "pending";

      const res = await call(
        "put",
        `/api/${TENANT}/events`,
        OWNER,
        form({ isPublic: true }),
      );

      expect(res.status).to.equal(201);
      expect(events[EVENT_ID].review.status).to.equal("pending");
    });

    it("keeps the review when the publication wish is switched off and on again", async function () {
      events[EVENT_ID].review = review("rejected");
      events[EVENT_ID].isPublic = true;

      await call(
        "put",
        `/api/${TENANT}/events`,
        OWNER,
        form({ isPublic: false }),
      );
      await call(
        "put",
        `/api/${TENANT}/events`,
        OWNER,
        form({ isPublic: true }),
      );

      expect(events[EVENT_ID].isPublic).to.equal(true);
      expect(events[EVENT_ID].review.status).to.equal("rejected");
      expect(SupervisionHistoryManager.insert.called).to.be.false;
    });

    it("shows the review in the admin DTOs and never in the public ones", async function () {
      events[EVENT_ID].review = review("approved", { reason: "Geheimgrund" });
      events[EVENT_ID].isPublic = true;
      h.bookables.ticket.isPublic = true;

      const admin = await call(
        "get",
        `/api/${TENANT}/events/${EVENT_ID}`,
        OWNER,
      );
      expect(admin.body.review).to.include({ status: "approved" });
      const adminList = await call("get", `/api/${TENANT}/events`, OWNER);
      expect(
        adminList.body.find((e) => e.id === EVENT_ID).review.status,
      ).to.equal("approved");

      for (const path of [
        `/api/${TENANT}/events/${EVENT_ID}`,
        `/api/${TENANT}/events`,
        `/api/${TENANT}/bookables/public/ticket?populate=true`,
        `/api/${TENANT}/bookables/public?populate=true`,
        `/json/${TENANT}/events/${EVENT_ID}`,
        `/json/${TENANT}/events`,
      ]) {
        // Signing in is no management reach.
        for (const userId of [null, CUSTOMER]) {
          const res = await call("get", path, userId);
          expect(res.status, path).to.equal(200);
          expect(JSON.stringify(res.body), path).to.include("Sommerkonzert");
          expect(JSON.stringify(res.body), path).to.not.include("Geheimgrund");
          expect(JSON.stringify(res.body), path).to.not.include('"review"');
        }
      }
    });
  });
  describe("the decision matrix (§5.1)", function () {
    const LEVELS = ["free", "supervised", "pending", "declined"];
    const STATUSES = [null, "pending", "approved", "rejected"];

    /** The matrix itself, spelled from the spec table. */
    const expected = (level, status, isPublic) => {
      if (["pending", "declined"].includes(level)) {
        return { listed: false, reachable: false };
      }
      if (level === "free") return { listed: isPublic, reachable: true };
      const approved = status === "approved";
      return { listed: approved && isPublic, reachable: approved };
    };

    // List-type delivery: lists, calendars and feeds.
    const listPaths = [
      `/api/${TENANT}/events`,
      `/json/${TENANT}/events`,
      `/html/${TENANT}/events`,
      `/api/${TENANT}/ical/events`,
      `/api/${TENANT}/ical/feed/events`,
    ];
    // The event embedded in its (listed, approved) ticket: what a direct
    // link may show.
    const embedPaths = [
      `/api/${TENANT}/bookables/public?populate=true`,
      `/api/${TENANT}/bookables/public/ticket?populate=true`,
    ];
    // Detail-type delivery: the event by direct link - in the engines and
    // the calendars too, one rule per delivery form (ADR 0003) - and what
    // booking its (approved) ticket needs.
    const detailPaths = [
      `/api/${TENANT}/events/${EVENT_ID}`,
      `/html/${TENANT}/events/${EVENT_ID}`,
      `/json/${TENANT}/events/${EVENT_ID}`,
      `/api/${TENANT}/ical/events/${EVENT_ID}`,
      `/api/${TENANT}/ical/feed/events/${EVENT_ID}`,
      `/api/${TENANT}/bookables/public/ticket`,
      `/api/${TENANT}/bookables/ticket/prices`,
      `/api/${TENANT}/bookables/ticket/availability`,
      `/api/${TENANT}/bookables/ticket/bookings?public=true`,
      `/api/${TENANT}/checkout/permissions/ticket`,
      `/api/v2/${TENANT}/checkout/permissions/ticket`,
    ];
    const NAME = "Sommerkonzert";
    const ticketBody = () =>
      checkoutBody("ticket", { timeBegin: null, timeEnd: null });

    for (const level of LEVELS) {
      for (const status of STATUSES) {
        for (const isPublic of [true, false]) {
          const want = expected(level, status, isPublic);
          it(`${level} / ${status} / isPublic ${isPublic}: listed ${want.listed}, reachable ${want.reachable}`, async function () {
            h.tenant.supervisionLevel = level;
            events[EVENT_ID].review = review(status, { reason: "Geheimgrund" });
            events[EVENT_ID].isPublic = isPublic;
            h.bookables.ticket.isPublic = true;

            for (const [paths, shows] of [
              [listPaths, want.listed],
              [embedPaths, want.reachable],
            ]) {
              for (const path of paths) {
                // Signing in opens nothing.
                for (const userId of [null, CUSTOMER]) {
                  const res = await call("get", path, userId);
                  const shown = res.status === 200 && res.text.includes(NAME);
                  expect(shown, `${path} -> ${res.status}`).to.equal(shows);
                  expect(res.text).to.not.match(/"review"|Geheimgrund/);
                }
              }
            }

            // The (listed, approved) ticket goes out with its event only.
            for (const path of [
              `/api/${TENANT}/bookables/public`,
              `/json/${TENANT}/bookables`,
            ]) {
              const res = await call("get", path);
              expect(
                res.status === 200 && res.body.some((b) => b.id === "ticket"),
                `ticket in ${path}`,
              ).to.equal(want.reachable);
            }

            for (const path of detailPaths) {
              for (const userId of [null, CUSTOMER]) {
                const res = await call("get", path, userId);
                expect(res.status === 404, `${path} -> ${res.status}`).to.equal(
                  !want.reachable,
                );
                expect(res.text ?? "").to.not.match(
                  /review|supervis|Geheimgrund/i,
                );
              }
            }

            const checkout = await call(
              "post",
              `/api/v2/${TENANT}/checkout`,
              CUSTOMER,
              ticketBody(),
            );
            expect(checkout.body.success, "checkout").to.equal(want.reachable);
            if (!want.reachable) {
              expect(checkout.body.error.reason).to.equal(
                CHECKOUT_REASONS.BOOKABLE_NOT_FOUND,
              );
            }
            const validate = await call(
              "post",
              `/api/${TENANT}/checkout/validateItem`,
              null,
              { bookableId: "ticket", amount: 1 },
            );
            // An offer the public cannot reach is not there (ADR 0003).
            expect(validate.status === 404, "validateItem").to.equal(
              !want.reachable,
            );
          });
        }
      }
    }
    it("a withdrawal after the page was loaded blocks the new booking and leaves the existing one alone", async function () {
      events[EVENT_ID].review = review("approved");
      const page = await call("get", `/api/${TENANT}/events/${EVENT_ID}`);
      expect(page.status).to.equal(200);
      const first = await call(
        "post",
        `/api/v2/${TENANT}/checkout`,
        CUSTOMER,
        ticketBody(),
      );
      expect(first.body.success).to.equal(true);
      const existing = JSON.stringify([...h.store.entries()]);

      const withdrawn = await call("post", decisions, ADMIN, {
        action: "withdraw",
        reason: "Beschwerde",
      });
      expect(withdrawn.body.review.status).to.equal("rejected");

      const second = await call(
        "post",
        `/api/v2/${TENANT}/checkout`,
        CUSTOMER,
        ticketBody(),
      );
      expect(second.body.success).to.equal(false);
      expect(second.body.error.reason).to.equal(
        CHECKOUT_REASONS.BOOKABLE_NOT_FOUND,
      );
      expect(JSON.stringify(second.body)).to.not.include("Beschwerde");
      // The existing booking: untouched, and its status still answers.
      expect(JSON.stringify([...h.store.entries()])).to.equal(existing);
      const [bookingId] = [...h.store.keys()];
      const status = await call(
        "get",
        `/api/${TENANT}/bookings/${bookingId}/status`,
      );
      expect(status.status).to.equal(200);
    });

    it("refuses the ticket of an unapproved event in the group and the legacy checkout", async function () {
      events[EVENT_ID].review = review("pending");
      const groupBody = {
        bookableItems: [{ bookableId: "ticket", amount: 1 }],
        bookingAttempts: [
          { timeBegin: null, timeEnd: null },
          { timeBegin: null, timeEnd: null },
        ],
        name: "Erika Muster",
        mail: CUSTOMER,
        paymentProvider: "giroCockpit",
      };

      const group = await call(
        "post",
        `/api/v2/${TENANT}/checkout/group`,
        CUSTOMER,
        groupBody,
      );
      expect(group.body.success).to.equal(false);
      // The group checkout reads its lead ticket as the public (ADR 0003):
      // a ticket of an unapproved event is not there for the public.
      expect(JSON.stringify(group.body)).to.include(
        CHECKOUT_REASONS.BOOKABLE_NOT_FOUND,
      );
      const legacy = await call(
        "post",
        `/api/${TENANT}/checkout`,
        null,
        ticketBody(),
      );
      expect(legacy.status).to.equal(404);
      expect(h.store.size).to.equal(storeSizeBefore);
    });

    it("lets a ticket whose event is gone through the event part of the projection", async function () {
      events = {};
      h.bookables.ticket.isPublic = true;

      const detail = await call(
        "get",
        `/api/${TENANT}/bookables/public/ticket`,
      );
      expect(detail.status).to.equal(200);
      const list = await call("get", `/api/${TENANT}/bookables/public`);
      expect(list.body.some((b) => b.id === "ticket")).to.equal(true);
    });

    it("keeps the management reach on a supervised tenant's unapproved event", async function () {
      for (const userId of [ROLE_HOLDER, OWNER, ADMIN]) {
        const detail = await call(
          "get",
          `/api/${TENANT}/events/${EVENT_ID}`,
          userId,
        );
        expect(detail.status).to.equal(200);
        expect(detail.body.review.status).to.equal(null);
        const list = await call("get", `/api/${TENANT}/events`, userId);
        expect(list.body.map((e) => e.id)).to.deep.equal([EVENT_ID]);
      }
      const booking = await h.manualBooking("ticket", {}, ticketBody());
      expect(h.stored(booking.id)).to.exist;
    });
  });

  describe("the reach `own` of the event routes", function () {
    const EventController = require("../src/platform/api/controllers/event-controller");
    const respond = async (handler, userId, reach = "own") => {
      const res = {
        status(code) {
          this.statusCode = code;
          return this;
        },
        send(body) {
          this.body = body;
        },
      };
      let error = null;
      await handler(
        {
          params: { tenant: TENANT, id: EVENT_ID },
          reach,
          principal: { userId },
        },
        res,
        (err) => (error = err),
      );
      return { ...res, error };
    };

    it("shows an owner their unapproved event whole, and under `own` nothing else - never own plus public (ADR 0001)", async function () {
      const mine = await respond(EventController.getEvent, ROLE_HOLDER);
      expect(mine.body.review.status).to.equal(null);
      const mineListed = await respond(EventController.getEvents, ROLE_HOLDER);
      expect(mineListed.body.map((e) => e.id)).to.deep.equal([EVENT_ID]);

      const other = await respond(
        EventController.getEvent,
        "other@example.test",
      );
      expect(other.error.statusCode).to.equal(404);
      const otherListed = await respond(
        EventController.getEvents,
        "other@example.test",
      );
      expect(otherListed.body).to.deep.equal([]);

      // The public list is the public's alone (`public`), not a holder's
      // `own`: the approved event is listed there, without its review.
      events[EVENT_ID].review = review("approved", { reason: "Geheimgrund" });
      events[EVENT_ID].isPublic = true;
      const stillOwn = await respond(
        EventController.getEvents,
        "other@example.test",
      );
      expect(stillOwn.body).to.deep.equal([]);
      const asPublic = await respond(EventController.getEvents, null, "public");
      expect(asPublic.body.map((e) => e.id)).to.deep.equal([EVENT_ID]);
      expect(asPublic.body[0]).to.not.have.property("review");
    });
  });
});
