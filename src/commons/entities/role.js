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
   * @param {boolean} manageBookables Allow users to manage bookable object
   * @param {boolean} manageUsers allow users to manage users
   * @param {boolean} manageTenants allow users to manage tenants
   * @param {boolean} manageBookings allow users to manage events
   * @param {boolean} manageRoles allow users to manage roles
   * @param {boolean} freeBookings allow users to book without paying
   *
   */
  constructor(
    id,
    name,
    manageBookables,
    manageUsers,
    manageTenants,
    manageBookings,
    manageRoles,
    manageCoupons,
    freeBookings,
  ) {
    this.id = id;
    this.name = name;
    this.manageBookables = manageBookables;
    this.manageUsers = manageUsers;
    this.manageTenants = manageTenants;
    this.manageBookings = manageBookings;
    this.manageRoles = manageRoles;
    this.manageCoupons = manageCoupons;
    this.freeBookings = freeBookings;
  }
}

module.exports = {
  Role: Role,
  RolePermission: RolePermission,
};
