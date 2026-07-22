const CompanyBranch = require("../entities/company/companyBranch");
const CompanyBranchModel = require("./models/companyBranchModel");

class CompanyBranchManager {
  static async getBranchesByCompany(tenantId, companyId) {
    const raw = await CompanyBranchModel.find({ tenantId, companyId }).sort({
      created: 1,
    });
    return raw.map((doc) => doc.toEntity());
  }

  static async getBranch(tenantId, id) {
    const raw = await CompanyBranchModel.findOne({ tenantId, id });
    if (!raw) {
      return null;
    }
    return raw.toEntity();
  }

  static async storeBranch(branch, upsert = true) {
    const branchEntity =
      branch instanceof CompanyBranch ? branch : new CompanyBranch(branch);
    branchEntity.validate();
    await CompanyBranchModel.updateOne(
      { id: branchEntity.id, tenantId: branchEntity.tenantId },
      { ...branchEntity },
      { upsert, runValidators: true },
    );
    return branchEntity;
  }

  static async removeBranch(tenantId, id) {
    await CompanyBranchModel.deleteOne({ tenantId, id });
  }
  static async countByField(tenantId, field, value) {
    return CompanyBranchModel.countDocuments({ tenantId, [field]: value });
  }
  static async countByDistrict(tenantId) {
    const rows = await CompanyBranchModel.aggregate([
      { $match: { tenantId, districtId: { $nin: [null, ""] } } },
      { $group: { _id: "$districtId", count: { $sum: 1 } } },
    ]);
    return rows.map((row) => ({ districtId: row._id, count: row.count }));
  }
}

module.exports = CompanyBranchManager;
