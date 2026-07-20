const TENANT_ID = "praktikum-kielregion";

module.exports = {
  name: "25-06-2026-seed-kielregion-tenant",

  up: async function (mongoose) {
    const Tenant = mongoose.model("Tenant");
    const existing = await Tenant.findOne({ id: TENANT_ID });
    if (!existing) {
      await Tenant.create({
        id: TENANT_ID,
        name: "KielRegion GmbH",
        location: "Haßstraße 3-5, 24103 Kiel",
        mail: "info@kielregion.de",
        phone: "+49 431 55 60 01-0",
        platform: "praktikumsboerse",
        catalogParticipation: { visible: false },
      });
    }
  },

  down: async function (mongoose) {
    const Tenant = mongoose.model("Tenant");
    await Tenant.deleteOne({ id: TENANT_ID });
  },
};
