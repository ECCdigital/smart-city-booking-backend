const MediaManager = require("../../data-managers/media-manager");
const MediaService = require("./media-service");
const TenantManager = require("../../data-managers/tenant-manager");
const { MEDIA_KIND } = require("../../schemas/mediaSchema");
const { MigrationReport } = require("./migration-report");
const { NextcloudManager } = require("../../data-managers/file-manager");
const { StorageNotFoundError } = require("../../../errors/StorageError");
const { PRESET_NAMES, VARIANT_FORMAT } = require("./image-variants");
const { variantKey } = require("../storage/media-keys");
const { BOOKING_DOCUMENT } = require("./booking-documents");
const { LEGACY_ROOTS } = require("./legacy-path");
const { listLegacyTree } = require("./media-import");

/**
 * Every key a medium claims: the original plus each variant it actually lists.
 *
 * @param {Object} media - The medium.
 * @returns {string[]}
 */
function claimedKeys(media) {
  return [
    media.storage?.key,
    ...(media.variants || []).map((variant) => variant.key),
  ].filter(Boolean);
}

/**
 * Whether a key exists at the provider of a medium.
 *
 * @param {Object} media - The medium the key belongs to.
 * @param {string} key - The key to probe.
 * @returns {Promise<boolean>}
 */
async function keyExists(media, key) {
  try {
    await MediaService.providerFor(media).stat({ key });
    return true;
  } catch (error) {
    if (error instanceof StorageNotFoundError) {
      return false;
    }

    throw error;
  }
}

/**
 * Regenerates the variants of the image stock — how existing media catch up
 * with a changed preset set, and how imported media get their variants at all
 * (§4.10). Each medium is regenerated at its own provider.
 *
 * @param {Object} [params]
 * @param {boolean} [params.dryRun] - Whether to only rehearse.
 * @param {string} [params.tenantId] - Restrict to one tenant.
 * @returns {Promise<MigrationReport>}
 */
async function regenerate({ dryRun = false, tenantId } = {}) {
  const report = new MigrationReport("regenerate", dryRun);

  const filter = { kind: MEDIA_KIND.IMAGE };
  if (tenantId !== undefined) {
    filter.tenantId = tenantId ?? null;
  }

  const media = await MediaManager.getAllMedia(filter);

  for (const medium of media) {
    try {
      if (dryRun) {
        report.processedOne();
        continue;
      }

      const result = await MediaService.regenerateVariants(medium);

      // Same bytes as before means the stock was already current — a second run
      // of the command touches neither storage nor database.
      if (result.added.length === 0 && result.removed.length === 0) {
        report.skippedOne();
        continue;
      }

      report.processedOne();
    } catch (error) {
      report.failed(`media:${medium.id}`, error);
    }
  }

  return report;
}

/**
 * Holds the database against the storage: every key a medium claims has to be
 * there. The reverse direction cannot be checked — the provider contract has no
 * `list` on purpose — so bytes without a medium surface in `cleanup` instead,
 * and only where a medium's own key space can be probed.
 *
 * @param {Object} [params]
 * @param {boolean} [params.dryRun] - Accepted for symmetry; `verify` never writes.
 * @returns {Promise<MigrationReport>}
 */
async function verify({ dryRun = false } = {}) {
  const report = new MigrationReport("verify", dryRun);
  const media = await MediaManager.getAllMedia();

  for (const medium of media) {
    try {
      const missing = [];

      for (const key of claimedKeys(medium)) {
        if (!(await keyExists(medium, key))) {
          missing.push(key);
        }
      }

      if (missing.length > 0) {
        report.orphan(
          `media:${medium.id}`,
          `missing bytes: ${missing.join(", ")}`,
        );
        continue;
      }

      report.processedOne();
    } catch (error) {
      report.failed(`media:${medium.id}`, error);
    }
  }

  return report;
}

/**
 * Removes bytes that lie in the key space of a medium without belonging to it —
 * a variant of a preset that has since been dropped, or one a regeneration
 * could not clear away. Only keys a medium could ever have written are probed;
 * without a `list` operation there is nothing else to go by, so bytes of an
 * already deleted medium stay out of reach and are the operator's to remove.
 *
 * @param {Object} [params]
 * @param {boolean} [params.dryRun] - Whether to only rehearse.
 * @returns {Promise<MigrationReport>}
 */
async function cleanup({ dryRun = false } = {}) {
  const report = new MigrationReport("cleanup", dryRun);

  report.note(
    "only the key space of existing media is reachable — bytes of an already " +
      "deleted medium have to be removed by hand",
  );

  const media = await MediaManager.getAllMedia({ kind: MEDIA_KIND.IMAGE });

  for (const medium of media) {
    try {
      const claimed = new Set(claimedKeys(medium));

      const candidates = PRESET_NAMES.map((name) =>
        variantKey({
          tenantId: medium.tenantId ?? null,
          mediaId: medium.id,
          name,
          format: VARIANT_FORMAT,
        }),
      ).filter((key) => !claimed.has(key));

      const stale = [];

      for (const key of candidates) {
        if (await keyExists(medium, key)) {
          stale.push(key);
        }
      }

      if (stale.length === 0) {
        report.skippedOne();
        continue;
      }

      if (!dryRun) {
        await MediaService.providerFor(medium).deleteMany({ keys: stale });
      }

      stale.forEach(() => report.processedOne());
    } catch (error) {
      report.failed(`media:${medium.id}`, error);
    }
  }

  return report;
}

/**
 * Empties the legacy tree — deliberately its own command, run only once the
 * import is verified. A file is removed only where a medium answers for its
 * legacy path; anything the import could not take, an unplaced booking document
 * above all, stays and goes into the report. The CLI never destroys what it did
 * not move.
 *
 * @param {Object} [params]
 * @param {boolean} [params.dryRun] - Whether to only rehearse.
 * @returns {Promise<MigrationReport>}
 */
async function purgeLegacy({ dryRun = false } = {}) {
  const report = new MigrationReport("purge-legacy", dryRun);
  const tenants = await TenantManager.getTenants();

  const bookingDocumentRoots = Object.values(BOOKING_DOCUMENT).map(
    (type) => type.legacyFolder,
  );

  const scopes = [
    { tenantId: null, roots: LEGACY_ROOTS },
    ...tenants.map((tenant) => ({
      tenantId: tenant.id,
      roots: [...LEGACY_ROOTS, ...bookingDocumentRoots],
    })),
  ];

  for (const scope of scopes) {
    for (const root of scope.roots) {
      const files = await listLegacyTree({ tenantId: scope.tenantId, root });

      for (const file of files) {
        try {
          const media = await MediaManager.getMediaByLegacyPath(
            scope.tenantId,
            file.legacyPath,
          );

          if (!media) {
            report.orphan(
              `${scope.tenantId || "instance"}:${file.legacyPath}`,
              "no medium holds this legacy path, left in place",
            );
            continue;
          }

          if (!dryRun) {
            await NextcloudManager.deleteFile({
              tenantID: scope.tenantId || undefined,
              filename: file.legacyPath,
            });
          }

          report.processedOne();
        } catch (error) {
          report.failed(
            `${scope.tenantId || "instance"}:${file.legacyPath}`,
            error,
          );
        }
      }
    }
  }

  return report;
}

module.exports = {
  cleanup,
  purgeLegacy,
  regenerate,
  verify,
};
