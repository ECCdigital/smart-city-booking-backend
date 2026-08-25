const bunyan = require("bunyan");
const AuditLogManager = require("../data-managers/audit-log-manager");
const requestContext = require("../utilities/request-context");

const logger = bunyan.createLogger({
  name: "audit-log-service.js",
  level: process.env.LOG_LEVEL,
});

const ACTIONS = ["create", "update", "delete", "error"];

class AuditLogService {
  // fire-and-forget; actor read from the request context
  static record(tenantId, action, message) {
    if (!tenantId || !ACTIONS.includes(action) || !message) {
      return;
    }
    const actorId = requestContext.getActorId() || "";
    (async () => {
      let actorName = "";
      if (actorId) {
        try {
          const UserManager = require("../data-managers/user-manager");
          const user = await UserManager.getUser(actorId);
          if (user) {
            actorName = `${user.firstName || ""} ${user.lastName || ""}`.trim();
          }
        } catch {
          // best-effort: fall back to the id when the name can't be resolved
        }
      }
      await AuditLogManager.append({
        tenantId,
        action,
        message,
        actorId,
        actorName,
      });
    })().catch((error) => {
      logger.error("Could not write audit-log entry", error);
    });
  }

  static async list(tenantId, params) {
    return AuditLogManager.list(tenantId, params);
  }
}

module.exports = AuditLogService;
