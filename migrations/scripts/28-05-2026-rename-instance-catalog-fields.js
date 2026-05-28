module.exports = {
  name: "28-05-2026-rename-instance-catalog-fields",

  up: async function (mongoose) {
    const Instance = mongoose.model("Instance");

    const instance = await Instance.findOne(
      {},
      { enableCatalog: 1, catalogUrl: 1, publicOffersEnabled: 1, portalUrl: 1 },
    ).lean();

    if (!instance) return;

    const update = {};

    if (
      instance.publicOffersEnabled === undefined &&
      instance.enableCatalog !== undefined
    ) {
      update.publicOffersEnabled = instance.enableCatalog;
    }

    if (
      (instance.portalUrl === undefined || instance.portalUrl === "") &&
      instance.catalogUrl
    ) {
      update.portalUrl = instance.catalogUrl;
    }

    if (Object.keys(update).length > 0) {
      await Instance.updateOne({}, { $set: update });
    }
  },

  down: async function (mongoose) {
    const Instance = mongoose.model("Instance");
    await Instance.updateOne(
      {},
      { $unset: { publicOffersEnabled: "", portalUrl: "" } },
    );
  },
};
