const { ValidationError } = require("../../../errors/ValidationError");
const { AccessPointType } = require("../../entities/access/access-point");

/**
 * The Fächer a Schließfachanlage carries itself - today only an Anlage of
 * Open Locker (tickets#1028). Such an Anlage keeps its list in
 * `config.compartments`, one entry per Fach:
 *
 * ```
 * { id: "<UUID at the provider>", number: 3,
 *   lockerBank: { id: "<Schließfachschrank id>", name: "Labor Fachbank 1" },
 *   outOfService: false }
 * ```
 *
 * An Anlage that carries its own list is one where the platform assigns the
 * Fach to a booking and checks the occupancy itself. That hangs on the
 * Anlage's data, never on the provider's name: iFBS and Pareva Anlagen carry
 * no list, their provider assigns.
 */

const FIELD = "config.compartments";

/**
 * Whether the access point is a Schließfachanlage that carries its own list
 * of Fächer, so the platform assigns them - an empty list included: such an
 * Anlage simply has no Fach to assign.
 *
 * @param {Object|null|undefined} accessPoint An access point, entity or plain
 *   row
 * @returns {boolean}
 */
function carriesOwnCompartments(accessPoint) {
  return (
    accessPoint?.type === AccessPointType.LOCKER &&
    Array.isArray(accessPoint?.config?.compartments)
  );
}

/**
 * The Fächer of an Anlage that carries its own list, in their stored order;
 * none for every other access point.
 *
 * @param {Object|null|undefined} accessPoint An access point
 * @returns {Object[]} The stored compartment entries
 */
function compartmentsOf(accessPoint) {
  return carriesOwnCompartments(accessPoint)
    ? accessPoint.config.compartments
    : [];
}

/**
 * The Fächer a save names for an Anlage, each reduced to the stored shape:
 * what the request says of number and Schließfachschrank is kept as it is,
 * for a save that cannot ask the provider. Refuses an entry without its
 * UUID and a Fach named twice, at the Fach.
 *
 * @param {Object[]} compartments `config.compartments` of the request
 * @returns {Object[]} The entries in the stored shape
 * @throws {ValidationError} `required` at `config.compartments.<i>.id`,
 *   `duplicate_compartment` at `config.compartments.<i>`
 */
function requestedCompartments(compartments) {
  const errors = [];
  const seen = new Set();

  const requested = compartments.map((compartment, index) => {
    const id = compartment?.id == null ? "" : String(compartment.id).trim();

    if (!id) {
      errors.push({ field: `${FIELD}.${index}.id`, code: "required" });
    } else if (seen.has(id)) {
      errors.push({
        field: `${FIELD}.${index}`,
        code: "duplicate_compartment",
        params: { compartmentId: id },
      });
    }
    seen.add(id);

    return {
      id,
      number: compartment?.number ?? null,
      lockerBank: compartment?.lockerBank
        ? {
            id: String(compartment.lockerBank.id ?? ""),
            name: compartment.lockerBank.name ?? "",
          }
        : null,
      outOfService: compartment?.outOfService === true,
    };
  });

  if (errors.length > 0) {
    throw new ValidationError(errors);
  }

  return requested;
}

/**
 * Refuses a Fach that another access point of the tenant already holds: one
 * Fach stands in at most one Anlage, and a Fach in an Anlage is no fixed
 * Fach (a `door` of the same provider with the Fach's UUID as `externalId`).
 * Checked on saving an Anlage, at each of its Fächer, and on saving a fixed
 * Fach, at its `externalId`.
 *
 * @param {Object} accessPoint The access point as it would be stored
 * @param {Object[]} tenantAccessPoints Every access point of the tenant; the
 *   one being saved (same `id`) is skipped
 * @throws {ValidationError} `compartment_in_locker_system` or
 *   `compartment_is_fixed`, naming the Fach and the access point that holds
 *   it
 */
function assertCompartmentsUnclaimed(accessPoint, tenantAccessPoints) {
  const others = tenantAccessPoints.filter(
    (other) =>
      other.id !== accessPoint.id && other.provider === accessPoint.provider,
  );
  const errors = [];

  if (carriesOwnCompartments(accessPoint)) {
    accessPoint.config.compartments.forEach((compartment, index) => {
      const claim = claimOf(compartment.id, others);
      if (claim) {
        errors.push(refusal(`${FIELD}.${index}`, compartment.id, claim));
      }
    });
  } else if (
    accessPoint.type === AccessPointType.DOOR &&
    accessPoint.externalId
  ) {
    const compartmentId = String(accessPoint.externalId);
    const claim = claimOf(compartmentId, others, { fixed: false });
    if (claim) {
      errors.push(refusal("externalId", compartmentId, claim));
    }
  }

  if (errors.length > 0) {
    throw new ValidationError(errors);
  }
}

/** The other access point that holds the Fach, and how. */
function claimOf(compartmentId, others, { fixed = true } = {}) {
  for (const other of others) {
    if (compartmentsOf(other).some((c) => c.id === compartmentId)) {
      return { code: "compartment_in_locker_system", accessPoint: other };
    }
    if (
      fixed &&
      other.type === AccessPointType.DOOR &&
      String(other.externalId) === compartmentId
    ) {
      return { code: "compartment_is_fixed", accessPoint: other };
    }
  }
  return null;
}

function refusal(field, compartmentId, claim) {
  return {
    field,
    code: claim.code,
    params: {
      compartmentId,
      accessPointId: claim.accessPoint.id,
      label: claim.accessPoint.label || "",
    },
  };
}

module.exports = {
  carriesOwnCompartments,
  compartmentsOf,
  requestedCompartments,
  assertCompartmentsUnclaimed,
};
