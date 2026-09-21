const {
  NOTIFICATION_TYPE_VALUES,
  NOTIFICATION_STATUS,
  NOTIFICATION_STATUS_VALUES,
} = require("../services/supervision/supervision-constants");

/**
 * One row of the supervision notification outbox (glossary
 * "Mitteilungsanlass"): an occasion recorded when a supervision event
 * happened, sent later by the outbox sender (ticket 11). Recording is
 * separate from sending, so a failed mail never rolls a decision back.
 */
const supervisionNotificationSchemaDefinition = {
  id: { type: String, required: true, unique: true },
  type: { type: String, enum: NOTIFICATION_TYPE_VALUES, required: true },
  tenantId: { type: String, required: true },
  payload: { type: Object, default: () => ({}) },
  status: {
    type: String,
    enum: NOTIFICATION_STATUS_VALUES,
    default: NOTIFICATION_STATUS.PENDING,
  },
  attempts: { type: Number, default: 0 },
  lastError: { type: String, default: null },
  createdAt: { type: Date, required: true },
  sentAt: { type: Date, default: null },
  dedupeKey: { type: String, default: undefined },
};

module.exports = { supervisionNotificationSchemaDefinition };
