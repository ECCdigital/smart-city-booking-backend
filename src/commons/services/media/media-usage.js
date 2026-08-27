const BookingManager = require("../../data-managers/booking-manager");
const EventManager = require("../../data-managers/event-manager");
const InstanceManager = require("../../data-managers/instance-manager");
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
   * did, blocking its deletion is the safe answer.
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

    const [bookables, events, bookings, instance] = await Promise.all([
      BookableManager.getMediaUsage(tenantId, mediaId),
      EventManager.getMediaUsage(tenantId, mediaId),
      BookingManager.getMediaUsage(tenantId, mediaId),
      InstanceManager.getMediaUsage(mediaId),
    ]);

    return [
      ...labelled(USAGE_TYPE.BOOKABLE, bookables),
      ...labelled(USAGE_TYPE.EVENT, events),
      ...labelled(USAGE_TYPE.BOOKING, bookings),
      ...labelled(USAGE_TYPE.INSTANCE, instance),
    ];
  }
}

module.exports = { USAGE_TYPE, MediaUsageService };
