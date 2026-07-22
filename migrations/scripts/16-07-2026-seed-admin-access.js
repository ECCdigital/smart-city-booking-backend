const TENANT_ID = "praktikum-kielregion";

module.exports = {
  name: "16-07-2026-seed-admin-access",

  up: async function (mongoose) {
    const AdminAccessService = require("../../src/commons/services/admin-access/admin-access-service");
    const InstanceModel = mongoose.model("Instance");

    const instance = await InstanceModel.findOne();
    const owners =
      instance && Array.isArray(instance.ownerUserIds)
        ? instance.ownerUserIds
        : [];
    const initAdmin = process.env.INIT_ADMIN || "admin";
    const adminUserIds = [...new Set([...owners, initAdmin])];

    await AdminAccessService.bootstrap(TENANT_ID, adminUserIds);
  },

  down: async function () {
    const AdminUserModel = require("../../src/commons/data-managers/models/adminUserModel");
    const AdminRoleModel = require("../../src/commons/data-managers/models/adminRoleModel");
    await AdminUserModel.deleteMany({ tenantId: TENANT_ID });
    await AdminRoleModel.deleteMany({ tenantId: TENANT_ID });
  },
};
