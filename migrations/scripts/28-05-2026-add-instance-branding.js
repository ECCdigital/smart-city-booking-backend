module.exports = {
  name: "28-05-2026-add-instance-branding",

  up: async function (mongoose) {
    const Catalog = mongoose.model("Catalog");
    const Instance = mongoose.model("Instance");

    const instanceCatalog = await Catalog.findOne({ type: "instance" }).lean();

    // Das frühere `catalog.theme.active` wandert auf `branding.active`.
    // Die Farben (`colors`) bleiben unter `branding.theme.colors`.
    const legacyTheme = instanceCatalog?.theme ?? {};
    const branding = {
      active: legacyTheme.active ?? false,
      theme: {
        colors: legacyTheme.colors ?? { primary: "", secondary: "" },
      },
      logoUrl: instanceCatalog?.logoUrl ?? "",
    };

    await Instance.updateOne(
      { branding: { $exists: false } },
      { $set: { branding } },
    );
  },

  down: async function (mongoose) {
    const Instance = mongoose.model("Instance");
    await Instance.updateOne({}, { $unset: { branding: "" } });
  },
};
