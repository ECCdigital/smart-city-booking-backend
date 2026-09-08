const bunyan = require("bunyan");

const BookingManager = require("../../data-managers/booking-manager");
const EventManager = require("../../data-managers/event-manager");
const InstanceManager = require("../../data-managers/instance-manager");
const MediaManager = require("../../data-managers/media-manager");
const MediaService = require("./media-service");
const TenantManager = require("../../data-managers/tenant-manager");
const { BookableManager } = require("../../data-managers/bookable-manager");
const { MEDIA_REFERENCE_SOURCE } = require("../../schemas/mediaSchema");
const { MigrationReport } = require("./migration-report");
const { NextcloudManager } = require("../../data-managers/file-manager");
const { BOOKING_DOCUMENT } = require("./booking-documents");
const {
  BRANDING_REFERENCE_FIELDS,
  DOCUMENT_FIELDS,
} = require("./instance-media");
const {
  LEGACY_ROOTS,
  legacyFileName,
  legacyTags,
  legacyVisibility,
  normaliseLegacyPath,
  parseLegacyUrl,
} = require("./legacy-path");

const logger = bunyan.createLogger({
  name: "media-import.js",
  level: process.env.LOG_LEVEL,
  // Provider errors carry their whole request, auth header included —
  // the standard serializer keeps the message and the stack, nothing else.
  serializers: { err: bunyan.stdSerializers.err },
});

/**
 * Lists one tree of the legacy storage. A tree that was never created is not a
 * failure — an installation that never used protected uploads simply has none.
 *
 * @param {Object} params
 * @param {string|null} params.tenantId - Tenant of the tree, null for the instance.
 * @param {string} params.root - Root folder, e.g. `public`.
 * @returns {Promise<Array<{legacyPath: string, fileName: string}>>}
 */
async function listLegacyTree({ tenantId, root }) {
  let items;

  try {
    items = await NextcloudManager.getFiles({
      tenant: tenantId || undefined,
      rootPath: root,
    });
  } catch (error) {
    // A tree that was never created is the normal case, not a failure: an
    // installation that never issued a cancellation has no `cancellations/`.
    // Saying so once per tenant and folder at error level would bury the report
    // the command exists to produce.
    if (error?.statusCode === 404) {
      logger.debug({ tenantId, root }, "Legacy tree does not exist");
    } else {
      logger.warn(
        { err: error, tenantId, root },
        "Legacy tree could not be listed, treating it as empty",
      );
    }

    return [];
  }

  return items
    .map((item) => normaliseLegacyPath(item.filename))
    .filter(Boolean)
    .map((legacyPath) => ({
      legacyPath,
      fileName: legacyFileName(legacyPath),
    }));
}

/**
 * Reads the bytes of a legacy file.
 *
 * @param {Object} params
 * @param {string|null} params.tenantId - Tenant of the file, null for the instance.
 * @param {string} params.legacyPath - Normalised legacy path.
 * @returns {Promise<Buffer>}
 */
async function readLegacyFile({ tenantId, legacyPath }) {
  const data = await NextcloudManager.getFile({
    tenant: tenantId || undefined,
    filename: legacyPath,
  });

  return Buffer.isBuffer(data) ? data : Buffer.from(data);
}

/**
 * Imports one tree into the media library: every file becomes a medium, its
 * folders become tags, the root decides the visibility and the place it had
 * becomes its legacy path. Bytes are copied to the currently configured
 * provider — the import is the storage move as well — and the source is left
 * where it is; only `purge-legacy` ever removes it.
 *
 * @param {Object} params
 * @param {string|null} params.tenantId - Tenant of the tree, null for the instance.
 * @param {string} params.root - Root folder, e.g. `public`.
 * @param {MigrationReport} params.report - Report to fill.
 * @param {boolean} params.dryRun - Whether to only rehearse.
 * @returns {Promise<void>}
 */
async function importTree({ tenantId, root, report, dryRun }) {
  const files = await listLegacyTree({ tenantId, root });

  for (const file of files) {
    try {
      const existing = await MediaManager.getMediaByLegacyPath(
        tenantId,
        file.legacyPath,
      );

      if (existing) {
        report.skippedOne();
        continue;
      }

      if (dryRun) {
        report.processedOne();
        continue;
      }

      const data = await readLegacyFile({
        tenantId,
        legacyPath: file.legacyPath,
      });

      await MediaService.importMedia({
        tenantId,
        legacyPath: file.legacyPath,
        file: { name: file.fileName, data },
        metadata: {
          title: file.fileName,
          tags: legacyTags(file.legacyPath),
          visibility: legacyVisibility(file.legacyPath),
        },
      });

      report.processedOne();
    } catch (error) {
      report.failed(file.legacyPath, error);
    }
  }
}

/**
 * Turns the whole legacy stock into media: `public/` and `protected/` of every
 * tenant, and the tenant-less trees, which become instance media (§4.9).
 *
 * @param {Object} [params]
 * @param {boolean} [params.dryRun] - Whether to only rehearse.
 * @returns {Promise<MigrationReport>}
 */
async function importLegacyMedia({ dryRun = false } = {}) {
  const report = new MigrationReport("import:media", dryRun);
  const tenants = await TenantManager.getTenants();
  const scopes = [null, ...tenants.map((tenant) => tenant.id)];

  for (const tenantId of scopes) {
    for (const root of LEGACY_ROOTS) {
      await importTree({ tenantId, root, report, dryRun });
    }
  }

  return report;
}

/**
 * Places the generated documents of the legacy trees (`receipts/`, `invoices/`,
 * `cancellations/`) with their bookings. The only link the old world left is
 * the file name in the booking attachment, so that is what is matched — a file
 * no attachment names stays where it is and goes into the report as an orphan.
 * An aggregated document names several bookings and becomes one medium that
 * references them all — one file, one medium, whatever the number of bookings.
 *
 * @param {Object} [params]
 * @param {boolean} [params.dryRun] - Whether to only rehearse.
 * @returns {Promise<MigrationReport>}
 */
async function importBookingDocuments({ dryRun = false } = {}) {
  const report = new MigrationReport("import:booking-documents", dryRun);
  const tenants = await TenantManager.getTenants();

  for (const tenant of tenants) {
    for (const type of Object.values(BOOKING_DOCUMENT)) {
      const files = await listLegacyTree({
        tenantId: tenant.id,
        root: type.legacyFolder,
      });

      for (const file of files) {
        try {
          const bookings = await BookingManager.getBookingsByAttachmentFileName(
            tenant.id,
            file.fileName,
          );

          if (bookings.length === 0) {
            report.orphan(
              `${tenant.id}:${file.legacyPath}`,
              "no booking attachment names this file",
            );
            continue;
          }

          const existing = await MediaManager.getMediaByLegacyPath(
            tenant.id,
            file.legacyPath,
          );

          if (existing) {
            report.skippedOne();
            continue;
          }

          if (dryRun) {
            report.processedOne();
            continue;
          }

          const data = await readLegacyFile({
            tenantId: tenant.id,
            legacyPath: file.legacyPath,
          });

          await MediaService.importMedia({
            tenantId: tenant.id,
            legacyPath: file.legacyPath,
            file: { name: file.fileName, data },
            bookingIds: bookings.map((booking) => booking.id),
            metadata: {
              title: file.fileName,
              tags: [type.tag],
              // Meaningless for a booking document, but never the public
              // default — access follows the bookings alone.
              visibility: legacyVisibility(file.legacyPath),
            },
          });

          report.processedOne();
        } catch (error) {
          report.failed(`${tenant.id}:${file.legacyPath}`, error);
        }
      }
    }
  }

  return report;
}

/**
 * Reads a stored address as a media reference. Only the path decides whether an
 * address is ours: stored legacy URLs carry the host of the environment they
 * were uploaded in, and that host may be long gone. An address that points at
 * the legacy file route of the right scope and resolves to an imported medium
 * becomes a media reference; anything else stays the external reference it is.
 *
 * @param {string} value - The stored address.
 * @param {string|null} tenantId - Tenant of the referencing entity, null for
 *   the instance.
 * @returns {Promise<Object|null>} The reference, or null for an empty site.
 */
async function resolveStoredAddress(value, tenantId) {
  const url = String(value ?? "").trim();

  if (!url) {
    return null;
  }

  const external = { source: MEDIA_REFERENCE_SOURCE.EXTERNAL, url };
  const legacy = parseLegacyUrl(url);

  // Strict separation: a tenant entity never references an instance medium and
  // the instance never references a tenant's (§4.9).
  if (!legacy || (legacy.tenantId || null) !== (tenantId || null)) {
    return external;
  }

  const media = await MediaManager.getMediaByLegacyPath(
    tenantId,
    legacy.legacyPath,
  );

  if (!media) {
    return external;
  }

  return { source: MEDIA_REFERENCE_SOURCE.MEDIA, mediaId: media.id };
}

/**
 * Converts the attachments of an entity in place.
 *
 * @param {Array} attachments - The stored attachments.
 * @param {string|null} tenantId - Tenant of the entity.
 * @returns {Promise<boolean>} Whether anything changed.
 */
async function rewriteAttachments(attachments, tenantId) {
  if (!Array.isArray(attachments)) {
    return false;
  }

  let changed = false;

  for (let index = 0; index < attachments.length; index++) {
    const attachment = attachments[index];

    // A bare string is a legacy attachment that never had context fields.
    const plain =
      typeof attachment === "string" ? { url: attachment } : attachment;

    if (!plain || plain.reference) {
      continue;
    }

    const reference = await resolveStoredAddress(plain.url, tenantId);

    if (!reference) {
      continue;
    }

    attachments[index] = { ...plain, reference };
    changed = true;
  }

  return changed;
}

/**
 * Converts the reference sites of one bookable.
 *
 * @param {Object} bookable - The bookable to convert.
 * @param {string} tenantId - Tenant of the bookable.
 * @returns {Promise<boolean>} Whether anything changed.
 */
async function convertBookable(bookable, tenantId) {
  let changed = false;

  // The legacy single image becomes position 0 of the image list — the cover
  // image. A list that already holds something has been converted.
  if (bookable.imgUrl && (bookable.images || []).length === 0) {
    const reference = await resolveStoredAddress(bookable.imgUrl, tenantId);

    if (reference) {
      bookable.images = [reference];
      changed = true;
    }
  }

  return (await rewriteAttachments(bookable.attachments, tenantId)) || changed;
}

/**
 * Converts the reference sites of one event.
 *
 * @param {Object} event - The event to convert.
 * @param {string} tenantId - Tenant of the event.
 * @returns {Promise<boolean>} Whether anything changed.
 */
async function convertEvent(event, tenantId) {
  let changed = false;

  // Every image site of an event (§4.8). A position of the image list is a
  // site like any other — the list holds it, its index names it.
  const sites = [
    { holder: event.information, field: "teaserImage" },
    { holder: event.eventOrganizer, field: "contactPersonImage" },
    ...(event.eventOrganizer?.speakers || []).map((speaker) => ({
      holder: speaker,
      field: "image",
    })),
    ...[...(event.images || []).keys()].map((index) => ({
      holder: event.images,
      field: index,
    })),
  ];

  for (const site of sites) {
    const stored = site.holder?.[site.field];

    // Anything already typed is converted; only a bare string is legacy.
    if (typeof stored !== "string" || !stored) {
      continue;
    }

    const reference = await resolveStoredAddress(stored, tenantId);

    if (reference) {
      site.holder[site.field] = reference;
      changed = true;
    }
  }

  return (await rewriteAttachments(event.attachments, tenantId)) || changed;
}

/**
 * Converts the reference sites of the instance itself: the two branding images
 * and the three legal documents (§4.9). They resolve against the tenant-less
 * scope, so only tenant-less legacy addresses become media here.
 *
 * @param {Object} instance - The instance to convert.
 * @returns {Promise<boolean>} Whether anything changed.
 */
async function convertInstance(instance) {
  let changed = false;

  for (const field of BRANDING_REFERENCE_FIELDS) {
    const branding = instance.branding;

    if (!branding || branding[field.reference]) {
      continue;
    }

    const reference = await resolveStoredAddress(
      branding[field.readField],
      null,
    );

    if (reference) {
      branding[field.reference] = reference;
      changed = true;
    }
  }

  for (const field of DOCUMENT_FIELDS) {
    const document = instance[field];

    if (!document || document.reference) {
      continue;
    }

    const reference = await resolveStoredAddress(document.url, null);

    if (reference) {
      document.reference = reference;
      changed = true;
    }
  }

  return changed;
}

/**
 * Walks one kind of entity through its conversion. Every reference site of the
 * platform is converted the same way — convert, store what changed, count what
 * was already converted — so the bookkeeping lives here once.
 *
 * @param {Object} params
 * @param {string} params.kind - Entity kind, for the report subjects.
 * @param {Array<Object>} params.entities - The entities to walk.
 * @param {Function} params.convert - Converts one entity, returns whether it changed.
 * @param {Function} params.store - Stores one converted entity.
 * @param {MigrationReport} params.report - Report to fill.
 * @param {boolean} params.dryRun - Whether to only rehearse.
 * @returns {Promise<void>}
 */
async function rewriteEach({ kind, entities, convert, store, report, dryRun }) {
  for (const entity of entities) {
    try {
      if (!(await convert(entity))) {
        report.skippedOne();
        continue;
      }

      if (!dryRun) {
        await store(entity);
      }

      report.processedOne();
    } catch (error) {
      report.failed(`${kind}:${entity.id ?? kind}`, error);
    }
  }
}

/**
 * Converts every stored address of the platform into a media reference where an
 * imported medium answers for it (§4.10).
 *
 * @param {Object} [params]
 * @param {boolean} [params.dryRun] - Whether to only rehearse.
 * @returns {Promise<MigrationReport>}
 */
async function rewriteReferences({ dryRun = false } = {}) {
  const report = new MigrationReport("import:references", dryRun);
  const tenants = await TenantManager.getTenants();

  for (const tenant of tenants) {
    const tenantId = tenant.id;

    await rewriteEach({
      kind: `bookable:${tenantId}`,
      entities: await BookableManager.getBookables(tenantId),
      convert: (bookable) => convertBookable(bookable, tenantId),
      store: (bookable) => BookableManager.storeBookable(bookable, false),
      report,
      dryRun,
    });

    await rewriteEach({
      kind: `event:${tenantId}`,
      entities: await EventManager.getEvents(tenantId),
      convert: (event) => convertEvent(event, tenantId),
      store: (event) => EventManager.storeEvent(event, false),
      report,
      dryRun,
    });

    await rewriteEach({
      kind: `booking:${tenantId}`,
      entities: await BookingManager.getBookingsWithAttachments(tenantId),
      convert: (booking) => rewriteAttachments(booking.attachments, tenantId),
      store: (booking) => BookingManager.storeBooking(booking, false),
      report,
      dryRun,
    });
  }

  const instance = await InstanceManager.getInstance();

  await rewriteEach({
    kind: "instance",
    entities: instance ? [instance] : [],
    convert: convertInstance,
    store: (entity) => InstanceManager.updateInstance(entity),
    report,
    dryRun,
  });

  return report;
}

/**
 * The whole move, in the order it has to happen: the stock becomes media, the
 * generated documents find their bookings, and only then are the stored
 * addresses rewritten — a reference can only point at a medium that exists.
 *
 * The command is idempotent: a second run finds every file imported and every
 * address converted, and changes nothing.
 *
 * @param {Object} [params]
 * @param {boolean} [params.dryRun] - Whether to only rehearse.
 * @returns {Promise<{report: MigrationReport, steps: MigrationReport[]}>}
 */
async function runImport({ dryRun = false } = {}) {
  const steps = [
    await importLegacyMedia({ dryRun }),
    await importBookingDocuments({ dryRun }),
    await rewriteReferences({ dryRun }),
  ];

  return { report: MigrationReport.rollUp("import", dryRun, steps), steps };
}

module.exports = {
  listLegacyTree,
  rewriteReferences,
  runImport,
};
