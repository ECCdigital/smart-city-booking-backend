const { AccessPointType } = require("../../schemas/accessPointSchema");

const IFBS = "ifbs";

/**
 * `booking.lockerInfo` as the locker stack used to store it, derived from
 * the booking's `accessInfo` entries of type `locker`: one record per
 * compartment, in the entries' order. The record is what the Admin UI
 * reads in BookingDetails - which locker system, whether the compartment
 * is confirmed and under which process - and, for iFBS, the box facts the
 * stack noted from `getBox`. Nothing writes it back; the entries are the
 * truth.
 *
 * @param {Object[]|undefined} accessInfo The booking's `accessInfo`
 * @returns {Object[]} The compartments as `lockerInfo` records:
 *   `{ id, lockerSystem, bookableId, isConfirmed, processId }`, iFBS ones
 *   with `ifbsMetadata: { boxId, nummer, price, bookingId }`
 */
function deriveLockerInfo(accessInfo) {
  return (accessInfo || [])
    .filter((entry) => entry.accessPointType === AccessPointType.LOCKER)
    .map(toLockerInfo);
}

function toLockerInfo(entry) {
  const authorizationId = entry.grant?.authorizationId ?? null;
  const isConfirmed = Boolean(authorizationId) && !entry.revokedAt;
  const info = {
    id: entry.externalId ?? null,
    lockerSystem: entry.provider ?? null,
    bookableId: entry.bookableId ?? null,
    isConfirmed,
    processId: isConfirmed ? String(authorizationId) : null,
  };

  if (entry.provider === IFBS) {
    info.ifbsMetadata = {
      boxId: entry.metadata?.boxId ?? null,
      nummer: entry.compartment ?? null,
      price: entry.metadata?.price ?? null,
      bookingId: isConfirmed
        ? String(authorizationId)
        : entry.hold?.holdId ?? null,
    };
  }

  return info;
}

module.exports = { deriveLockerInfo };
