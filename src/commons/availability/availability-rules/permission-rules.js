const {
  CheckoutPermissions,
} = require("../../services/checkout/item-checkout-service");

/**
 * @param {import("../../entities/bookable/bookable").Bookable} bookable
 * @returns {boolean}
 */
function isBookableEnabled(bookable) {
  return bookable?.isBookable === true;
}

/**
 * Pure permission check when permitted user IDs are already resolved.
 *
 * @param {string|undefined|null} userId
 * @param {string[]} permittedUserIds
 * @returns {boolean}
 */
function isUserPermitted(userId, permittedUserIds) {
  if (!permittedUserIds || permittedUserIds.length === 0) {
    return true;
  }

  return permittedUserIds.includes(userId);
}

/**
 * @param {import("../../entities/bookable/bookable").Bookable} bookable
 * @param {string|undefined|null} userId
 * @param {string[]} permittedUserIds
 * @returns {boolean}
 */
function hasBookingPermissionSync(bookable, userId, permittedUserIds) {
  if (!isBookableEnabled(bookable)) {
    return false;
  }

  return isUserPermitted(userId, permittedUserIds);
}

/**
 * @param {import("../../entities/bookable/bookable").Bookable} bookable
 * @param {string|undefined|null} userId
 * @param {string} tenantId
 * @returns {Promise<boolean>}
 */
async function hasBookingPermission(bookable, userId, tenantId) {
  if (!isBookableEnabled(bookable)) {
    return false;
  }

  return CheckoutPermissions._allowCheckout(bookable, userId, tenantId);
}

module.exports = {
  isBookableEnabled,
  isUserPermitted,
  hasBookingPermissionSync,
  hasBookingPermission,
};
