const { ValidationError } = require("../../../errors/ValidationError");
const {
  AccessPointType,
  generateScanCode,
} = require("../../entities/access/access-point");

/**
 * The Fächer a Schließfachanlage carries itself - today only an Anlage of
 * Open Locker (tickets#1028). Such an Anlage keeps its list in
 * `config.compartments`, one entry per Fach:
 *
 * ```
 * { id: "<UUID at the provider>", number: 3,
 *   lockerBank: { id: "<Schließfachschrank id>", name: "Labor Fachbank 1" },
 *   outOfService: false,
 *   scanCode: "<opaque>", previousScanCodes: ["<rotated out>", …] }
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
 * The name of the Schließfachschrank a Fach stands in, as its entry or an
 * `assignedCompartment` carries it.
 *
 * @param {Object} compartment The Fach's entry
 * @returns {string|null} The name, `null` where the entry names none
 */
function lockerBankNameOf(compartment) {
  return compartment.lockerBank?.name ?? null;
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
 * The Fächer as a save stores them, each with its scan code (tickets#1055):
 * a Fach the Anlage already holds keeps `scanCode` and `previousScanCodes`
 * of its stored entry, found by its UUID, so printed stickers stay valid; a
 * Fach new to the Anlage - a Fach taken back in included - gets a fresh code
 * minted like a door's. The codes come from the stored entries alone, never
 * from the request.
 *
 * @param {Object[]} compartments The Fächer as the save leaves them
 * @param {Object[]} storedCompartments The Fächer as stored before the
 *   save, none on a create
 * @returns {Object[]} The Fächer with their scan codes
 */
function withScanCodes(compartments, storedCompartments = []) {
  const stored = new Map(
    storedCompartments.map((compartment) => [
      String(compartment.id),
      compartment,
    ]),
  );

  return compartments.map((compartment) => {
    const kept = stored.get(String(compartment.id));

    return kept?.scanCode
      ? {
          ...compartment,
          scanCode: kept.scanCode,
          previousScanCodes: [...(kept.previousScanCodes || [])],
        }
      : { ...compartment, scanCode: generateScanCode(), previousScanCodes: [] };
  });
}

/**
 * Refuses a Fach that another Anlage of the tenant already holds: one Fach
 * stands in at most one Anlage. Checked on saving an Anlage, at each of its
 * Fächer; an access point without its own list holds no Fach.
 *
 * @param {Object} accessPoint The access point as it would be stored
 * @param {Object[]} tenantAccessPoints Every access point of the tenant; the
 *   one being saved (same `id`) is skipped
 * @throws {ValidationError} `compartment_in_locker_system`, naming the Fach
 *   and the Anlage that holds it
 */
function assertCompartmentsUnclaimed(accessPoint, tenantAccessPoints) {
  const others = tenantAccessPoints.filter(
    (other) =>
      other.id !== accessPoint.id && other.provider === accessPoint.provider,
  );
  const errors = [];

  compartmentsOf(accessPoint).forEach((compartment, index) => {
    const holder = others.find((other) =>
      compartmentsOf(other).some((c) => c.id === compartment.id),
    );
    if (holder) {
      errors.push(refusal(`${FIELD}.${index}`, compartment.id, holder));
    }
  });

  if (errors.length > 0) {
    throw new ValidationError(errors);
  }
}

function refusal(field, compartmentId, holder) {
  return {
    field,
    code: "compartment_in_locker_system",
    params: {
      compartmentId,
      accessPointId: holder.id,
      label: holder.label || "",
    },
  };
}

module.exports = {
  carriesOwnCompartments,
  compartmentsOf,
  lockerBankNameOf,
  requestedCompartments,
  withScanCodes,
  assertCompartmentsUnclaimed,
};
