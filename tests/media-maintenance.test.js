const assert = require("assert");
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
  cleanup,
  purgeLegacy,
  regenerate,
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
  });
});
