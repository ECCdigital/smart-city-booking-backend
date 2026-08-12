const { Double } = require("mongodb");
const { Schema } = require("mongoose");

const accessLogActorSchemaDefinition = {
  userId: { type: String, default: null },
  source: {
    type: String,
    enum: ["user", "system", "webhook"],
    default: "system",
  },
};

const accessLogSchemaDefinition = {
  id: { type: String, required: true, unique: true },
  tenantId: { type: String, required: true, ref: "Tenant" },
  bookingId: { type: String, default: null },
  accessPointId: { type: String, default: null },
  accessPointType: {
    type: String,
    enum: ["locker", "door"],
    default: null,
  },
  provider: { type: String, default: null },
  externalId: { type: String, default: null },
  action: {
    type: String,
    enum: [
      "open",
      "unlatch",
      "close",
      "provision",
      "revoke",
      "status",
      "webhook",
      "scan",
    ],
    required: true,
  },
  actor: {
    type: new Schema(accessLogActorSchemaDefinition, { _id: false }),
    default: () => ({}),
  },
  result: {
    // `denied` means the attempt was refused before the provider was
    // contacted, `failure` a provider error after the checks had passed.
    type: String,
    enum: ["success", "failure", "denied", "pending"],
    default: "pending",
  },
  blockingReasons: { type: [String], default: [] },
  channel: {
    // How the client says it reached the door (`qrScan`, `remote`). Reported by
    // the client and stored as reported: it is diagnostic context for reading
    // the audit, never part of the access decision.
    type: String,
    default: null,
  },
  evidenceBypassed: {
    // True only where it means something: the access point did require
    // evidence and a user with the manage-bookings permission was let through
    // without it.
    type: Boolean,
    default: false,
  },
  payload: { type: Object, default: {} },
  errorCode: { type: String, default: null },
  errorMessage: { type: String, default: null },
  timestamp: { type: Double, default: () => Date.now() },
  expiresAt: { type: Date, default: null },
};

module.exports = {
  accessLogSchemaDefinition,
  accessLogActorSchemaDefinition,
};
