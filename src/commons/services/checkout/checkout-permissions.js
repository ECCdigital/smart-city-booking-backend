const MembershipManager = require("../../data-managers/membership-manager");

class CheckoutPermissions {
  static _isOwner(bookable, userId, tenantId) {
    return bookable.ownerUserId === userId && bookable.tenantId === tenantId;
  }

  static async _allowCheckout(bookable, userId, tenantId) {
    const permittedUsers = [
      ...(bookable.permittedUsers || []),
      ...(
        await MembershipManager.getMembershipsByTenantAndRoles(
          tenantId,
          bookable.permittedRoles || [],
        )
      ).map((u) => u.userId),
    ];

    if (permittedUsers.length > 0 && !permittedUsers.includes(userId)) {
      return false;
    }

    return true;
  }
}

module.exports = { CheckoutPermissions };
