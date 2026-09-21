const { Schema } = require("mongoose");
const {
  OFFER_TYPE_VALUES,
  HISTORY_EVENT_TYPE_VALUES,
  HISTORY_ACTOR_TYPES,
  HISTORY_ACTOR_TYPE_VALUES,
  HISTORY_ORIGINS,
  HISTORY_ORIGIN_VALUES,
} = require("../services/supervision/supervision-constants");

/**
 * One row of the supervision history (glossary "Aufsichtshistorie"): an
 * event at a tenant or one of its offers, with who acted, the old and the
 * new state and an optional reason. Immutable once written.
 */
const supervisionHistorySchemaDefinition = {
  id: { type: String, required: true, unique: true },
  tenantId: { type: String, required: true },
  offerType: {
    type: String,
    enum: [...OFFER_TYPE_VALUES, null],
    default: null,
  },
  offerId: { type: String, default: null },
  eventType: { type: String, enum: HISTORY_EVENT_TYPE_VALUES, required: true },
  occurredAt: { type: Date, required: true },
  actor: {
    type: new Schema(
      {
        type: {
          type: String,
          enum: HISTORY_ACTOR_TYPE_VALUES,
          default: HISTORY_ACTOR_TYPES.SYSTEM,
        },
        userId: { type: String, default: null },
      },
      { _id: false },
    ),
    default: () => ({}),
  },
  from: { type: String, default: null },
  to: { type: String, default: null },
  reason: { type: String, default: null },
  origin: {
    type: String,
    enum: HISTORY_ORIGIN_VALUES,
    default: HISTORY_ORIGINS.API,
  },
  // Set where a retry could write the same row twice (migration, replayed
  // API writes); the unique sparse index refuses the second one.
  dedupeKey: { type: String, default: undefined },
};

module.exports = { supervisionHistorySchemaDefinition };
