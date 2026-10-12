/**
 * The points of the locations of a tenant's records (bookables, events,
 * access points), read for the start view of the map (map
 * ECCdigital/tickets#372). The query reads the point and nothing else of a
 * record, so no record leaves the manager.
 */

/** The projection of the point alone. */
const POINT_ONLY = { _id: 0, "location.coordinates.points": 1 };

/**
 * The stored `points` of every record of the tenant, `[lon, lat]` as kept,
 * `[null, null]` and `undefined` included; the caller decides what counts.
 *
 * @param {import("mongoose").Model} Model The model of the records
 * @param {string} tenantId The tenant
 * @returns {Promise<Array<*>>} One `points` value per record
 */
async function locationPointsOf(Model, tenantId) {
  const docs = await Model.find({ tenantId }, POINT_ONLY).lean();
  return docs.map((doc) => doc?.location?.coordinates?.points);
}

module.exports = { locationPointsOf };
