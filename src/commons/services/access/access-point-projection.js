const {
  getAccessProviderCapabilities,
} = require("./providers/access-provider-registry");
const { AccessPointType } = require("../../schemas/accessPointSchema");
const { demandedEvidenceOf } = require("./access-decision");

require("./providers/register-access-providers");

/**
 * The provider capabilities a client may act on: one button each. Everything
 * else a provider declares - authorizations, webhooks, listing - is management
 * business and says nothing about what the person at the door can do.
 *
 * `unlatch` is deliberately absent: pulling the latch is decided behind
 * `open`, per lock, so a client never picks that action itself.
 * `getOpenProgress` likewise: a client polls exactly when the open answer
 * carries an `openProcessId`, so that answer already says it.
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
 * is ready. Lockers are provisioned by their very existence - the box was
 * assigned with the booking - and carry the booking id the provider knows them
 * by.
 *
 * @param {Object} accessPoint The access point being projected
 * @param {Object} bookingContext The booking context it was resolved with
 * @returns {Object} The booking fields of the projection
 */
function bookingFields(accessPoint, bookingContext) {
  const isLocker = accessPoint.type === AccessPointType.LOCKER;
  const fields = {
    accessFrom: bookingContext.accessFrom ?? null,
    accessTo: bookingContext.accessTo ?? null,
    accessBuffer: bookingContext.accessBuffer || { ...NO_BUFFER },
    isProvisioned: isLocker ? true : bookingContext.isProvisioned === true,
  };

  if (isLocker) {
    fields.externalBookingId = bookingContext.externalBookingId ?? null;
  }

  return fields;
}

module.exports = {
  projectAccessPoint,
};
