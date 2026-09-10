const BookingManager = require("../../data-managers/booking-manager");
const CatalogManager = require("../../data-managers/catalog-manager");
const EventManager = require("../../data-managers/event-manager");
const InstanceManager = require("../../data-managers/instance-manager");
const TenantManager = require("../../data-managers/tenant-manager");
const { BookableManager } = require("../../data-managers/bookable-manager");

/**
 * The kinds of usage site a medium can turn up in. The type travels with every
 * finding so the admin UI can link it without guessing.
 */
const USAGE_TYPE = Object.freeze({
  BOOKABLE: "bookable",
  EVENT: "event",
  BOOKING: "booking",
  INSTANCE: "instance",
  TENANT: "tenant",
  HERO: "hero",
});

/**
 * Labels the findings of one reference site with their usage type and reduces
 * them to the three fields a usage proof carries.
 *
 * @param {string} type - One of {@link USAGE_TYPE}.
 * @param {Array<{id: string|null, title: string}>} sites - Raw findings.
 * @returns {Array<{type: string, id: string|null, title: string}>}
 */
function labelled(type, sites) {
  return sites.map(({ id, title }) => ({
    type,
    id: id ?? null,
    title: title ?? "",
  }));
}

/**
 * The Hero as a usage site: the image Blocks of the instance catalog's Hero
 * Layout and the Background of the instance branding. The two sit in different
 * documents but are one place to an admin — the Hero editor — so they report
 * as one entry, carrying the id of the instance catalog.
 *
 * @param {string} mediaId - Id of the medium.
 * @returns {Promise<Array<{id: string|null, title: string}>>} The one site, or
 *   none.
 */
async function heroSites(mediaId) {
  const [inLayout, inBackground] = await Promise.all([
    CatalogManager.hasHeroLayoutMedia(mediaId),
    InstanceManager.hasBackgroundMedia(mediaId),
  ]);

  if (!inLayout && !inBackground) {
    return [];
  }

  // An instance can hold a Background before it has a catalog to edit it on.
  // A site without an id still blocks the deletion, which is what the finding
  // is for; a Hero that goes unreported would not.
  const site = await CatalogManager.getHeroSite();

  return [site ?? { id: null, title: "" }];
}

/**
 * The usage proof of a medium (§4.7 of the media spec): every entity that
 * references it, searched on demand across the reference sites. There is no
 * `usedBy` field and no back reference at the medium — a stored index would
 * drift the moment an entity is edited elsewhere.
 */
class MediaUsageService {
  /**
   * All usage sites of a medium.
   *
   * The instance is searched for every medium, not only for instance media: a
   * tenant medium must never end up in an instance context, but if one ever
   * did, blocking its deletion is the safe answer. The tenant is searched the
   * other way round — only in its own scope, because an instance medium has no
   * tenant whose legal documents could hold it.
   *
   * @param {Object} params
   * @param {string|null} params.tenantId - Tenant of the medium.
   * @param {string} params.mediaId - Id of the medium.
   * @returns {Promise<Array<{type: string, id: string|null, title: string}>>}
   *   One entry per usage site, empty when the medium is unused.
   */
  static async findUsage({ tenantId, mediaId }) {
    if (!mediaId) {
      return [];
    }

    const [bookables, events, bookings, instance, tenant, hero] =
      await Promise.all([
        BookableManager.getMediaUsage(tenantId, mediaId),
        EventManager.getMediaUsage(tenantId, mediaId),
        BookingManager.getMediaUsage(tenantId, mediaId),
        InstanceManager.getMediaUsage(mediaId),
        TenantManager.getMediaUsage(tenantId, mediaId),
        heroSites(mediaId),
      ]);

    return [
      ...labelled(USAGE_TYPE.BOOKABLE, bookables),
      ...labelled(USAGE_TYPE.EVENT, events),
      ...labelled(USAGE_TYPE.BOOKING, bookings),
      ...labelled(USAGE_TYPE.INSTANCE, instance),
      ...labelled(USAGE_TYPE.TENANT, tenant),
      ...labelled(USAGE_TYPE.HERO, hero),
    ];
  }

  /**
   * The usage sites of a medium that anonymous visitors see: the branding and
   * the Hero. They are what keeps a medium from turning internal — the pages
   * they paint are served to whoever asks, so an internal medium behind one
   * would simply stop loading.
   *
   * Everything else is left out on purpose. The legal documents of the
   * instance may hold an internal medium, and the public entities of a tenant
   * are guarded at their own save, where the entity's visibility is known.
   *
   * @param {Object} params
   * @param {string} params.mediaId - Id of the medium.
   * @returns {Promise<Array<{type: string, id: string|null, title: string}>>}
   *   One entry per usage site, empty when nothing public holds the medium.
   */
  static async findPublicUsage({ mediaId }) {
    if (!mediaId) {
      return [];
    }

    const [branding, hero] = await Promise.all([
      InstanceManager.getBrandingMediaUsage(mediaId),
      heroSites(mediaId),
    ]);

    return [
      ...labelled(USAGE_TYPE.INSTANCE, branding),
      ...labelled(USAGE_TYPE.HERO, hero),
    ];
  }
}

module.exports = { USAGE_TYPE, MediaUsageService };
