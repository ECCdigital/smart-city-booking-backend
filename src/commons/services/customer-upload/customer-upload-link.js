const crypto = require("crypto");

/**
 * The signed link of a guest: a
 * booking made without an account gets one link for all its upload fields.
 * It opens the page „Nachweise einreichen“ with that booking alone and
 * lets the guest hand in, replace and delete proofs until the booking
 * ends; after that the backend refuses it.
 *
 * The token names tenant and booking and is signed with HMAC-SHA256 under a
 * key derived from `CRYPTO_SECRET` for this purpose alone. It carries no
 * expiry of its own: the end is read off the booking each time, so a booking
 * moved later keeps its link valid as long as it lasts.
 *
 * A token is `base64url(JSON {t, b}) "." base64url(signature)`.
 *
 * A series has a link of its own, `{t, g}` with the id of the group in
 * place of the booking: without a storefront the mails of a series lead to
 * one page with all its bookings. It opens each booking of the group, as
 * the link of that booking would, and holds for each until it ends.
 */

const PURPOSE = "biletado:customer-upload-link:v1";

function key() {
  const secret = process.env.CRYPTO_SECRET;
  if (!secret) {
    throw new Error(
      "CRYPTO_SECRET is not set; links for customer uploads cannot be signed",
    );
  }
  return crypto.createHash("sha256").update(`${PURPOSE}:${secret}`).digest();
}

const signatureOf = (payload) =>
  crypto.createHmac("sha256", key()).update(payload).digest();

/**
 * @param {Object} booking
 * @returns {boolean} Whether the booking was made without an account
 */
function isGuestBooking(booking) {
  return !booking?.assignedUserId;
}

/**
 * @param {Object} booking
 * @param {number} [now]
 * @returns {boolean} Whether a link of the booking still holds: until the
 *   booking ends. A booking without an end has no link.
 */
function linkHolds(booking, now = Date.now()) {
  const end = Number(booking?.timeEnd);
  return Number.isFinite(end) && end > now;
}

/**
 * The token of a booking's link.
 *
 * @param {Object} booking With `id` and `tenantId`
 * @returns {string}
 */
function signCustomerUploadLink(booking) {
  return sign({ t: booking.tenantId, b: booking.id });
}

function sign(content) {
  const payload = Buffer.from(JSON.stringify(content)).toString("base64url");
  return `${payload}.${signatureOf(payload).toString("base64url")}`;
}

/**
 * The token of a series' link: tenant and group.
 *
 * @param {string} tenantId
 * @param {string} groupBookingId
 * @returns {string}
 */
function signCustomerUploadGroupLink(tenantId, groupBookingId) {
  return sign({ t: tenantId, g: groupBookingId });
}

/**
 * Reads a token of {@link signCustomerUploadLink} or
 * {@link signCustomerUploadGroupLink}.
 *
 * @param {string} token
 * @returns {{tenantId: string, bookingId: string}|{tenantId: string,
 *   groupBookingId: string}|null} What it names, or null when it is not a
 *   token signed here
 */
function verifyCustomerUploadLink(token) {
  if (typeof token !== "string") return null;
  const [payload, signature, ...rest] = token.split(".");
  if (!payload || !signature || rest.length > 0) return null;

  const expected = signatureOf(payload);
  const given = Buffer.from(signature, "base64url");
  if (
    given.length !== expected.length ||
    !crypto.timingSafeEqual(given, expected)
  ) {
    return null;
  }
  try {
    const { t, b, g } = JSON.parse(
      Buffer.from(payload, "base64url").toString("utf8"),
    );
    if (typeof t !== "string") return null;
    if (typeof b === "string" && g === undefined) {
      return { tenantId: t, bookingId: b };
    }
    if (typeof g === "string" && b === undefined) {
      return { tenantId: t, groupBookingId: g };
    }
    return null;
  } catch {
    return null;
  }
}

module.exports = {
  isGuestBooking,
  linkHolds,
  signCustomerUploadGroupLink,
  signCustomerUploadLink,
  verifyCustomerUploadLink,
};
