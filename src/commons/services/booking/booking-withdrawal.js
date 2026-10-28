/**
 * The withdrawal of a private customer: who is offered it, and where. One
 * rule for the mails (`render.js`) and the customer's own bookings
 * (`booking-customer-view.js`). Whether a withdrawal is admissible is for
 * the tenant's staff to check, not for the platform; a withdrawal changes
 * nothing on the booking by itself.
 */

const { withdrawalUrl } = require("../../mail-service/mail-links");

/** The statutory withdrawal period of a private customer, from the booking. */
const WITHDRAWAL_PERIOD_MS = 14 * 24 * 60 * 60 * 1000;

/**
 * Whether the withdrawal is offered: a private customer - a booking
 * without a company - within 14 days of the booking, and a tenant address
 * to write to.
 *
 * @param {{ mail?: string }|null} tenant
 * @param {{ company?: string, timeCreated?: number }|null} booking
 * @param {number} [now]
 * @returns {boolean}
 */
function withdrawalOffered(tenant, booking, now = Date.now()) {
  if (!tenant?.mail || !booking) return false;
  if (String(booking.company ?? "").trim() !== "") return false;
  const created = Number(booking.timeCreated);
  if (!Number.isFinite(created) || created <= 0) return false;
  return now - created <= WITHDRAWAL_PERIOD_MS;
}

/**
 * The withdrawal link of one booking, the mail the customer writes to the
 * tenant; `null` where the withdrawal is not offered.
 *
 * @returns {string|null}
 */
function withdrawalUrlOf(tenant, booking, now = Date.now()) {
  return withdrawalOffered(tenant, booking, now)
    ? withdrawalUrl(tenant.mail, booking.id, booking.name)
    : null;
}

module.exports = { WITHDRAWAL_PERIOD_MS, withdrawalOffered, withdrawalUrlOf };
