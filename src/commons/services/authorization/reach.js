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
 *
 * `withinReach` is the same question about a record already in hand, for
 * an adapter that loaded it before it knew which reach applies (a medium
 * that turns out to be a booking document, a referenced medium that has
 * to be told apart from an unknown one). It is asked by adapters, which
 * always hold a reach, so it answers no to everything but `any` and an
 * owned record - where `ownCondition` widens for a caller inside the
 * domain, `withinReach` closes.
 *
 * `readsRecords` is the question the two of them leave open: whether a
 * reach reaches records at all, or only what the public sees.
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

/**
 * Whether a record the caller already holds lies within a reach.
 *
 * @param {Object} record - The record.
 * @param {string} key - The field that names the owner of the entity.
 * @param {{reach?: string, userId?: string|null}} [scope]
 * @returns {boolean}
 */
function withinReach(record, key, { reach, userId } = {}) {
  if (reach === REACH.ANY) {
    return true;
  }
  if (reach === REACH.OWN) {
    return Boolean(userId) && record?.[key] === userId;
  }
  return false;
}

/**
 * Whether a reach reaches records at all: `any` and `own` do, `public` and
 * no reach do not.
 *
 * @param {{reach?: string}} [scope]
 * @returns {boolean}
 */
function readsRecords({ reach } = {}) {
  return reach === REACH.ANY || reach === REACH.OWN;
}

module.exports = { ownCondition, withinReach, readsRecords };
