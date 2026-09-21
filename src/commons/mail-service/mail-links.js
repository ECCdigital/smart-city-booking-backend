/**
 * The storefront addresses a booking notice links to, built from
 * `FRONTEND_URL`. Pure URL construction: whether a link applies (the public
 * status view enabled, the booking cancellable and live) is decided by the
 * caller, `render.js`. The variable catalog of `mail-snippet-overrides.js`
 * builds its sample links from the same functions.
 */

/** The public status page of a booking - the QR code's address. */
function bookingStatusUrl(booking, tenantId) {
  return `${process.env.FRONTEND_URL}/booking/status/${tenantId}?id=${booking.id}&name=${encodeURIComponent(booking.name)}`;
}

/** The customer's cancellation request of a booking. */
function cancellationUrl(booking, tenantId) {
  return `${process.env.FRONTEND_URL}/booking/request-reject/${tenantId}?id=${booking.id}`;
}

/**
 * The admin links of the supervision notices (glossary
 * "Aufsichtsmitteilung"): `FRONTEND_URL` is the Admin UI. The tenant owner
 * lands on the overview of their tenants, the instance owner on the
 * instance's tenant list.
 */
function adminDashboardUrl() {
  return `${process.env.FRONTEND_URL}/dashboard`;
}

function adminInstanceTenantsUrl() {
  return `${process.env.FRONTEND_URL}/instance/mandanten`;
}

module.exports = {
  bookingStatusUrl,
  cancellationUrl,
  adminDashboardUrl,
  adminInstanceTenantsUrl,
};
