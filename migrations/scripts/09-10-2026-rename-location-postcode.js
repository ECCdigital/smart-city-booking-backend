/**
 * The address of a location keeps its postcode under `postcode` only
 * (ECCdigital/tickets#373): the Admin UI has always written `postcode`, the
 * old schema default and the legacy migrations wrote `post_code`. On events
 * and bookables that carry both, a non-empty `postcode` wins and `post_code`
 * is dropped; everywhere else `post_code` is renamed. Idempotent: a second
 * run finds no `post_code`.
 */
const MODELS = ["Event", "Bookable"];

const POST_CODE = "location.address.post_code";
const POSTCODE = "location.address.postcode";

module.exports = {
  name: "09-10-2026-rename-location-postcode",

  up: async function (mongoose) {
    for (const name of MODELS) {
      const Model = mongoose.model(name);

      await Model.updateMany(
        {
          [POST_CODE]: { $exists: true },
          [POSTCODE]: { $nin: [null, ""] },
        },
        { $unset: { [POST_CODE]: "" } },
        { strict: false },
      );

      await Model.updateMany(
        { [POST_CODE]: { $exists: true } },
        { $rename: { [POST_CODE]: POSTCODE } },
        { strict: false },
      );
    }
  },

  down: async function (mongoose) {
    for (const name of MODELS) {
      await mongoose
        .model(name)
        .updateMany(
          { [POSTCODE]: { $exists: true } },
          { $rename: { [POSTCODE]: POST_CODE } },
          { strict: false },
        );
    }
  },
};
