const TenantClass = require("../../src/commons/entities/tenant");

module.exports = {
  name: "04-02-2025-create-roles",

  up: async function (mongoose) {
    const User = mongoose.model("User");
    const Role = mongoose.model("Role");
    const Tenant = mongoose.model("Tenant");

    const users = await User.find().lean();
    const existingRoles = await Role.find().lean();

    const existingRolesMap = new Map();
    existingRoles.forEach((r) => {
      existingRolesMap.set(
        JSON.stringify({
          id: r.id,
          tenantId: r.tenantId,
        }),
        r,
      );
    });

    const rolesToCreatePerTenant = {};
    const userRoleAssignments = {};

    for (const user of users) {
      if (!user.tenant) continue;

      if (user.roles && user.roles.length) {
        if (!rolesToCreatePerTenant[user.tenant]) {
          rolesToCreatePerTenant[user.tenant] = new Set();
        }
        user.roles.forEach((r) => rolesToCreatePerTenant[user.tenant].add(r));
      }

      if (!userRoleAssignments[user.tenant]) {
        userRoleAssignments[user.tenant] = [];
      }
      const uniqueRoles = Array.from(new Set(user.roles || []));
      userRoleAssignments[user.tenant].push({
        userId: user.id,
        roles: uniqueRoles,
      });
    }

    for (const [tenantId, roleIds] of Object.entries(rolesToCreatePerTenant)) {
      for (const roleId of roleIds) {
        const key = JSON.stringify({ id: roleId, tenantId: tenantId });
        if (!existingRolesMap.has(key)) {
          const roleInDB = existingRoles.find(
            (r) => r.id === roleId && !r.tenantId,
          );
          if (roleInDB) {
            const { _id, ...rest } = roleInDB;
            const newRole = new Role({
              ...rest,
              tenantId: tenantId,
              assignedUserId: roleInDB.ownerUserId,
            });
            await newRole.save();

            existingRolesMap.set(key, newRole);
          }
        }
      }
    }

    const roleMap = { roles: {}, users: {} };
    users.forEach((user) => {
      if (user.roles) {
        if (roleMap.roles[user.tenant]) {
          roleMap.roles[user.tenant].push(...user.roles);
        } else {
          roleMap.roles[user.tenant] = user.roles;
        }
      }
      if (roleMap.users[user.tenant]) {
        const roles = new Set(user.roles);
        roleMap.users[user.tenant].push({
          userId: user.id,
          roles: Array.from(roles),
        });
      } else {
        const roles = new Set(user.roles);
        roleMap.users[user.tenant] = [
          { userId: user.id, roles: Array.from(roles) },
        ];
      }
    });

    for (const [tenantId, assignments] of Object.entries(userRoleAssignments)) {
      const tenantDoc = await Tenant.findOne({ id: tenantId });
      if (!tenantDoc) {
        console.warn(`No Tenant with id=${tenantId} found. Skipping...`);
        continue;
      }

      tenantDoc.users = tenantDoc.users || [];
      tenantDoc.users.push(...assignments);

      for (const user of assignments) {
        const isOwner = user.roles.some((roleId) => {
          const roleDoc = existingRoles.find((r) => r.id === roleId);
          if (!roleDoc) return false;

          return roleDoc.manageTenants?.readAny === true;
        });

        if (isOwner) {
          if (!tenantDoc.ownerUserIds.includes(user.userId)) {
            tenantDoc.ownerUserIds.push(user.userId);
          }
        }

        const tenantClassInstance = new TenantClass(tenantDoc);
        await Tenant.replaceOne({ id: tenantId }, tenantClassInstance);
      }
    }

    await Role.deleteMany({ tenantId: { $exists: false } });
  },

  down: async function (mongoose) {},
};
