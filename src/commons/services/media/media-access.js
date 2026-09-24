const BookingManager = require("../../data-managers/booking-manager");
const TenantManager = require("../../data-managers/tenant-manager");
const EventManager = require("../../data-managers/event-manager");
const { BookableManager } = require("../../data-managers/bookable-manager");
const {
  isTenantPubliclyVisible,
  isOfferReachable,
} = require("../supervision/offer-gate");
const {
  SUPERVISION_LEVELS,
  effectiveLevelOf,
} = require("../supervision/supervision-constants");
const { MediaUsageService, USAGE_TYPE } = require("./media-usage");

/** The usage sites that are offers (glossary "Angebot"). */
const OFFER_USAGE = new Set([USAGE_TYPE.BOOKABLE, USAGE_TYPE.EVENT]);
const { readsRecords, withinReach } = require("../authorization/reach");
const {
  ForbiddenError,
  NotFoundError,
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
 * The receipt rule: `any` covers every booking document of the tenant, `own`
 * the documents of one's own bookings — a paying customer gets their invoice
 * without holding any role, and an aggregated document is covered for every
 * participant of its group.
 *
 * Reading and changing a document are two entries of the rights table
 * (`media.bookingDocument` and `media.updateBookingDocument`), and the same
 * rule reads both: the caller passes the reach of the entry that applies.
 *
 * @param {Object} media - The booking document.
 * @param {{reach?: string, userId?: string|null}} [scope] - The reach of the
 *   entry the caller is asking about.
 * @returns {Promise<boolean>}
 */
async function coversBookingDocument(media, scope = {}) {
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

  if (!(await coversBookingDocument(media, scope))) {
    throw new ForbiddenError("forbidden");
  }
}

/**
 * A public medium follows the supervision (tenant supervision spec §5.2):
 * a pending or declined tenant has no public projection, and under a
 * supervised tenant a medium that only offers hold goes out with a
 * reachable one of them - the missing publication wish alone never refuses
 * it. The tenant's own
 * people keep reading. Booking documents never come here: they follow the
 * booking, whatever the tenant's level.
 *
 * @param {Object} media - The public medium.
 * @param {{reach?: string, userId?: string|null}} file - The reach of `media.file`.
 * @param {boolean} isMember - Whether the caller is a member of the tenant
 *   (glossary "Mitglied"): the caller's answer, never asked here.
 * @returns {Promise<void>}
 * @throws {NotFoundError} `media_not_found`, naming no reason
 */
async function assertPublicMediaOfVisibleTenant(media, file, isMember) {
  const tenant = await TenantManager.getTenant(media.tenantId);
  if (
    isTenantPubliclyVisible(tenant) &&
    (await hasReachableHolder(tenant, media))
  ) {
    return;
  }
  const ownPeople =
    file.userId && (withinReach(media, "uploadedBy", file) || isMember);
  if (!ownPeople) {
    throw new NotFoundError("media_not_found", { mediaId: media.id });
  }
}

/**
 * Whether the public may see a medium by what holds it. Only a supervised
 * tenant asks: a medium that nothing but offers hold needs one of them to
 * be reachable; one that anything else holds (the tenant, the hero), or
 * nothing at all, is not an offer's to hide.
 *
 * @param {Object} tenant
 * @param {Object} media
 * @returns {Promise<boolean>}
 */
async function hasReachableHolder(tenant, media) {
  if (effectiveLevelOf(tenant) !== SUPERVISION_LEVELS.SUPERVISED) {
    return true;
  }
  const usage = await MediaUsageService.findUsage({
    tenantId: media.tenantId,
    mediaId: media.id,
  });
  const offerSites = usage.filter((site) => OFFER_USAGE.has(site.type));
  if (offerSites.length === 0 || offerSites.length < usage.length) {
    return true;
  }
  for (const site of offerSites) {
    const offer =
      site.type === USAGE_TYPE.EVENT
        ? await EventManager.getEvent(site.id, media.tenantId)
        : await BookableManager.getBookable(site.id, media.tenantId);
    if (offer && isOfferReachable({ tenant, offer })) {
      return true;
    }
  }
  return false;
}

/**
 * Read access to the file of a tenant medium: `public` media are readable
 * anonymously, an `intern` one for whoever the reach covers or is a member
 * of the owning tenant (glossary "Mitglied") - not one whose membership
 * rests. Booking documents follow the receipt rule, which is its own reach.
 *
 * @param {Object} media - The medium.
 * @param {Object} scopes
 * @param {{reach?: string, userId?: string|null}} scopes.file - The reach of
 *   `media.file`.
 * @param {{reach?: string, userId?: string|null}} scopes.document - The reach
 *   of `media.bookingDocument`.
 * @param {boolean} scopes.isMember - Whether the caller is a member of the
 *   medium's tenant: the caller's answer, never asked here.
 * @returns {Promise<void>}
 * @throws {UnauthorizedError|ForbiddenError}
 */
async function assertMediaFileAccess(
  media,
  { file = {}, document = {}, isMember = false } = {},
) {
  if (media.isBookingDocument()) {
    return await assertBookingDocumentAccess(media, document);
  }

  if (media.isPublic()) {
    return await assertPublicMediaOfVisibleTenant(media, file, isMember);
  }

  if (!file.userId) {
    throw new UnauthorizedError("unauthorized");
  }

  if (withinReach(media, "uploadedBy", file)) {
    return;
  }

  if (!isMember) {
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

  if (!readsRecords(scope)) {
    throw new UnauthorizedError("unauthorized");
  }
}

module.exports = {
  assertBookingDocumentAccess,
  assertInstanceMediaFileAccess,
  assertMediaFileAccess,
  coversBookingDocument,
};
