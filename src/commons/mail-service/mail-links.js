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
 * The customer's withdrawal of a booking: a mail to the tenant's address,
 * subject and body naming the booking and signed with the name of the
 * booking, which the tenant's staff then checks. A withdrawal is not a
 * cancellation: nothing changes on the booking by itself.
 */
function withdrawalUrl(tenantMail, bookingRef, customerName = "") {
  const subject = `Widerruf der Buchung ${bookingRef}`;
  const body = [
    "Sehr geehrte Damen und Herren,",
    "",
    `hiermit widerrufe ich den von mir abgeschlossenen Vertrag für die Buchung ${bookingRef}.`,
    "Bitte bestätigen Sie den erfolgreichen Widerruf.",
    "",
    "Mit freundlichen Grüßen",
    customerName,
  ]
    .join("\r\n")
    .trimEnd();
  return `mailto:${tenantMail}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`;
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

/**
 * The open reports in the review queue of the instance (glossary
 * „Meldung“), for the instance owner.
 */
function adminInstanceReportsUrl() {
  return `${process.env.FRONTEND_URL}/instance/review-queue?tab=reports`;
}

/**
 * The members of a tenant in the Admin UI (`FRONTEND_URL`), the tenant
 * named by `?tenant=` so the owner lands in the right one.
 */
function adminTenantMembersUrl(tenantId) {
  return `${process.env.FRONTEND_URL}/tenant/members?tenant=${encodeURIComponent(tenantId)}`;
}

module.exports = {
  bookingStatusUrl,
  cancellationUrl,
  withdrawalUrl,
  adminDashboardUrl,
  adminInstanceTenantsUrl,
  adminInstanceReportsUrl,
  adminTenantMembersUrl,
};
