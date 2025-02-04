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
   * @param {Object} manageTenants Permission to manage tenants
   * @param {Object} manageUsers Permission to manage users
   * @param {string} tenant The tenant id
   * @param {string} ownerUserId The user id of the owner
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
    manageTenants,
    manageUsers,
    tenant,
    ownerUserId,
    freeBookings,
  }) {
    this.id = id;
    this.name = name;
    this.adminInterfaces = adminInterfaces;
    this.manageBookables = manageBookables;
    this.manageBookings = manageBookings;
    this.manageCoupons = manageCoupons;
    this.manageRoles = manageRoles;
    this.manageTenants = manageTenants;
    this.manageUsers = manageUsers;
    this.tenant = tenant;
    this.ownerUserId = ownerUserId;
    this.freeBookings = freeBookings;
  }

  static schema() {
    return {
      id: { type: String, required: true, unique: true },
      name: { type: String, required: true },
      adminInterfaces: { type: Array, default: [] },
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
      manageTenants: {
        create: { type: Boolean, default: false },
        readAny: { type: Boolean, default: false },
        readOwn: { type: Boolean, default: false },
        updateAny: { type: Boolean, default: false },
        updateOwn: { type: Boolean, default: false },
        deleteAny: { type: Boolean, default: false },
        deleteOwn: { type: Boolean, default: false },
      },
      manageUsers: {
        create: { type: Boolean, default: false },
        readAny: { type: Boolean, default: false },
        readOwn: { type: Boolean, default: false },
        updateAny: { type: Boolean, default: false },
        updateOwn: { type: Boolean, default: false },
        deleteAny: { type: Boolean, default: false },
        deleteOwn: { type: Boolean, default: false },
      },
      tenant: { type: String, ref: "Tenant", required: true },
      ownerUserId: { type: String, required: true },
      freeBookings: { type: Boolean, default: false },
    };
  }
}

module.exports = {
  Role: Role,
  RolePermission: RolePermission,
};
