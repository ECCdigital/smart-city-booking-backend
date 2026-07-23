module.exports = {
  name: "28-05-2026-add-branding-favicon-url",

  up: async function (mongoose) {
    const Instance = mongoose.model("Instance");

    // Setzt `branding.faviconUrl` auf "" für alle Instanzen, in denen das
    // Feld bislang nicht existiert (z.B. weil eine ältere Variante des
    // add-instance-branding-Skripts bereits gelaufen ist).
    await Instance.updateOne(
      { "branding.faviconUrl": { $exists: false } },
      { $set: { "branding.faviconUrl": "" } },
    );
  },

  down: async function (mongoose) {
    const Instance = mongoose.model("Instance");
    await Instance.updateOne({}, { $unset: { "branding.faviconUrl": "" } });
  },
};
