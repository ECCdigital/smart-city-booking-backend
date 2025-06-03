const InstanceManger = require("../../data-managers/instance-manager");
const TenantManager = require("../../data-managers/tenant-manager");
const axios = require("axios");
const UserManager = require("../../data-managers/user-manager");
const { RoleManager } = require("../../data-managers/role-manager");
const { User } = require("../../entities/user");

class SsoService {
  static async handleLogin(token) {
    const instance = await InstanceManger.getInstance();
    const app = instance.applications.find((app) => app.id === "keycloak");
    let kcResponse = await SsoService.verifyToken(token, app);

    let user = await UserManager.getUser(kcResponse.email);

    if (!user) {
      throw { message: "User not found", status: 404 };
    }

    const kcRoles = extractRoles(kcResponse.resource_access);

    if (app.roleMapping.active) {
      await SsoService.mapRoles(user, kcRoles, app);
    }

    user.permissions = await UserManager.getUserPermissions(user.id);

    return user;
  }

  static async handleSignup(token) {
    const instance = await InstanceManger.getInstance();
    const app = instance.applications.find((app) => app.id === "keycloak");
    let kcResponse = await SsoService.verifyToken(token, app);

    if (kcResponse.active === false) {
      throw { message: "User not active", status: 404 };
    }

    let user = await UserManager.getUser(kcResponse.email);
    if (user) {
      throw { message: "User already exist", status: 409 };
    }

    const kcRoles = extractRoles(kcResponse.resource_access);

    const newUser = new User({
      id: kcResponse.email,
      firstName: kcResponse.given_name,
      lastName: kcResponse.family_name,
    });

    newUser.authType = "keycloak";
    newUser.isVerified = true;

    if (app.roleMapping.active) {
      await SsoService.mapRoles(newUser, kcRoles, app);
    }

    await UserManager.signupUser(newUser);
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
      const userRoles = await TenantManager.getTenantUserRoles(
        role.tenantId,
        user.id,
      );

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
        !userRoles.includes(role.tenantRoleId)
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
        userRoles.includes(role.tenantRoleId)
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
        newRoles.push(newRole);
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
  for (const { tenantId, role, action, needsInvite } of roles) {
    if (action === "add") {
      if (needsInvite) {
        await TenantManager.addTenantUser(tenantId, userId);
      }
      await TenantManager.addUserRole(tenantId, userId, role);
    } else if (action === "remove") {
      await TenantManager.removeUserRole(tenantId, userId, role);
    }
  }
}

module.exports = SsoService;
