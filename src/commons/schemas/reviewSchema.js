const { Schema } = require("mongoose");
const {
  REVIEW_STATUS_VALUES,
} = require("../services/supervision/supervision-constants");
const { emptyReview } = require("../services/supervision/review-transitions");

/**
 * The review of an offer (glossary "Prüfstatus"), shared by bookables and
 * events. Written by the review service alone (tenant supervision spec
 * §3): never taken from a store or update body, stripped from every public
 * export.
 */
const reviewSchema = new Schema(
  {
    status: {
      type: String,
      enum: [...REVIEW_STATUS_VALUES, null],
      default: null,
    },
    submittedAt: { type: Date, default: null },
    decidedAt: { type: Date, default: null },
    decidedBy: { type: String, default: null },
    reason: { type: String, default: null },
  },
  { _id: false },
);

/** The field definition an offer schema carries as `review`. */
const reviewField = { type: reviewSchema, default: () => emptyReview() };

module.exports = { reviewSchema, reviewField };
