const ACCESS_POINT_TYPE_DOOR = "door";
const ACCESS_POINT_MODE_AUTHORIZATION = "authorization";
const DEDUPE_KEY_SEPARATOR = "\u0000";

/**
 * The key that decides whether two embedded points describe the same physical
 * lock. Points without an external id cannot be recognised as duplicates and
 * therefore always become their own entity.
 *
 * @param {string} tenantId The tenant the point belongs to
 * @param {Object} point An embedded access point of a bookable
 * @returns {string|null} The dedupe key, or null if the point cannot be merged
 */
function dedupeKey(tenantId, point) {
  if (!point.externalId) {
    return null;
  }

  return [tenantId, point.provider, point.externalId].join(
    DEDUPE_KEY_SEPARATOR,
  );
}

/**
 * Turn an embedded point into an access point of the `accesspoints` collection.
 * The per point access buffer has no successor and is dropped; existing
 * `validationRules` stay empty so migrated doors open exactly as before.
 *
 * @param {string} tenantId The tenant the point belongs to
 * @param {Object} point An embedded access point of a bookable
 * @returns {Object} The access point fields, without its scan codes
 */
function toAccessPoint(tenantId, point) {
  return {
    id: point.id,
    tenantId: tenantId,
    type: ACCESS_POINT_TYPE_DOOR,
    provider: point.provider,
    externalId: point.externalId || "",
    providerLocationId: point.locationId || null,
    label: point.label || "",
    mode: point.mode || ACCESS_POINT_MODE_AUTHORIZATION,
    config: point.config || {},
    location: null,
    validationRules: [],
  };
}

/**
 * Plan the move of the access points embedded in bookables into the
 * tenant-wide `accesspoints` collection.
 *
 * Points that describe the same physical lock of the same tenant become one
 * access point. The first point of such a group wins completely - its id,
 * label, mode, config and provider location survive - and every later point
 * leaves its id behind as a rewrite. The plan is derived from the passed
 * bookables alone, so planning the same data twice yields the same result.
 *
 * @param {Object[]} bookables Bookables carrying `accessPointDetails.points`,
 *   in ObjectId order - the order decides which point of a group wins
 * @returns {{accessPoints: Object[], bookableReferences: Object[], merges: Object[]}}
 *   The access points to create, the access point ids per bookable, and the
 *   merges that happened - each one a loser id to rewrite to its winner
 */
function planAccessPointMigration(bookables = []) {
  const accessPoints = [];
  const bookableReferences = [];
  const merges = [];
  const winnerIdByKey = new Map();

  for (const bookable of bookables) {
    const accessPointIds = [];

    for (const point of bookable.accessPointDetails?.points || []) {
      const key = dedupeKey(bookable.tenantId, point);
      const winnerId = key === null ? null : winnerIdByKey.get(key);

      if (winnerId === undefined || winnerId === null) {
        accessPoints.push(toAccessPoint(bookable.tenantId, point));

        if (key !== null) {
          winnerIdByKey.set(key, point.id);
        }
      } else if (winnerId !== point.id) {
        merges.push({
          tenantId: bookable.tenantId,
          provider: point.provider,
          externalId: point.externalId,
          winnerId: winnerId,
          loserId: point.id,
          bookableId: bookable.id,
        });
      }

      const referencedId = winnerId || point.id;
      if (!accessPointIds.includes(referencedId)) {
        accessPointIds.push(referencedId);
      }
    }

    bookableReferences.push({
      _id: bookable._id,
      accessPointIds: accessPointIds,
    });
  }

  return {
    accessPoints: accessPoints,
    bookableReferences: bookableReferences,
    merges: merges,
  };
}

/**
 * Group the merges of a plan into the id rewrites to apply per tenant.
 *
 * @param {Object[]} merges The merges of a migration plan
 * @returns {Map<string, Map<string, string>>} tenantId -> (loser id -> winner id)
 */
function winnerIdsByTenant(merges = []) {
  const byTenant = new Map();

  for (const merge of merges) {
    if (!byTenant.has(merge.tenantId)) {
      byTenant.set(merge.tenantId, new Map());
    }
    byTenant.get(merge.tenantId).set(merge.loserId, merge.winnerId);
  }

  return byTenant;
}

/**
 * Point the entries of a booking's access info at the winning access points.
 *
 * @param {Object[]} accessInfo The access info entries of a booking
 * @param {Map<string, string>} winnerIds Loser id to winner id
 * @returns {Object[]} The access info with every merged away id replaced
 */
function rewriteAccessInfo(accessInfo = [], winnerIds) {
  return accessInfo.map((entry) =>
    winnerIds.has(entry.accessPointId)
      ? { ...entry, accessPointId: winnerIds.get(entry.accessPointId) }
      : entry,
  );
}

/**
 * Turn an access point back into a point embedded in a bookable. Used by the
 * rollback only, where losing the per point access buffer is accepted.
 *
 * @param {Object} accessPoint An access point of the `accesspoints` collection
 * @returns {Object} The embedded point
 */
function toEmbeddedPoint(accessPoint) {
  return {
    id: accessPoint.id,
    provider: accessPoint.provider,
    externalId: accessPoint.externalId,
    locationId: accessPoint.providerLocationId || null,
    label: accessPoint.label,
    mode: accessPoint.mode,
    config: accessPoint.config || {},
  };
}

module.exports = {
  planAccessPointMigration,
  winnerIdsByTenant,
  rewriteAccessInfo,
  toEmbeddedPoint,
};
