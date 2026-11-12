const { BookableManager } = require("../../data-managers/bookable-manager");
const { DOMAIN } = require("../authorization/reach");
const { ValidationError } = require("../../../errors/ValidationError");
const { carriesOwnCompartments } = require("./locker-system-compartments");

/**
 * Refuses to link a Schließfachanlage that carries its own Fächer to a
 * second bookable (tickets#1038): its Fächer limit exactly one `amount`, so
 * two bookables never share them. Every bookable of the tenant counts, its
 * access switched on or off and whether the saver may see it or not.
 * Doors and Anlagen whose provider assigns (iFBS, Pareva) may still hang at
 * several bookables, and one bookable may carry several Anlagen.
 *
 * @param {Object} bookable The bookable to be stored
 * @param {Object[]} accessPoints The access points it links
 * @throws {ValidationError} `locker_system_in_other_bookable` at
 *   `accessPointDetails.accessPointIds`, naming the Anlage and the bookable
 *   that holds it
 */
async function assertLockerSystemsUnshared(bookable, accessPoints) {
  const lockerSystems = accessPoints.filter(carriesOwnCompartments);
  if (lockerSystems.length === 0) {
    return;
  }

  const others = (
    await BookableManager.getBookablesReferencingAccessPoints(
      bookable.tenantId,
      lockerSystems.map((lockerSystem) => lockerSystem.id),
      DOMAIN,
    )
  ).filter((other) => other.id !== bookable.id);

  const errors = lockerSystems.flatMap((lockerSystem) => {
    const holder = others.find((other) =>
      (other.accessPointDetails?.accessPointIds || [])
        .map(String)
        .includes(String(lockerSystem.id)),
    );
    if (!holder) {
      return [];
    }
    return [
      {
        field: "accessPointDetails.accessPointIds",
        code: "locker_system_in_other_bookable",
        params: {
          accessPointId: lockerSystem.id,
          label: lockerSystem.label || "",
          bookableId: holder.id,
          bookableTitle: holder.title || "",
        },
      },
    ];
  });

  if (errors.length > 0) {
    throw new ValidationError(errors);
  }
}

module.exports = { assertLockerSystemsUnshared };
