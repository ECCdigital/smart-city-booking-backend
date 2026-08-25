const mock = require("mock-require");
const { expect } = require("chai");
const sinon = require("sinon");

const {
  ALL_PERMISSIONS,
} = require("../../src/commons/services/admin-access/permission-catalog");

describe("AdminAccessService", () => {
  let sandbox;
  let AdminRoleManager;
  let AdminUserManager;
  let AdminInvitationManager;
  let UserManager;
  let InstanceManager;
  let AdminInvitationMail;
  let AuditLogService;
  let AdminAccessService;

  beforeEach(() => {
    sandbox = sinon.createSandbox();

    AdminRoleManager = {
      getRoles: sandbox.stub().resolves([]),
      getRole: sandbox.stub().resolves(null),
      storeRole: sandbox.stub().callsFake(async (r) => r),
      removeRole: sandbox.stub().resolves(true),
    };
    AdminUserManager = {
      getAdmins: sandbox.stub().resolves([]),
      getByUser: sandbox.stub().resolves(null),
      store: sandbox.stub().callsFake(async (r) => r),
      setRole: sandbox.stub().resolves(null),
      remove: sandbox.stub().resolves(true),
      countByRole: sandbox.stub().resolves(0),
    };
    AdminInvitationManager = {
      getByToken: sandbox.stub().resolves(null),
      getPendingByEmail: sandbox.stub().resolves(null),
      getPending: sandbox.stub().resolves([]),
      store: sandbox.stub().callsFake(async (r) => r),
      remove: sandbox.stub().resolves(),
    };
    UserManager = {
      getUserBy: sandbox.stub().resolves(null),
      createUser: sandbox.stub().resolves(),
      deleteUser: sandbox.stub().resolves(),
    };
    InstanceManager = {
      getInstance: sandbox.stub().resolves({ ownerUserIds: [] }),
    };
    AdminInvitationMail = { sendAdminInvitation: sandbox.stub().resolves() };
    AuditLogService = { record: sandbox.stub() };

    mock(
      "../../src/commons/data-managers/admin-role-manager",
      AdminRoleManager,
    );
    mock(
      "../../src/commons/data-managers/admin-user-manager",
      AdminUserManager,
    );
    mock(
      "../../src/commons/data-managers/admin-invitation-manager",
      AdminInvitationManager,
    );
    mock("../../src/commons/data-managers/user-manager", UserManager);
    mock("../../src/commons/data-managers/instance-manager", InstanceManager);
    mock(
      "../../src/commons/services/admin-access/admin-invitation-mail",
      AdminInvitationMail,
    );
    mock("../../src/commons/services/audit-log-service", AuditLogService);

    AdminAccessService = mock.reRequire(
      "../../src/commons/services/admin-access/admin-access-service",
    );
  });

  afterEach(() => {
    sandbox.restore();
    mock.stopAll();
  });

  async function rejectsWith(fn, status) {
    let err;
    try {
      await fn();
    } catch (e) {
      err = e;
    }
    expect(err, "expected the call to reject").to.not.equal(undefined);
    expect(err.status).to.equal(status);
  }

  describe("hasPermission", () => {
    it("grants everything to the instance owner", async () => {
      InstanceManager.getInstance.resolves({ ownerUserIds: ["owner"] });
      expect(
        await AdminAccessService.hasPermission(
          "owner",
          "t",
          "companies:delete",
        ),
      ).to.equal(true);
      expect(AdminUserManager.getByUser.called).to.equal(false);
    });

    it("grants a permission the assigned role holds", async () => {
      AdminUserManager.getByUser.resolves({ userId: "a", roleId: "r1" });
      AdminRoleManager.getRole.resolves({
        id: "r1",
        permissions: ["offers:view", "offers:moderate"],
      });
      expect(
        await AdminAccessService.hasPermission("a", "t", "offers:moderate"),
      ).to.equal(true);
    });

    it("denies a permission the role lacks", async () => {
      AdminUserManager.getByUser.resolves({ userId: "a", roleId: "r1" });
      AdminRoleManager.getRole.resolves({
        id: "r1",
        permissions: ["offers:view"],
      });
      expect(
        await AdminAccessService.hasPermission("a", "t", "offers:moderate"),
      ).to.equal(false);
    });

    it("denies when the user is not an admin", async () => {
      expect(
        await AdminAccessService.hasPermission("nobody", "t", "stats:view"),
      ).to.equal(false);
    });
  });

  describe("getMyPermissions", () => {
    it("returns the full catalog for the instance owner", async () => {
      InstanceManager.getInstance.resolves({ ownerUserIds: ["owner"] });
      const perms = await AdminAccessService.getMyPermissions("owner", "t");
      expect(perms).to.have.length(ALL_PERMISSIONS.length);
    });

    it("returns [] for a non-admin", async () => {
      expect(await AdminAccessService.getMyPermissions("x", "t")).to.deep.equal(
        [],
      );
    });
  });

  describe("createRole", () => {
    it("rejects an empty name", async () => {
      await rejectsWith(
        () =>
          AdminAccessService.createRole("t", {
            name: "  ",
            permissions: ["stats:view"],
          }),
        400,
      );
    });

    it("rejects an unknown permission", async () => {
      await rejectsWith(
        () =>
          AdminAccessService.createRole("t", {
            name: "X",
            permissions: ["bogus:perm"],
          }),
        400,
      );
    });

    it("rejects when no permissions are given", async () => {
      await rejectsWith(
        () =>
          AdminAccessService.createRole("t", { name: "X", permissions: [] }),
        400,
      );
    });

    it("rejects a duplicate name (case-insensitive)", async () => {
      AdminRoleManager.getRoles.resolves([
        { id: "r", name: "Moderation", permissions: ["offers:view"] },
      ]);
      await rejectsWith(
        () =>
          AdminAccessService.createRole("t", {
            name: "moderation",
            permissions: ["stats:view"],
          }),
        409,
      );
    });

    it("creates a role, deduping permissions, and returns a DTO", async () => {
      const dto = await AdminAccessService.createRole("t", {
        name: "Neu",
        permissions: ["stats:view", "stats:view"],
      });
      expect(dto.name).to.equal("Neu");
      expect(dto.permissions).to.deep.equal(["stats:view"]);
      expect(dto.builtin).to.equal(false);
      expect(AdminRoleManager.storeRole.calledOnce).to.equal(true);
    });
  });

  describe("role protection", () => {
    it("refuses to edit the built-in role", async () => {
      AdminRoleManager.getRole.resolves({
        id: "administrator",
        name: "Administrator",
        permissions: [],
        builtin: true,
      });
      await rejectsWith(
        () =>
          AdminAccessService.updateRole("t", "administrator", { name: "X" }),
        409,
      );
    });

    it("refuses to delete the built-in role", async () => {
      AdminRoleManager.getRole.resolves({
        id: "administrator",
        builtin: true,
        permissions: [],
      });
      await rejectsWith(
        () => AdminAccessService.deleteRole("t", "administrator"),
        409,
      );
    });

    it("refuses to delete a role still assigned to admins", async () => {
      AdminRoleManager.getRole.resolves({
        id: "r",
        builtin: false,
        permissions: [],
      });
      AdminUserManager.countByRole.resolves(2);
      await rejectsWith(() => AdminAccessService.deleteRole("t", "r"), 409);
    });
  });

  describe("revokeAdmin lockout guards", () => {
    it("refuses to revoke your own access", async () => {
      AdminUserManager.getByUser.resolves({
        userId: "me",
        roleId: "administrator",
      });
      await rejectsWith(
        () => AdminAccessService.revokeAdmin("t", "me", "me"),
        409,
      );
    });

    it("refuses to revoke the instance owner", async () => {
      InstanceManager.getInstance.resolves({ ownerUserIds: ["owner"] });
      AdminUserManager.getByUser.resolves({
        userId: "owner",
        roleId: "administrator",
      });
      await rejectsWith(
        () => AdminAccessService.revokeAdmin("t", "owner", "caller"),
        409,
      );
    });

    it("refuses to revoke the last access-management admin", async () => {
      AdminUserManager.getByUser.resolves({
        userId: "solo",
        roleId: "administrator",
      });
      sandbox.stub(AdminAccessService, "_managerRemainsAfter").resolves(false);
      await rejectsWith(
        () => AdminAccessService.revokeAdmin("t", "solo", "caller"),
        409,
      );
      expect(AdminUserManager.remove.called).to.equal(false);
    });
  });

  describe("acceptInvitation guards", () => {
    const pendingInvite = (over = {}) => ({
      id: "i1",
      tenantId: "t",
      email: "new@y.de",
      firstName: "X",
      lastName: "Y",
      roleId: "r1",
      status: "pending",
      expiresAt: Date.now() + 3600000,
      ...over,
    });

    it("rejects a token minted for another tenant (404)", async () => {
      AdminInvitationManager.getByToken.resolves(
        pendingInvite({ tenantId: "other" }),
      );
      await rejectsWith(
        () => AdminAccessService.acceptInvitation("t", "tok", "Passwort1"),
        404,
      );
      expect(UserManager.createUser.called).to.equal(false);
    });

    it("rejects an expired invitation (410)", async () => {
      AdminInvitationManager.getByToken.resolves(
        pendingInvite({ expiresAt: Date.now() - 1000 }),
      );
      await rejectsWith(
        () => AdminAccessService.acceptInvitation("t", "tok", "Passwort1"),
        410,
      );
      expect(UserManager.createUser.called).to.equal(false);
    });

    it("rejects a password that fails the policy (400)", async () => {
      AdminInvitationManager.getByToken.resolves(pendingInvite());
      await rejectsWith(
        () => AdminAccessService.acceptInvitation("t", "tok", "short"),
        400,
      );
      expect(UserManager.createUser.called).to.equal(false);
    });
  });

  describe("inviteAdmin", () => {
    it("grants admin directly when the account already exists", async () => {
      AdminRoleManager.getRole.resolves({
        id: "r1",
        name: "Moderation",
        permissions: ["offers:view"],
      });
      UserManager.getUserBy.resolves({
        id: "x@y.de",
        firstName: "X",
        lastName: "Y",
      });
      const res = await AdminAccessService.inviteAdmin("t", "admin", {
        firstName: "X",
        lastName: "Y",
        email: "x@y.de",
        roleId: "r1",
      });
      expect(res.status).to.equal("active");
      expect(AdminUserManager.store.calledOnce).to.equal(true);
      expect(AdminInvitationMail.sendAdminInvitation.called).to.equal(false);
    });

    it("sends an invitation for a brand-new email", async () => {
      AdminRoleManager.getRole.resolves({
        id: "r1",
        name: "Moderation",
        permissions: ["offers:view"],
      });
      UserManager.getUserBy.resolves(null);
      const res = await AdminAccessService.inviteAdmin("t", "admin", {
        firstName: "X",
        lastName: "Y",
        email: "new@y.de",
        roleId: "r1",
      });
      expect(res.status).to.equal("pending");
      expect(AdminInvitationManager.store.calledOnce).to.equal(true);
      expect(AdminInvitationMail.sendAdminInvitation.calledOnce).to.equal(true);
    });

    it("surfaces a concurrent duplicate (unique-index E11000) as 409", async () => {
      AdminRoleManager.getRole.resolves({
        id: "r1",
        name: "Moderation",
        permissions: ["offers:view"],
      });
      UserManager.getUserBy.resolves(null);
      AdminInvitationManager.store.rejects({ code: 11000 });
      await rejectsWith(
        () =>
          AdminAccessService.inviteAdmin("t", "admin", {
            firstName: "X",
            lastName: "Y",
            email: "new@y.de",
            roleId: "r1",
          }),
        409,
      );
    });

    it("rejects an invalid email", async () => {
      AdminRoleManager.getRole.resolves({ id: "r1", permissions: [] });
      await rejectsWith(
        () =>
          AdminAccessService.inviteAdmin("t", "admin", {
            firstName: "X",
            lastName: "Y",
            email: "notanemail",
            roleId: "r1",
          }),
        400,
      );
    });

    it("rejects an unknown role", async () => {
      AdminRoleManager.getRole.resolves(null);
      await rejectsWith(
        () =>
          AdminAccessService.inviteAdmin("t", "admin", {
            firstName: "X",
            lastName: "Y",
            email: "x@y.de",
            roleId: "ghost",
          }),
        400,
      );
    });

    it("rejects when the user is already an admin", async () => {
      AdminRoleManager.getRole.resolves({ id: "r1", permissions: [] });
      AdminUserManager.getByUser.resolves({ userId: "x@y.de", roleId: "r1" });
      await rejectsWith(
        () =>
          AdminAccessService.inviteAdmin("t", "admin", {
            firstName: "X",
            lastName: "Y",
            email: "x@y.de",
            roleId: "r1",
          }),
        409,
      );
    });
  });

  describe("bootstrap", () => {
    it("stores the built-in Administrator with the full catalog and assigns the user", async () => {
      AdminRoleManager.getRole.resolves(null);
      AdminUserManager.getByUser.resolves(null);
      await AdminAccessService.bootstrap("t", ["admin"]);
      const stored = AdminRoleManager.storeRole.firstCall.args[0];
      expect(stored.id).to.equal("administrator");
      expect(stored.builtin).to.equal(true);
      expect(stored.permissions).to.have.length(ALL_PERMISSIONS.length);
      expect(AdminUserManager.store.calledOnce).to.equal(true);
      expect(AdminUserManager.store.firstCall.args[0]).to.include({
        userId: "admin",
        roleId: "administrator",
      });
    });
  });
});
