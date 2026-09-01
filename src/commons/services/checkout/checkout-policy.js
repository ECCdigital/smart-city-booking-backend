/**
 * Checkout-Policy: the single value that crosses the checkout interface.
 *
 * What a policy means is decided here and nowhere else. Callers pick a value
 * and pass it down; they never compose behaviour flags. See CONTEXT.md
 * ("Checkout-Policy", "Selbstbuchung", "Manuelle Buchung").
 */
const CheckoutPolicy = Object.freeze({
  SELF_SERVICE: "self-service",
  ADMIN_MANUAL: "admin-manual",
});

const VALID_POLICIES = new Set(Object.values(CheckoutPolicy));

function assertCheckoutPolicy(policy) {
  if (!VALID_POLICIES.has(policy)) {
    throw new Error(`Unknown checkout policy: ${policy}`);
  }
  return policy;
}

/**
 * Whether checkout rules (availability, opening hours, lead time, …) run at
 * all. Under ADMIN_MANUAL nothing is checked — the admin is the authority and
 * saves never hard-fail; informational availability is via the validate
 * endpoints.
 */
function runsChecks(policy) {
  return policy === CheckoutPolicy.SELF_SERVICE;
}

/**
 * Resolve the effective bookWithoutDiscount value. A self-service client may
 * waive its own automatic discount; under ADMIN_MANUAL discounts are always
 * suppressed and the request wish is ignored.
 */
function bookWithoutDiscount(policy, requestedWithoutDiscount) {
  if (policy === CheckoutPolicy.ADMIN_MANUAL) {
    return true;
  }
  return Boolean(requestedWithoutDiscount);
}

/**
 * Whether missing mandatory addons are resolved into the cart. Admin carts
 * are taken literally — addons are included only if the admin added them.
 */
function resolvesMandatoryAddons(policy) {
  return policy === CheckoutPolicy.SELF_SERVICE;
}

/**
 * Whether paying by invoice requires the invoice permission of the booking
 * user.
 */
function requiresInvoicePermission(policy) {
  return policy === CheckoutPolicy.SELF_SERVICE;
}

/**
 * Whether admin overrides (booking status, payment method, internal comments,
 * provisioned locker/access info, cancellation-policy override) are accepted.
 */
function acceptsAdminOverrides(policy) {
  return policy === CheckoutPolicy.ADMIN_MANUAL;
}

module.exports = {
  CheckoutPolicy,
  assertCheckoutPolicy,
  runsChecks,
  bookWithoutDiscount,
  resolvesMandatoryAddons,
  requiresInvoicePermission,
  acceptsAdminOverrides,
};
