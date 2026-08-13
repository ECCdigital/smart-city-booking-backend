const {
  getAccessProviderCapabilities,
} = require("./providers/access-provider-registry");
const { AccessPointType } = require("../../schemas/accessPointSchema");

require("./providers/register-access-providers");

/**
 * The provider capabilities a client may act on: one button each. Everything
 * else a provider declares - authorizations, webhooks, listing - is management
 * business and says nothing about what the person at the door can do.
 *
 * `unlatch` is deliberately absent: pulling the latch is decided behind
 * `open`, per lock, so a client never picks that action itself.
 * `getOpenStatus` likewise: a client polls exactly when the open answer
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
 *   booking. Its evidence requirements are read from `validationRules` (stored
 *   form) or `validationRuleTypes` (resolved form, which carries the types
 *   only).
 * @param {Object} [options]
 * @param {boolean} [options.hasManagePermission=false] Whether the user may
 *   manage the bookings of the tenant, which exempts them from the evidence
 *   rules
 * @param {Object|null} [options.bookingContext=null] The booking the access
 *   point was resolved for. Given, the booking fields are added; a resolved
 *   scan knows no booking and gets the core fields alone.
 * @returns {Object} The access point as the API hands it out
 */
function projectAccessPoint(
  accessPoint,
  { hasManagePermission = false, bookingContext = null } = {},
) {
  const view = {
    id: accessPoint.id,
    tenantId: accessPoint.tenantId,
    type: accessPoint.type,
    provider: accessPoint.provider,
    label: accessPoint.label || "",
    mode: accessPoint.mode,
    validationRuleTypes: effectiveValidationRuleTypes(
      accessPoint,
      hasManagePermission,
    ),
    capabilities: uiCapabilities(accessPoint.provider),
  };

  if (!bookingContext) {
    return view;
  }

  return { ...view, ...bookingFields(accessPoint, bookingContext) };
}

/**
 * What this user has to prove at this access point - not what the door is
 * configured with. The answer is empty where the rules never come into play:
 * for a user who may manage the bookings of the tenant, and for lockers, which
 * are not asked for evidence at all.
 *
 * It says what is demanded, never whether it will work: a rule whose
 * preconditions are unmet still reports itself at opening time.
 *
 * @param {Object} accessPoint The access point being projected
 * @param {boolean} hasManagePermission Whether the user may manage bookings
 * @returns {string[]} The rule types this user has to satisfy
 */
function effectiveValidationRuleTypes(accessPoint, hasManagePermission) {
  if (hasManagePermission || accessPoint.type === AccessPointType.LOCKER) {
    return [];
  }

  const types = Array.isArray(accessPoint.validationRules)
    ? accessPoint.validationRules.map((rule) => rule?.type)
    : accessPoint.validationRuleTypes || [];

  return [...new Set(types.filter((type) => typeof type === "string"))];
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
