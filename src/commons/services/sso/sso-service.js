const TenantManager = require("../../data-managers/tenant-manager");
const axios = require("axios");
const UserManager = require("../../data-managers/user-manager");
const RoleManager = require("../../data-managers/role-manager");
const { User } = require("../../entities/user");

class SsoService {
  static async handleLogin(tenant, token) {
    const app = await TenantManager.getTenantApp(tenant, "keycloak");
    let kcResponse = await SsoService.verifyToken(tenant, token, app);

    let user = await UserManager.getUser(kcResponse.email, tenant);

    if (!user) {
      throw { message: "User not found", status: 404 };
    }

    const kcRoles = extractRoles(kcResponse.resource_access);

    if (app.roleMapping.active) {
      user.roles = await SsoService.mapRoles(tenant, user, kcRoles, app);
      await UserManager.updateUser(user);
      user = await UserManager.getUser(user.id, user.tenant);
    }

    user.permissions = await UserManager.getUserPermissions(
      user.id,
      user.tenant,
    );

    return user;
  }

  static async handleSignup(tenant, token) {
    const app = await TenantManager.getTenantApp(tenant, "keycloak");
    let kcResponse = await SsoService.verifyToken(tenant, token, app);

    if (kcResponse.active === false) {
      throw { message: "User not active", status: 404 };
    }

    let user = await UserManager.getUser(kcResponse.email, tenant);
    if (user) {
      throw { message: "User already exist", status: 409 };
    }

    const kcRoles = extractRoles(kcResponse.resource_access);

    const newUser = new User(
      kcResponse.email,
      undefined,
      tenant,
      kcResponse.given_name,
      kcResponse.family_name,
    );

    newUser.roles = [];
    newUser.authType = "keycloak";
    newUser.isVerified = true;

    if (app.roleMapping.active) {
      newUser.roles = await SsoService.mapRoles(tenant, newUser, kcRoles, app);
    }

    await UserManager.signupUser(newUser);
  }

  static async verifyToken(tenantId, userToken, app) {
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

  static async mapRoles(tenantId, user, keycloakRoles, app) {
    const tenantRoles = await RoleManager.getRoles();
    const rolesToMap = app.roleMapping.roles;
    const userRoles = user.roles;
    rolesToMap.forEach((role) => {
      if (
        keycloakRoles.includes(role.keycloakRole) &&
        !userRoles.includes(role.tenantRoleId)
      ) {
        if (!tenantRoles.find((tRole) => tRole.id === role.tenantRoleId)) {
          return;
        }
        userRoles.push(role.tenantRoleId);
      } else if (
        !keycloakRoles.includes(role.keycloakRole) &&
        userRoles.includes(role.tenantRoleId)
      ) {
        userRoles.splice(userRoles.indexOf(role.tenantRoleId), 1);
      }
    });
    return userRoles;
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

module.exports = SsoService;
