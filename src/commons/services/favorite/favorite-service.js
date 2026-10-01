/**
 * The favorites of a signed-in user (glossary "Favorit", "Favoritenliste"):
 * marking an offer and removing the mark, both idempotent, and reading
 * the list - as references, or hydrated with the state of every entry.
 * Favorites are the user's alone, so the service reads them for the user
 * under `DOMAIN` (`self` reaches no record, as "my bookings" does); the
 * offer itself is read with the reach the route decided for it when
 * marking - the public's, or the staff's management view (`also` on the
 * marker: `bookable.readPublic`, `event.read`) - so a user marks only
 * what they reach at this moment. A tenant without a public projection
 * has nothing to mark (`404 tenant_not_found`, ADR 0003).
 *
 * The state of an entry is decided when the list is read, never stored:
 * the targets of the favorites are loaded per tenant and kind once as the
 * domain (does the offer exist?) and once as the public through the
 * projection `reached` (does the public reach it?). An offer the domain
 * does not find is `deleted`; one the public does not reach - the tenant
 * pending or declined, the review not approved, a ticket's event not
 * approved - is `unavailable`; the rest is `available` and carries the
 * offer in its public projection. No favorite disappears by itself, and
 * no removal of an offer needs a cascade here.
 */

const { BookableManager } = require("../../data-managers/bookable-manager");
const EventManager = require("../../data-managers/event-manager");
const FavoriteManager = require("../../data-managers/favorite-manager");
const TenantManager = require("../../data-managers/tenant-manager");
const {
  Favorite,
  FavoriteTargetType,
  isFavoriteTargetType,
} = require("../../entities/favorite/favorite");
const { DOMAIN, PUBLIC } = require("../authorization/reach");
const {
  BadRequestError,
  ConflictError,
  NotFoundError,
} = require("../../../errors/BaseError");

/** The favorites a user may hold, without `FAVORITES_MAX_PER_USER`. */
const DEFAULT_MAX_FAVORITES_PER_USER = 200;

/**
 * The state of an entry of the favorites list (glossary "Favoritenliste":
 * _verfügbar_, _nicht verfügbar_, _gelöscht_), decided when it is read.
 */
const FAVORITE_STATUS = Object.freeze({
  AVAILABLE: "available",
  UNAVAILABLE: "unavailable",
  DELETED: "deleted",
});

/**
 * Each kind of target: the entry of the rights table a route names on its
 * marker for the read of one offer, the manager reads - one by id, many
 * by ids within a tenant - and the offer as the public delivery gives it.
 */
const TARGETS = {
  [FavoriteTargetType.BOOKABLE]: {
    entry: "bookable.readPublic",
    read: (id, tenantId, scope) =>
      BookableManager.getBookable(id, tenantId, scope),
    readMany: (tenantId, ids, scope) =>
      BookableManager.getBookablesByIds(tenantId, ids, scope),
    titleOf: (bookable) => bookable.title ?? "",
    // As the public bookable routes deliver it: media addresses resolved.
    publicView: (bookable) => bookable.withResolvedMediaUrls(),
  },
  [FavoriteTargetType.EVENT]: {
    entry: "event.read",
    read: (id, tenantId, scope) => EventManager.getEvent(id, tenantId, scope),
    readMany: (tenantId, ids, scope) =>
      EventManager.getEventsByIds(
        ids.map((id) => ({ tenantId, id })),
        scope,
      ),
    titleOf: (event) => event.information?.name ?? "",
    // As the public event routes deliver it: the entity, already without
    // its review.
    publicView: (event) => event,
  },
};

/**
 * The limit per user: `FAVORITES_MAX_PER_USER`, read at call time; a
 * value that is not a positive integer falls back to the default.
 *
 * @returns {number}
 */
function maxFavoritesPerUser() {
  const value = Number(process.env.FAVORITES_MAX_PER_USER);
  return Number.isInteger(value) && value > 0
    ? value
    : DEFAULT_MAX_FAVORITES_PER_USER;
}

function targetOf(targetType) {
  if (!isFavoriteTargetType(targetType)) {
    throw new BadRequestError("favorite.invalid_target_type", { targetType });
  }
  return TARGETS[targetType];
}

/** The target of a favorite as a map key. */
const targetKeyOf = ({ tenantId, targetType, targetId }) =>
  `${tenantId}/${targetType}/${targetId}`;

/**
 * The public's read of some offers: what the public reaches of them. A
 * tenant without a public projection answers the public's 404 at the
 * managers (ADR 0003); here it reaches none of its offers.
 *
 * @param {() => Promise<Object[]>} read
 * @returns {Promise<Object[]>}
 */
async function reachedByPublic(read) {
  try {
    return await read();
  } catch (err) {
    if (err?.code !== "tenant_not_found") throw err;
    return [];
  }
}

/**
 * The targets of some favorites, loaded per tenant and kind once as the
 * domain and once as the public, keyed by target: what exists, and of it
 * what the public reaches.
 *
 * @param {Favorite[]} favorites
 * @returns {Promise<Map<string, {reached: Object|null}>>} An entry per
 *   target that exists; `reached` is the offer the public reaches, or null
 */
async function loadTargets(favorites) {
  const groups = new Map();
  for (const favorite of favorites) {
    const key = `${favorite.tenantId}/${favorite.targetType}`;
    const group = groups.get(key) ?? {
      tenantId: favorite.tenantId,
      targetType: favorite.targetType,
      ids: new Set(),
    };
    group.ids.add(favorite.targetId);
    groups.set(key, group);
  }

  const targets = new Map();
  for (const { tenantId, targetType, ids } of groups.values()) {
    const target = TARGETS[targetType];
    const list = [...ids];
    const [existing, reached] = await Promise.all([
      target.readMany(tenantId, list, DOMAIN),
      reachedByPublic(() => target.readMany(tenantId, list, PUBLIC)),
    ]);
    const reachedById = new Map(reached.map((offer) => [offer.id, offer]));
    for (const offer of existing) {
      targets.set(targetKeyOf({ tenantId, targetType, targetId: offer.id }), {
        reached: reachedById.get(offer.id) ?? null,
      });
    }
  }
  return targets;
}

/**
 * One entry of the hydrated list: the favorite with its state, and the
 * offer in its public projection where it is available.
 *
 * @param {Favorite} favorite
 * @param {{reached: Object|null}|undefined} target What `loadTargets`
 *   found for the favorite's target; none means the offer is gone
 * @returns {Object}
 */
function entryOf(favorite, target) {
  const entry = favorite.toResponse();
  if (!target) {
    return { ...entry, status: FAVORITE_STATUS.DELETED };
  }
  if (!target.reached) {
    return { ...entry, status: FAVORITE_STATUS.UNAVAILABLE };
  }
  return {
    ...entry,
    status: FAVORITE_STATUS.AVAILABLE,
    offer: TARGETS[favorite.targetType].publicView(target.reached),
  };
}

class FavoriteService {
  /**
   * The favorites of the user, across every tenant or within one, newest
   * first - the domain's read for the user (`self` reaches no record).
   *
   * @param {Object} params
   * @param {string} params.userId The signed-in user
   * @param {string|null} [params.tenantId] The tenant to narrow to
   * @returns {Promise<Favorite[]>}
   */
  static async getFavorites({ userId, tenantId = null }) {
    return FavoriteManager.getFavorites(userId, tenantId, DOMAIN);
  }

  /**
   * The favorites of the user with their state, as the favorites page
   * shows them: each entry with the snapshot, its `status` (`available`,
   * `unavailable`, `deleted`) and, when available, the `offer` in its
   * public projection. The order is the favorites', newest first.
   *
   * @param {Object} params
   * @param {string} params.userId The signed-in user
   * @param {string|null} [params.tenantId] The tenant to narrow to
   * @returns {Promise<Object[]>} The entries
   */
  static async getFavoriteOffers({ userId, tenantId = null }) {
    const favorites = await FavoriteManager.getFavorites(
      userId,
      tenantId,
      DOMAIN,
    );
    const targets = await loadTargets(favorites);
    return favorites.map((favorite) =>
      entryOf(favorite, targets.get(targetKeyOf(favorite))),
    );
  }

  /**
   * Marks an offer as a favorite of the user. Idempotent: an offer already
   * marked answers the existing favorite, snapshot untouched.
   *
   * @param {Object} params
   * @param {string} params.userId The signed-in user
   * @param {string} params.tenantId The tenant of the offer
   * @param {string} params.targetType `bookable` or `event`
   * @param {string} params.targetId The id of the offer
   * @param {Object<string, string|null>} params.reaches The reaches the
   *   route decided (`reachesOf(req)`): the read of the offer takes the
   *   one of its entry
   * @returns {Promise<Favorite>} The favorite
   * @throws {BadRequestError} `favorite.invalid_target_type`
   * @throws {NotFoundError} `favorite.offer_not_found` for an offer the
   *   user does not reach, `tenant_not_found` for a tenant without a
   *   public projection
   * @throws {ConflictError} `favorite.limit_reached` at the limit
   */
  static async markFavorite({
    userId,
    tenantId,
    targetType,
    targetId,
    reaches,
  }) {
    const target = targetOf(targetType);
    const offer = await target.read(targetId, tenantId, {
      reach: reaches?.[target.entry] ?? undefined,
      userId: reaches?.userId ?? userId,
    });
    if (!offer) {
      throw new NotFoundError("favorite.offer_not_found", {
        tenantId,
        targetType,
        targetId,
      });
    }

    const existing = await FavoriteManager.getFavorite(
      userId,
      tenantId,
      targetType,
      targetId,
      DOMAIN,
    );
    if (existing) {
      return existing;
    }

    const limit = maxFavoritesPerUser();
    if ((await FavoriteManager.countFavorites(userId)) >= limit) {
      throw new ConflictError("favorite.limit_reached", { limit });
    }

    const tenant = await TenantManager.getTenant(tenantId, DOMAIN);
    return FavoriteManager.storeFavorite(
      Favorite.create({
        userId,
        tenantId,
        targetType,
        targetId,
        title: target.titleOf(offer),
        tenantName: tenant?.name ?? "",
      }),
    );
  }

  /**
   * Removes a favorite of the user. Idempotent: nothing to remove is fine.
   *
   * @param {Object} params
   * @param {string} params.userId
   * @param {string} params.tenantId
   * @param {string} params.targetType `bookable` or `event`
   * @param {string} params.targetId
   * @returns {Promise<void>}
   * @throws {BadRequestError} `favorite.invalid_target_type`
   */
  static async unmarkFavorite({ userId, tenantId, targetType, targetId }) {
    targetOf(targetType);
    await FavoriteManager.removeFavorite(
      userId,
      tenantId,
      targetType,
      targetId,
    );
  }
}

module.exports = FavoriteService;
module.exports.DEFAULT_MAX_FAVORITES_PER_USER = DEFAULT_MAX_FAVORITES_PER_USER;
module.exports.FAVORITE_STATUS = FAVORITE_STATUS;
module.exports.maxFavoritesPerUser = maxFavoritesPerUser;
