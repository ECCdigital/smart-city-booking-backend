/**
 * Buchungsweg (GLOSSARY.md): how a booking was created - through a user
 * account, as a guest or by the administration as a manual booking. The
 * checkout sets it once when it creates a booking, from the checkout
 * policy and the sign-in alone, and nothing changes it afterwards. Bookings
 * from before it existed carry none.
 */
const checkoutPolicy = require("./checkout-policy");

const BookedVia = Object.freeze({
  USER: "user",
  GUEST: "guest",
  ADMIN: "admin",
});

const BOOKED_VIA = Object.freeze(Object.values(BookedVia));

/**
 * The Buchungsweg of a booking the checkout creates. It hangs on the
 * process, not on the person: no role is asked, an admin signed in at a
 * checkout books through the account.
 *
 * @param {string} policy The checkout policy
 * @param {Object|null|undefined} user The signed-in user, if any
 * @returns {string} One of {@link BOOKED_VIA}
 */
function bookedViaOf(policy, user) {
  if (checkoutPolicy.acceptsAdminOverrides(policy)) {
    return BookedVia.ADMIN;
  }
  return user?.id ? BookedVia.USER : BookedVia.GUEST;
}

module.exports = {
  BookedVia,
  BOOKED_VIA,
  bookedViaOf,
};
