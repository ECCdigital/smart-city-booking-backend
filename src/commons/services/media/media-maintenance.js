const crypto = require("node:crypto");

const MediaManager = require("../../data-managers/media-manager");
const MediaService = require("./media-service");
const TenantManager = require("../../data-managers/tenant-manager");
const storage = require("../storage");
const { MEDIA_KIND, STORAGE_PROVIDER } = require("../../schemas/mediaSchema");
const { MigrationReport } = require("./migration-report");
const { NextcloudManager } = require("../../data-managers/file-manager");
const { StorageNotFoundError } = require("../../../errors/StorageError");
const {
  PRESET_NAMES,
  VARIANT_FORMAT,
  VARIANT_MIME_TYPE,
} = require("./image-variants");
const { variantKey } = require("../storage/media-keys");
const { BOOKING_DOCUMENT } = require("./booking-documents");
const { LEGACY_ROOTS } = require("./legacy-path");
const { listLegacyTree } = require("./media-import");
const { MediaUsageService } = require("./media-usage");

/**
 * How a scope reads in a report — `null` is the instance, not a nameless tenant.
 *
 * @param {string|null} tenantId - The tenant of a medium.
 * @returns {string}
 */
function scopeLabel(tenantId) {
  return tenantId ?? "instance";
}

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
 * How many media a scope holds, keyed by tenant.
 *
 * @param {Object[]} media - The media to count.
 * @returns {Map<string|null, number>}
 */
function countByScope(media) {
  const counts = new Map();

  for (const medium of media) {
    const key = medium.tenantId ?? null;
    counts.set(key, (counts.get(key) || 0) + 1);
  }

  return counts;
}

/**
 * The legacy paths that more than one medium claims. One legacy file is one
 * medium per tenant (§4.10) — a group larger than one is stock from before that
 * rule, and its size is what tells an operator which kind of run they are
 * cleaning up after.
 *
 * @param {Object[]} media - Imported media.
 * @returns {{groups: number, media: number, largest: number}}
 */
function duplicateLegacyPaths(media) {
  const sizes = new Map();

  for (const medium of media) {
    // The pair is the identity, so the separator must not occur in a path.
    const key = `${scopeLabel(medium.tenantId)}\u0000${medium.legacyPath}`;
    sizes.set(key, (sizes.get(key) || 0) + 1);
  }

  const duplicates = [...sizes.values()].filter((size) => size > 1);

  return {
    groups: duplicates.length,
    media: duplicates.reduce((sum, size) => sum + size, 0),
    largest: duplicates.reduce((largest, size) => Math.max(largest, size), 0),
  };
}

/**
 * Writes what a scope holds after a purge into the report — the check an
 * operator runs the command for: no imported media left, and how much library
 * is still there.
 *
 * @param {MigrationReport} report - The report to write into.
 * @param {Object} params
 * @param {boolean} params.dryRun - Whether the run was a rehearsal.
 * @param {Object[]} params.media - The media the run looked at.
 * @param {string} [params.tenantId] - The tenant the run was restricted to.
 * @returns {Promise<void>}
 */
async function noteRemaining(report, { dryRun, media, tenantId }) {
  if (dryRun) {
    report.note("dry run — nothing was deleted, the scope is unchanged");
    return;
  }

  // An explicitly named tenant is reported even when it held nothing, because
  // that is the answer the operator asked for.
  const scopes = new Set(media.map((medium) => medium.tenantId ?? null));
  if (tenantId !== undefined) {
    scopes.add(tenantId ?? null);
  }

  const parts = [];

  for (const scopeTenantId of scopes) {
    const [imported, total] = await Promise.all([
      MediaManager.countMedia({
        tenantId: scopeTenantId,
        legacyPath: { $ne: null },
      }),
      MediaManager.countMedia({ tenantId: scopeTenantId }),
    ]);

    parts.push(
      `${scopeLabel(scopeTenantId)}: ${imported} imported of ${total} media`,
    );
  }

  report.note(`remaining — ${parts.join(", ") || "nothing was in scope"}`);
}

/**
 * Removes every imported medium of a scope, so a broken or superseded import
 * can simply be run again. The legacy tree is the source it comes back from and
 * stays untouched — this command is the counterpart of `purge-legacy`, not a
 * step towards it.
 *
 * Deliberately generic over `legacyPath`: an operator cleans up after an import
 * run, not after one known tenant, and `--tenant` narrows it where that matters.
 *
 * @param {Object} [params]
 * @param {boolean} [params.dryRun] - Whether to only rehearse.
 * @param {string} [params.tenantId] - Restrict to one tenant.
 * @returns {Promise<MigrationReport>}
 */
async function purgeImported({ dryRun = false, tenantId } = {}) {
  const report = new MigrationReport("purge-imported", dryRun);

  report.note(
    "the legacy tree stays untouched — the import is the source of truth and " +
      "is meant to run again afterwards",
  );
  report.note(
    "the indexes of a pre-reference-model stock (`bookingId_1`, " +
      "`legacyPath_1`) are not dropped here — remove them by hand once the " +
      "scope is clean",
  );

  const scope = { legacyPath: { $ne: null } };
  if (tenantId !== undefined) {
    scope.tenantId = tenantId ?? null;
  }

  const media = await MediaManager.getAllMedia(scope);
  const found = [...countByScope(media)]
    .map(([scopeTenantId, count]) => `${scopeLabel(scopeTenantId)}: ${count}`)
    .join(", ");

  report.note(
    `found ${media.length} imported media${found ? ` — ${found}` : ""}`,
  );

  const duplicates = duplicateLegacyPaths(media);
  report.note(
    duplicates.groups === 0
      ? "duplicate legacy paths: none"
      : `duplicate legacy paths: ${duplicates.groups} group` +
          `${duplicates.groups === 1 ? "" : "s"}, ${duplicates.media} media, ` +
          `largest ${duplicates.largest}`,
  );

  // Deleting through the service skips the in-use check the API route makes
  // (§4.7), so it is made here — once, for the whole scope. A single finding
  // stops the run: half a purge would leave references pointing at nothing,
  // and which of them is safe to drop is not this command's call.
  for (const medium of media) {
    try {
      const usage = await MediaUsageService.findUsage({
        tenantId: medium.tenantId,
        mediaId: medium.id,
      });

      if (usage.length > 0) {
        const sites = usage.map((site) => `${site.type}:${site.id}`).join(", ");
        report.failed(`media:${medium.id}`, `still referenced by ${sites}`);
      }
    } catch (error) {
      report.failed(`media:${medium.id}`, error);
    }
  }

  if (report.errors.length > 0) {
    report.note(
      "nothing was deleted — resolve the references above, then run the " +
        "command again",
    );
    return report;
  }

  for (const medium of media) {
    try {
      if (dryRun) {
        report.processedOne();
        continue;
      }

      const removed = await MediaService.deleteMedia(medium);

      // Bytes go best-effort, and once the document is gone `cleanup` can no
      // longer reach that key space — so whatever survives is named here.
      for (const key of claimedKeys(medium)) {
        if (await keyExists(medium, key)) {
          report.orphan(`media:${medium.id}`, `bytes left in storage: ${key}`);
        }
      }

      if (!removed) {
        // Someone got there first; the target state holds either way.
        report.skippedOne();
        continue;
      }

      report.processedOne();
    } catch (error) {
      report.failed(`media:${medium.id}`, error);
    }
  }

  await noteRemaining(report, { dryRun, media, tenantId });

  return report;
}

/**
 * Every file of a medium as the relocation sees it: its unchanged key, the
 * size and checksum the database claims, and the content type to store it
 * under at the target.
 *
 * @param {Object} media - The medium.
 * @returns {{key: string, size: number|null, checksum: string, contentType: string}[]}
 */
function fileEntries(media) {
  return [
    {
      key: media.storage?.key,
      size: media.size ?? null,
      checksum: media.checksum || "",
      contentType: media.mimeType,
    },
    ...(media.variants || []).map((variant) => ({
      key: variant.key,
      size: variant.size ?? null,
      checksum: variant.checksum || "",
      contentType: VARIANT_MIME_TYPE,
    })),
  ].filter((file) => Boolean(file.key));
}

/**
 * Copies one file of a medium to the target provider and verifies the copy
 * before anyone relies on it: size always (`stat` at the target against what
 * the database claims), checksum where the database has one. The checksum is
 * computed from the very bytes that were copied — one download, no second.
 *
 * The provider contract takes buffers, not streams, so the file passes through
 * memory; media are capped by the upload limits, which keeps that safe.
 *
 * @param {Object} params
 * @param {import("../storage/storage-provider").StorageProvider} params.source
 * @param {import("../storage/storage-provider").StorageProvider} params.target
 * @param {{key: string, size: number|null, checksum: string, contentType: string}} params.file
 * @returns {Promise<void>}
 * @throws {Error} When the source misses the file or the copy does not verify.
 */
async function copyAndVerify({ source, target, file }) {
  let data;

  try {
    data = await source.getBuffer({ key: file.key });
  } catch (error) {
    if (error instanceof StorageNotFoundError) {
      throw new Error(`missing source bytes: ${file.key}`);
    }
    throw error;
  }

  const checksum = crypto.createHash("sha256").update(data).digest("hex");

  await target.put({
    key: file.key,
    data,
    contentType: file.contentType,
  });

  const stat = await target.stat({ key: file.key });
  const expectedSize = file.size ?? data.length;

  if (stat.size !== expectedSize) {
    throw new Error(
      `size mismatch at ${target.name} for ${file.key}: ` +
        `expected ${expectedSize}, found ${stat.size}`,
    );
  }

  if (file.checksum && file.checksum !== checksum) {
    throw new Error(`checksum mismatch for ${file.key}`);
  }
}

/**
 * Moves the stock to one storage provider (§4.2 of the media spec): every
 * medium whose storage location is not the target yet travels as a whole —
 * original plus all variants, under unchanged keys — or not at all. Only after
 * every file is copied and verified does the medium's `storage.provider` flip;
 * from that moment every delivery path reads from the target. The bytes at the
 * old provider stay where they are — their disposal is the operator's, never
 * this command's.
 *
 * Safe to run during operation and safe to abort: before the flip nothing has
 * happened but harmless copies at the target, after the flip the medium has
 * fully moved. A second run skips everything that already lives at the target
 * and simply overwrites the half-finished copies of media that failed.
 *
 * @param {Object} params
 * @param {string} params.to - Target provider, `nextcloud` or `s3`.
 * @param {boolean} [params.dryRun] - Whether to only rehearse.
 * @param {string} [params.tenantId] - Restrict to one tenant.
 * @returns {Promise<MigrationReport>}
 */
async function relocate({ dryRun = false, tenantId, to } = {}) {
  if (!Object.values(STORAGE_PROVIDER).includes(to)) {
    throw new Error(
      `Unknown target provider "${to}". Expected one of: ` +
        Object.values(STORAGE_PROVIDER).join(", "),
    );
  }

  const report = new MigrationReport("relocate", dryRun);

  report.note(
    "the bytes at the old provider stay in place — removing them is the " +
      "operator's job",
  );

  const filter = { "storage.provider": { $ne: to } };
  if (tenantId !== undefined) {
    filter.tenantId = tenantId ?? null;
  }

  const media = await MediaManager.getAllMedia(filter);

  const fileCount = media.reduce(
    (sum, medium) => sum + fileEntries(medium).length,
    0,
  );
  const found = [...countByScope(media)]
    .map(([scopeTenantId, count]) => `${scopeLabel(scopeTenantId)}: ${count}`)
    .join(", ");

  report.note(
    `found ${media.length} media (${fileCount} files) not at ${to}` +
      `${found ? ` — ${found}` : ""}`,
  );

  const target = storage.getStorageProvider(to);

  for (const medium of media) {
    try {
      if (dryRun) {
        // What a real run would trip over: files the database claims but the
        // source provider does not hold — the same view `verify` takes.
        const missing = [];

        for (const file of fileEntries(medium)) {
          if (!(await keyExists(medium, file.key))) {
            missing.push(file.key);
          }
        }

        if (missing.length > 0) {
          report.failed(
            `media:${medium.id}`,
            `missing source bytes: ${missing.join(", ")}`,
          );
          continue;
        }

        report.processedOne();
        continue;
      }

      const source = MediaService.providerFor(medium);

      for (const file of fileEntries(medium)) {
        await copyAndVerify({ source, target, file });
      }

      // The flip — atomic per medium, and only after every file made it.
      medium.storage.provider = to;
      await MediaManager.storeMedia(medium, false);

      report.processedOne();
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
  purgeImported,
  purgeLegacy,
  regenerate,
  relocate,
  verify,
};
