/**
 * One attempt counted by the rate limiter: the key of the limited subject
 * (e.g. `signup:ip:203.0.113.7`) and when the attempt happened. Rows expire
 * on their own (TTL index on the model); no window may be longer than that.
 */
const rateLimitEventSchemaDefinition = {
  key: { type: String, required: true },
  at: { type: Date, required: true },
};

module.exports = rateLimitEventSchemaDefinition;
