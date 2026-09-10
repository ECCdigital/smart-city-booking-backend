const bunyan = require("bunyan");
const AdminAccessService = require("../../../commons/services/admin-access/admin-access-service");

const logger = bunyan.createLogger({
  name: "admin-access-controller.js",
  level: process.env.LOG_LEVEL,
});

function fail(response, error, fallback) {
  logger.error(fallback, error);
  const status = error.status || error.statusCode || 500;
  // only echo the message for client errors; a 5xx may carry internal detail
  const body = status < 500 ? error.message || fallback : fallback;
  return response.status(status).send(body);
}

class AdminAccessController {
  static async getPermissions(request, response) {
    try {
      return response.status(200).send(AdminAccessService.getCatalog());
    } catch (error) {
      return fail(response, error, "Could not load permission catalog");
    }
  }

  static async getMe(request, response) {
    try {
      const tenantId = request.params.tenant;
      const me = await AdminAccessService.getMe(request.user.id, tenantId);
      return response.status(200).send(me);
    } catch (error) {
      return fail(response, error, "Could not load admin context");
    }
  }

  static async listRoles(request, response) {
    try {
      const tenantId = request.params.tenant;
      return response
        .status(200)
        .send(await AdminAccessService.listRoles(tenantId));
    } catch (error) {
      return fail(response, error, "Could not list roles");
    }
  }

  static async createRole(request, response) {
    try {
      const tenantId = request.params.tenant;
      const role = await AdminAccessService.createRole(
        tenantId,
        request.body || {},
      );
      return response.status(201).send(role);
    } catch (error) {
      return fail(response, error, "Could not create role");
    }
  }

  static async updateRole(request, response) {
    try {
      const tenantId = request.params.tenant;
      const role = await AdminAccessService.updateRole(
        tenantId,
        request.params.id,
        request.body || {},
      );
      return response.status(200).send(role);
    } catch (error) {
      return fail(response, error, "Could not update role");
    }
  }

  static async deleteRole(request, response) {
    try {
      const tenantId = request.params.tenant;
      const result = await AdminAccessService.deleteRole(
        tenantId,
        request.params.id,
      );
      return response.status(200).send(result);
    } catch (error) {
      return fail(response, error, "Could not delete role");
    }
  }

  static async listAdmins(request, response) {
    try {
      const tenantId = request.params.tenant;
      return response
        .status(200)
        .send(await AdminAccessService.listAdmins(tenantId));
    } catch (error) {
      return fail(response, error, "Could not list admins");
    }
  }

  static async inviteAdmin(request, response) {
    try {
      const tenantId = request.params.tenant;
      const result = await AdminAccessService.inviteAdmin(
        tenantId,
        request.user.id,
        request.body || {},
      );
      return response.status(201).send(result);
    } catch (error) {
      return fail(response, error, "Could not add admin");
    }
  }

  static async changeAdminRole(request, response) {
    try {
      const tenantId = request.params.tenant;
      const body = request.body || {};
      const result = await AdminAccessService.changeAdminRole(
        tenantId,
        request.params.userId,
        body.roleId,
      );
      return response.status(200).send(result);
    } catch (error) {
      return fail(response, error, "Could not change role");
    }
  }

  static async revokeAdmin(request, response) {
    try {
      const tenantId = request.params.tenant;
      const result = await AdminAccessService.revokeAdmin(
        tenantId,
        request.params.userId,
        request.user.id,
      );
      return response.status(200).send(result);
    } catch (error) {
      return fail(response, error, "Could not revoke admin access");
    }
  }

  static async acceptInvitation(request, response) {
    try {
      const tenantId = request.params.tenant;
      const body = request.body || {};
      const result = await AdminAccessService.acceptInvitation(
        tenantId,
        request.params.token,
        body.password,
      );
      return response.status(200).send(result);
    } catch (error) {
      return fail(response, error, "Could not accept invitation");
    }
  }
}

module.exports = AdminAccessController;
