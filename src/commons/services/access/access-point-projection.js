const {
  getAccessProviderCapabilities,
} = require("./providers/access-provider-registry");
const { AccessPointType } = require("../../schemas/accessPointSchema");
const { demandedEvidenceOf } = require("./access-decision");
const { compartmentPointId } = require("./compartment-allocation");
const { lockerBankNameOf } = require("./locker-system-compartments");

require("./providers/register-access-providers");

/**
 * The provider capabilities a client may act on: one button each. Everything
 * else a provider declares - authorizations, webhooks, listing - is management
 * business and says nothing about what the person at the door can do.
 *
 * Which action Nuki carries out on `open` is the access point's Öffnungsart;
 * a client never picks it, so there is no capability for it.
 * `getOpenProgress` is absent too: a client polls exactly when the open
 * answer carries an `openProcessId`, so that answer already says it.
 */
const UI_CAPABILITIES = Object.freeze(["open", "close", "getStatus"]);

const NO_BUFFER = Object.freeze({ beforeMs: 0, afterMs: 0 });

/**
 * The one shape an access point takes on its way to a client - the list of a
 * booking as well as a resolved scan. Both ways project through here so the
 * two forms cannot drift apart again.
 *
 * Everything not named here stays on the server: the provider configuration,
 * the external ids, and above all the scan codes - a client that knows the
 * code of a door could forge the evidence for it.
 *
 * @param {Object} accessPoint The access point, as stored or as resolved for a
 *   booking - both carry its rules in `validationRules`.
 * @param {Object} [options]
 * @param {Object|null} [options.decision=null] The access decision for the
 *   booking (`access-decision.js`), which says what this access point demands
 *   of the user it was made for. Without one - a resolved scan knows no
 *   booking - the door's own rules are reported.
 * @param {Object|null} [options.bookingContext=null] The booking the access
 *   point was resolved for. Given, the booking fields are added; a resolved
 *   scan knows no booking and gets the core fields alone.
 * @returns {Object} The access point as the API hands it out
 */
function projectAccessPoint(
  accessPoint,
  { decision = null, bookingContext = null } = {},
) {
  const view = {
    id: accessPoint.id,
    tenantId: accessPoint.tenantId,
    type: accessPoint.type,
    provider: accessPoint.provider,
    label: accessPoint.label || "",
    mode: accessPoint.mode,
    validationRuleTypes: decision
      ? decision.demandedEvidence[String(accessPoint.id)] ?? []
      : demandedEvidenceOf(accessPoint),
    capabilities: uiCapabilities(accessPoint.provider),
  };

  if (!bookingContext) {
    return view;
  }

  return { ...view, ...bookingFields(accessPoint, bookingContext) };
}

/**
 * A Fach of a Schließfachanlage as a resolved scan hands it out: the core
 * fields of its Anlage - type, provider, mode, label and rules, because a
 * Fach inherits them - under the id the Fach is opened and listed by
 * (`<anlage>:<Fach UUID>`), plus the Anlage's id and the Fach as the person
 * looks for it. The Fach's UUID and its codes stay on the server.
 *
 * `compartment` is an object here, unlike the box number string iFBS names in
 * a booking's projection: a client tells the two apart by type.
 *
 * @param {Object} lockerSystem The Anlage, as stored
 * @param {Object} compartment The Fach's entry in `config.compartments`
 * @returns {Object} The Fach as the API hands it out
 */
function projectCompartment(lockerSystem, compartment) {
  const { id, ...view } = projectAccessPoint(lockerSystem);

  return {
    id: compartmentPointId(id, compartment.id),
    lockerSystemId: id,
    ...view,
    compartment: {
      number: compartment.number ?? null,
      lockerBankName: lockerBankNameOf(compartment),
      outOfService: compartment.outOfService === true,
    },
  };
}

/**
 * The actions of a provider a client may offer, in a fixed order so the same
 * lock always reads the same way.
 *
 * @param {string} provider Id of the provider, e.g. `nuki`
 * @returns {string[]} The offerable actions, empty for an unknown provider
 */
function uiCapabilities(provider) {
  const declared = getAccessProviderCapabilities(provider);

  return UI_CAPABILITIES.filter((capability) => declared.includes(capability));
}

/**
 * What the booking adds to an access point: when it may be used and whether it
 * is ready - a door once its access is set up, a compartment once it is
 * granted (or, assigned by the platform, provisioned) and not revoked. A
 * compartment of a locker system is listed under its own opaque id
 * (`<accessPointId>:<Fach UUID>` where the platform assigned the Fach,
 * `<accessPointId>:<authorizationId>`, `<accessPointId>:hold` before the
 * grant) and additionally carries the booking id the provider knows it by,
 * the compartment the person looks for - iFBS' box number - where the
 * provider names one, and the Fach the platform assigned.
 *
 * @param {Object} accessPoint The access point being projected
 * @param {Object} bookingContext The booking context it was resolved with
 * @returns {Object} The booking fields of the projection
 */
function bookingFields(accessPoint, bookingContext) {
  const fields = {
    accessFrom: bookingContext.accessFrom ?? null,
    accessTo: bookingContext.accessTo ?? null,
    accessBuffer: bookingContext.accessBuffer || { ...NO_BUFFER },
    isProvisioned: bookingContext.isProvisioned === true,
  };

  if (accessPoint.type === AccessPointType.LOCKER) {
    fields.externalBookingId = bookingContext.externalBookingId ?? null;
    fields.compartment = bookingContext.compartment ?? null;
    fields.assignedCompartment = assignedCompartmentView(
      bookingContext.assignedCompartment,
    );
  }

  return fields;
}

/**
 * The Fach the platform assigned, as the person looks for it: its number
 * and the name of its Schließfachschrank - the Anlage's name is the
 * `label`. Its UUID stays on the server like every external id.
 *
 * @param {Object|null|undefined} assigned The entry's `assignedCompartment`
 * @returns {{ number: number|null, lockerBankName: string|null }|null}
 *   `null` for a compartment the provider assigns
 */
function assignedCompartmentView(assigned) {
  if (!assigned) {
    return null;
  }

  return {
    number: assigned.number ?? null,
    lockerBankName: lockerBankNameOf(assigned),
  };
}

module.exports = {
  projectAccessPoint,
  projectCompartment,
  assignedCompartmentView,
};
