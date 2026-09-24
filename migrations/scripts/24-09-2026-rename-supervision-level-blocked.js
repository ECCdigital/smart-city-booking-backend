/**
 * Renames the stored supervision level `blocked` to `pending` (glossary
 * "Freigabe ausstehend", the level's new name) wherever a level is stored:
 *
 *   tenants.supervisionLevel
 *   instances.tenantInitialSupervisionLevel
 *   supervisionhistories.from / .to
 *   supervisionnotifications.payload.from / .to / .supervisionLevel
 *
 * A rename is no level change (glossary "Stufenwechsel"): no history row,
 * no outbox row, no mail, and `supervisionChangedAt` stays. The literal
 * `blocked` is spelled here and nowhere else: the constant is gone, and the
 * API refuses the value. Plain `updateMany` with `$set`, so a rerun finds
 * nothing to rewrite; `down` is a no-op, the old name has no reader left.
 */

const {
  SUPERVISION_LEVELS,
} = require("../../src/commons/services/supervision/supervision-constants");

const FORMER_LEVEL = "blocked";
const LEVEL = SUPERVISION_LEVELS.PENDING;

const LEVEL_FIELDS = [
  { model: "Tenant", fields: ["supervisionLevel"] },
  { model: "Instance", fields: ["tenantInitialSupervisionLevel"] },
  { model: "SupervisionHistory", fields: ["from", "to"] },
  {
    model: "SupervisionNotification",
    fields: ["payload.from", "payload.to", "payload.supervisionLevel"],
  },
];

module.exports = {
  name: "24-09-2026-rename-supervision-level-blocked",

  up: async function (mongoose) {
    for (const { model, fields } of LEVEL_FIELDS) {
      const Model = mongoose.model(model);
      for (const field of fields) {
        await Model.updateMany(
          { [field]: FORMER_LEVEL },
          { $set: { [field]: LEVEL } },
        );
      }
    }
  },

  // Nothing to take back: the old name has no reader.
  down: async function () {},
};
