const RolePermission = Object.freeze({
  MANAGE_BOOKABLES: "manageBookables",
  MANAGE_USERS: "manageUsers",
  MANAGE_TENANTS: "manageTenants",
  MANAGE_ROLES: "manageRoles",
  MANAGE_BOOKINGS: "manageBookings",
  MANAGE_COUPONS: "manageCoupons",
  FREE_BOOKINGS: "freeBookings",
});

/**
 * The Role class is the basic definition for the security layer.
 */
class Role {
  /**
   * Create a new role object.
   *
   * @param {string} id Identifier of the Role
   * @param {string} name Name of the Role
   * @param {Array} adminInterface Access to the admin interface
   * @param {Object} manageBookables Permission to manage bookables
   * @param {Object} manageBookings Permission to manage bookings
   * @param {Object} manageCoupons Permission to manage coupons
   * @param {Object} manageRoles Permission to manage roles
   * @param {string} tenantId The tenant id
   * @param {string} assignedUserId The user id of the owner
   * @param {boolean} freeBookings Permission to book for free
   */
  constructor({
    id,
    name,
    adminInterfaces,
    manageBookables,
    manageBookings,
    manageCoupons,
    manageRoles,
    tenantId,
    assignedUserId,
    freeBookings,
  }) {
    this.id = id;
    this.name = name;
    this.adminInterfaces = adminInterfaces;
    this.manageBookables = manageBookables;
    this.manageBookings = manageBookings;
    this.manageCoupons = manageCoupons;
    this.manageRoles = manageRoles;
    this.tenantId = tenantId;
    this.assignedUserId = assignedUserId;
    this.freeBookings = freeBookings;
  }

  static get schema() {
    return {
      id: { type: String, required: true },
      name: { type: String, required: true },
      tenantId: { type: String, required: true },
      adminInterfaces: {
        type: [String],
        enum: [
          "locations",
          "roles",
          "bookings",
          "coupons",
          "rooms",
          "resources",
          "tickets",
          "events",
        ],
        default: [],
      },
      manageBookables: {
        create: { type: Boolean, default: false },
        readAny: { type: Boolean, default: false },
        readOwn: { type: Boolean, default: false },
        updateAny: { type: Boolean, default: false },
        updateOwn: { type: Boolean, default: false },
        deleteAny: { type: Boolean, default: false },
        deleteOwn: { type: Boolean, default: false },
      },
      manageBookings: {
        create: { type: Boolean, default: false },
        readAny: { type: Boolean, default: false },
        readOwn: { type: Boolean, default: false },
        updateAny: { type: Boolean, default: false },
        updateOwn: { type: Boolean, default: false },
        deleteAny: { type: Boolean, default: false },
        deleteOwn: { type: Boolean, default: false },
      },
      manageCoupons: {
        create: { type: Boolean, default: false },
        readAny: { type: Boolean, default: false },
        readOwn: { type: Boolean, default: false },
        updateAny: { type: Boolean, default: false },
        updateOwn: { type: Boolean, default: false },
        deleteAny: { type: Boolean, default: false },
        deleteOwn: { type: Boolean, default: false },
      },
      manageRoles: {
        create: { type: Boolean, default: false },
        readAny: { type: Boolean, default: false },
        readOwn: { type: Boolean, default: false },
        updateAny: { type: Boolean, default: false },
        updateOwn: { type: Boolean, default: false },
        deleteAny: { type: Boolean, default: false },
        deleteOwn: { type: Boolean, default: false },
      },
      assignedUserId: { type: String, default: null },
      freeBookings: { type: Boolean, default: false },
    };
  }
}

module.exports = {
  Role: Role,
  RolePermission: RolePermission,
};
