const IFBS = "ifbs";
const IFBS_HANDLES = ["pricing", "availability", "maxAmount"];

/**
 * Keeps the iFBS entry of `externalProviders` in step with the iFBS locker
 * system a bookable offers: the checkout prices and checks a bike box
 * through iFBS at the location the entry names. Whether the entry is
 * `active` stays the admin's decision; without an iFBS locker system
 * nothing is touched, so a bookable that dropped its boxes keeps what the
 * admin configured.
 *
 * @param {Object} doc The bookable document, written into
 * @param {string|null} locationId The iFBS location of the bookable's
 *   locker system, or `null` where it has none
 */
function ensureIfbsProvider(doc, locationId) {
  if (!doc || locationId == null) {
    return;
  }

  if (!Array.isArray(doc.externalProviders)) {
    doc.externalProviders = [];
  }

  const existingIndex = doc.externalProviders.findIndex(
    (p) => p.provider === IFBS,
  );
  const existingProvider =
    existingIndex >= 0 ? doc.externalProviders[existingIndex] : null;

  const providerEntry = {
    active: existingProvider?.active ?? false,
    provider: IFBS,
    handles: existingProvider?.handles ?? [...IFBS_HANDLES],
    config: {
      locationId: String(locationId),
      amount: 1,
    },
  };

  if (existingIndex >= 0) {
    doc.externalProviders[existingIndex] = providerEntry;
  } else {
    doc.externalProviders.push(providerEntry);
  }
}

module.exports = { ensureIfbsProvider };
