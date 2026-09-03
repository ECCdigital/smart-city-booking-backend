const TenantManager = require("../data-managers/tenant-manager");
const { BadRequestError, NotFoundError } = require("../../errors/BaseError");

/**
 * The counter a document type draws its numbers from, per year, at the
 * tenant.
 */
const COUNTERS = Object.freeze({
  receipt: "receiptCount",
  invoice: "invoiceCount",
  cancellation: "cancellationCount",
});

/**
 * Draws the document numbers of a tenant: unique, not gapless. A draw is one
 * atomic increment at the tenant row, so two documents issued at the same
 * moment can never share a number; a number lost to a failure after the
 * draw stays a gap (spec part 2, 6.2).
 */
class IdGenerator {
  /**
   * The next number of a document type for the current year.
   *
   * @param {string} tenantId The tenant
   * @param {number} leadingZeros Width the counter is padded to (0: none)
   * @param {"receipt"|"invoice"|"cancellation"} idType The document type
   * @returns {Promise<string>} The number as `<year>-<counter>`
   */
  static async next(tenantId, leadingZeros = 0, idType) {
    const counter = COUNTERS[idType];
    if (!counter) {
      throw new BadRequestError("unknown_document_type", { type: idType });
    }

    const year = new Date().getFullYear();
    const value = await TenantManager.incrementDocumentCounter(
      tenantId,
      counter,
      year,
    );

    if (value === null) {
      throw new NotFoundError("tenant_not_found", { tenantId });
    }

    return formatId(value, year, leadingZeros);
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
