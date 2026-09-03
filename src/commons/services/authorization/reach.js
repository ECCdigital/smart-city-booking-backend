/**
 * The reach (glossary "Reichweite") as a query condition, spec §4.1: the
 * manager of an entity names the key that means "own" for it - `ownerUserId`
 * at bookables, events and coupons, `assignedUserId` at bookings and group
 * bookings - and gets back what to add to its query. The reach itself
 * carries no schema knowledge; only the manager knows its key.
 *
 *   any        nothing - every record of the tenant
 *   own        `{ [key]: userId }` - the principal's own records
 *   undefined  nothing - a caller inside the domain that reads everything
 *
 * A `public` reach is not a condition on records: what the public sees is
 * each manager's own answer (its public records, or nothing), so asking
 * for a condition under it is a programming error, as is `own` without a
 * user - the condition would match records nobody owns.
 */

const { REACH } = require("./policy");

/**
 * @param {string} key - The field that names the owner of the entity.
 * @param {{reach?: string, userId?: string|null}} [scope]
 * @returns {Object} The condition to spread into the query.
 */
function ownCondition(key, { reach, userId } = {}) {
  if (reach === undefined || reach === REACH.ANY) {
    return {};
  }
  if (reach === REACH.OWN) {
    if (!userId) {
      throw new Error("authorization: reach own without a user");
    }
    return { [key]: userId };
  }
  throw new Error(`authorization: no record condition under reach ${reach}`);
}

module.exports = { ownCondition };
