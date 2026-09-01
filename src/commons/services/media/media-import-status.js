const bunyan = require("bunyan");

const MediaManager = require("../../data-managers/media-manager");

const logger = bunyan.createLogger({
  name: "media-import-status.js",
  level: process.env.LOG_LEVEL,
  // Provider errors carry their whole request, auth header included —
  // the standard serializer keeps the message and the stack, nothing else.
  serializers: { err: bunyan.stdSerializers.err },
});

/**
 * Whether the media import has run on this installation (§4.10 of the media
 * spec). Two things hang off the answer: the boot warning, and whether the
 * legacy resolver route may still fall back to serving the old tree directly.
 *
 * The state only ever moves one way — once something has been imported, this
 * installation is migrated for good — so the answer is remembered as soon as it
 * is positive. Before that it is asked again, which is exactly the phase in
 * which the media collection is still small.
 */

let migrated = false;

/**
 * Whether the legacy file stock still waits to be imported.
 *
 * @returns {Promise<boolean>} True while nothing has been imported.
 */
async function isImportPending() {
  if (migrated) {
    return false;
  }

  try {
    migrated = (await MediaManager.countImportedMedia()) > 0;
  } catch (error) {
    logger.warn({ err: error }, "Could not determine the media import state");
    // Answering "migrated" here would turn a database hiccup into 404s for
    // every legacy address; the fallback is the safer wrong answer.
    return true;
  }

  return !migrated;
}

/**
 * Forgets the remembered state (used by tests).
 *
 * @returns {void}
 */
function resetImportStatus() {
  migrated = false;
}

/**
 * Warns when the media import has not run yet. An installation is not broken
 * without it — the resolver route falls back to serving the legacy tree
 * directly — so this is a warning at boot, never an error. Nothing to warn
 * about where no legacy storage is configured at all: a fresh install has no
 * stock to move.
 *
 * @returns {Promise<boolean>} Whether the warning applies.
 */
async function warnIfImportPending() {
  if (!process.env.NEXTCLOUD_URL) {
    return false;
  }

  if (!(await isImportPending())) {
    return false;
  }

  logger.warn(
    "The media import has not run on this installation. Legacy file URLs are " +
      "served from the old storage tree until `node src/cli/media-cli.js import` " +
      "has been run.",
  );

  return true;
}

module.exports = {
  isImportPending,
  resetImportStatus,
  warnIfImportPending,
};
