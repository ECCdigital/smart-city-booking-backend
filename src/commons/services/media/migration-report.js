/**
 * What every command of the media CLI hands back (§4.10 of the media spec):
 * how much it did, how much it left alone, what it could not place and what
 * went wrong. A run is only trustworthy if it says all four — a `--dry-run`
 * fills the very same report, it just never writes.
 */
class MigrationReport {
  /**
   * @param {string} command - Name of the command the report belongs to.
   * @param {boolean} [dryRun] - Whether the run was a rehearsal.
   */
  constructor(command, dryRun = false) {
    this.command = command;
    this.dryRun = Boolean(dryRun);
    this.processed = 0;
    this.skipped = 0;
    this.orphans = [];
    this.errors = [];
    this.notes = [];
    // A roll-up repeats what its parts already said in detail.
    this.isRollUp = false;
  }

  /**
   * Records what the command could not look at, so an empty report is never
   * mistaken for a clean bill of health.
   *
   * @param {string} message - The limitation, in one sentence.
   * @returns {MigrationReport} This report.
   */
  note(message) {
    this.notes.push(message);
    return this;
  }

  /**
   * Counts one item the command acted on — or would have, in a dry run.
   *
   * @returns {MigrationReport} This report.
   */
  processedOne() {
    this.processed += 1;
    return this;
  }

  /**
   * Counts one item that was already in its target state. A second run of an
   * idempotent command skips everything.
   *
   * @returns {MigrationReport} This report.
   */
  skippedOne() {
    this.skipped += 1;
    return this;
  }

  /**
   * Records something the command found but must not place by itself — a
   * booking document whose booking no attachment names, for one. Orphans are
   * reported, never guessed.
   *
   * @param {string} subject - What was found, usually a path.
   * @param {string} reason - Why it could not be placed.
   * @returns {MigrationReport} This report.
   */
  orphan(subject, reason) {
    this.orphans.push({ subject, reason });
    return this;
  }

  /**
   * Records a failure against one item. A failing item never stops the run —
   * the rest of the stock is still worth moving.
   *
   * @param {string} subject - What was being worked on.
   * @param {Error|string} error - The failure.
   * @returns {MigrationReport} This report.
   */
  failed(subject, error) {
    this.errors.push({ subject, message: error?.message || String(error) });
    return this;
  }

  /**
   * Sums several reports into one. The whole is a roll-up: it carries the
   * totals of its parts, and it says so, because the parts have already
   * accounted for every orphan and every failure in detail — printing them a
   * second time under the total would read as twice the trouble.
   *
   * @param {string} command - Name of the umbrella command.
   * @param {boolean} dryRun - Whether the run was a rehearsal.
   * @param {MigrationReport[]} steps - The reports to sum.
   * @returns {MigrationReport} The roll-up.
   */
  static rollUp(command, dryRun, steps) {
    const report = new MigrationReport(command, dryRun);
    report.isRollUp = true;
    steps.forEach((step) => report.absorb(step));
    return report;
  }

  /**
   * Folds another report into this one — how the umbrella `import` command
   * sums up its three passes.
   *
   * @param {MigrationReport} other - The report to absorb.
   * @returns {MigrationReport} This report.
   */
  absorb(other) {
    this.processed += other.processed;
    this.skipped += other.skipped;
    this.orphans.push(...other.orphans);
    this.errors.push(...other.errors);
    this.notes.push(...other.notes);
    return this;
  }

  /**
   * The report as a single line for the console.
   *
   * @returns {string}
   */
  toLine() {
    return [
      `${this.command}${this.dryRun ? " (dry run)" : ""}:`,
      `${this.processed} processed`,
      `${this.skipped} skipped`,
      `${this.orphans.length} orphans`,
      `${this.errors.length} errors`,
    ].join(" ");
  }
}

module.exports = { MigrationReport };
