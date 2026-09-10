const TaxonomyTermModel = require("./models/taxonomyTermModel");

class TaxonomyTermManager {
  static async getTerm(tenantId, id) {
    const raw = await TaxonomyTermModel.findOne({ tenantId, id });
    if (!raw) {
      return null;
    }
    return raw.toEntity();
  }

  static async getTerms(tenantId, { type, activeOnly = true } = {}) {
    const query = { tenantId };
    if (type) {
      query.type = type;
    }
    if (activeOnly) {
      query.active = true;
    }
    const raw = await TaxonomyTermModel.find(query).sort({
      type: 1,
      sortOrder: 1,
    });
    return raw.map((doc) => doc.toEntity());
  }
  static async createTerm(term) {
    const doc = await TaxonomyTermModel.create(term);
    return doc.toEntity();
  }

  static async updateTerm(tenantId, id, patch) {
    await TaxonomyTermModel.updateOne({ tenantId, id }, { $set: patch });
    return TaxonomyTermManager.getTerm(tenantId, id);
  }

  static async removeTerm(tenantId, id) {
    const res = await TaxonomyTermModel.deleteOne({ tenantId, id });
    return res.deletedCount > 0;
  }

  static async setSortOrders(tenantId, updates) {
    await Promise.all(
      updates.map((u) =>
        TaxonomyTermModel.updateOne(
          { tenantId, id: u.id },
          { $set: { sortOrder: u.sortOrder } },
        ),
      ),
    );
  }
}

module.exports = TaxonomyTermManager;
