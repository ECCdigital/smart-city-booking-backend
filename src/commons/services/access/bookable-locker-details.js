const AccessPointManager = require("../../data-managers/access-point-manager");
const {
  deriveLockerDetails,
} = require("../../entities/bookable/locker-details");

/**
 * Attaches the derived `lockerDetails` (see
 * `entities/bookable/locker-details.js`) to bookables on their way out of
 * the API. The rows every bookable references are loaded once for the
 * whole list; a list that references none loads nothing.
 *
 * @param {string} tenantId The tenant the bookables belong to
 * @param {Object[]} bookables Bookables, or the response objects made of
 *   them - anything carrying `accessPointDetails` and `amount`
 * @returns {Promise<Object[]>} Copies with `lockerDetails`, in order
 */
async function withLockerDetails(tenantId, bookables) {
  const ids = [
    ...new Set(
      bookables.flatMap((bookable) =>
        (bookable.accessPointDetails?.accessPointIds || []).map(String),
      ),
    ),
  ];
  const accessPoints = ids.length
    ? await AccessPointManager.getAccessPointsByIds(tenantId, ids)
    : [];

  return bookables.map((bookable) => ({
    ...bookable,
    lockerDetails: deriveLockerDetails(bookable, accessPoints),
  }));
}

module.exports = { withLockerDetails };
