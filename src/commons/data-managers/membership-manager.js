const MembershipModel = require("./models/membershipModel");
const Membership = require("../entities/tenant/membership");
const { normalizeUserId } = require("../utilities/user-id-utils");

class MembershipManager {
  static async getMemberships() {
    const rawMemberships = await MembershipModel.find({});
    return rawMemberships.map((raw) => raw.toEntity());
  }

  static async getMembershipsByTenantID(tenantID) {
    const rawMemberships = await MembershipModel.find({ tenantId: tenantID });
    return rawMemberships.map((raw) => raw.toEntity());
  }

  static async getMembershipsByUserID(userID) {
    const rawMembership = await MembershipModel.find({
      userId: normalizeUserId(userID),
    });
    if (!rawMembership) return [];
    return rawMembership.map((raw) => raw.toEntity());
  }

  static async getMembershipByTenantAndUserID(tenantID, userID) {
    const rawMembership = await MembershipModel.findOne({
      tenantId: tenantID,
      userId: normalizeUserId(userID),
    });
    if (!rawMembership) {
      return null;
    }
    return rawMembership.toEntity();
  }

  static async getMembershipsByTenantAndRoles(tenantID, roles) {
    const rawMemberships = await MembershipModel.find({
      tenantId: tenantID,
      roles: { $in: roles },
    });
    return rawMemberships.map((raw) => raw.toEntity());
  }

  static async addMembership(tenantID, membership) {
    const newMembership = new Membership({
      tenantId: tenantID,
      ...membership,
    });
    const savedMembership = await MembershipModel.create(newMembership);
    return savedMembership.toEntity();
  }

  static async addRoleToMembership(tenantID, userID, role) {
    await MembershipModel.updateOne(
      { tenantId: tenantID, userId: normalizeUserId(userID) },
      { $addToSet: { roles: role } },
    );
  }

  static async setRolesForMembership(tenantID, userID, roles) {
    await MembershipModel.updateOne(
      { tenantId: tenantID, userId: normalizeUserId(userID) },
      { $set: { roles: roles } },
    );
  }

  static async removeRoleFromMembership(tenantID, userID, role) {
    await MembershipModel.updateOne(
      { tenantId: tenantID, userId: normalizeUserId(userID) },
      { $pull: { roles: role } },
    );
  }

  static async removeMembership(tenantID, userID) {
    await MembershipModel.deleteOne({
      tenantId: tenantID,
      userId: normalizeUserId(userID),
    });
  }

  static async updateMembership(tenantID, userID, updates) {
    await MembershipModel.updateOne(
      { tenantId: tenantID, userId: normalizeUserId(userID) },
      { $set: updates },
    );
  }

  static async reassignUserId(previousUserId, newUserId, session = null) {
    const options = session ? { session } : {};
    await MembershipModel.updateMany(
      { userId: normalizeUserId(previousUserId) },
      { $set: { userId: normalizeUserId(newUserId) } },
      options,
    );
  }
}

module.exports = MembershipManager;
