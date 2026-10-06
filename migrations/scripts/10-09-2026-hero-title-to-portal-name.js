/**
 * The Hero of a Catalog is a Hero Layout now (hero-layout spec, §7): the two
 * text fields `hero.title` and `hero.subtitle` are gone. The title of the
 * instance catalog becomes its Portal Name where none is set; the subtitle is
 * dropped - the slogan of the Default Hero Layout replaces it. Every catalog
 * carried `hero` through the old schema default, so the key is removed from
 * all of them. Idempotent: a second run finds a name and no `hero` key.
 */
module.exports = {
  name: "10-09-2026-hero-title-to-portal-name",

  up: async function (mongoose) {
    const Catalog = mongoose.model("Catalog");

    const instance = await Catalog.findOne(
      { type: "instance" },
      { name: 1, hero: 1 },
    ).lean();

    const title = instance?.hero?.title?.trim();

    if (instance && !instance.name?.trim() && title) {
      await Catalog.updateOne({ _id: instance._id }, { $set: { name: title } });
    }

    // `hero` is no longer in the schema, so the unset has to bypass strict.
    await Catalog.updateMany(
      { hero: { $exists: true } },
      { $unset: { hero: "" } },
      { strict: false },
    );
  },

  down: async function (mongoose) {
    const Catalog = mongoose.model("Catalog");

    const instance = await Catalog.findOne(
      { type: "instance" },
      { name: 1 },
    ).lean();

    if (!instance) return;

    await Catalog.updateOne(
      { _id: instance._id },
      { $set: { hero: { title: instance.name ?? "", subtitle: "" } } },
      { strict: false },
    );
  },
};
