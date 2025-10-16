const CatalogModel = require("./models/catalogModel");

class CatalogManager {
  static async getCatalogs() {
    const rawCatalogs = await CatalogModel.find();
    return rawCatalogs.map((doc) => doc.toEntity());
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
    return updatedCatalog.toEntity();
  }
}

module.exports = CatalogManager;
