require("dotenv").config();
const { User: UserEntity } = require("../src/commons/entities/user/user");

/**
 * Seeds the database with initial data.
 *
 * @param {Object} mongoose - The mongoose instance.
 * @returns {Promise<void>} - A promise that resolves when the seeding is complete.
 */
async function seed(mongoose) {
  const InstanceModel = mongoose.model("Instance");
  const UserModel = mongoose.model("User");

  const { INIT_ADMIN, INIT_ADMIN_SECRET } = process.env;

  try {
    let instance = await InstanceModel.findOne();

    async function getOrCreateAdminUser() {
      let adminUser = await UserModel.findOne({ id: INIT_ADMIN || "admin" });
      if (!adminUser) {
        const newAdminUser = new UserEntity({
          id: INIT_ADMIN || "admin",
          isVerified: true,
        });
        newAdminUser.setPassword(INIT_ADMIN_SECRET || "admin");
        adminUser = await UserModel.create(newAdminUser);
      }
      return adminUser;
    }

    let adminUser;

    if (!instance || !instance.isInitialized) {
      adminUser = await getOrCreateAdminUser();
    }

    if (!instance) {
      await InstanceModel.create({
        isInitialized: true,
        ownerUserIds: [adminUser.id],
      });
      console.log("Seeding complete.");
    } else if (!instance.isInitialized) {
      if (!instance.ownerUserIds.includes(adminUser.id)) {
        instance.ownerUserIds.push(adminUser.id);
      }
      instance.isInitialized = true;
      await instance.save();
      console.log("Seeding complete.");
    }
  } catch (error) {
    throw error;
  }
}

module.exports = seed;
