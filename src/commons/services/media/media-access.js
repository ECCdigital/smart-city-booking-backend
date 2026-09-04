const BookingManager = require("../../data-managers/booking-manager");
const MembershipManager = require("../../data-managers/membership-manager");
const { withinReach } = require("../authorization/reach");
const {
  ForbiddenError,
  UnauthorizedError,
} = require("../../../errors/BaseError");

/**
 * Who may read the file of a medium (§4.3 of the media spec). Two routes ask
 * this question — the media route and the permanent legacy resolver — so the
 * answer lives here rather than in either controller.
 *
 * The domain never asks about rights (authorize spec §5): callers hand a
 * reach in, one per rule they are asking about — `media.file` for the medium
 * and `media.bookingDocument` for the receipt rule, which are two entries of
 * the rights table and therefore two values. What is left here is what the
 * medium itself decides: its visibility `public | intern`, and which bookings
 * a document belongs to.
 */

/**
 * Whether the user is an active member of a tenant. An `intern` medium is
 * readable for a member even where no reach covers it — being signed in
 * anywhere is not enough.
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
 * Whether any booking a document references satisfies a predicate — the OR
 * semantics every booking document rule shares, checked with an early exit.
 * References to bookings that no longer exist are skipped.
 *
 * @param {Object} media - The booking document.
 * @param {Function} predicate - Receives a booking, returns (a promise of) a boolean.
 * @returns {Promise<boolean>}
 */
async function anyReferencedBooking(media, predicate) {
  for (const bookingId of media.bookingIds || []) {
    const booking = await BookingManager.getBooking(bookingId, media.tenantId);

    if (booking && (await predicate(booking))) {
      return true;
    }
  }

  return false;
}

/**
 * The receipt rule under a reach: `any` reads every document of the tenant,
 * `own` the documents of one's own bookings — a paying customer gets their
 * invoice without holding any role, and an aggregated document is readable
 * for every participant of its group.
 *
 * @param {Object} media - The booking document.
 * @param {{reach?: string, userId?: string|null}} scope - The reach of
 *   `media.bookingDocument`.
 * @returns {Promise<boolean>}
 */
async function mayReadBookingDocument(media, scope) {
  return await coversAnyBooking(media, scope);
}

/**
 * The write side of the receipt rule: `any` changes every document of the
 * tenant, `own` the documents of one's own bookings.
 *
 * @param {Object} media - The booking document.
 * @param {{reach?: string, userId?: string|null}} scope - The reach of
 *   `media.updateBookingDocument`.
 * @returns {Promise<boolean>}
 */
async function mayUpdateBookingDocument(media, scope) {
  return await coversAnyBooking(media, scope);
}

/**
 * Whether a reach covers a booking document: everything under `any`, and
 * under `own` a document of a booking assigned to the user.
 *
 * @param {Object} media - The booking document.
 * @param {{reach?: string, userId?: string|null}} [scope]
 * @returns {Promise<boolean>}
 */
async function coversAnyBooking(media, scope = {}) {
  if (scope.reach === "any") {
    return true;
  }

  if (scope.reach !== "own") {
    return false;
  }

  return await anyReferencedBooking(media, (booking) =>
    withinReach(booking, "assignedUserId", scope),
  );
}

/**
 * Read access to a booking document, in whatever form it is asked for.
 *
 * @param {Object} media - The booking document.
 * @param {{reach?: string, userId?: string|null}} scope - The reach of
 *   `media.bookingDocument`.
 * @returns {Promise<void>}
 * @throws {UnauthorizedError|ForbiddenError}
 */
async function assertBookingDocumentAccess(media, scope = {}) {
  if (!scope.userId) {
    throw new UnauthorizedError("unauthorized");
  }

  if (!(await mayReadBookingDocument(media, scope))) {
    throw new ForbiddenError("forbidden");
  }
}

/**
 * Read access to the file of a tenant medium: `public` media are readable
 * anonymously, an `intern` one for whoever the reach covers or holds an
 * active membership in the owning tenant. Booking documents follow the
 * receipt rule, which is its own reach.
 *
 * @param {Object} media - The medium.
 * @param {Object} scopes
 * @param {{reach?: string, userId?: string|null}} scopes.file - The reach of
 *   `media.file`.
 * @param {{reach?: string, userId?: string|null}} scopes.document - The reach
 *   of `media.bookingDocument`.
 * @returns {Promise<void>}
 * @throws {UnauthorizedError|ForbiddenError}
 */
async function assertMediaFileAccess(media, { file = {}, document = {} } = {}) {
  if (media.isBookingDocument()) {
    return await assertBookingDocumentAccess(media, document);
  }

  if (media.isPublic()) {
    return;
  }

  if (!file.userId) {
    throw new UnauthorizedError("unauthorized");
  }

  if (withinReach(media, "uploadedBy", file)) {
    return;
  }

  if (!(await hasActiveMembership(file.userId, media.tenantId))) {
    throw new ForbiddenError("forbidden");
  }
}

/**
 * Read access to the file of an instance medium: `public` is readable
 * anonymously, `intern` means any signed-in user of the instance — there is no
 * membership that could narrow it further (§4.9), which is exactly the reach
 * `own` of `instanceMedia.file`.
 *
 * @param {Object} media - The medium.
 * @param {{reach?: string, userId?: string|null}} [scope] - The reach of
 *   `instanceMedia.file`.
 * @returns {void}
 * @throws {UnauthorizedError}
 */
function assertInstanceMediaFileAccess(media, scope = {}) {
  if (media.isPublic()) {
    return;
  }

  if (scope.reach !== "own" && scope.reach !== "any") {
    throw new UnauthorizedError("unauthorized");
  }
}

module.exports = {
  assertBookingDocumentAccess,
  assertInstanceMediaFileAccess,
  assertMediaFileAccess,
  hasActiveMembership,
  mayReadBookingDocument,
  mayUpdateBookingDocument,
};
