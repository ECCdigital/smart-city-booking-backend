/**
 * Adds the new usageOptions fields `filterable` and `detailDisplayPosition`
 * to existing custom field definitions on all three levels
 * (Instance, Tenant, Bookable).
 *
 * - filterable: true when the field was already configured as a catalog filter
 *   (context "catalog" with a catalogFilterType), otherwise false.
 * - detailDisplayPosition: "none" (not shown in detail view by default).
 */

function migrateDefinitions(definitions = []) {
  let changed = false;

  for (const def of definitions) {
    if (!def.usageOptions) {
      def.usageOptions = {};
    }

    const usage = def.usageOptions;

    if (usage.filterable === undefined) {
      usage.filterable =
        usage.context === "catalog" &&
        usage.catalogFilterType !== null &&
        usage.catalogFilterType !== undefined;
      changed = true;
    }

    if (usage.detailDisplayPosition === undefined) {
      usage.detailDisplayPosition = "none";
      changed = true;
    }
  }

  return changed;
}

module.exports = {
  name: "09-06-2026-customfield-filterable-detaildisplay",

  up: async function (mongoose) {
    const Instance = mongoose.model("Instance");
    const Tenant = mongoose.model("Tenant");
    const Bookable = mongoose.model("Bookable");

    const instances = await Instance.find({
      bookableCustomFields: { $exists: true, $ne: [] },
    });
    for (const instance of instances) {
      if (migrateDefinitions(instance.bookableCustomFields)) {
        instance.markModified("bookableCustomFields");
        await instance.save();
      }
    }

    const tenants = await Tenant.find({
      bookableCustomFields: { $exists: true, $ne: [] },
    });
    for (const tenant of tenants) {
      if (migrateDefinitions(tenant.bookableCustomFields)) {
        tenant.markModified("bookableCustomFields");
        await tenant.save();
      }
    }

    const bookables = await Bookable.find({
      customFieldDefinitions: { $exists: true, $ne: [] },
    });
    for (const bookable of bookables) {
      if (migrateDefinitions(bookable.customFieldDefinitions)) {
        bookable.markModified("customFieldDefinitions");
        await bookable.save();
      }
    }
  },

  down: async function (mongoose) {
    const Instance = mongoose.model("Instance");
    const Tenant = mongoose.model("Tenant");
    const Bookable = mongoose.model("Bookable");

    await Instance.updateMany(
      {},
      {
        $unset: {
          "bookableCustomFields.$[].usageOptions.filterable": "",
          "bookableCustomFields.$[].usageOptions.detailDisplayPosition": "",
        },
      },
    );

    await Tenant.updateMany(
      {},
      {
        $unset: {
          "bookableCustomFields.$[].usageOptions.filterable": "",
          "bookableCustomFields.$[].usageOptions.detailDisplayPosition": "",
        },
      },
    );

    await Bookable.updateMany(
      {},
      {
        $unset: {
          "customFieldDefinitions.$[].usageOptions.filterable": "",
          "customFieldDefinitions.$[].usageOptions.detailDisplayPosition": "",
        },
      },
    );
  },
};
