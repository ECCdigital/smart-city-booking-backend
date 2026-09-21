/**
 * The review transitions of an offer (tenant supervision spec §4): every
 * row of the transition table, the no-op of a repeated submission, and a
 * conflict for everything the table does not list.
 */

const { expect } = require("chai");

const {
  applyReviewTransition,
  REVIEW_ACTIONS,
  emptyReview,
} = require("../src/commons/services/supervision/review-transitions");
const { ConflictError } = require("../src/errors/BaseError");

const NOW = new Date("2026-09-21T10:00:00.000Z");
const EARLIER = new Date("2026-09-01T10:00:00.000Z");
const ACTOR = "admin@example.test";

const review = (status, overrides = {}) => ({
  status,
  submittedAt: null,
  decidedAt: null,
  decidedBy: null,
  reason: null,
  ...overrides,
});

const apply = (from, action, options = {}) =>
  applyReviewTransition(from, action, {
    now: NOW,
    actorUserId: ACTOR,
    ...options,
  });

const conflictOf = (from, action) => {
  try {
    apply(from, action);
  } catch (err) {
    return err;
  }
  throw new Error(`expected ${from?.status} + ${action} to conflict`);
};

describe("review transitions", function () {
  it("names the actions of the spec", function () {
    expect(REVIEW_ACTIONS).to.deep.equal({
      SUBMIT: "submit",
      APPROVE: "approve",
      REJECT: "reject",
      WITHDRAW: "withdraw",
    });
    expect(emptyReview()).to.deep.equal(review(null));
  });

  it("submits an offer without a review status as pending with the submission time", function () {
    const { review: next, changed } = apply(review(null), "submit");

    expect(changed).to.equal(true);
    expect(next).to.deep.equal(review("pending", { submittedAt: NOW }));
  });

  it("submits a missing review object the same way", function () {
    const { review: next } = apply(undefined, "submit");

    expect(next.status).to.equal("pending");
    expect(next.submittedAt).to.equal(NOW);
  });

  it("repeats a submission on a pending offer as a no-op that keeps the waiting time", function () {
    const from = review("pending", { submittedAt: EARLIER });

    const { review: next, changed } = apply(from, "submit");

    expect(changed).to.equal(false);
    expect(next).to.deep.equal(from);
  });

  it("resubmits a rejected offer as pending with a new submission time and no decision", function () {
    const from = review("rejected", {
      submittedAt: EARLIER,
      decidedAt: EARLIER,
      decidedBy: ACTOR,
      reason: "Unvollständig",
    });

    const { review: next, changed } = apply(from, "submit");

    expect(changed).to.equal(true);
    expect(next).to.deep.equal(review("pending", { submittedAt: NOW }));
  });

  it("approves and rejects a pending offer with actor, time and a trimmed reason", function () {
    const from = review("pending", { submittedAt: EARLIER });

    const approved = apply(from, "approve", { reason: "  passt  " });
    expect(approved.changed).to.equal(true);
    expect(approved.review).to.deep.equal(
      review("approved", {
        submittedAt: EARLIER,
        decidedAt: NOW,
        decidedBy: ACTOR,
        reason: "passt",
      }),
    );

    const rejected = apply(from, "reject");
    expect(rejected.review).to.deep.equal(
      review("rejected", {
        submittedAt: EARLIER,
        decidedAt: NOW,
        decidedBy: ACTOR,
        reason: null,
      }),
    );
  });

  it("withdraws an approval into rejected", function () {
    const from = review("approved", {
      submittedAt: EARLIER,
      decidedAt: EARLIER,
      decidedBy: "other@example.test",
      reason: "ok",
    });

    const { review: next } = apply(from, "withdraw", { reason: "Beschwerde" });

    expect(next).to.deep.equal(
      review("rejected", {
        submittedAt: EARLIER,
        decidedAt: NOW,
        decidedBy: ACTOR,
        reason: "Beschwerde",
      }),
    );
  });

  it("corrects a rejection into approved without a new submission", function () {
    const from = review("rejected", {
      submittedAt: EARLIER,
      decidedAt: EARLIER,
      decidedBy: ACTOR,
      reason: "nein",
    });

    const { review: next } = apply(from, "approve");

    expect(next).to.deep.equal(
      review("approved", {
        submittedAt: EARLIER,
        decidedAt: NOW,
        decidedBy: ACTOR,
        reason: null,
      }),
    );
  });

  it("refuses every transition the table does not list as a conflict naming from and action", function () {
    const cases = [
      [review(null), "approve"],
      [review(null), "reject"],
      [review(null), "withdraw"],
      [review("pending"), "withdraw"],
      [review("approved"), "submit"],
      [review("approved"), "approve"],
      [review("approved"), "reject"],
      [review("rejected"), "reject"],
      [review("rejected"), "withdraw"],
    ];
    for (const [from, action] of cases) {
      const err = conflictOf(from, action);
      expect(err, `${from.status} + ${action}`).to.be.instanceOf(ConflictError);
      expect(err.code).to.equal("review_transition_invalid");
      expect(err.params).to.deep.equal({ from: from.status, action });
    }
  });

  it("refuses an unknown action as a bad request", function () {
    expect(() => apply(review(null), "publish")).to.throw(
      /invalid_review_action/,
    );
  });

  it("stores a blank reason as none", function () {
    const { review: next } = apply(review("pending"), "approve", {
      reason: "   ",
    });
    expect(next.reason).to.equal(null);
  });
});
