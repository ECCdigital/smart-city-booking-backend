/**
 * A blacklist entry (glossary „Blacklist-Eintrag“, ECCdigital/tickets#625):
 * an exact address or a whole domain (with a leading `@`) the instance
 * owner keeps for every tenant of the instance. Value and kind are fixed
 * once the entry is stored; the reason may change. `suspendedUserIds` are
 * the accounts the entry suspended when it was added. There is no expiry.
 */

const BlacklistEntryKind = Object.freeze({
  ADDRESS: "address",
  DOMAIN: "domain",
});

/** Where an entry comes from; a suspension and reports follow. */
const BLACKLIST_ENTRY_ORIGINS = Object.freeze({ MANUAL: "manual" });

const blacklistEntrySchemaDefinition = {
  id: { type: String, required: true },
  value: { type: String, required: true },
  kind: {
    type: String,
    required: true,
    enum: Object.values(BlacklistEntryKind),
  },
  reason: { type: String, required: true },
  createdAt: { type: Number, required: true },
  createdBy: { type: String, required: true },
  origin: {
    type: String,
    required: true,
    enum: Object.values(BLACKLIST_ENTRY_ORIGINS),
  },
  suspendedUserIds: { type: [String], default: [] },
};

module.exports = {
  blacklistEntrySchemaDefinition,
  BlacklistEntryKind,
  BLACKLIST_ENTRY_ORIGINS,
};
