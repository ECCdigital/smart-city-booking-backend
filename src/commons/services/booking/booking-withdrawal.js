/**
 * The withdrawal of a private customer: who is offered it, and where. One
 * rule for the mails (`render.js`) and the customer's own bookings
 * (`booking-customer-view.js`). Whether a withdrawal is admissible is for
 * the tenant's staff to check, not for the platform; the mail changes
 * nothing on the booking, the staff's acceptance moves it to `withdrawn`
 * (`acceptWithdrawal`).
 */

const { withdrawalUrl } = require("../../mail-service/mail-links");
const { LIVE_STATUSES } = require("../booking-lifecycle/booking-state");
const { isPrivateBooking } = require("../checkout/business-booking");

/** The statutory withdrawal period of a private customer, from the booking. */
const WITHDRAWAL_PERIOD_MS = 14 * 24 * 60 * 60 * 1000;

/**
 * Whether the withdrawal is offered: a live private booking - as the
 * booker answered it, or without the answer a booking without a company -
 * within 14 days of the booking, and a tenant address to write to. A rejected, cancelled or withdrawn booking
 * has nothing left to withdraw.
 *
 * @param {{ mail?: string }|null} tenant
 * @param {{ status?: string, isBusiness?: boolean, company?: string, timeCreated?: number }|null} booking
 * @param {number} [now]
 * @returns {boolean}
 */
function withdrawalOffered(tenant, booking, now = Date.now()) {
  if (!tenant?.mail || !booking) return false;
  if (booking.status && !LIVE_STATUSES.includes(booking.status)) return false;
  if (!isPrivateBooking(booking)) return false;
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
