const { Role } = require("../../entities/role/role");
const { RoleManager } = require("../../data-managers/role-manager");

const UNTERNEHMEN_ROLE_ID = "unternehmen";

class CompanyRoleService {
  static async ensureUnternehmenRole(tenantId) {
    const existing = await RoleManager.getRole(UNTERNEHMEN_ROLE_ID, tenantId);
    if (existing) {
      return existing;
    }

    // company authz is via company_members + /me/context, not legacy RBAC
    const role = Role.create({
      id: UNTERNEHMEN_ROLE_ID,
      name: "Unternehmen",
      tenantId,
      adminInterfaces: [],
    });

    return RoleManager.storeRole(role, tenantId);
  }
}

module.exports = { CompanyRoleService };
