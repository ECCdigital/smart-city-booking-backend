const { ROLE_GROUPS, ROLE_LEVELS } = require("../entities/role/role-catalogue");

/** One boolean per level for every group of the catalogue, all false. */
function roleGroupBlocks() {
  return Object.fromEntries(
    ROLE_GROUPS.map((group) => [
      group,
      Object.fromEntries(
        ROLE_LEVELS.map((level) => [level, { type: Boolean, default: false }]),
      ),
    ]),
  );
}

const roleSchemaDefinition = {
  id: { type: String, required: true },
  name: { type: String, required: true },
  tenantId: { type: String, required: true },
  adminInterfaces: {
    type: [String],
    enum: [
      "locations",
      "users",
      "roles",
      "bookings",
      "coupons",
      "rooms",
      "resources",
      "tickets",
      "events",
      "media",
    ],
    default: [],
  },
  ...roleGroupBlocks(),
  assignedUserId: { type: String, default: null },
  freeBookings: { type: Boolean, default: false },
};

module.exports = {
  roleSchemaDefinition,
};
