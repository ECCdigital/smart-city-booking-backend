/**
 * The documents adapter of the booking lifecycle seam: the issuance of
 * booking documents (`document-issuance.js`, glossary "Ausstellung") behind
 * the interface the lifecycle speaks (spec part 2, sections 6 and 10).
 */

const documentIssuance = require("../../documents/document-issuance");

const documents = {
  /**
   * @param {{ tenantId: string, bookingIds: string[], type: string, groupBookingId?: string|null, bookings?: Object[], options?: Object }} params
   * @returns {Promise<{ attachment: Object, file: { name: string, buffer: Buffer } }>}
   */
  async issue(params) {
    return await documentIssuance.issue(params);
  },

  /**
   * @param {{ tenantId: string, booking: Object }} params
   * @returns {Promise<*>}
   */
  async remove(params) {
    return await documentIssuance.remove(params);
  },
};

module.exports = documents;
