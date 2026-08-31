const assert = require("assert");
const crypto = require("node:crypto");
const sinon = require("sinon");

const MediaManager = require("../src/commons/data-managers/media-manager");
const MediaService = require("../src/commons/services/media/media-service");
const TenantManager = require("../src/commons/data-managers/tenant-manager");
const storage = require("../src/commons/services/storage");
const {
  NextcloudManager,
} = require("../src/commons/data-managers/file-manager");
const { StorageNotFoundError } = require("../src/errors/StorageError");
const {
  MediaUsageService,
} = require("../src/commons/services/media/media-usage");
const {
  cleanup,
  purgeImported,
  purgeLegacy,
  regenerate,
  relocate,
  verify,
} = require("../src/commons/services/media/media-maintenance");

const TENANT = "tenant1";

function imageMedium(overrides = {}) {
  return {
    id: "media-1",
    tenantId: TENANT,
    kind: "image",
    originalFileName: "logo.png",
    storage: {
      provider: "nextcloud",
      key: `${TENANT}/media/media-1/original.png`,
    },
    variants: [
      {
        name: "thumb",
        format: "webp",
        key: `${TENANT}/media/media-1/thumb.webp`,
      },
    ],
    ...overrides,
  };
}

function importedMedium(overrides = {}) {
  return {
    id: "media-1",
    tenantId: TENANT,
    kind: "document",
    originalFileName: "receipt-1.pdf",
    legacyPath: "/receipts/receipt-1.pdf",
    storage: {
      provider: "nextcloud",
      key: `${TENANT}/media/media-1/original.pdf`,
    },
    variants: [],
    ...overrides,
  };
}

describe("media maintenance", () => {
  let sandbox;
  let provider;
  let present;

  beforeEach(() => {
    sandbox = sinon.createSandbox();

    // The keys the storage actually holds.
    present = new Set();

    provider = {
      name: "nextcloud",
      stat: sandbox.stub().callsFake(async ({ key }) => {
        if (!present.has(key)) {
          throw new StorageNotFoundError({ provider: "nextcloud", key });
        }
        return { size: 1 };
      }),
      deleteMany: sandbox.stub().resolves(),
      deletePrefix: sandbox.stub().resolves(),
    };

    sandbox.stub(storage, "getStorageProvider").returns(provider);
    sandbox.stub(MediaManager, "getAllMedia").resolves([]);
    sandbox.stub(TenantManager, "getTenants").resolves([{ id: TENANT }]);
    sandbox.stub(NextcloudManager, "getFiles").resolves([]);
    sandbox.stub(NextcloudManager, "deleteFile").resolves();
    sandbox.stub(MediaManager, "getMediaByLegacyPath").resolves(null);
  });

  afterEach(() => {
    sandbox.restore();
  });

  describe("verify", () => {
    it("reports a medium whose bytes are gone", async () => {
      MediaManager.getAllMedia.resolves([imageMedium()]);
      present.add(`${TENANT}/media/media-1/original.png`);

      const report = await verify();

      assert.strictEqual(report.processed, 0);
      assert.strictEqual(report.orphans.length, 1);
      assert.match(report.orphans[0].reason, /thumb\.webp/);
    });

    it("passes a medium whose keys are all there", async () => {
      MediaManager.getAllMedia.resolves([imageMedium()]);
      present.add(`${TENANT}/media/media-1/original.png`);
      present.add(`${TENANT}/media/media-1/thumb.webp`);

      const report = await verify();

      assert.strictEqual(report.processed, 1);
      assert.strictEqual(report.orphans.length, 0);
    });

    it("walks a booking document like any other medium", async () => {
      // The reference model (`bookingIds`) changes nothing for maintenance:
      // a booking document claims its keys the same way.
      MediaManager.getAllMedia.resolves([
        imageMedium({
          kind: "document",
          originalFileName: "receipt-1.pdf",
          bookingIds: ["booking-1", "booking-2"],
          storage: {
            provider: "nextcloud",
            key: `${TENANT}/media/media-1/original.pdf`,
          },
          variants: [],
        }),
      ]);
      present.add(`${TENANT}/media/media-1/original.pdf`);

      const report = await verify();

      assert.strictEqual(report.processed, 1);
      assert.strictEqual(report.orphans.length, 0);
    });
  });

  describe("cleanup", () => {
    beforeEach(() => {
      MediaManager.getAllMedia.resolves([imageMedium()]);
      present.add(`${TENANT}/media/media-1/original.png`);
      present.add(`${TENANT}/media/media-1/thumb.webp`);
      // A variant of a preset the medium no longer lists.
      present.add(`${TENANT}/media/media-1/sm.webp`);
    });

    it("removes bytes in the key space of a medium that it does not claim", async () => {
      const report = await cleanup();

      assert.strictEqual(report.processed, 1);
      assert.deepStrictEqual(provider.deleteMany.firstCall.args, [
        { keys: [`${TENANT}/media/media-1/sm.webp`] },
      ]);
    });

    it("deletes nothing in a dry run", async () => {
      const report = await cleanup({ dryRun: true });

      assert.strictEqual(report.processed, 1);
      assert.strictEqual(provider.deleteMany.callCount, 0);
    });
  });

  describe("regenerate", () => {
    it("regenerates every image medium at its own provider", async () => {
      MediaManager.getAllMedia.resolves([imageMedium()]);
      const regenerateVariants = sandbox
        .stub(MediaService, "regenerateVariants")
        .resolves({ media: imageMedium(), added: ["a"], removed: [] });

      const report = await regenerate();

      assert.strictEqual(report.processed, 1);
      assert.strictEqual(regenerateVariants.callCount, 1);
    });

    it("regenerates nothing in a dry run", async () => {
      MediaManager.getAllMedia.resolves([imageMedium()]);
      const regenerateVariants = sandbox.stub(
        MediaService,
        "regenerateVariants",
      );

      const report = await regenerate({ dryRun: true });

      assert.strictEqual(report.processed, 1);
      assert.strictEqual(regenerateVariants.callCount, 0);
    });
  });

  describe("purge-imported", () => {
    let deleteMedia;
    let second;

    beforeEach(() => {
      second = importedMedium({
        id: "media-2",
        originalFileName: "receipt-2.pdf",
        legacyPath: "/receipts/receipt-2.pdf",
        storage: {
          provider: "nextcloud",
          key: `${TENANT}/media/media-2/original.pdf`,
        },
      });

      MediaManager.getAllMedia.resolves([importedMedium(), second]);
      sandbox.stub(MediaManager, "countMedia").resolves(0);
      sandbox.stub(MediaUsageService, "findUsage").resolves([]);
      deleteMedia = sandbox.stub(MediaService, "deleteMedia").resolves(true);
    });

    it("removes every imported medium of the stock", async () => {
      const report = await purgeImported();

      assert.strictEqual(report.processed, 2);
      assert.strictEqual(report.errors.length, 0);
      assert.strictEqual(deleteMedia.callCount, 2);
      assert.deepStrictEqual(MediaManager.getAllMedia.firstCall.args, [
        { legacyPath: { $ne: null } },
      ]);
    });

    it("restricts the run to one tenant", async () => {
      await purgeImported({ tenantId: TENANT });

      assert.deepStrictEqual(MediaManager.getAllMedia.firstCall.args, [
        { legacyPath: { $ne: null }, tenantId: TENANT },
      ]);
    });

    it("aborts without deleting anything when an entity still references a medium", async () => {
      MediaUsageService.findUsage
        .withArgs({ tenantId: TENANT, mediaId: "media-1" })
        .resolves([{ type: "bookable", id: "bookable-1", title: "Room" }]);

      const report = await purgeImported();

      assert.strictEqual(report.processed, 0);
      assert.strictEqual(deleteMedia.callCount, 0);
      assert.strictEqual(report.errors.length, 1);
      assert.match(report.errors[0].message, /bookable:bookable-1/);
    });

    it("deletes nothing in a dry run", async () => {
      const report = await purgeImported({ dryRun: true });

      assert.strictEqual(report.processed, 2);
      assert.strictEqual(deleteMedia.callCount, 0);
    });

    it("reports bytes the storage still holds after the delete", async () => {
      // `deleteMedia` removes bytes best-effort; what survives it can no longer
      // be reached by `cleanup` and has to be named here.
      present.add(`${TENANT}/media/media-1/original.pdf`);

      const report = await purgeImported();

      assert.strictEqual(report.processed, 2);
      assert.strictEqual(report.orphans.length, 1);
      assert.match(report.orphans[0].reason, /media-1\/original\.pdf/);
    });

    it("reports an empty scope on a second run", async () => {
      MediaManager.getAllMedia.resolves([]);

      const report = await purgeImported();

      assert.strictEqual(report.processed, 0);
      assert.strictEqual(report.skipped, 0);
      assert.strictEqual(report.errors.length, 0);
      assert.strictEqual(deleteMedia.callCount, 0);
      assert.ok(
        report.notes.some((note) => /found 0 imported media/.test(note)),
      );
    });

    it("counts the duplicate legacy paths it removes", async () => {
      // The stock of the pre-reference-model import: one legacy file, one
      // medium per booking it was matched against.
      MediaManager.getAllMedia.resolves([
        importedMedium(),
        importedMedium({ id: "media-2" }),
      ]);

      const report = await purgeImported();

      assert.strictEqual(report.processed, 2);
      assert.ok(
        report.notes.some((note) =>
          /duplicate legacy paths: 1 group, 2 media/.test(note),
        ),
      );
    });

    it("reports what is left per scope once it is done", async () => {
      MediaManager.countMedia
        .withArgs({ tenantId: TENANT, legacyPath: { $ne: null } })
        .resolves(0);
      MediaManager.countMedia.withArgs({ tenantId: TENANT }).resolves(7);

      const report = await purgeImported();

      assert.ok(
        report.notes.some((note) =>
          /remaining — tenant1: 0 imported of 7 media/.test(note),
        ),
      );
    });
  });

  describe("relocate", () => {
    const ORIGINAL = Buffer.from("original-bytes");
    const THUMB = Buffer.from("thumb-bytes");
    const ORIGINAL_KEY = `${TENANT}/media/media-1/original.png`;
    const THUMB_KEY = `${TENANT}/media/media-1/thumb.webp`;

    const sha256 = (data) =>
      crypto.createHash("sha256").update(data).digest("hex");

    function movableMedium(overrides = {}) {
      return imageMedium({
        mimeType: "image/png",
        size: ORIGINAL.length,
        checksum: sha256(ORIGINAL),
        variants: [
          {
            name: "thumb",
            format: "webp",
            key: THUMB_KEY,
            size: THUMB.length,
            checksum: sha256(THUMB),
          },
        ],
        ...overrides,
      });
    }

    let sourceBytes;
    let targetBytes;
    let source;
    let target;
    let storeMedia;

    beforeEach(() => {
      sourceBytes = new Map([
        [ORIGINAL_KEY, ORIGINAL],
        [THUMB_KEY, THUMB],
      ]);
      targetBytes = new Map();

      source = {
        name: "nextcloud",
        stat: sandbox.stub().callsFake(async ({ key }) => {
          if (!sourceBytes.has(key)) {
            throw new StorageNotFoundError({ provider: "nextcloud", key });
          }
          return { size: sourceBytes.get(key).length };
        }),
        getBuffer: sandbox.stub().callsFake(async ({ key }) => {
          if (!sourceBytes.has(key)) {
            throw new StorageNotFoundError({ provider: "nextcloud", key });
          }
          return sourceBytes.get(key);
        }),
      };

      target = {
        name: "s3",
        put: sandbox.stub().callsFake(async ({ key, data }) => {
          targetBytes.set(key, data);
          return { key, size: data.length };
        }),
        stat: sandbox.stub().callsFake(async ({ key }) => {
          if (!targetBytes.has(key)) {
            throw new StorageNotFoundError({ provider: "s3", key });
          }
          return { size: targetBytes.get(key).length };
        }),
      };

      storage.getStorageProvider.callsFake((name) =>
        name === "s3" ? target : source,
      );

      storeMedia = sandbox.stub(MediaManager, "storeMedia").resolves({});
      MediaManager.getAllMedia.resolves([movableMedium()]);
    });

    it("moves a medium as a whole and flips its storage location", async () => {
      const report = await relocate({ to: "s3" });

      assert.strictEqual(report.processed, 1);
      assert.strictEqual(report.errors.length, 0);

      // Every file travels under its unchanged key, with its own content type.
      assert.strictEqual(target.put.callCount, 2);
      assert.deepStrictEqual(targetBytes.get(ORIGINAL_KEY), ORIGINAL);
      assert.deepStrictEqual(targetBytes.get(THUMB_KEY), THUMB);
      assert.strictEqual(target.put.firstCall.args[0].contentType, "image/png");
      assert.strictEqual(
        target.put.secondCall.args[0].contentType,
        "image/webp",
      );

      // The flip happens once, after copy and verification, keys untouched.
      assert.strictEqual(storeMedia.callCount, 1);
      const [flipped, upsert] = storeMedia.firstCall.args;
      assert.strictEqual(flipped.storage.provider, "s3");
      assert.strictEqual(flipped.storage.key, ORIGINAL_KEY);
      assert.strictEqual(upsert, false);
    });

    it("only fetches media that are not at the target yet", async () => {
      await relocate({ to: "s3" });

      assert.deepStrictEqual(MediaManager.getAllMedia.firstCall.args, [
        { "storage.provider": { $ne: "s3" } },
      ]);
    });

    it("restricts the run to one tenant", async () => {
      await relocate({ to: "s3", tenantId: TENANT });

      assert.deepStrictEqual(MediaManager.getAllMedia.firstCall.args, [
        { "storage.provider": { $ne: "s3" }, tenantId: TENANT },
      ]);
    });

    it("counts what would move, per scope", async () => {
      const report = await relocate({ to: "s3", dryRun: true });

      assert.ok(
        report.notes.some((note) =>
          /1 media \(2 files\).*tenant1: 1/.test(note),
        ),
      );
    });

    it("copies and flips nothing in a dry run", async () => {
      const report = await relocate({ to: "s3", dryRun: true });

      assert.strictEqual(report.processed, 1);
      assert.strictEqual(target.put.callCount, 0);
      assert.strictEqual(storeMedia.callCount, 0);
    });

    it("reports missing source bytes in a dry run", async () => {
      sourceBytes.delete(THUMB_KEY);

      const report = await relocate({ to: "s3", dryRun: true });

      assert.strictEqual(report.processed, 0);
      assert.strictEqual(report.errors.length, 1);
      assert.match(report.errors[0].message, /thumb\.webp/);
    });

    it("leaves a medium in place when source bytes are missing", async () => {
      sourceBytes.delete(THUMB_KEY);

      const report = await relocate({ to: "s3" });

      assert.strictEqual(report.processed, 0);
      assert.strictEqual(report.errors.length, 1);
      assert.match(report.errors[0].message, /missing source bytes/);
      assert.strictEqual(storeMedia.callCount, 0);
    });

    it("leaves a medium in place when the copy does not verify", async () => {
      target.stat.callsFake(async () => ({ size: 999 }));

      const report = await relocate({ to: "s3" });

      assert.strictEqual(report.processed, 0);
      assert.strictEqual(report.errors.length, 1);
      assert.match(report.errors[0].message, /size mismatch/);
      assert.strictEqual(storeMedia.callCount, 0);
    });

    it("flags a checksum mismatch before the flip", async () => {
      MediaManager.getAllMedia.resolves([
        movableMedium({ checksum: "not-the-checksum-of-the-bytes" }),
      ]);

      const report = await relocate({ to: "s3" });

      assert.strictEqual(report.processed, 0);
      assert.strictEqual(report.errors.length, 1);
      assert.match(report.errors[0].message, /checksum mismatch/);
      assert.strictEqual(storeMedia.callCount, 0);
    });

    it("moves a medium without a stored checksum on size alone", async () => {
      const medium = movableMedium({ checksum: "" });
      medium.variants[0].checksum = "";
      MediaManager.getAllMedia.resolves([medium]);

      const report = await relocate({ to: "s3" });

      assert.strictEqual(report.processed, 1);
      assert.strictEqual(report.errors.length, 0);
      assert.strictEqual(storeMedia.callCount, 1);
    });

    it("keeps going when one medium fails", async () => {
      const broken = movableMedium({
        id: "media-2",
        storage: {
          provider: "nextcloud",
          key: `${TENANT}/media/media-2/original.png`,
        },
        variants: [],
      });
      MediaManager.getAllMedia.resolves([broken, movableMedium()]);

      const report = await relocate({ to: "s3" });

      assert.strictEqual(report.processed, 1);
      assert.strictEqual(report.errors.length, 1);
      assert.strictEqual(report.errors[0].subject, "media:media-2");
      assert.strictEqual(storeMedia.callCount, 1);
      assert.strictEqual(storeMedia.firstCall.args[0].id, "media-1");
    });

    it("rejects an unknown target provider", async () => {
      await assert.rejects(() => relocate({ to: "ftp" }), /ftp/);
    });
  });

  describe("purge-legacy", () => {
    beforeEach(() => {
      NextcloudManager.getFiles
        .withArgs({ tenant: TENANT, rootPath: "public" })
        .resolves([{ filename: "/public/logo.png", type: "file" }]);
    });

    it("removes a file the import took over", async () => {
      MediaManager.getMediaByLegacyPath
        .withArgs(TENANT, "/public/logo.png")
        .resolves({ id: "media-1" });

      const report = await purgeLegacy();

      assert.strictEqual(report.processed, 1);
      assert.deepStrictEqual(NextcloudManager.deleteFile.firstCall.args, [
        { tenantID: TENANT, filename: "/public/logo.png" },
      ]);
    });

    it("leaves a file no medium answers for in place", async () => {
      const report = await purgeLegacy();

      assert.strictEqual(report.processed, 0);
      assert.strictEqual(report.orphans.length, 1);
      assert.strictEqual(NextcloudManager.deleteFile.callCount, 0);
    });

    it("deletes nothing in a dry run", async () => {
      MediaManager.getMediaByLegacyPath
        .withArgs(TENANT, "/public/logo.png")
        .resolves({ id: "media-1" });

      const report = await purgeLegacy({ dryRun: true });

      assert.strictEqual(report.processed, 1);
      assert.strictEqual(NextcloudManager.deleteFile.callCount, 0);
    });

    it("removes an aggregated legacy document once one medium answers for it", async () => {
      // One file, one medium, N booking references — the single legacy-path
      // lookup is all purge-legacy needs under the reference model.
      NextcloudManager.getFiles
        .withArgs({ tenant: TENANT, rootPath: "public" })
        .resolves([]);
      NextcloudManager.getFiles
        .withArgs({ tenant: TENANT, rootPath: "receipts" })
        .resolves([{ filename: "/receipts/receipt-group.pdf", type: "file" }]);
      MediaManager.getMediaByLegacyPath
        .withArgs(TENANT, "/receipts/receipt-group.pdf")
        .resolves({ id: "media-1", bookingIds: ["booking-1", "booking-2"] });

      const report = await purgeLegacy();

      assert.strictEqual(report.processed, 1);
      assert.strictEqual(report.orphans.length, 0);
      assert.deepStrictEqual(NextcloudManager.deleteFile.firstCall.args, [
        { tenantID: TENANT, filename: "/receipts/receipt-group.pdf" },
      ]);
    });
  });
});
