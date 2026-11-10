/**
 * The members of the roles a tenant names for the staff's notices of
 * customer uploads, over the lifecycle harness.
 */

const sinon = require("sinon");

const MembershipManager = require("../../src/commons/data-managers/membership-manager");

/**
 * The active members of the tenant's roles, by role id; the harness stubs
 * `getMembershipsByTenantAndRoles` to answer none.
 *
 * @param {Object<string, string[]>} membersOf User ids by role id
 */
function installRoleMembers(membersOf) {
  MembershipManager.getMembershipsByTenantAndRoles.callsFake(
    async (tenantId, roleIds) =>
      roleIds.flatMap((roleId) =>
        (membersOf[roleId] || []).map((userId) => ({
          tenantId,
          userId,
          status: "active",
        })),
      ),
  );
}

module.exports = { installRoleMembers };
