/**
 * The points of the locations of a tenant's records (bookables, events,
 * access points), read for the start view of the map (map
 * ECCdigital/tickets#372). The query reads the point and nothing else of a
 * record, so no record leaves the manager, and it reads within the reach
 * it is given (ADR 0002), never without one.
 */

const { ownCondition } = require("../services/authorization/reach");

/** The projection of the point alone. */
const POINT_ONLY = { _id: 0, "location.coordinates.points": 1 };

/**
 * The stored `points` of every record of the tenant within the reach,
 * `[lon, lat]` as kept, `[null, null]` and `undefined` included; the
 * caller decides what counts.
 *
 * @param {import("mongoose").Model} Model The model of the records
 * @param {string} resource The resource of the records, for the reach
 * @param {string} tenantId The tenant
 * @param {{reach: string, userId?: string|null}} scope The reach
 * @returns {Promise<Array<*>>} One `points` value per record
 * @throws {Error} without a reach, or under one that is no condition
 */
async function locationPointsOf(Model, resource, tenantId, scope) {
  const condition = ownCondition(resource, scope);
  const docs = await Model.find({ tenantId, ...condition }, POINT_ONLY).lean();
  return docs.map((doc) => doc?.location?.coordinates?.points);
}

module.exports = { locationPointsOf };
