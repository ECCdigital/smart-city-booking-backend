/**
 * The review service (tenant supervision spec §4, §6.2, §8) over an
 * in-memory offer adapter: submission and decision are written
 * conditionally on the status they were read at, followed by one history
 * row and - where the spec names one - one notification occasion.
 */

const { expect } = require("chai");
const sinon = require("sinon");

const TenantManager = require("../src/commons/data-managers/tenant-manager");
const SupervisionHistoryManager = require("../src/commons/data-managers/supervision-history-manager");
const SupervisionNotificationManager = require("../src/commons/data-managers/supervision-notification-manager");
const ReviewService = require("../src/commons/services/supervision/review-service");
const {
  BadRequestError,
  NotFoundError,
  ConflictError,
} = require("../src/errors/BaseError");

const NOW = new Date("2026-09-21T10:00:00.000Z");
const EARLIER = new Date("2026-09-01T10:00:00.000Z");
const OFFER_TYPE = "test-offer";

async function rejection(promise) {
  try {
    await promise;
  } catch (err) {
    return err;
  }
  throw new Error("expected a rejection");
}

describe("ReviewService", function () {
  let offers;
  let tenant;
  let history;
  let outbox;
  /** Runs between the service's load and its write: the concurrent other. */
  let beforeWrite;

  const review = (status, overrides = {}) => ({
    status,
    submittedAt: null,
    decidedAt: null,
    decidedBy: null,
    reason: null,
    ...overrides,
  });

  beforeEach(function () {
    tenant = { id: "t1", name: "Verein", supervisionLevel: "supervised" };
    offers = {
      o1: { id: "o1", title: "Saal", isPublic: false, review: review(null) },
    };
    beforeWrite = null;
    ReviewService.registerOfferAdapter(OFFER_TYPE, {
      load: async (tenantId, offerId) =>
        tenantId === "t1" && offers[offerId]
          ? structuredClone(offers[offerId])
          : null,
      updateReview: async ({ tenantId, offerId, expectedStatus, review }) => {
        if (beforeWrite) beforeWrite();
        const offer = tenantId === "t1" ? offers[offerId] : null;
        if (!offer || (offer.review.status ?? null) !== expectedStatus) {
          return null;
        }
        offer.review = review;
        return structuredClone(offer);
      },
      listByReviewStatus: async (tenantId, status) =>
        Object.values(tenantId === "t1" ? offers : {})
          .filter((offer) => (offer.review.status ?? null) === status)
          .map((offer) => structuredClone(offer)),
    });
    sinon.stub(TenantManager, "getTenant").callsFake(async () => tenant);
    history = sinon
      .stub(SupervisionHistoryManager, "insert")
      .callsFake(async (row) => row);
    outbox = sinon
      .stub(SupervisionNotificationManager, "record")
      .callsFake(async (row) => row);
  });

  afterEach(function () {
    sinon.restore();
  });

  const submit = (overrides = {}) =>
    ReviewService.submit({
      offerType: OFFER_TYPE,
      tenantId: "t1",
      offerId: "o1",
      actorUserId: "owner@example.test",
      now: NOW,
      ...overrides,
    });
  const decide = (action, overrides = {}) =>
    ReviewService.decide({
      offerType: OFFER_TYPE,
      tenantId: "t1",
      offerId: "o1",
      action,
      actorUserId: "admin@example.test",
      now: NOW,
      ...overrides,
    });

  describe("submit", function () {
    it("makes the offer pending, writes history and announces the queue entry of a supervised tenant", async function () {
      const result = await submit();

      expect(result).to.deep.equal(review("pending", { submittedAt: NOW }));
      expect(offers.o1.review.status).to.equal("pending");
      expect(history.calledOnce).to.be.true;
      expect(history.firstCall.args[0]).to.deep.include({
        tenantId: "t1",
        offerType: OFFER_TYPE,
        offerId: "o1",
        eventType: "review.submitted",
        occurredAt: NOW,
        actor: { type: "user", userId: "owner@example.test" },
        from: null,
        to: "pending",
        reason: null,
        origin: "api",
      });
      expect(outbox.calledOnce).to.be.true;
      expect(outbox.firstCall.args[0]).to.deep.include({
        type: "review.queueEntered",
        tenantId: "t1",
      });
      expect(outbox.firstCall.args[0].payload.offers).to.deep.equal([
        {
          offerType: OFFER_TYPE,
          offerId: "o1",
          title: "Saal",
          submittedAt: NOW,
          isPublic: false,
        },
      ]);
    });

    it("submits for a free, a pending and a declined tenant too, without a queue occasion", async function () {
      for (const level of ["free", "pending", "declined", undefined]) {
        offers.o1.review = review(null);
        tenant.supervisionLevel = level;
        history.resetHistory();

        const result = await submit();

        expect(result.status, String(level)).to.equal("pending");
        expect(history.calledOnce).to.be.true;
      }
      expect(outbox.called).to.be.false;
    });

    it("repeats on a pending offer as a no-op: no write, no history, no occasion", async function () {
      offers.o1.review = review("pending", { submittedAt: EARLIER });

      const result = await submit();

      expect(result.submittedAt).to.deep.equal(EARLIER);
      expect(offers.o1.review.submittedAt).to.deep.equal(EARLIER);
      expect(history.called).to.be.false;
      expect(outbox.called).to.be.false;
    });

    it("resubmits a rejected offer with a new submission time", async function () {
      offers.o1.review = review("rejected", {
        submittedAt: EARLIER,
        decidedAt: EARLIER,
        decidedBy: "admin@example.test",
        reason: "nein",
      });

      const result = await submit();

      expect(result).to.deep.equal(review("pending", { submittedAt: NOW }));
      expect(history.firstCall.args[0]).to.include({
        from: "rejected",
        to: "pending",
      });
      expect(outbox.calledOnce).to.be.true;
    });

    it("refuses an approved offer as a conflict and writes nothing", async function () {
      offers.o1.review = review("approved");

      const err = await rejection(submit());

      expect(err).to.be.instanceOf(ConflictError);
      expect(err.code).to.equal("review_transition_invalid");
      expect(history.called).to.be.false;
    });

    it("answers not found for an offer outside the tenant", async function () {
      const err = await rejection(submit({ tenantId: "t2" }));

      expect(err).to.be.instanceOf(NotFoundError);
      expect(err.code).to.equal("offer_not_found");
    });

    it("refuses an unknown offer type", async function () {
      const err = await rejection(submit({ offerType: "voucher" }));
      expect(err).to.be.instanceOf(BadRequestError);
    });
  });

  describe("decide", function () {
    beforeEach(function () {
      offers.o1.review = review("pending", { submittedAt: EARLIER });
    });

    const cases = [
      ["approve", "pending", "approved", "review.approved"],
      ["reject", "pending", "rejected", "review.rejected"],
      ["withdraw", "approved", "rejected", "review.withdrawn"],
      ["approve", "rejected", "approved", "review.approved"],
    ];
    for (const [action, from, to, eventType] of cases) {
      it(`${action} on ${from}: ${to}, a ${eventType} row and a decided occasion`, async function () {
        offers.o1.review.status = from;
        offers.o1.isPublic = true;

        const result = await decide(action, { reason: " Grund " });

        expect(result).to.deep.include({
          status: to,
          decidedAt: NOW,
          decidedBy: "admin@example.test",
          reason: "Grund",
        });
        // A decision never touches the publication wish (spec §4).
        expect(offers.o1.isPublic).to.equal(true);
        expect(history.calledOnce).to.be.true;
        expect(history.firstCall.args[0]).to.deep.include({
          eventType,
          from,
          to,
          reason: "Grund",
          actor: { type: "user", userId: "admin@example.test" },
        });
        expect(outbox.calledOnce).to.be.true;
        expect(outbox.firstCall.args[0].type).to.equal("review.decided");
        expect(outbox.firstCall.args[0].payload).to.deep.include({
          offerType: OFFER_TYPE,
          offerId: "o1",
          title: "Saal",
          action,
          from,
          to,
          reason: "Grund",
        });
      });
    }

    it("records the decided occasion whatever the tenant's level", async function () {
      tenant.supervisionLevel = "free";
      await decide("approve");
      expect(outbox.firstCall.args[0].type).to.equal("review.decided");
    });

    it("refuses submit as a decision and an unknown action", async function () {
      for (const action of ["submit", "publish", undefined]) {
        const err = await rejection(decide(action));
        expect(err).to.be.instanceOf(BadRequestError);
        expect(err.code).to.equal("invalid_review_action");
      }
      expect(history.called).to.be.false;
    });

    it("refuses an invalid transition as a conflict", async function () {
      const err = await rejection(decide("withdraw"));

      expect(err).to.be.instanceOf(ConflictError);
      expect(err.params).to.deep.equal({ from: "pending", action: "withdraw" });
    });

    it("loses no withdrawal: a decision overtaken between load and write is a conflict", async function () {
      offers.o1.review.status = "approved";
      // The other instance owner withdraws first; this one still saw
      // `approved` - its own withdrawal must not write a second row.
      beforeWrite = () => {
        offers.o1.review = review("rejected", { reason: "zuerst" });
        beforeWrite = null;
      };

      const err = await rejection(decide("withdraw", { reason: "zu spät" }));

      expect(err).to.be.instanceOf(ConflictError);
      expect(err.code).to.equal("review_transition_invalid");
      expect(offers.o1.review.reason).to.equal("zuerst");
      expect(history.called).to.be.false;
      expect(outbox.called).to.be.false;
    });
  });

  describe("submitOnPublicationWish", function () {
    const wish = (offer) =>
      ReviewService.submitOnPublicationWish({
        offerType: OFFER_TYPE,
        tenantId: "t1",
        offer: { id: "o1", ...offer },
        actorUserId: "owner@example.test",
      });

    it("submits an offer stored with a publication wish and no status", async function () {
      const result = await wish({ isPublic: true, review: review(null) });

      expect(result.status).to.equal("pending");
      expect(history.calledOnce).to.be.true;
    });

    it("leaves an offer without the wish, or with any status, alone", async function () {
      expect(await wish({ isPublic: false, review: review(null) })).to.equal(
        null,
      );
      for (const status of ["pending", "approved", "rejected"]) {
        expect(await wish({ isPublic: true, review: review(status) })).to.equal(
          null,
        );
      }
      expect(history.called).to.be.false;
    });
  });
});
