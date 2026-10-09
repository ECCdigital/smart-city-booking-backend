/**
 * The address of a location keeps its postcode under `postcode` only
 * (ECCdigital/tickets#373): the Admin UI has always written `postcode`, the
 * old schema default and the legacy migrations wrote `post_code`. On events
 * and bookables that carry both, a non-empty `postcode` wins and `post_code`
 * is dropped; everywhere else `post_code` is renamed. Idempotent: a second
 * run finds no `post_code`.
 */
const MODELS = ["Event", "Bookable"];

const LEGACY_KEY = "location.address.post_code";
const KEY = "location.address.postcode";

module.exports = {
  name: "09-10-2026-rename-location-postcode",

  up: async function (mongoose) {
    for (const name of MODELS) {
      const Model = mongoose.model(name);

      await Model.updateMany(
        {
          [LEGACY_KEY]: { $exists: true },
          [KEY]: { $nin: [null, ""] },
        },
        { $unset: { [LEGACY_KEY]: "" } },
        { strict: false },
      );

      await Model.updateMany(
        { [LEGACY_KEY]: { $exists: true } },
        { $rename: { [LEGACY_KEY]: KEY } },
        { strict: false },
      );
    }
  },

  down: async function (mongoose) {
    for (const name of MODELS) {
      await mongoose
        .model(name)
        .updateMany(
          { [KEY]: { $exists: true } },
          { $rename: { [KEY]: LEGACY_KEY } },
          { strict: false },
        );
    }
  },
};
