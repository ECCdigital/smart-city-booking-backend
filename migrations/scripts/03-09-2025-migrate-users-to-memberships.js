module.exports = {
  name: "03-09-2025-migrate-users-to-memberships",

  up: async function (mongoose) {
    console.log("Starting migration of users to memberships...");

    // Get Tenant model
    const Tenant = mongoose.model("Tenant");
    const MembershipModel = mongoose.model("Membership");

    // Get all tenants
    const tenants = await Tenant.find({}).lean();
    console.log(`Found ${tenants.length} tenants to process`);

    let totalUsers = 0;
    let migratedUsers = 0;
    let skippedUsers = 0;
    let totalOwners = 0;
    let migratedOwners = 0;
    let updatedOwners = 0;

    // Process each tenant
    for (const tenant of tenants) {
      console.log(`Processing tenant: ${tenant.id} (${tenant.name})`);

      // Process regular users if they exist
      if (tenant.users && tenant.users.length > 0) {
        totalUsers += tenant.users.length;
        console.log(`  Found ${tenant.users.length} users to migrate`);

        // Process each user in the tenant
        for (const user of tenant.users) {
          try {
            // Check if membership already exists
            const existingMembership = await MembershipModel.findOne({
              tenantId: tenant.id,
              userId: user.userId,
            });

            if (existingMembership) {
              console.log(
                `  Membership already exists for user ${user.userId} in tenant ${tenant.id}, skipping`,
              );
              skippedUsers++;
              continue;
            }

            // Create new membership
            const membership = new MembershipModel({
              tenantId: tenant.id,
              userId: user.userId,
              roles: user.roles || [],
              status: "active", // Assuming existing users are active
              source: "invite", // Assuming all existing users were invited
            });

            await membership.save();
            migratedUsers++;
            console.log(
              `  Created membership for user ${user.userId} in tenant ${tenant.id}`,
            );
          } catch (error) {
            console.error(
              `  Error migrating user ${user.userId} in tenant ${tenant.id}:`,
              error.message,
            );
          }
        }
      } else {
        console.log(`  No regular users found for tenant ${tenant.id}`);
      }

      // Process owner user IDs
      if (tenant.ownerUserIds && tenant.ownerUserIds.length > 0) {
        totalOwners += tenant.ownerUserIds.length;
        console.log(
          `  Found ${tenant.ownerUserIds.length} owner users to process for tenant ${tenant.id}`,
        );

        for (const ownerId of tenant.ownerUserIds) {
          try {
            // Check if membership already exists
            const existingMembership = await MembershipModel.findOne({
              tenantId: tenant.id,
              userId: ownerId,
            });

            if (existingMembership) {
              // Update the existing membership to set owner to true
              if (!existingMembership.owner) {
                await MembershipModel.updateOne(
                  { _id: existingMembership._id },
                  { $set: { owner: true } },
                );
                updatedOwners++;
                console.log(
                  `  Updated existing membership for owner ${ownerId} in tenant ${tenant.id}`,
                );
              } else {
                console.log(
                  `  Membership for owner ${ownerId} in tenant ${tenant.id} already has owner=true`,
                );
              }
            } else {
              // Create new membership with owner=true
              const membership = new MembershipModel({
                tenantId: tenant.id,
                userId: ownerId,
                roles: [],
                owner: true,
                status: "active",
                source: "invite",
              });

              await membership.save();
              migratedOwners++;
              console.log(
                `  Created membership for owner ${ownerId} in tenant ${tenant.id} with owner=true`,
              );
            }
          } catch (error) {
            console.error(
              `  Error processing owner ${ownerId} in tenant ${tenant.id}:`,
              error.message,
            );
          }
        }
      } else {
        console.log(`  No owner users found for tenant ${tenant.id}`);
      }
    }

    await Tenant.updateMany(
      {},
      { $unset: { users: 1, ownerUserIds: 1 } },
      { runValidators: false, strict: false },
    );
    console.log("\nMigration summary:");
    console.log(`Total tenants processed: ${tenants.length}`);
    console.log(`Total users found: ${totalUsers}`);
    console.log(`Users migrated: ${migratedUsers}`);
    console.log(`Users skipped (already had membership): ${skippedUsers}`);
    console.log(`Total owner users processed: ${totalOwners}`);
    console.log(`Owner memberships created: ${migratedOwners}`);
    console.log(`Owner memberships updated: ${updatedOwners}`);
    console.log("Migration completed successfully");
  },

  down: async function (mongoose) {
    console.log(
      "Reverting migration: removing memberships created from tenant users and resetting owner flags",
    );

    const Tenant = mongoose.model("Tenant");
    const MembershipModel = mongoose.model("Membership");

    // Get all tenants
    const tenants = await Tenant.find({});
    let removedCount = 0;
    let resetOwnerCount = 0;

    for (const tenant of tenants) {
      // Process regular users
      if (tenant.users && tenant.users.length > 0) {
        for (const user of tenant.users) {
          // Delete memberships that were created from tenant users
          const result = await MembershipModel.deleteOne({
            tenantId: tenant.id,
            userId: user.userId,
          });

          if (result.deletedCount > 0) {
            removedCount++;
            console.log(
              `Removed membership for user ${user.userId} in tenant ${tenant.id}`,
            );
          }
        }
      }

      // Process owner users
      if (tenant.ownerUserIds && tenant.ownerUserIds.length > 0) {
        for (const ownerId of tenant.ownerUserIds) {
          // Check if this user is also in the users array
          const isRegularUser =
            tenant.users &&
            tenant.users.some((user) => user.userId === ownerId);

          if (isRegularUser) {
            // If the user is also a regular user, just reset the owner flag
            const result = await MembershipModel.updateOne(
              { tenantId: tenant.id, userId: ownerId },
              { $set: { owner: false } },
            );

            if (result.modifiedCount > 0) {
              resetOwnerCount++;
              console.log(
                `Reset owner flag for user ${ownerId} in tenant ${tenant.id}`,
              );
            }
          } else {
            // If the user is only an owner, remove the membership
            const result = await MembershipModel.deleteOne({
              tenantId: tenant.id,
              userId: ownerId,
            });

            if (result.deletedCount > 0) {
              removedCount++;
              console.log(
                `Removed membership for owner ${ownerId} in tenant ${tenant.id}`,
              );
            }
          }
        }
      }
    }

    console.log(`Total memberships removed: ${removedCount}`);
    console.log(`Total owner flags reset: ${resetOwnerCount}`);
  },
};
