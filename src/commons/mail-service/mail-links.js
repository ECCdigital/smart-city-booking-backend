/**
 * The storefront addresses a booking notice links to, built from
 * `FRONTEND_URL`. Pure URL construction: whether a link applies (the public
 * status view enabled, the booking cancellable and live) is decided by the
 * caller, `render.js`. The variable catalog of `mail-snippet-overrides.js`
 * builds its sample links from the same functions.
 */

const {
  isGuestBooking,
  linkHolds,
  signCustomerUploadLink,
} = require("../services/customer-upload/customer-upload-link");

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

/**
 * The storefront's page „Nachweise einreichen“,
 * under the customer's account, opened at the upload field of the booking
 * where both are named; none without `STORE_FRONT_URL`.
 */
function customerUploadProofsUrl(bookingId = null, fieldId = null) {
  const base = (process.env.STORE_FRONT_URL || "").replace(/\/+$/, "");
  if (!base) return "";
  const url = `${base}/account/proofs`;
  if (!bookingId) return url;
  const query = new URLSearchParams({ booking: bookingId });
  if (fieldId) query.set("field", fieldId);
  return `${url}?${query}`;
}

/**
 * The page „Nachweise einreichen“ of a guest: the
 * storefront's page without account and menu, with the booking's signed
 * link, opened at the upload field where one is named. None without
 * `STORE_FRONT_URL`, nor for a booking whose link no longer holds.
 */
function customerUploadGuestUrl(booking, fieldId = null) {
  const base = (process.env.STORE_FRONT_URL || "").replace(/\/+$/, "");
  if (!base || !booking || !linkHolds(booking)) return "";
  const query = new URLSearchParams({ link: signCustomerUploadLink(booking) });
  if (fieldId) query.set("field", fieldId);
  return `${base}/proofs?${query}`;
}

/**
 * The way of a booking's customer to hand proofs in: a guest's signed link,
 * the page under the account for everyone else.
 */
function customerUploadUrlOf(booking, fieldId = null) {
  return isGuestBooking(booking)
    ? customerUploadGuestUrl(booking, fieldId)
    : customerUploadProofsUrl(booking?.id, fieldId);
}

module.exports = {
  bookingStatusUrl,
  customerUploadProofsUrl,
  customerUploadGuestUrl,
  customerUploadUrlOf,
  cancellationUrl,
  withdrawalUrl,
  adminDashboardUrl,
  adminInstanceTenantsUrl,
  adminInstanceReportsUrl,
  adminTenantMembersUrl,
};
