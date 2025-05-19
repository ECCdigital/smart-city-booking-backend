require("dotenv").config();
const dbm = require("../../src/commons/utilities/database-manager");
const yargs = require("yargs/yargs");
const { hideBin } = require("yargs/helpers");
const CommandLineServices = require("./command-line-services");

const argv = yargs(hideBin(process.argv)).argv;

(async () => {
  const dbName = argv.dbname || process.env.DB_NAME;

  await dbm.getInstance().connect(dbName);
  const tenantId = argv._[0];
  if (!tenantId) {
    process.exit(1);
  }

  if (!!argv.receipt) {
    const bookingId = argv.receipt;
    const receiptNumber = argv.reno || 1;
    const outputPath = argv.output || "./receipt.pdf";
    const forcedReceiptTemplate = argv.template || null;
    console.log(
      `Generating receipt for booking ${bookingId} in tenant ${tenantId}...`,
    );

    await CommandLineServices.generateReceipt(
      bookingId,
      tenantId,
      receiptNumber,
      outputPath,
      forcedReceiptTemplate,
    );

    console.log(`Receipt generated at ${outputPath}`);
  }

  dbm.getInstance().close();
})();
