/**
 * The hold of one locker system (glossary "Schließfachanlage") by one
 * process: the key of the locker system, who holds it, and until when.
 * At most one row per key (unique index on the model); a row past
 * `expiresAt` no longer holds and is taken over by the next acquire.
 */
const lockerSystemHoldSchemaDefinition = {
  key: { type: String, required: true },
  holder: { type: String, required: true },
  expiresAt: { type: Date, required: true },
};

module.exports = lockerSystemHoldSchemaDefinition;
