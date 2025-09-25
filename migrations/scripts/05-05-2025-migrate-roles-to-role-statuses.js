module.exports = {
  name: "05-05-2025-migrate-roles-to-role-statuses",

  up: async function (mongoose) {
    console.log("Starting migration of roles to roleStatuses...");

    // Get Membership model
    const MembershipModel = mongoose.model("Membership");

    // Find all memberships
    const memberships = await MembershipModel.find({}).lean();
    console.log(`Found ${memberships.length} memberships to process`);

    let processedCount = 0;
    let updatedCount = 0;
    let skippedCount = 0;
    let errorCount = 0;

    // Process each membership
    for (const membership of memberships) {
      processedCount++;

      try {
        // Check if membership has roles field
        if (membership.roles && membership.roles.length > 0) {
          console.log(
            `Processing membership ${membership._id} with ${membership.roles.length} roles`,
          );

          // Create roleStatuses entries for each role
          const roleStatuses = membership.roles.map((role) => ({
            role: role,
            status: "active",
            source: "manually",
          }));

          // Update the membership with the new roleStatuses
          await MembershipModel.updateOne(
            { _id: membership._id },
            {
              $set: { roleStatuses: roleStatuses },
              // Optionally, you might want to unset the roles field after migration
              $unset: { roles: "" },
            },
            { runValidators: false, strict: false },
          );

          updatedCount++;
          console.log(
            `Updated membership ${membership._id} with ${roleStatuses.length} roleStatuses entries`,
          );
        } else {
          await MembershipModel.updateOne(
            { _id: membership._id },
            {
              $set: { roleStatuses: [] },
              $unset: { roles: "" },
            },
            { runValidators: false, strict: false },
          );
          skippedCount++;
          console.log(`Skipping membership ${membership._id} - no roles found`);
        }
      } catch (error) {
        errorCount++;
        console.error(
          `Error processing membership ${membership._id}:`,
          error.message,
        );
      }

      // Log progress every 100 memberships
      if (processedCount % 100 === 0) {
        console.log(
          `Progress: ${processedCount}/${memberships.length} memberships processed`,
        );
      }
    }

    console.log("Migration completed:");
    console.log(`Total memberships processed: ${processedCount}`);
    console.log(`Memberships updated: ${updatedCount}`);
    console.log(`Memberships skipped (no roles): ${skippedCount}`);
    console.log(`Errors encountered: ${errorCount}`);
  },

  down: async function (mongoose) {
    console.log("This migration cannot be reversed automatically.");
    console.log(
      "To reverse, you would need to manually restore from a backup.",
    );
  },
};
