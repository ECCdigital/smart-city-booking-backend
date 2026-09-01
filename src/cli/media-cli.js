const path = require("node:path");

// Anchored at the repository, not at the working directory: an operator runs a
// CLI from wherever they happen to stand, and `dotenv` would otherwise look for
// a `.env` next to them and silently find none. A missing file stays fine —
// deployments that inject their configuration as real environment variables
// never had one, and those variables win over the file either way.
require("dotenv").config({ path: path.join(__dirname, "..", "..", ".env") });

const yargs = require("yargs/yargs");
const { hideBin } = require("yargs/helpers");

const dbm = require("../commons/utilities/database-manager");
const {
  cleanup,
  purgeImported,
  purgeLegacy,
  regenerate,
  relocate,
  verify,
} = require("../commons/services/media/media-maintenance");
const { runImport } = require("../commons/services/media/media-import");
const { STORAGE_PROVIDER } = require("../commons/schemas/mediaSchema");

/**
 * The media CLI (§4.10 of the media spec): the move of the legacy file stock
 * into the media library, and the maintenance of that library afterwards.
 *
 * Deliberately not a boot migration — installations are operated by others, and
 * an update must not wait on a file move. Every command is idempotent and takes
 * `--dry-run`, which fills the same report without writing anything.
 */

/**
 * Prints a report the way an operator reads it: the one-line summary first,
 * then what could not be placed and what failed.
 *
 * @param {import("../commons/services/media/migration-report").MigrationReport} report
 * @returns {void}
 */
function printReport(report) {
  console.log(report.toLine());

  // The parts of a roll-up have already listed every orphan and every failure.
  if (report.isRollUp) {
    return;
  }

  for (const note of report.notes) {
    console.log(`  note    ${note}`);
  }

  for (const orphan of report.orphans) {
    console.log(`  orphan  ${orphan.subject} — ${orphan.reason}`);
  }

  for (const error of report.errors) {
    console.log(`  error   ${error.subject} — ${error.message}`);
  }
}

/**
 * Runs one command against a connected database and reports what it did.
 *
 * @param {Function} command - The command to run.
 * @param {Object} argv - Parsed command line arguments.
 * @returns {Promise<void>}
 */
async function run(command, argv) {
  await dbm.getInstance().connect(argv.dbname || process.env.DB_NAME);

  try {
    const result = await command(argv);
    const reports = Array.isArray(result) ? result : [result];

    reports.forEach(printReport);

    // A run that could not finish parts of its work must not look successful to
    // whatever called it.
    process.exitCode = reports.some((report) => report.errors.length > 0)
      ? 1
      : 0;
  } finally {
    await dbm.getInstance().close();
  }
}

const dryRunOption = {
  "dry-run": {
    type: "boolean",
    default: false,
    describe: "Report what would happen without writing anything",
  },
};

yargs(hideBin(process.argv))
  .scriptName("media-cli")
  .usage("$0 <command> [options]")
  .option("dbname", {
    type: "string",
    describe: "Database to work on, defaults to DB_NAME",
  })
  .command(
    "import",
    "Turn the legacy file stock into media, place booking documents and rewrite stored addresses",
    (builder) => builder.options(dryRunOption),
    (argv) =>
      run(async () => {
        const { report, steps } = await runImport({ dryRun: argv.dryRun });
        return [...steps, report];
      }, argv),
  )
  .command(
    "regenerate",
    "Generate the image variants of the existing stock",
    (builder) =>
      builder.options(dryRunOption).option("tenant", {
        type: "string",
        describe: "Restrict to one tenant",
      }),
    (argv) =>
      run(
        () => regenerate({ dryRun: argv.dryRun, tenantId: argv.tenant }),
        argv,
      ),
  )
  .command(
    "verify",
    "Check that every medium's bytes are where the database says they are",
    // `verify` never writes, so the flag changes nothing — it is accepted so
    // that every command of the CLI takes the same options.
    (builder) => builder.options(dryRunOption),
    (argv) => run(() => verify({ dryRun: argv.dryRun }), argv),
  )
  .command(
    "relocate",
    "Move every medium's bytes to the given storage provider",
    (builder) =>
      builder
        .options(dryRunOption)
        .option("to", {
          type: "string",
          choices: Object.values(STORAGE_PROVIDER),
          demandOption: true,
          describe: "Target storage provider",
        })
        .option("tenant", {
          type: "string",
          describe: "Restrict to one tenant",
        }),
    (argv) =>
      run(
        () =>
          relocate({
            dryRun: argv.dryRun,
            tenantId: argv.tenant,
            to: argv.to,
          }),
        argv,
      ),
  )
  .command(
    "cleanup",
    "Remove stale variant bytes in the key space of known media",
    (builder) => builder.options(dryRunOption),
    (argv) => run(() => cleanup({ dryRun: argv.dryRun }), argv),
  )
  .command(
    "purge-imported",
    "Remove the imported media again, so the import can run from scratch",
    (builder) =>
      builder.options(dryRunOption).option("tenant", {
        type: "string",
        describe: "Restrict to one tenant",
      }),
    (argv) =>
      run(
        () => purgeImported({ dryRun: argv.dryRun, tenantId: argv.tenant }),
        argv,
      ),
  )
  .command(
    "purge-legacy",
    "Remove the imported files from the legacy tree",
    (builder) => builder.options(dryRunOption),
    (argv) => run(() => purgeLegacy({ dryRun: argv.dryRun }), argv),
  )
  .demandCommand(1, "Pick a command")
  .strict()
  .help()
  // A command that fails while running is not a usage problem. Printing the
  // whole help text over it buries the one line that says what went wrong —
  // which is the difference between "I mistyped something" and "the database
  // is unreachable".
  .fail((message, error, instance) => {
    if (error) {
      console.error(error.message || String(error));
    } else {
      console.error(instance.help());
      console.error(`\n${message}`);
    }

    process.exit(1);
  })
  .parse();
