const mongoose = require("mongoose");
const def = require("../../schemas/rateLimitEventSchema");

const { Schema } = mongoose;

/** Rows outlive the longest window the limiter is configured with (7 days). */
const EVENT_TTL_SECONDS = 7 * 24 * 60 * 60;

const RateLimitEventSchema = new Schema(def, { versionKey: false });

RateLimitEventSchema.index({ key: 1, at: 1 });
RateLimitEventSchema.index(
  { at: 1 },
  { expireAfterSeconds: EVENT_TTL_SECONDS },
);

module.exports =
  mongoose.models.RateLimitEvent ||
  mongoose.model("RateLimitEvent", RateLimitEventSchema);
module.exports.EVENT_TTL_SECONDS = EVENT_TTL_SECONDS;
