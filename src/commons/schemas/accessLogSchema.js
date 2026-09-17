const { Double } = require("mongodb");
const { Schema } = require("mongoose");
const {
  OPEN_ACTIONS,
  OPEN_ACTION_ORIGINS,
} = require("../services/access/access-open-action");

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
      // Legacy, not written anymore: the unlatch route is gone, rows written
      // before it went stay readable and filterable.
      "unlatch",
      "close",
      "hold",
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
  accessRole: {
    // The capacity somebody operated the door in, as the access decision
    // (`access-decision.js`, `decide`) derived it: `booker` where the booking
    // is theirs or assigned to them, `manager` where they may manage one that
    // is not. It says why `evidenceBypassed` reads the way it does - a `false`
    // there on its own could mean "no manage permission" just as well as
    // "their own booking". Empty where there is no capacity to record: a
    // refused user with no standing at the booking, a status read nobody
    // asked for, scans and provisioning.
    type: String,
    enum: ["booker", "manager", null],
    default: null,
  },
  evidenceBypassed: {
    // `bypassed` of the evidence step (`access-decision.js`, `satisfy`): true
    // only where it means something - the access point did require evidence
    // and the management was let through without it, on a booking that is
    // not their own.
    type: Boolean,
    default: false,
  },
  windowOverridden: {
    // The admin override (`access-decision.js`, `overriddenAccessPointIds`):
    // true only where it means something - the door was past its access
    // window and was closed or read by the manage permission. Written on
    // every row of such a command, success or failure; an open is never
    // overridden.
    type: Boolean,
    default: false,
  },
  openAction: {
    // The Öffnungsart (`access-open-action.js`) that actually went to the
    // lock on an open, whichever provider sent it. Empty where the provider
    // names none, and on rows written before the field existed: blank means
    // "not recorded", as with `evidenceBypassed`. A provider's raw action
    // number (Nuki: `payload.nukiAction`) stays in the payload.
    type: String,
    enum: [...Object.values(OPEN_ACTIONS), null],
    default: null,
  },
  openActionOrigin: {
    // Where that Öffnungsart came from: set on the access point, decided by
    // the device type, or the fallback after a device that could not be read.
    type: String,
    enum: [...Object.values(OPEN_ACTION_ORIGINS), null],
    default: null,
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
