const MediaManager = require("../../data-managers/media-manager");
const BookingManager = require("../../data-managers/booking-manager");
const TenantManager = require("../../data-managers/tenant-manager");
const EventManager = require("../../data-managers/event-manager");
const { BookableManager } = require("../../data-managers/bookable-manager");
const { reached } = require("../supervision/public-projection");
const {
  SUPERVISION_LEVELS,
  effectiveLevelOf,
} = require("../supervision/supervision-constants");
const { MediaUsageService, USAGE_TYPE } = require("./media-usage");
const { readsRecords, withinReach, DOMAIN } = require("../authorization/reach");
const { REACH } = require("../authorization/policy");
const {
  ForbiddenError,
  NotFoundError,
  UnauthorizedError,
} = require("../../../errors/BaseError");

/**
 * The media rights (ticket 04 of the authorization architecture): which
 * rule a medium follows, decided in one place from the facts of the
 * medium. The caller brings a bundle of decided reaches (`reachesOf(req)`
 * in the authorization middleware: the entries the route's marker names,
 * plus the `userId`) and never the principal - the domain does not know
 * it. The bundle names the entries by action, and the medium picks the
 * side of the table: a medium without a tenant is an instance medium
 * (`instanceMedia.*`), every other one a tenant medium (`media.*`).
 *
 *   library             `read`, `update`, `delete` over the uploader
 *   booking document    the receipt rule, `bookingDocument` and
 *                       `updateBookingDocument` over the booking's owner
 *   file                the visibility: `public` for anyone (a tenant
 *                       medium under the public projection of its tenant),
 *                       `intern` for whoever `file` or `intern` reaches
 *   reference           the picker right of whoever saves an entity that
 *                       pins the medium: `media.read` over the uploader,
 *                       `instanceMedia.read` for an instance medium
 *
 * Every verb loads the medium itself (under `DOMAIN`) and answers it, or
 * throws the refusal: `401` anonymous, `404 media_not_found` for a medium
 * out of reach (glossary "Reichweite"), `403` for a rule of the facts
 * (a booking document is never deleted by hand, an internal file).
 *
 * The file route answers `403` where the metadata routes answer `404`: a
 * booking document of someone else, an internal medium. The `404` hides
 * that a medium exists; whoever asks for the file already holds its URL,
 * so there is nothing left to hide, and the refusal names itself. A public
 * medium out of the public projection stays a `404`: what the projection
 * does not carry is not there (ADR 0003).
 */

/** The usage sites that are offers (glossary "Angebot"). */
const OFFER_USAGE = new Set([USAGE_TYPE.BOOKABLE, USAGE_TYPE.EVENT]);

/**
 * One entry of the bundle, as the reach helpers take it.
 *
 * @param {Object} reaches - The bundle.
 * @param {string} action - The entry asked about.
 * @returns {{reach: string|null, userId: string|null}}
 */
const entryOf = (reaches, action) => ({
  reach: reaches?.[action] ?? null,
  userId: reaches?.userId ?? null,
});

const notFound = (mediaId) => new NotFoundError("media_not_found", { mediaId });

function assertSignedIn(reaches) {
  if (!reaches?.userId) {
    throw new UnauthorizedError("unauthorized");
  }
}

async function load(mediaId, tenantId) {
  const media = await MediaManager.getMedia(mediaId, tenantId ?? null, DOMAIN);
  if (!media) {
    throw notFound(mediaId);
  }
  return media;
}

/**
 * Whether any booking a document references satisfies a predicate - the OR
 * semantics every booking document rule shares, with an early exit.
 * References to bookings that no longer exist are skipped.
 */
async function anyReferencedBooking(media, predicate) {
  for (const bookingId of media.bookingIds || []) {
    const booking = await BookingManager.getBooking(
      bookingId,
      media.tenantId,
      DOMAIN,
    );

    if (booking && predicate(booking)) {
      return true;
    }
  }

  return false;
}

/**
 * The receipt rule: `any` covers every booking document of the tenant,
 * `own` the documents of one's own bookings - a paying customer gets
 * their invoice without holding any role, and an aggregated document is
 * covered for every participant of its group.
 *
 * @param {Object} media - The booking document.
 * @param {{reach: string|null, userId: string|null}} scope
 * @returns {Promise<boolean>}
 */
async function coversBookingDocument(media, scope) {
  if (!readsRecords(scope)) {
    return false;
  }
  return await anyReferencedBooking(media, (booking) =>
    withinReach(booking, "assignedUserId", scope),
  );
}

/**
 * Whether the medium is within the reach of a library entry, or - for a
 * booking document - of the receipt rule's entry.
 */
async function covers(media, reaches, { library, document }) {
  if (media.isBookingDocument()) {
    return await coversBookingDocument(media, entryOf(reaches, document));
  }
  return withinReach(media, "uploadedBy", entryOf(reaches, library));
}

/**
 * Whether the bundle reads internal files: whoever `file` reaches records
 * for, or `intern` (a member of the tenant; any signed-in user on the
 * instance, where no membership could narrow it).
 */
const readsIntern = (reaches) =>
  readsRecords(entryOf(reaches, "file")) ||
  readsRecords(entryOf(reaches, "intern"));

/**
 * The offers that hold a medium, when offers alone hold it - the case the
 * public projection decides. `null` when anything else holds it too, or
 * nothing at all: that medium is no offer's to hide.
 */
async function offersHoldingAlone(media) {
  const usage = await MediaUsageService.findUsage({
    tenantId: media.tenantId,
    mediaId: media.id,
  });
  const sites = usage.filter((site) => OFFER_USAGE.has(site.type));
  if (sites.length === 0 || sites.length < usage.length) {
    return null;
  }
  const offers = [];
  for (const site of sites) {
    const offer =
      site.type === USAGE_TYPE.EVENT
        ? await EventManager.getEvent(site.id, media.tenantId, DOMAIN)
        : await BookableManager.getBookable(site.id, media.tenantId, DOMAIN);
    if (offer) {
      offers.push(offer);
    }
  }
  return offers;
}

/**
 * Whether a public tenant medium goes out to the public (tenant
 * supervision spec §5.2): its tenant has a public projection, and under a
 * supervised tenant a medium that only offers hold goes out with one of
 * them the public reaches (`public-projection.reached`). Only a supervised
 * tenant hides an offer, so only there the holders are looked up.
 */
async function isPubliclyOut(media) {
  const tenant = await TenantManager.getTenant(media.tenantId, DOMAIN);
  const offers =
    tenant && effectiveLevelOf(tenant) === SUPERVISION_LEVELS.SUPERVISED
      ? await offersHoldingAlone(media)
      : null;
  try {
    const out = await reached(media.tenantId, offers ?? []);
    return offers === null || out.length > 0;
  } catch (err) {
    if (err instanceof NotFoundError && err.code === "tenant_not_found") {
      return false;
    }
    throw err;
  }
}

/**
 * The tenant's own people keep reading a public medium the public does
 * not see: its uploader under `file`, and whoever `file` or `intern`
 * reaches every record for.
 */
const isOwnPeople = (media, reaches) =>
  Boolean(reaches?.userId) &&
  (withinReach(media, "uploadedBy", entryOf(reaches, "file")) ||
    readsRecords(entryOf(reaches, "intern")));

/**
 * The metadata of a medium: the library's `read`, or the receipt rule
 * for a booking document.
 *
 * @param {string} mediaId
 * @param {string|null} tenantId - `null` is the instance library.
 * @param {Object} reaches - `read`, `bookingDocument`, `userId`.
 * @returns {Promise<Object>} The medium.
 * @throws {UnauthorizedError|NotFoundError}
 */
async function readable(mediaId, tenantId, reaches) {
  assertSignedIn(reaches);
  const media = await load(mediaId, tenantId);
  if (
    !(await covers(media, reaches, {
      library: "read",
      document: "bookingDocument",
    }))
  ) {
    throw notFound(media.id);
  }
  return media;
}

/**
 * A change of the metadata: the library's `update`, or the update side of
 * the receipt rule for a booking document.
 *
 * @param {string} mediaId
 * @param {string|null} tenantId
 * @param {Object} reaches - `update`, `updateBookingDocument`, `userId`.
 * @returns {Promise<Object>} The medium.
 * @throws {UnauthorizedError|NotFoundError}
 */
async function updatable(mediaId, tenantId, reaches) {
  assertSignedIn(reaches);
  const media = await load(mediaId, tenantId);
  if (
    !(await covers(media, reaches, {
      library: "update",
      document: "updateBookingDocument",
    }))
  ) {
    throw notFound(media.id);
  }
  return media;
}

/**
 * A deletion: the library's `delete`, and never a booking document - every
 * one the platform writes is a system receipt that only cascades with its
 * booking, so no right can grant it.
 *
 * @param {string} mediaId
 * @param {string|null} tenantId
 * @param {Object} reaches - `delete`, `userId`.
 * @returns {Promise<Object>} The medium.
 * @throws {UnauthorizedError|NotFoundError|ForbiddenError}
 */
async function deletable(mediaId, tenantId, reaches) {
  assertSignedIn(reaches);
  const media = await load(mediaId, tenantId);
  if (!withinReach(media, "uploadedBy", entryOf(reaches, "delete"))) {
    throw notFound(media.id);
  }
  if (media.isBookingDocument()) {
    throw new ForbiddenError("booking_document_not_deletable", {
      bookingIds: media.bookingIds,
    });
  }
  return media;
}

/**
 * The file of a medium already loaded: the receipt rule for a booking
 * document, the visibility for everything else.
 *
 * @param {Object} media
 * @param {Object} reaches - `file`, `intern`, `bookingDocument`, `userId`.
 * @returns {Promise<void>}
 * @throws {UnauthorizedError|ForbiddenError|NotFoundError}
 */
async function assertFileReadable(media, reaches) {
  const isInstance = media.tenantId == null;

  if (media.isBookingDocument()) {
    assertSignedIn(reaches);
    if (
      !(await coversBookingDocument(media, entryOf(reaches, "bookingDocument")))
    ) {
      throw new ForbiddenError("forbidden");
    }
    return;
  }

  if (media.isPublic()) {
    if (
      isInstance ||
      (await isPubliclyOut(media)) ||
      isOwnPeople(media, reaches)
    ) {
      return;
    }
    throw notFound(media.id);
  }

  assertSignedIn(reaches);
  if (readsIntern(reaches)) {
    return;
  }
  throw isInstance
    ? new UnauthorizedError("unauthorized")
    : new ForbiddenError("forbidden");
}

/**
 * The file of a medium.
 *
 * @param {string} mediaId
 * @param {string|null} tenantId
 * @param {Object} reaches - `file`, `intern`, `bookingDocument`, `userId`.
 * @returns {Promise<Object>} The medium.
 */
async function fileReadable(mediaId, tenantId, reaches) {
  const media = await load(mediaId, tenantId);
  await assertFileReadable(media, reaches);
  return media;
}

/**
 * The file of an imported medium, found by the place its bytes had in the
 * legacy tree (the resolver route `GET /files/get?name=`): the medium,
 * readable as its file; `null` where the path names no imported medium,
 * for the resolver to look in the old tree.
 *
 * @param {string|null} tenantId - The tenant, `null` on the instance.
 * @param {string} legacyPath - Normalised legacy path.
 * @param {Object} reaches - `file`, `intern`, `bookingDocument`, `userId`.
 * @returns {Promise<Object|null>} The medium, or null.
 * @throws {UnauthorizedError|ForbiddenError|NotFoundError}
 */
async function importedFileReadable(tenantId, legacyPath, reaches) {
  const media = await MediaManager.getMediaByLegacyPath(
    tenantId ?? null,
    legacyPath,
    DOMAIN,
  );
  if (!media) {
    return null;
  }
  await assertFileReadable(media, reaches);
  return media;
}

/**
 * A file of the legacy tree the media import has not taken over yet: a
 * public one for anyone, a protected one as an internal medium - a member
 * of the owning tenant, any signed-in user for a tenant-less file.
 *
 * @param {{isPublic: boolean, tenantId: string|null}} file
 * @param {Object} reaches - `file`, `intern`, `userId`.
 * @returns {void}
 * @throws {UnauthorizedError|ForbiddenError}
 */
function legacyFileReadable({ isPublic, tenantId }, reaches) {
  if (isPublic) {
    return;
  }
  assertSignedIn(reaches);
  if (readsIntern(reaches)) {
    return;
  }
  throw tenantId
    ? new ForbiddenError("forbidden")
    : new UnauthorizedError("unauthorized");
}

/**
 * The picker right, by the side of the table the medium belongs to. The
 * saver of an entity asks it from a route of another resource, so the
 * bundle names it with its resource (`also: ["media.read"]`).
 */
const PICKER = Object.freeze({
  tenant: "media.read",
  instance: "instanceMedia.read",
});

/**
 * Whether whoever saves an entity may pin a medium to it: a tenant medium
 * within the reach of the picker right over its uploader, an instance
 * medium for the instance library's `any` alone. The saver has loaded the
 * medium in the tenant of the entity (the tenant boundary); the facts of
 * the reference - unknown, a booking document, not public - are the
 * saver's (`media-reference-guard.js`).
 *
 * @param {Object} media - The medium, loaded by the saver.
 * @param {Object} reaches - `media.read` or `instanceMedia.read`, `userId`.
 * @returns {void}
 * @throws {ForbiddenError} The picker right does not cover the medium.
 */
function referenceable(media, reaches) {
  const covered =
    media.tenantId == null
      ? reaches?.[PICKER.instance] === REACH.ANY
      : withinReach(media, "uploadedBy", entryOf(reaches, PICKER.tenant));
  if (!covered) {
    throw new ForbiddenError("forbidden", { mediaId: media.id });
  }
}

module.exports = {
  readable,
  updatable,
  deletable,
  fileReadable,
  importedFileReadable,
  legacyFileReadable,
  referenceable,
};
