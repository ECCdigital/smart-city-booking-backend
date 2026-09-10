const bunyan = require("bunyan");
const AdminAccessService = require("./admin-access-service");

const logger = bunyan.createLogger({
  name: "require-permission.js",
  level: process.env.LOG_LEVEL,
});

// Middleware gating a route on one admin permission (needs isSignedIn first).
function requirePermission(permission) {
  return async function (request, response, next) {
    try {
      const tenantId = request.params.tenant;
      const userId = request.user && request.user.id;
      if (!userId) {
        return response.sendStatus(401);
      }
      const allowed = await AdminAccessService.hasPermission(
        userId,
        tenantId,
        permission,
      );
      if (!allowed) {
        return response.sendStatus(403);
      }
      return next();
    } catch (error) {
      logger.error("Permission check failed", error);
      return response.sendStatus(500);
    }
  };
}

module.exports = requirePermission;
