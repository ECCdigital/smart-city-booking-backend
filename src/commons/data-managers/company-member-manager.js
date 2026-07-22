const CompanyMember = require("../entities/company/companyMember");
const CompanyMemberModel = require("./models/companyMemberModel");

class CompanyMemberManager {
  static async getMembersByCompany(tenantId, companyId) {
    const raw = await CompanyMemberModel.find({ tenantId, companyId });
    return raw.map((doc) => doc.toEntity());
  }

  static async getMemberByUser(tenantId, userId) {
    const raw = await CompanyMemberModel.findOne({ tenantId, userId });
    if (!raw) {
      return null;
    }
    return raw.toEntity();
  }

  static async storeMember(member, upsert = true) {
    const memberEntity =
      member instanceof CompanyMember ? member : new CompanyMember(member);
    memberEntity.validate();
    await CompanyMemberModel.updateOne(
      {
        tenantId: memberEntity.tenantId,
        companyId: memberEntity.companyId,
        userId: memberEntity.userId,
      },
      { ...memberEntity },
      { upsert, setDefaultsOnInsert: true, runValidators: true },
    );
    return memberEntity;
  }

  static async removeMember(tenantId, companyId, userId) {
    await CompanyMemberModel.deleteOne({ tenantId, companyId, userId });
  }
}

module.exports = CompanyMemberManager;
