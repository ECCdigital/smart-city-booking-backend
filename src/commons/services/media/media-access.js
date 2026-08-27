const BookingManager = require("../../data-managers/booking-manager");
const MembershipManager = require("../../data-managers/membership-manager");
const PermissionService = require("../permission-service");
const { RolePermission } = require("../../entities/role/role");
const {
  ForbiddenError,
  UnauthorizedError,
} = require("../../../errors/BaseError");

/**
 * Who may read the file of a medium (§4.3 of the media spec). Two routes ask
 * this question — the media route and the permanent legacy resolver — so the
 * answer lives here rather than in either controller.
 *
 * Callers pass the id of the signed-in user, not the request: the rules are
 * about a user and a medium, nothing about HTTP.
 */

/**
 * Whether the user is an active member of a tenant. `intern` media require
 * membership — being signed in anywhere is not enough.
 *
 * @param {string} userId - Id of the user.
 * @param {string} tenantId - Id of the tenant.
 * @returns {Promise<boolean>}
 */
async function hasActiveMembership(userId, tenantId) {
  if (!userId) {
    return false;
  }

  const membership = await MembershipManager.getMembershipByTenantAndUserID(
    tenantId,
    userId,
  );

  return membership?.status === "active";
}

/**
 * The receipt rule: a booking document is readable for whoever may read any
 * booking of the tenant, or for the owner of the booking itself — a paying
 * customer gets their invoice without holding any role.
 *
 * @param {string} userId - Id of the user.
 * @param {Object} media - The booking document.
 * @returns {Promise<boolean>}
 */
async function mayReadBookingDocument(userId, media) {
  const tenantId = media.tenantId;

  if (
    await PermissionService._allowReadAny(
      userId,
      tenantId,
      RolePermission.MANAGE_BOOKINGS,
    )
  ) {
    return true;
  }

  const booking = await BookingManager.getBooking(media.bookingId, tenantId);

  return (
    Boolean(booking) && PermissionService._isOwner(booking, userId, tenantId)
  );
}

/**
 * Read access to a booking document, in whatever form it is asked for.
 *
 * @param {string|null} userId - Id of the signed-in user.
 * @param {Object} media - The booking document.
 * @returns {Promise<void>}
 * @throws {UnauthorizedError|ForbiddenError}
 */
async function assertBookingDocumentAccess(userId, media) {
  if (!userId) {
    throw new UnauthorizedError("unauthorized");
  }

  if (!(await mayReadBookingDocument(userId, media))) {
    throw new ForbiddenError("forbidden");
  }
}

/**
 * Read access to the file of a tenant medium: `public` media are readable
 * anonymously, `intern` media require an active membership in the owning
 * tenant. Booking documents follow the receipt rule.
 *
 * @param {string|null} userId - Id of the signed-in user.
 * @param {Object} media - The medium.
 * @returns {Promise<void>}
 * @throws {UnauthorizedError|ForbiddenError}
 */
async function assertMediaFileAccess(userId, media) {
  if (media.isBookingDocument()) {
    return await assertBookingDocumentAccess(userId, media);
  }

  if (media.isPublic()) {
    return;
  }

  if (!userId) {
    throw new UnauthorizedError("unauthorized");
  }

  if (!(await hasActiveMembership(userId, media.tenantId))) {
    throw new ForbiddenError("forbidden");
  }
}

/**
 * Read access to the file of an instance medium: `public` is readable
 * anonymously, `intern` means any signed-in user of the instance — there is no
 * membership that could narrow it further (§4.9).
 *
 * @param {string|null} userId - Id of the signed-in user.
 * @param {Object} media - The medium.
 * @returns {void}
 * @throws {UnauthorizedError}
 */
function assertInstanceMediaFileAccess(userId, media) {
  if (media.isPublic()) {
    return;
  }

  if (!userId) {
    throw new UnauthorizedError("unauthorized");
  }
}

module.exports = {
  assertBookingDocumentAccess,
  assertInstanceMediaFileAccess,
  assertMediaFileAccess,
  hasActiveMembership,
  mayReadBookingDocument,
};
