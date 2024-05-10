const TenantManager = require("../data-managers/tenant-manager");

/**
 * The ID Generator is used to generate unique IDs for receipts.
 */
class IdGenerator {
  /**
   * Get the next ID for the given namespace.
   *
   * @param tenantId The tenant ID
   * @param leadingZeros The number of leading zeros to pad the ID with
   * @returns {string} The next ID
   */
  static async next(tenantId, leadingZeros = 0) {
    const tenant = await TenantManager.getTenant(tenantId);

    const year = new Date().getFullYear();
    const idForCurrentYear =
      (tenant.receiptCount && tenant.receiptCount[year]) || 0;
    const newId = idForCurrentYear + 1;

    const updatedTenant = {
      ...tenant,
      receiptCount: {
        ...tenant.receiptCount,
        [year]: newId,
      },
    };

    await TenantManager.storeTenant(updatedTenant);

    return formatId(newId, year, leadingZeros);
  }
}

/**
 * Format the ID with the given year and leading zeros.
 *
 * @param {number} id
 * @param {number} year
 * @param {number} leadingZeros
 * @returns {string}
 */
function formatId(id, year, leadingZeros) {
  const formattedId =
    leadingZeros > 0
      ? id.toString().padStart(leadingZeros, "0")
      : id.toString();
  return `${year}-${formattedId}`;
}

module.exports = IdGenerator;
