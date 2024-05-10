const pdfService = require("../../src/commons/pdf-service/pdf-service");
const fs = require("fs");

class CommandLineServices {
  static async generateReceipt(bookingId, tenantId, receiptNumber, outputPath) {
    const buffer = await pdfService.generateReceipt(
      bookingId,
      tenantId,
      receiptNumber,
    );

    fs.writeFileSync(outputPath, buffer);
  }
}

module.exports = CommandLineServices;
