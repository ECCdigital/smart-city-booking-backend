const UserManager = require("../data-managers/user-manager");

async function resolveCheckoutId(checkoutId, userID, tenantId) {
  if (checkoutId) {
    return { checkoutId, generated: false };
  }

  if (userID) {
    const rawUser = await UserManager.getRawUser(userID, tenantId);
    if (rawUser) {
      const id =
        typeof rawUser._id === "string"
          ? rawUser._id
          : rawUser._id.toString();

      return { checkoutId: "01" + id, generated: false };
    }
  }
}

module.exports = { resolveCheckoutId };