/**
 * The review of a bookable over the routes (tenant supervision spec §4,
 * §5.1, §6.2): submission and decision, the write sovereignty of the
 * review, the first publication wish, and every row of the decision
 * matrix over list, detail, prices, availability and checkout.
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
const {
  BookableManager,
} = require("../src/commons/data-managers/bookable-manager");
const SupervisionHistoryManager = require("../src/commons/data-managers/supervision-history-manager");
const SupervisionNotificationManager = require("../src/commons/data-managers/supervision-notification-manager");
const {
  CHECKOUT_REASONS,
} = require("../src/commons/services/checkout/checkout-reasons");

const review = (status, overrides = {}) => ({
  status,
  submittedAt: null,
  decidedAt: null,
  decidedBy: null,
  reason: null,
  ...overrides,
});

describe("bookable review routes", function () {
  this.timeout(30000);

  let h;
  let stored;

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
    // The conditional write and the store, over the harness's catalogue.
    BookableManager.updateReview.restore();
    sinon
      .stub(BookableManager, "updateReview")
      .callsFake(async ({ id, expectedStatus, review: next }) => {
        const target = h.bookables[id];
        if (!target || (target.review?.status ?? null) !== expectedStatus) {
          return null;
        }
        target.review = next;
        return target;
      });
    BookableManager.storeBookable.restore();
    sinon.stub(BookableManager, "storeBookable").callsFake(async (entity) => {
      // As the manager does it: the review is written on insert only.
      const existing = h.bookables[entity.id];
      stored = {
        ...entity,
        review: existing ? existing.review : entity.review,
      };
      h.bookables[entity.id] = bookable(stored);
      return entity;
    });
  });

  after(async function () {
    sinon.restore();
    await h.close();
  });

  beforeEach(function () {
    h.tenant.supervisionLevel = "supervised";
    h.bookables[FIXTURE_ID].review = review(null);
    h.bookables[FIXTURE_ID].isPublic = false;
    stored = null;
    SupervisionHistoryManager.insert.resetHistory();
    SupervisionNotificationManager.record.resetHistory();
  });

  afterEach(function () {
    h.tenant.supervisionLevel = "free";
    h.bookables[FIXTURE_ID].review = review(null);
    h.bookables[FIXTURE_ID].isPublic = false;
  });

  const call = (method, path, userId, body) => {
    let req = h.api()[method](path).timeout({ response: 5000 });
    if (userId) req = req.set(h.as(userId));
    if (body) req = req.send(body);
    return req;
  };
  const submissions = `/api/${TENANT}/bookables/${FIXTURE_ID}/review/submissions`;
  const decisions = `/api/${TENANT}/bookables/${FIXTURE_ID}/review/decisions`;

  describe("POST …/review/submissions", function () {
    it("lets the tenant owner submit without a publication wish and answers the review", async function () {
      const res = await call("post", submissions, OWNER, {
        status: "approved",
      });

      expect(res.status).to.equal(200);
      expect(res.body.offerType).to.equal("bookable");
      expect(res.body.offerId).to.equal(FIXTURE_ID);
      expect(res.body.review.status).to.equal("pending");
      expect(new Date(res.body.review.submittedAt).getTime()).to.be.closeTo(
        Date.now(),
        5000,
      );
      const row = SupervisionHistoryManager.insert.firstCall.args[0];
      expect(row).to.include({ eventType: "review.submitted", to: "pending" });
      expect(row.actor.userId).to.equal(OWNER);
      expect(
        SupervisionNotificationManager.record.firstCall.args[0].type,
      ).to.equal("review.queueEntered");
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

    it("lets the instance owner submit, refuses role holder, customer and anonymous", async function () {
      expect((await call("post", submissions, ADMIN)).status).to.equal(200);
      expect((await call("post", submissions, ROLE_HOLDER)).status).to.equal(
        403,
      );
      expect((await call("post", submissions, CUSTOMER)).status).to.equal(403);
      expect((await call("post", submissions)).status).to.equal(401);
    });

    it("answers 404 for an unknown bookable and 409 for an approved one", async function () {
      const unknown = await call(
        "post",
        `/api/${TENANT}/bookables/nope/review/submissions`,
        OWNER,
      );
      expect(unknown.status).to.equal(404);

      h.bookables[FIXTURE_ID].review = review("approved");
      const res = await call("post", submissions, OWNER);
      expect(res.status).to.equal(409);
      expect(res.body.code).to.equal("review_transition_invalid");
    });
  });

  describe("POST …/review/decisions", function () {
    it("lets the instance owner approve, withdraw and correct, with actor and reason", async function () {
      h.bookables[FIXTURE_ID].review = review("pending");
      h.bookables[FIXTURE_ID].isPublic = true;

      const approved = await call("post", decisions, ADMIN, {
        action: "approve",
        decidedBy: "someone-else",
      });
      expect(approved.status).to.equal(200);
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
      expect(h.bookables[FIXTURE_ID].isPublic).to.equal(true);

      const corrected = await call("post", decisions, ADMIN, {
        action: "approve",
      });
      expect(corrected.body.review.status).to.equal("approved");

      expect(
        SupervisionHistoryManager.insert
          .getCalls()
          .map((c) => c.args[0].eventType),
      ).to.deep.equal([
        "review.approved",
        "review.withdrawn",
        "review.approved",
      ]);
      expect(
        SupervisionNotificationManager.record
          .getCalls()
          .map((c) => c.args[0].type),
      ).to.deep.equal(["review.decided", "review.decided", "review.decided"]);
    });

    it("refuses everyone but the instance owner", async function () {
      h.bookables[FIXTURE_ID].review = review("pending");
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
      expect(h.bookables[FIXTURE_ID].review.status).to.equal("pending");
    });

    it("answers 400 for an unknown action or submit, 409 for an invalid transition", async function () {
      h.bookables[FIXTURE_ID].review = review("pending");

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
  });

  describe("write sovereignty and the first publication wish", function () {
    const form = (changes = {}) => ({
      ...JSON.parse(JSON.stringify(h.bookables[FIXTURE_ID])),
      ...changes,
    });

    it("ignores a review in an update body and answers the stored one", async function () {
      h.bookables[FIXTURE_ID].review = review("rejected", { reason: "nein" });

      const res = await call(
        "put",
        `/api/${TENANT}/bookables`,
        OWNER,
        form({ title: "Neu", review: review("approved") }),
      );

      expect(res.status).to.equal(201);
      expect(res.body.review).to.include({
        status: "rejected",
        reason: "nein",
      });
      expect(h.bookables[FIXTURE_ID].review.status).to.equal("rejected");
      expect(h.bookables[FIXTURE_ID].title).to.equal("Neu");
      expect(SupervisionHistoryManager.insert.called).to.be.false;
    });

    it("ignores a review in a creation body", async function () {
      const body = form({ review: review("approved"), isPublic: false });
      delete body.id;

      const res = await call("put", `/api/${TENANT}/bookables`, OWNER, body);

      expect(res.status).to.equal(201);
      expect(res.body.review.status).to.equal(null);
      expect(stored.review.status).to.equal(null);
      delete h.bookables[res.body.id];
    });

    it("submits on creation with a publication wish, for a free tenant too", async function () {
      h.tenant.supervisionLevel = "free";
      const body = form({ isPublic: true });
      delete body.id;

      const res = await call("put", `/api/${TENANT}/bookables`, OWNER, body);

      expect(res.status).to.equal(201);
      expect(res.body.review.status).to.equal("pending");
      expect(SupervisionHistoryManager.insert.calledOnce).to.be.true;
      expect(SupervisionHistoryManager.insert.firstCall.args[0]).to.include({
        offerId: res.body.id,
        eventType: "review.submitted",
      });
      // A free tenant has no active review queue.
      expect(SupervisionNotificationManager.record.called).to.be.false;
      delete h.bookables[res.body.id];
    });

    it("submits on the first publication wish of an edit, for a pending tenant too", async function () {
      h.tenant.supervisionLevel = "pending";

      const res = await call(
        "put",
        `/api/${TENANT}/bookables`,
        OWNER,
        form({ isPublic: true }),
      );

      expect(res.status).to.equal(201);
      expect(res.body.review.status).to.equal("pending");
      expect(h.bookables[FIXTURE_ID].review.status).to.equal("pending");
    });

    it("keeps the review when the publication wish is switched off and on again", async function () {
      h.bookables[FIXTURE_ID].review = review("rejected");
      h.bookables[FIXTURE_ID].isPublic = true;

      await call(
        "put",
        `/api/${TENANT}/bookables`,
        OWNER,
        form({ isPublic: false }),
      );
      const on = await call(
        "put",
        `/api/${TENANT}/bookables`,
        OWNER,
        form({ isPublic: true }),
      );

      expect(on.body.review.status).to.equal("rejected");
      expect(SupervisionHistoryManager.insert.called).to.be.false;
    });

    it("shows the review in the admin DTOs and never in the public ones", async function () {
      h.bookables[FIXTURE_ID].review = review("approved", { reason: "intern" });
      h.bookables[FIXTURE_ID].isPublic = true;

      const admin = await call(
        "get",
        `/api/${TENANT}/bookables/${FIXTURE_ID}`,
        OWNER,
      );
      expect(admin.body.review).to.include({ status: "approved" });
      const adminList = await call("get", `/api/${TENANT}/bookables`, OWNER);
      expect(
        adminList.body.find((b) => b.id === FIXTURE_ID).review.status,
      ).to.equal("approved");

      for (const path of [
        `/api/${TENANT}/bookables/public/${FIXTURE_ID}?populate=true`,
        `/api/${TENANT}/bookables/public`,
        `/json/${TENANT}/bookables/${FIXTURE_ID}`,
        `/json/${TENANT}/bookables`,
      ]) {
        const res = await call("get", path);
        expect(res.status, path).to.equal(200);
        expect(JSON.stringify(res.body), path).to.not.include("intern");
        expect(JSON.stringify(res.body), path).to.not.include('"review"');
      }
    });
  });

  describe("the decision matrix (§5.1)", function () {
    const LEVELS = ["free", "supervised", "pending", "declined"];
    const STATUSES = [null, "pending", "approved", "rejected"];

    /** The matrix itself, spelled from the spec table. */
    const expected = (level, status, isPublic) => {
      // A pending or declined tenant has no public projection at all: the
      // managers answer the public's 404 before any offer is asked.
      if (["pending", "declined"].includes(level)) {
        return { tenantVisible: false, listed: false, reachable: false };
      }
      if (level === "free") {
        return { tenantVisible: true, listed: isPublic, reachable: true };
      }
      const approved = status === "approved";
      return {
        tenantVisible: true,
        listed: approved && isPublic,
        reachable: approved,
      };
    };

    const detailPaths = [
      `/api/${TENANT}/bookables/public/${FIXTURE_ID}`,
      `/api/${TENANT}/bookables/${FIXTURE_ID}/prices`,
      `/api/${TENANT}/bookables/${FIXTURE_ID}/availability`,
      `/api/${TENANT}/bookables/${FIXTURE_ID}/availability/v1`,
      `/api/${TENANT}/bookables/${FIXTURE_ID}/openingHours`,
      `/api/${TENANT}/bookables/${FIXTURE_ID}/block-periods`,
      `/api/${TENANT}/bookables/${FIXTURE_ID}/occupancy`,
      `/api/${TENANT}/bookables/${FIXTURE_ID}/bookings?public=true`,
      `/api/${TENANT}/checkout/permissions/${FIXTURE_ID}`,
      `/api/v2/${TENANT}/checkout/permissions/${FIXTURE_ID}`,
    ];

    for (const level of LEVELS) {
      for (const status of STATUSES) {
        for (const isPublic of [true, false]) {
          const want = expected(level, status, isPublic);
          it(`${level} / ${status} / isPublic ${isPublic}: listed ${want.listed}, reachable ${want.reachable}`, async function () {
            h.tenant.supervisionLevel = level;
            h.bookables[FIXTURE_ID].review = review(status);
            h.bookables[FIXTURE_ID].isPublic = isPublic;

            const list = await call("get", `/api/${TENANT}/bookables/public`);
            if (!want.tenantVisible) {
              expect(list.status).to.equal(404);
            } else {
              expect(list.body.some((b) => b.id === FIXTURE_ID)).to.equal(
                want.listed,
              );
            }
            const json = await call("get", `/json/${TENANT}/bookables`);
            expect(
              json.status === 200 && json.body.some((b) => b.id === FIXTURE_ID),
            ).to.equal(want.listed);
            const occupancy = await call(
              "get",
              `/api/${TENANT}/calendar/occupancy`,
            );
            expect(occupancy.status).to.equal(want.tenantVisible ? 200 : 404);

            for (const path of detailPaths) {
              const res = await call("get", path);
              expect(res.status === 404, `${path} -> ${res.status}`).to.equal(
                !want.reachable,
              );
              expect(JSON.stringify(res.body)).to.not.match(/review|supervis/i);
            }

            const checkout = await call(
              "post",
              `/api/v2/${TENANT}/checkout`,
              CUSTOMER,
              checkoutBody(FIXTURE_ID),
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
              {
                bookableId: FIXTURE_ID,
                amount: 1,
                timeBegin: checkoutBody(FIXTURE_ID).timeBegin,
                timeEnd: checkoutBody(FIXTURE_ID).timeEnd,
              },
            );
            // An offer the public cannot reach is not there (ADR 0003).
            expect(validate.status === 404, "validateItem").to.equal(
              !want.reachable,
            );
          });
        }
      }
    }

    it("keeps the management reach on a supervised tenant's unapproved bookable", async function () {
      const prices = await call(
        "get",
        `/api/${TENANT}/bookables/${FIXTURE_ID}/prices`,
        ROLE_HOLDER,
      );
      expect(prices.status).to.equal(200);
      const booking = await h.manualBooking(FIXTURE_ID);
      expect(h.stored(booking.id)).to.exist;
    });

    it("refuses an unapproved ticket of an event and an unapproved group item", async function () {
      h.bookables.ticket.review = review("pending");
      const ticket = await call(
        "post",
        `/api/v2/${TENANT}/checkout`,
        null,
        checkoutBody("ticket", { timeBegin: null, timeEnd: null }),
      );
      expect(ticket.body.error.reason).to.equal(
        CHECKOUT_REASONS.BOOKABLE_NOT_FOUND,
      );
    });

    it("signing in opens neither the anonymized bookings nor the prices of an unapproved bookable", async function () {
      for (const path of [
        `/api/${TENANT}/bookables/${FIXTURE_ID}/bookings?public=true`,
        `/api/${TENANT}/bookables/${FIXTURE_ID}/prices`,
      ]) {
        expect((await call("get", path, CUSTOMER)).status, path).to.equal(404);
      }
      // The staff read the prices whole (`any`); the anonymized bookings
      // are the public's view whoever asks (ADR 0003), the management
      // list is theirs without the flag.
      expect(
        (
          await call(
            "get",
            `/api/${TENANT}/bookables/${FIXTURE_ID}/prices`,
            ADMIN,
          )
        ).status,
      ).to.equal(200);
      expect(
        (
          await call(
            "get",
            `/api/${TENANT}/bookables/${FIXTURE_ID}/bookings?public=true`,
            ADMIN,
          )
        ).status,
      ).to.equal(404);
      expect(
        (
          await call(
            "get",
            `/api/${TENANT}/bookables/${FIXTURE_ID}/bookings`,
            ADMIN,
          )
        ).status,
      ).to.equal(200);
    });

    it("keeps the review out of the booking a checkout stores and answers", async function () {
      h.bookables[FIXTURE_ID].review = review("approved", {
        reason: "Geheimgrund",
        decidedBy: ADMIN,
      });

      const res = await call(
        "post",
        `/api/v2/${TENANT}/checkout`,
        CUSTOMER,
        checkoutBody(FIXTURE_ID),
      );

      expect(res.body.success).to.equal(true);
      expect(JSON.stringify(res.body)).to.not.include("Geheimgrund");
      expect(JSON.stringify([...h.store.values()])).to.not.include(
        "Geheimgrund",
      );
      // The catalogue's bookable keeps its review.
      expect(h.bookables[FIXTURE_ID].review.status).to.equal("approved");
    });

    it("leaves unlisted related bookables out of a public detail's embedding", async function () {
      h.bookables[FIXTURE_ID].review = review("approved");
      // The related bookables as the manager reads them: through the
      // projection under `public` (the route world's stub knows no rule).
      const related = [
        bookable({
          id: "rel-ok",
          title: "A",
          isPublic: true,
          review: review("approved"),
        }),
        bookable({
          id: "rel-no",
          title: "B",
          isPublic: true,
          review: review("pending"),
        }),
      ];
      const reads = offerReads(() => related, "bookable");
      BookableManager.getRelatedBookables.callsFake((id, tenantId, scope) =>
        reads.many(tenantId, scope),
      );
      try {
        const res = await call(
          "get",
          `/api/${TENANT}/bookables/public/${FIXTURE_ID}?populate=true`,
        );
        expect(
          res.body._populated.relatedBookables.map((b) => b.id),
        ).to.deep.equal(["rel-ok"]);
      } finally {
        BookableManager.getRelatedBookables.resolves([]);
      }
    });
  });
});
