const CatalogModel = require("./models/catalogModel");

class CatalogManager {
  static async getCatalogs() {
    const rawCatalogs = await CatalogModel.find();
    return rawCatalogs.map((doc) => doc.toEntity());
  }

  static async getInstanceCatalog() {
    const rawCatalog = await CatalogModel.findOne({ type: "instance" });
    if (!rawCatalog) {
      return null;
    }
    return rawCatalog.toEntity();
  }

  static async getCatalogByTenant(tenantId) {
    const rawCatalog = await CatalogModel.findOne({ tenantId });
    if (!rawCatalog) {
      return null;
    }
    return rawCatalog.toEntity();
  }

  static async getCatalogBySlug(catalogSlug) {
    const rawCatalog = await CatalogModel.findOne({ slug: catalogSlug });

    if (!rawCatalog) {
      return null;
    }

    return rawCatalog.toEntity();
  }

  /**
   * Whether an image Block of the stored Hero Layout holds a medium — one half
   * of the Hero as a usage site (hero-layout spec §6); the other, the
   * Background, sits on the instance branding.
   *
   * Only the stored layout is searched. A medium in the *derived* Default Hero
   * Layout is the branding logo, which reports as an instance site of its own.
   *
   * The instance catalog is a singleton, so the search needs no tenant: a
   * tenant medium that somehow ended up in the Hero is found the same way, and
   * blocking its deletion is the safe answer.
   *
   * @param {string} mediaId - Id of the medium.
   * @returns {Promise<boolean>}
   */
  static async hasHeroLayoutMedia(mediaId) {
    if (!mediaId) {
      return false;
    }

    const raw = await CatalogModel.findOne(
      { type: "instance", "heroLayout.blocks.image.mediaId": mediaId },
      { _id: 1 },
    ).lean();

    return Boolean(raw);
  }

  /**
   * The instance catalog as the site the Hero reports under. Its two halves
   * live in different documents but are one place to an admin — the Hero
   * editor — so both report as this one entry, titled with the Portal Name.
   *
   * @returns {Promise<?{id: string, title: string}>} The site, or null while
   *   the instance has no catalog.
   */
  static async getHeroSite() {
    const raw = await CatalogModel.findOne(
      { type: "instance" },
      { name: 1 },
    ).lean();

    return raw ? { id: String(raw._id), title: raw.name ?? "" } : null;
  }

  static async createCatalog(catalogData) {
    const newCatalog = await CatalogModel.create(catalogData);
    return newCatalog.toEntity();
  }

  static async updateCatalog(catalogData, filter = {}) {
    const updatedCatalog = await CatalogModel.findOneAndUpdate(
      filter,
      catalogData,
      { new: true },
    );
    if (!updatedCatalog) {
      return null;
    }
    return updatedCatalog.toEntity();
  }
}

module.exports = CatalogManager;
