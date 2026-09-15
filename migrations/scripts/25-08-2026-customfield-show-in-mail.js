/**
 * Adds the new usageOptions field `showInMail` to existing custom field
 * definitions on all three levels (Instance, Tenant, Bookable).
 *
 * - showInMail: false (custom field values are opt-in for booking mails,
 *   so existing tenants see no behavior change).
 */

function migrateDefinitions(definitions = []) {
  let changed = false;

  for (const def of definitions) {
    if (!def.usageOptions) {
      def.usageOptions = {};
    }

    if (def.usageOptions.showInMail === undefined) {
      def.usageOptions.showInMail = false;
      changed = true;
    }
  }

  return changed;
}

module.exports = {
  name: "25-08-2026-customfield-show-in-mail",

  migrateDefinitions,

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
          "bookableCustomFields.$[].usageOptions.showInMail": "",
        },
      },
    );

    await Tenant.updateMany(
      {},
      {
        $unset: {
          "bookableCustomFields.$[].usageOptions.showInMail": "",
        },
      },
    );

    await Bookable.updateMany(
      {},
      {
        $unset: {
          "customFieldDefinitions.$[].usageOptions.showInMail": "",
        },
      },
    );
  },
};
