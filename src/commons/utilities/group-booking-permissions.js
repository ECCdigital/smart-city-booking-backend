class GroupBookingPermissions {
  /**
   * Whether the current user may create a group booking for this bookable.
   * Aggregates groupBooking.enabled and groupBooking.permittedRoles.
   */
  static isAllowed(bookable, identity, userRoles) {
    const gb = bookable?.groupBooking;
    if (!gb?.enabled) {
      return false;
    }

    const permitted = Array.isArray(gb.permittedRoles) ? gb.permittedRoles : [];
    if (permitted.length === 0) {
      return true;
    }

    if (!identity) {
      return false;
    }

    return userRoles?.some((role) => permitted.includes(role)) ?? false;
  }
}

module.exports = { GroupBookingPermissions };
