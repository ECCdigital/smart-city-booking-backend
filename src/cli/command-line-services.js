const pdfService = require("../../src/commons/pdf-service/pdf-service");
const fs = require("fs");

class CommandLineServices {
  static async generateReceipt(
    bookingId,
    tenantId,
    receiptNumber,
    outputPath,
    forcedReceiptTemplate
  ) {
    const buffer = await pdfService.generateReceipt(
      bookingId,
      tenantId,
      receiptNumber,
      forcedReceiptTemplate
    );

    fs.writeFileSync(outputPath, buffer);
  }
}

module.exports = CommandLineServices;
