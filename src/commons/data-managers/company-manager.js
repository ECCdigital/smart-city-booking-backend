const Company = require("../entities/company/company");
const CompanyModel = require("./models/companyModel");
const { escapeRegex } = require("../utilities/regexUtils");

class CompanyManager {
  static async getCompanies(tenantId, filter = {}) {
    const rawCompanies = await CompanyModel.find({ tenantId, ...filter });
    return rawCompanies.map((doc) => doc.toEntity());
  }

  // paginated, name-searched admin list → { page, total }
  static async getCompaniesPage(tenantId, { status, q, limit, offset } = {}) {
    const query = { tenantId };
    if (status) {
      query.status = status;
    }
    if (q) {
      query.name = { $regex: escapeRegex(q), $options: "i" };
    }
    const total = await CompanyModel.countDocuments(query);
    const raw = await CompanyModel.find(query)
      .sort({ name: 1 })
      .skip(offset || 0)
      .limit(limit);
    return { items: raw.map((doc) => doc.toEntity()), total };
  }

  static async getCompany(tenantId, id) {
    const rawCompany = await CompanyModel.findOne({ tenantId, id });
    if (!rawCompany) {
      return null;
    }
    return rawCompany.toEntity();
  }

  static async getCompanyIdsByName(tenantId, name) {
    const raw = await CompanyModel.find(
      { tenantId, name: { $regex: escapeRegex(name), $options: "i" } },
      { id: 1, _id: 0 },
    );
    return raw.map((doc) => doc.id);
  }

  static async getBlockedCompanyIds(tenantId) {
    const raw = await CompanyModel.find(
      { tenantId, status: "blocked" },
      { id: 1, _id: 0 },
    );
    return raw.map((doc) => doc.id);
  }

  static async storeCompany(company, upsert = true) {
    const companyEntity =
      company instanceof Company ? company : new Company(company);
    companyEntity.validate();
    await CompanyModel.updateOne(
      { id: companyEntity.id, tenantId: companyEntity.tenantId },
      { ...companyEntity },
      { upsert, setDefaultsOnInsert: true, runValidators: true },
    );
    return companyEntity;
  }

  static async setStatus(tenantId, id, status) {
    await CompanyModel.updateOne({ tenantId, id }, { $set: { status } });
  }

  static async setLogo(tenantId, id, logoUrl) {
    await CompanyModel.updateOne({ tenantId, id }, { $set: { logoUrl } });
  }

  static async deleteCompany(tenantId, id) {
    await CompanyModel.deleteOne({ tenantId, id });
  }
  static async countByDistrict(tenantId) {
    const rows = await CompanyModel.aggregate([
      { $match: { tenantId, districtId: { $nin: [null, ""] } } },
      { $group: { _id: "$districtId", count: { $sum: 1 } } },
    ]);
    return rows.map((row) => ({ districtId: row._id, count: row.count }));
  }
  static async countByField(tenantId, field, value) {
    return CompanyModel.countDocuments({ tenantId, [field]: value });
  }
}

module.exports = CompanyManager;
