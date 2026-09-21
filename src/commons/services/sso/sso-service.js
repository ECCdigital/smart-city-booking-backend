const InstanceManger = require("../../data-managers/instance-manager");
const axios = require("axios");
const UserManager = require("../../data-managers/user-manager");
const { RoleManager } = require("../../data-managers/role-manager");
const { User } = require("../../entities/user/user");
const MembershipManager = require("../../data-managers/membership-manager");

const SSO_PROVIDER = "keycloak";

class SsoService {
  static async handleLogin(token) {
    const instance = await InstanceManger.getInstance();
    const app = instance.applications.find((app) => app.id === "keycloak");
    if (!app) {
      throw { message: "Keycloak not configured", status: 500 };
    }

    const kcResponse = await SsoService.verifyToken(token, app);

    if (kcResponse.active === false) {
      throw { message: "User not active", status: 403 };
    }

    const user = await UserManager.resolveKeycloakUser(kcResponse);

    if (user.isSuspended) {
      throw { message: "User account is suspended", status: 403 };
    }

    await SsoService.recordVerificationProof(user, kcResponse);

    const kcRoles = extractRoles(kcResponse.resource_access);

    if (app.roleMapping?.active) {
      await SsoService.mapRoles(user, kcRoles, app);
    }

    user.permissions = await UserManager.getUserPermissions(user.id);

    return user;
  }

  static async handleSignup(token, legalAcceptance) {
    const instance = await InstanceManger.getInstance();
    const app = instance.applications.find((app) => app.id === "keycloak");
    let kcResponse = await SsoService.verifyToken(token, app);

    if (kcResponse.active === false) {
      throw { message: "User not active", status: 404 };
    }

    try {
      await UserManager.resolveKeycloakUser(kcResponse, {
        syncKeycloakId: false,
      });
      throw { message: "User already exist", status: 409 };
    } catch (error) {
      if (error.status !== 404) {
        throw error;
      }
    }

    const kcRoles = extractRoles(kcResponse.resource_access);

    const newUser = new User({
      id: kcResponse.email,
      firstName: kcResponse.given_name,
      lastName: kcResponse.family_name,
      keycloakId: kcResponse.sub || "",
      legalAcceptance: legalAcceptance,
    });

    newUser.authType = "keycloak";
    // The account is active, but this flag is no verification proof (spec
    // §6.3); the proof is the provider's claim below.
    newUser.isVerified = true;
    if (SsoService.hasConfirmedEmail(kcResponse)) {
      newUser.idpEmailVerifiedAt = new Date();
      newUser.idpEmailVerifiedProvider = SSO_PROVIDER;
    }

    if (app.roleMapping?.active) {
      await SsoService.mapRoles(newUser, kcRoles, app);
    }

    await UserManager.signupUser(newUser);
  }

  /**
   * Whether the identity provider confirmed the e-mail of the token's holder
   * (the OIDC `email_verified` claim in Keycloak's introspection answer).
   */
  static hasConfirmedEmail(claims) {
    return claims?.email_verified === true;
  }

  /**
   * Persists the provider's confirmation as the account's verification proof
   * on a login that carries it. The first proof stands; an account without
   * the claim stays without proof, whatever its historic `isVerified` says.
   */
  static async recordVerificationProof(user, claims) {
    if (user.idpEmailVerifiedAt || !SsoService.hasConfirmedEmail(claims)) {
      return;
    }
    const proof = {
      idpEmailVerifiedAt: new Date(),
      idpEmailVerifiedProvider: SSO_PROVIDER,
    };
    await UserManager.updateUser({ id: user.id, ...proof }, false);
    Object.assign(user, proof);
  }

  static async verifyToken(userToken, app) {
    const url = `${app.serverUrl}/realms/${app.realm}/protocol/openid-connect/token/introspect`;
    const kcResponse = await axios.post(
      url,
      `client_id=${app.privateClient}&client_secret=${app.privateClientSecret}&token=${userToken}`,
      {
        headers: {
          "Content-Type": "application/x-www-form-urlencoded",
        },
      },
    );
    return kcResponse.data;
  }

  static async logout() {
    throw new Error("Method not implemented");
  }

  static async signup() {
    throw new Error("Method not implemented");
  }

  static async mapRoles(user, keycloakRoles, app) {
    const roles = await RoleManager.getRoles();
    const rolesToMap = app.roleMapping.roles;

    async function processRole(role) {
      const membership = await MembershipManager.getMembershipByTenantAndUserID(
        role.tenantId,
        user.id,
      );

      const userRoles = membership ? membership.roles : null;

      if (!userRoles) {
        if (keycloakRoles.includes(role.keycloakRole)) {
          return {
            tenantId: role.tenantId,
            role: role.tenantRoleId,
            action: "add",
            needsInvite: true,
          };
        }
        return;
      }

      if (
        keycloakRoles.includes(role.keycloakRole) &&
        !userRoles.some((r) => r === role.tenantRoleId)
      ) {
        if (!roles.find((tRole) => tRole.id === role.tenantRoleId)) {
          return;
        }
        return {
          tenantId: role.tenantId,
          role: role.tenantRoleId,
          action: "add",
        };
      } else if (
        !keycloakRoles.includes(role.keycloakRole) &&
        userRoles.some((r) => r === role.tenantRoleId)
      ) {
        return {
          tenantId: role.tenantId,
          role: role.tenantRoleId,
          action: "remove",
        };
      }
    }

    const newRoles = [];

    for (const role of rolesToMap) {
      const newRole = await processRole(role);
      if (newRole) {
        newRoles.push({
          tenantId: newRole.tenantId,
          role: newRole.role,
          action: newRole.action,
          needsInvite: newRole.needsInvite,
          status: "active",
          source: "keycloak",
        });
      }
    }

    await updateTenantRoles(newRoles, user.id);
  }
}

function extractRoles(obj) {
  let allRoles = [];
  for (const key in obj) {
    if (obj[key].roles && Array.isArray(obj[key].roles)) {
      allRoles = allRoles.concat(obj[key].roles);
    }
  }
  return allRoles;
}

async function updateTenantRoles(roles, userId) {
  // Group roles by tenantId to handle multiple roles for the same tenant
  const rolesByTenant = {};
  for (const roleObj of roles) {
    if (!rolesByTenant[roleObj.tenantId]) {
      rolesByTenant[roleObj.tenantId] = [];
    }
    rolesByTenant[roleObj.tenantId].push(roleObj);
  }

  // Process each tenant's roles
  for (const tenantId in rolesByTenant) {
    const tenantRoles = rolesByTenant[tenantId];

    // Check if membership exists
    const membership = await MembershipManager.getMembershipByTenantAndUserID(
      tenantId,
      userId,
    );

    // If any role needs to create membership and it doesn't exist, create it once
    if (!membership && tenantRoles.some((r) => r.needsInvite)) {
      await MembershipManager.addMembership(tenantId, {
        userId,
        source: "manually",
        status: "active",
      });
    }

    // Now add all roles for this tenant
    for (const { role, action } of tenantRoles) {
      if (action === "add") {
        await MembershipManager.addRoleToMembership(tenantId, userId, role);
      } else if (action === "remove") {
        await MembershipManager.removeRoleFromMembership(
          tenantId,
          userId,
          role,
        );
      }
    }
  }
}

module.exports = SsoService;
