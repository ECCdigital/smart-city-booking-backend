const AccessPointManager = require("../../data-managers/access-point-manager");
const { BookableManager } = require("../../data-managers/bookable-manager");
const { DOMAIN } = require("../authorization/reach");
const { carriesOwnCompartments } = require("./locker-system-compartments");
const { ValidationError } = require("../../../errors/ValidationError");
const { ForbiddenError, NotFoundError } = require("../../../errors/BaseError");

/** The request field every refusal of the assignment names. */
const BOOKABLE_IDS_FIELD = "bookableIds";

/** The access point ids a bookable links, as strings. */
function linksOf(bookable) {
  return (bookable.accessPointDetails?.accessPointIds || []).map(String);
}

/**
 * The list of bookable ids of a request body, each once and in order.
 *
 * @throws {ValidationError} `invalid_bookable_ids` unless it is a list of
 *   non-empty strings
 */
function requestedIds(bookableIds) {
  const valid =
    Array.isArray(bookableIds) &&
    bookableIds.every((id) => typeof id === "string" && id.trim() !== "");
  if (!valid) {
    throw new ValidationError([
      { field: BOOKABLE_IDS_FIELD, code: "invalid_bookable_ids", params: {} },
    ]);
  }
  return [...new Set(bookableIds)];
}

/**
 * Sets the bookables of an access point (glossary "Zuordnung") from the
 * access points page (tickets#1110): the access point's id is added to
 * `accessPointDetails.accessPointIds` of every listed bookable that lacks
 * it and removed from every other bookable that carries it. A bookable
 * that gets its first access point has its access switched on, so the
 * assignment takes effect at once; one that loses its last keeps the
 * switch as it is. Nothing else of a bookable is touched - the assignment
 * is the same the bookable's own section shows and writes.
 *
 * Every bookable that changes has to lie within the reach of the request
 * (`bookable.update`, as `PUT bookables`); a bookable that does not change
 * is not asked about. A locker system with its own compartments hangs at
 * one bookable at most (tickets#1038).
 *
 * @param {string} tenantId
 * @param {string} accessPointId
 * @param {string[]} bookableIds The bookables that shall carry the access point
 * @param {{reach: string, userId?: string|null}} scope The reach of the request
 * @returns {Promise<{accessPointId: string, bookableIds: string[]}>}
 * @throws {NotFoundError} `access_point_not_found`
 * @throws {ValidationError} `invalid_bookable_ids`, `unknown_bookable`,
 *   `locker_system_one_bookable`
 * @throws {ForbiddenError} when a bookable that changes is out of reach
 */
async function assignBookables(tenantId, accessPointId, bookableIds, scope) {
  const wanted = requestedIds(bookableIds);

  const accessPoint = await AccessPointManager.getAccessPoint(
    accessPointId,
    tenantId,
  );
  if (!accessPoint) {
    throw new NotFoundError("access_point_not_found", { accessPointId });
  }
  const linkId = String(accessPoint.id);

  // The assignment is read whole, by the domain: the bookables listed and
  // every one that carries the access point, out of reach too. A scoped
  // read would hide a bookable out of reach that the request changes - one
  // it would silently leave carrying the access point, or call unknown -
  // where the spec asks to refuse the change; the reach is decided below,
  // at the bookables that change.
  const listed = await BookableManager.getBookablesByIds(
    tenantId,
    wanted,
    DOMAIN,
  );
  const known = new Set(listed.map((bookable) => bookable.id));
  const unknown = wanted.filter((id) => !known.has(id));
  if (unknown.length > 0) {
    throw new ValidationError(
      unknown.map((bookableId) => ({
        field: BOOKABLE_IDS_FIELD,
        code: "unknown_bookable",
        params: { bookableId },
      })),
    );
  }

  if (carriesOwnCompartments(accessPoint) && wanted.length > 1) {
    throw new ValidationError([
      {
        field: BOOKABLE_IDS_FIELD,
        code: "locker_system_one_bookable",
        params: { accessPointId: linkId, label: accessPoint.label || "" },
      },
    ]);
  }

  const holders = await BookableManager.getBookablesReferencingAccessPoints(
    tenantId,
    [linkId],
    DOMAIN,
  );
  const toAdd = listed.filter(
    (bookable) => !linksOf(bookable).includes(linkId),
  );
  const toRemove = holders.filter((bookable) => !known.has(bookable.id));
  const changing = [...toAdd, ...toRemove];

  // The read `PUT bookables` makes of the bookable it changes, under the
  // reach of the request. A bookable that changes but lies out of reach is
  // refused with 403, not the 404 of a scoped read that finds nothing: the
  // spec of the access points page asks for 403 at a bookable the request
  // would change without `bookable.update` on it (tickets#1082), and the
  // bookable is known to exist - the request names it, or it carries the
  // access point.
  for (const bookable of changing) {
    if (!(await BookableManager.getBookable(bookable.id, tenantId, scope))) {
      throw new ForbiddenError();
    }
  }

  for (const bookable of toAdd) {
    const links = linksOf(bookable);
    await BookableManager.storeAccessPointLinks(tenantId, bookable.id, {
      accessPointIds: [...links, linkId],
      active: links.length === 0 ? true : !!bookable.accessPointDetails?.active,
    });
  }
  for (const bookable of toRemove) {
    await BookableManager.storeAccessPointLinks(tenantId, bookable.id, {
      accessPointIds: linksOf(bookable).filter((id) => id !== linkId),
      active: !!bookable.accessPointDetails?.active,
    });
  }

  return { accessPointId: linkId, bookableIds: wanted };
}

module.exports = { assignBookables };
