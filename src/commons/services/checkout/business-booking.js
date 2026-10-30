/**
 * Private or business booking (GLOSSARY.md "Geschäftliche Buchung"): the
 * booker says so at the checkout. A booking without that answer - one from
 * before, or a body that does not carry it - reads off the company: with a
 * company it is a business booking, without one a private booking. Only a
 * private booking is offered the withdrawal (booking-withdrawal.js).
 */

function hasCompany(company) {
  return String(company ?? "").trim() !== "";
}

/**
 * The answer a new booking stores: what the body says where it says a
 * boolean, the company's reading otherwise.
 *
 * @param {*} isBusiness What the body carries
 * @param {string} [company] The company of the booking
 * @returns {boolean}
 */
function isBusinessOf(isBusiness, company) {
  return typeof isBusiness === "boolean" ? isBusiness : hasCompany(company);
}

/**
 * Whether a booking is a private one: the stored answer, or without it the
 * company's reading.
 *
 * @param {{ isBusiness?: boolean, company?: string }} booking
 * @returns {boolean}
 */
function isPrivateBooking(booking) {
  return !isBusinessOf(booking?.isBusiness, booking?.company);
}

module.exports = { isBusinessOf, isPrivateBooking };
