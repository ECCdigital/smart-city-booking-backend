/**
 * Golden-master snapshots for the characterization tests: a rendered value
 * is compared with the file of the same name under `tests/snapshots/`.
 *
 * A snapshot that does not exist yet is written and the test passes, so the
 * first run of a new case records what the code does today; on a CI run
 * (`CI` set) a missing snapshot fails instead, so nothing is pinned
 * unseen. `UPDATE_SNAPSHOTS=1 npm test` rewrites every snapshot - the way
 * to accept a change the chain made on purpose. A mismatch names the file
 * and the first differing line.
 */

const assert = require("assert");
const fs = require("fs");
const path = require("path");

const SNAPSHOT_ROOT = path.join(__dirname, "..", "snapshots");

function firstDifference(expected, actual) {
  const expectedLines = expected.split("\n");
  const actualLines = actual.split("\n");
  const length = Math.max(expectedLines.length, actualLines.length);
  for (let line = 0; line < length; line += 1) {
    if (expectedLines[line] !== actualLines[line]) {
      return {
        line: line + 1,
        expected: expectedLines[line] ?? "<end of file>",
        actual: actualLines[line] ?? "<end of file>",
      };
    }
  }
  return null;
}

/**
 * Compares a value with its snapshot, or records it.
 *
 * @param {string} name Path of the snapshot below `tests/snapshots/`, with
 *   its extension (`mail/booking-confirmation.txt`)
 * @param {string} actual The value the code produced
 */
function expectSnapshot(name, actual) {
  const file = path.join(SNAPSHOT_ROOT, name);
  const update = process.env.UPDATE_SNAPSHOTS === "1";

  if (!update && fs.existsSync(file)) {
    const expected = fs.readFileSync(file, "utf8");
    if (expected !== actual) {
      const diff = firstDifference(expected, actual);
      assert.fail(
        `snapshot ${name} differs at line ${diff.line}:\n` +
          `  expected: ${diff.expected}\n` +
          `  actual:   ${diff.actual}\n` +
          `Run UPDATE_SNAPSHOTS=1 npm test to accept the change.`,
      );
    }
    return;
  }

  if (!update && process.env.CI) {
    assert.fail(`snapshot ${name} is missing; record it locally and commit it`);
  }

  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, actual, "utf8");
}

module.exports = { expectSnapshot, SNAPSHOT_ROOT };
