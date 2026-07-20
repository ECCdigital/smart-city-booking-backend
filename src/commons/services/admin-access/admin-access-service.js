const crypto = require("crypto");
const { v4: uuidv4 } = require("uuid");
const { isEmail } = require("validator");

const AdminRoleManager = require("../../data-managers/admin-role-manager");
const AdminUserManager = require("../../data-managers/admin-user-manager");
const AdminInvitationManager = require("../../data-managers/admin-invitation-manager");
const UserManager = require("../../data-managers/user-manager");
const InstanceManager = require("../../data-managers/instance-manager");
const { User } = require("../../entities/user/user");
const AdminInvitationMail = require("./admin-invitation-mail");
const AuditLogService = require("../audit-log-service");
const {
  PERMISSION_CATALOG,
  ALL_PERMISSIONS,
  isValidPermission,
} = require("./permission-catalog");

const BUILTIN_ROLE_ID = "administrator";
const MANAGE_PERMISSION = "access:manage";
const INVITE_TTL_MS = 7 * 24 * 60 * 60 * 1000;

// Standalone admin access management; instance owner is always an admin.
class AdminAccessService {
  static async _isInstanceOwner(userId) {
    try {
      const instance = await InstanceManager.getInstance();
      return (
        !!instance &&
        Array.isArray(instance.ownerUserIds) &&
        instance.ownerUserIds.includes(userId)
      );
    } catch {
      return false;
    }
  }

  static async _instanceOwnerIds() {
    try {
      const instance = await InstanceManager.getInstance();
      return instance && Array.isArray(instance.ownerUserIds)
        ? instance.ownerUserIds
        : [];
    } catch {
      return [];
    }
  }

  static getCatalog() {
    return PERMISSION_CATALOG;
  }

  static async isAdmin(userId, tenantId) {
    if (!userId || !tenantId) {
      return false;
    }
    if (await AdminAccessService._isInstanceOwner(userId)) {
      return true;
    }
    return !!(await AdminUserManager.getByUser(tenantId, userId));
  }

  static async hasPermission(userId, tenantId, permission) {
    if (!userId || !tenantId || !permission) {
      return false;
    }
    if (await AdminAccessService._isInstanceOwner(userId)) {
      return true;
    }
    const adminUser = await AdminUserManager.getByUser(tenantId, userId);
    if (!adminUser) {
      return false;
    }
    const role = await AdminRoleManager.getRole(tenantId, adminUser.roleId);
    return !!role && role.permissions.includes(permission);
  }

  static async getMyPermissions(userId, tenantId) {
    if (await AdminAccessService._isInstanceOwner(userId)) {
      return [...ALL_PERMISSIONS];
    }
    const adminUser = await AdminUserManager.getByUser(tenantId, userId);
    if (!adminUser) {
      return [];
    }
    const role = await AdminRoleManager.getRole(tenantId, adminUser.roleId);
    return role ? [...role.permissions] : [];
  }

  static async getMe(userId, tenantId) {
    return {
      isAdmin: await AdminAccessService.isAdmin(userId, tenantId),
      permissions: await AdminAccessService.getMyPermissions(userId, tenantId),
    };
  }

  // --- Roles -------------------------------------------------------------

  static _normalizePermissions(input) {
    if (!Array.isArray(input)) {
      throw { message: "permissions must be an array", status: 400 };
    }
    const seen = new Set();
    const result = [];
    for (const raw of input) {
      const key = String(raw);
      if (!isValidPermission(key)) {
        throw { message: `Unknown permission: ${key}`, status: 400 };
      }
      if (!seen.has(key)) {
        seen.add(key);
        result.push(key);
      }
    }
    return result;
  }

  static async _roleDto(tenantId, role) {
    return {
      id: role.id,
      name: role.name,
      permissions: [...role.permissions],
      builtin: role.builtin === true,
      adminCount: await AdminUserManager.countByRole(tenantId, role.id),
    };
  }

  static async listRoles(tenantId) {
    const roles = await AdminRoleManager.getRoles(tenantId);
    const result = [];
    for (const role of roles) {
      result.push(await AdminAccessService._roleDto(tenantId, role));
    }
    return result;
  }

  static async createRole(tenantId, payload = {}) {
    const name = String(payload.name || "").trim();
    if (!name) {
      throw { message: "Name is required", status: 400 };
    }
    const permissions = AdminAccessService._normalizePermissions(
      payload.permissions || [],
    );
    if (permissions.length === 0) {
      throw { message: "At least one permission is required", status: 400 };
    }
    const roles = await AdminRoleManager.getRoles(tenantId);
    if (roles.some((r) => r.name.toLowerCase() === name.toLowerCase())) {
      throw { message: "A role with this name already exists", status: 409 };
    }
    const role = await AdminRoleManager.storeRole({
      id: uuidv4(),
      tenantId,
      name,
      permissions,
      builtin: false,
    });
    return AdminAccessService._roleDto(tenantId, role);
  }

  static async updateRole(tenantId, id, payload = {}) {
    const role = await AdminRoleManager.getRole(tenantId, id);
    if (!role) {
      throw { message: "Role not found", status: 404 };
    }
    if (role.builtin) {
      throw {
        message: "The built-in Administrator role cannot be edited",
        status: 409,
      };
    }
    const patch = {};
    if (payload.name !== undefined) {
      const name = String(payload.name).trim();
      if (!name) {
        throw { message: "Name is required", status: 400 };
      }
      const roles = await AdminRoleManager.getRoles(tenantId);
      if (
        roles.some(
          (r) => r.id !== id && r.name.toLowerCase() === name.toLowerCase(),
        )
      ) {
        throw { message: "A role with this name already exists", status: 409 };
      }
      patch.name = name;
    }
    if (payload.permissions !== undefined) {
      const permissions = AdminAccessService._normalizePermissions(
        payload.permissions,
      );
      if (permissions.length === 0) {
        throw { message: "At least one permission is required", status: 400 };
      }
      if (
        role.permissions.includes(MANAGE_PERMISSION) &&
        !permissions.includes(MANAGE_PERMISSION) &&
        !(await AdminAccessService._managerRemainsExcludingRole(tenantId, id))
      ) {
        throw {
          message: "At least one admin must keep access management",
          status: 409,
        };
      }
      patch.permissions = permissions;
    }
    const stored = await AdminRoleManager.storeRole({ ...role, ...patch });
    return AdminAccessService._roleDto(tenantId, stored);
  }

  static async deleteRole(tenantId, id) {
    const role = await AdminRoleManager.getRole(tenantId, id);
    if (!role) {
      throw { message: "Role not found", status: 404 };
    }
    if (role.builtin) {
      throw {
        message: "The built-in Administrator role cannot be deleted",
        status: 409,
      };
    }
    const inUse = await AdminUserManager.countByRole(tenantId, id);
    if (inUse > 0) {
      throw {
        message: "This role is still assigned to admins",
        status: 409,
      };
    }
    const pendingInvites = await AdminInvitationManager.countPendingByRole(
      tenantId,
      id,
    );
    if (pendingInvites > 0) {
      throw {
        message: "This role is still assigned to a pending invitation",
        status: 409,
      };
    }
    await AdminRoleManager.removeRole(tenantId, id);
    return { id };
  }

  // --- Admins ------------------------------------------------------------

  static async _managerRemainsAfter(tenantId, excludeUserId) {
    const owners = await AdminAccessService._instanceOwnerIds();
    if (owners.some((o) => o !== excludeUserId)) {
      return true;
    }
    const [admins, roles] = await Promise.all([
      AdminUserManager.getAdmins(tenantId),
      AdminRoleManager.getRoles(tenantId),
    ]);
    const managerRoleIds = new Set(
      roles
        .filter((r) => r.permissions.includes(MANAGE_PERMISSION))
        .map((r) => r.id),
    );
    return admins.some(
      (a) => a.userId !== excludeUserId && managerRoleIds.has(a.roleId),
    );
  }

  static async _managerRemainsExcludingRole(tenantId, roleId) {
    const owners = await AdminAccessService._instanceOwnerIds();
    if (owners.length > 0) {
      return true;
    }
    const [admins, roles] = await Promise.all([
      AdminUserManager.getAdmins(tenantId),
      AdminRoleManager.getRoles(tenantId),
    ]);
    const managerRoleIds = new Set(
      roles
        .filter(
          (r) => r.id !== roleId && r.permissions.includes(MANAGE_PERMISSION),
        )
        .map((r) => r.id),
    );
    return admins.some((a) => managerRoleIds.has(a.roleId));
  }

  static async listAdmins(tenantId) {
    const [admins, roles, owners] = await Promise.all([
      AdminUserManager.getAdmins(tenantId),
      AdminRoleManager.getRoles(tenantId),
      AdminAccessService._instanceOwnerIds(),
    ]);
    const roleNames = new Map(roles.map((r) => [r.id, r.name]));
    const result = [];
    for (const admin of admins) {
      const user = await UserManager.getUserBy({ id: admin.userId });
      result.push({
        userId: admin.userId,
        email: admin.userId,
        firstName: user ? user.firstName : "",
        lastName: user ? user.lastName : "",
        roleId: admin.roleId,
        roleName: roleNames.get(admin.roleId) || "—",
        isOwner: owners.includes(admin.userId),
        status: "active",
      });
    }
    const invitations = await AdminInvitationManager.getPending(tenantId);
    for (const inv of invitations) {
      result.push({
        userId: inv.email,
        email: inv.email,
        firstName: inv.firstName,
        lastName: inv.lastName,
        roleId: inv.roleId,
        roleName: roleNames.get(inv.roleId) || "—",
        isOwner: false,
        status: "pending",
      });
    }
    return result;
  }

  static async inviteAdmin(tenantId, invitedBy, payload = {}) {
    const email = String(payload.email || "")
      .trim()
      .toLowerCase();
    const firstName = String(payload.firstName || "").trim();
    const lastName = String(payload.lastName || "").trim();
    const roleId = String(payload.roleId || "").trim();
    if (!email || !firstName || !lastName) {
      throw {
        message: "First name, last name and email are required",
        status: 400,
      };
    }
    if (!isEmail(email)) {
      throw { message: "Invalid email", status: 400 };
    }
    const role = await AdminRoleManager.getRole(tenantId, roleId);
    if (!role) {
      throw { message: "Unknown role", status: 400 };
    }
    const existingAdmin = await AdminUserManager.getByUser(tenantId, email);
    if (existingAdmin) {
      throw { message: "This user is already an admin", status: 409 };
    }

    const existingUser = await UserManager.getUserBy({ id: email });
    if (existingUser) {
      // The account already exists — grant admin rights directly.
      await AdminUserManager.store({ tenantId, userId: email, roleId });
      AuditLogService.record(
        tenantId,
        "create",
        `${email} als Admin hinzugefügt`,
      );
      return {
        userId: email,
        email,
        firstName: existingUser.firstName || firstName,
        lastName: existingUser.lastName || lastName,
        roleId,
        roleName: role.name,
        status: "active",
      };
    }

    const pending = await AdminInvitationManager.getPendingByEmail(
      tenantId,
      email,
    );
    if (pending) {
      if (Date.now() <= pending.expiresAt) {
        throw {
          message: "An invitation for this email is already pending",
          status: 409,
        };
      }
      // drop the expired invitation so the email can be re-invited
      await AdminInvitationManager.remove(tenantId, pending.id);
    }
    const token = crypto.randomBytes(32).toString("hex");
    try {
      await AdminInvitationManager.store({
        id: uuidv4(),
        tenantId,
        token,
        email,
        firstName,
        lastName,
        roleId,
        status: "pending",
        invitedBy: invitedBy || "",
        expiresAt: Date.now() + INVITE_TTL_MS,
      });
    } catch (err) {
      // concurrent invite may collide on the unique pending index → 409
      if (err && err.code === 11000) {
        throw {
          message: "An invitation for this email is already pending",
          status: 409,
        };
      }
      throw err;
    }
    try {
      await AdminInvitationMail.sendAdminInvitation({ sendTo: email, token });
    } catch {
      // mail is best-effort; the invitation can be re-sent or accepted via its link
    }
    AuditLogService.record(tenantId, "create", `Admin-Einladung an ${email}`);
    return {
      email,
      firstName,
      lastName,
      roleId,
      roleName: role.name,
      status: "pending",
    };
  }

  static async acceptInvitation(tenantId, token, password) {
    const invitation = await AdminInvitationManager.getByToken(token);
    if (
      !invitation ||
      invitation.tenantId !== tenantId ||
      invitation.status !== "pending"
    ) {
      throw { message: "Invalid or expired invitation", status: 404 };
    }
    if (invitation.expiresAt && invitation.expiresAt < Date.now()) {
      throw { message: "This invitation has expired", status: 410 };
    }
    if (
      !password ||
      String(password).length < 8 ||
      !/[A-Za-z]/.test(password) ||
      !/\d/.test(password)
    ) {
      throw {
        message:
          "Password must be at least 8 characters and include a letter and a number",
        status: 400,
      };
    }
    const email = invitation.email;
    const role = await AdminRoleManager.getRole(tenantId, invitation.roleId);
    if (!role) {
      throw { message: "The assigned role no longer exists", status: 409 };
    }
    const existingUser = await UserManager.getUserBy({ id: email }, true);
    if (existingUser) {
      throw { message: "This email is already registered", status: 409 };
    }
    const user = new User({
      id: email,
      firstName: invitation.firstName,
      lastName: invitation.lastName,
    });
    user.setPassword(password);
    user.isVerified = true;
    await UserManager.createUser(user);
    try {
      await AdminUserManager.store({
        tenantId,
        userId: email,
        roleId: invitation.roleId,
      });
      await AdminInvitationManager.remove(tenantId, invitation.id);
    } catch (err) {
      // Undo the user creation so a retry is not blocked by the existing-user guard.
      await AdminUserManager.remove(tenantId, email).catch(() => {});
      await UserManager.deleteUser(email).catch(() => {});
      throw err;
    }
    AuditLogService.record(
      tenantId,
      "update",
      `Admin-Einladung von ${email} angenommen`,
    );
    return { userId: email };
  }

  static async changeAdminRole(tenantId, targetUserId, roleId) {
    const userId = String(targetUserId || "")
      .trim()
      .toLowerCase();
    const admin = await AdminUserManager.getByUser(tenantId, userId);
    if (!admin) {
      throw { message: "Admin not found", status: 404 };
    }
    const role = await AdminRoleManager.getRole(tenantId, roleId);
    if (!role) {
      throw { message: "Unknown role", status: 400 };
    }
    if (admin.roleId === roleId) {
      return { userId, roleId, roleName: role.name };
    }
    if (
      !role.permissions.includes(MANAGE_PERMISSION) &&
      !(await AdminAccessService._managerRemainsAfter(tenantId, userId))
    ) {
      throw {
        message: "At least one admin must keep access management",
        status: 409,
      };
    }
    await AdminUserManager.setRole(tenantId, userId, roleId);
    AuditLogService.record(
      tenantId,
      "update",
      `Rolle von ${userId} auf „${role.name}" geändert`,
    );
    return { userId, roleId, roleName: role.name };
  }

  static async revokeAdmin(tenantId, targetUserId, callerUserId) {
    const userId = String(targetUserId || "")
      .trim()
      .toLowerCase();

    // A pending invitation (not yet accepted) is revoked by removing it.
    const pending = await AdminInvitationManager.getPendingByEmail(
      tenantId,
      userId,
    );
    if (pending) {
      await AdminInvitationManager.remove(tenantId, pending.id);
      AuditLogService.record(
        tenantId,
        "delete",
        `Admin-Einladung an ${userId} zurückgezogen`,
      );
      return { userId, status: "revoked" };
    }

    const admin = await AdminUserManager.getByUser(tenantId, userId);
    if (!admin) {
      throw { message: "Admin not found", status: 404 };
    }
    if (callerUserId && userId === callerUserId) {
      throw {
        message: "You cannot revoke your own admin access",
        status: 409,
      };
    }
    if (await AdminAccessService._isInstanceOwner(userId)) {
      throw {
        message: "The instance owner cannot be removed",
        status: 409,
      };
    }
    if (!(await AdminAccessService._managerRemainsAfter(tenantId, userId))) {
      throw {
        message: "At least one admin must keep access management",
        status: 409,
      };
    }
    await AdminUserManager.remove(tenantId, userId);
    AuditLogService.record(
      tenantId,
      "delete",
      `Admin-Zugriff von ${userId} entzogen`,
    );
    return { userId, status: "revoked" };
  }

  // --- Bootstrap ---------------------------------------------------------

  // ensure the built-in Administrator role exists and assign the users (idempotent)
  static async bootstrap(tenantId, adminUserIds = []) {
    const existing = await AdminRoleManager.getRole(tenantId, BUILTIN_ROLE_ID);
    await AdminRoleManager.storeRole({
      id: BUILTIN_ROLE_ID,
      tenantId,
      name: "Administrator",
      permissions: [...ALL_PERMISSIONS],
      builtin: true,
      created: existing ? existing.created : Date.now(),
    });
    for (const userId of adminUserIds) {
      if (!userId) {
        continue;
      }
      const current = await AdminUserManager.getByUser(tenantId, userId);
      if (!current) {
        await AdminUserManager.store({
          tenantId,
          userId,
          roleId: BUILTIN_ROLE_ID,
        });
      }
    }
  }
}

module.exports = AdminAccessService;
