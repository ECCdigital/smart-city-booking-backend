const assert = require("assert");
const sinon = require("sinon");
const sharp = require("sharp");

const MediaManager = require("../src/commons/data-managers/media-manager");
const MediaService = require("../src/commons/services/media/media-service");
const storage = require("../src/commons/services/storage");
const {
  maxBytesForKind,
  uploadBackstopBytes,
} = require("../src/commons/services/media/media-config");

const TENANT = "tenant1";
const UPLOADER = "user-1";

/**
 * A PNG of the given size — the pipeline decides on content, so the fixtures
 * have to be real images.
 */
async function png(width, height = width) {
  return await sharp({
    create: {
      width,
      height,
      channels: 3,
      background: { r: 10, g: 120, b: 200 },
    },
  })
    .png()
    .toBuffer();
}

/**
 * An animated GIF: two differently coloured frames stacked into one raw image
 * become the pages of the encoded file.
 */
async function animatedGif(width = 600, frameHeight = 400) {
  const frame = async (background) =>
    await sharp({
      create: { width, height: frameHeight, channels: 3, background },
    })
      .raw()
      .toBuffer();

  const raw = Buffer.concat([
    await frame({ r: 255, g: 0, b: 0 }),
    await frame({ r: 0, g: 0, b: 255 }),
  ]);

  return await sharp(raw, {
    raw: {
      width,
      height: frameHeight * 2,
      channels: 3,
      pageHeight: frameHeight,
    },
  })
    .gif({ loop: 0 })
    .toBuffer();
}

function svg(width = 100, height = 100) {
  return Buffer.from(
    `<?xml version="1.0" encoding="UTF-8"?>\n<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}"><rect width="${width}" height="${height}" fill="#0af"/></svg>`,
  );
}

function pdf() {
  return Buffer.from(
    "%PDF-1.4\n1 0 obj<</Type/Catalog>>endobj\ntrailer<</Root 1 0 R>>\n%%EOF\n",
  );
}

function upload(data, name) {
  return {
    name,
    data,
    size: data.length,
    mimetype: "application/octet-stream",
  };
}

function variantNames(media) {
  return media.variants.map((variant) => variant.name);
}

const OVERRIDDEN_ENV = [
  "MEDIA_MAX_IMAGE_SIZE_MB",
  "MEDIA_MAX_DOCUMENT_SIZE_MB",
  "MEDIA_UPLOAD_BACKSTOP_SIZE_MB",
];

describe("Media upload pipeline", function () {
  let sandbox;
  let provider;
  let stored;
  let originalEnv;

  beforeEach(function () {
    sandbox = sinon.createSandbox();
    stored = [];
    originalEnv = Object.fromEntries(
      OVERRIDDEN_ENV.map((name) => [name, process.env[name]]),
    );

    provider = {
      put: sandbox.stub().resolves({}),
      getStream: sandbox.stub().resolves({}),
      getBuffer: sandbox.stub().resolves(Buffer.alloc(0)),
      stat: sandbox.stub().resolves({}),
      delete: sandbox.stub().resolves(),
      deleteMany: sandbox.stub().resolves(),
      deletePrefix: sandbox.stub().resolves(),
    };

    sandbox.stub(storage, "getStorageProvider").returns(provider);
    sandbox.stub(storage, "configuredProviderName").returns("nextcloud");
    sandbox.stub(MediaManager, "storeMedia").callsFake(async (media) => {
      stored.push(media);
      return media;
    });
  });

  afterEach(function () {
    sandbox.restore();

    // Put the developer's own environment back, do not just unset.
    for (const [name, value] of Object.entries(originalEnv)) {
      if (value === undefined) {
        delete process.env[name];
      } else {
        process.env[name] = value;
      }
    }
  });

  async function createMedia(data, name) {
    return await MediaService.createMedia({
      tenantId: TENANT,
      file: upload(data, name),
      uploadedBy: UPLOADER,
    });
  }

  describe("type detection", function () {
    it("decides the type from the content, not from the file name", async function () {
      const media = await createMedia(pdf(), "photo.png");

      assert.strictEqual(media.mimeType, "application/pdf");
      assert.strictEqual(media.kind, "document");
      assert.ok(media.storage.key.endsWith("/original.pdf"));
    });

    it("rejects a file whose real type is not on the allowlist", async function () {
      const zip = Buffer.concat([
        Buffer.from([0x50, 0x4b, 0x03, 0x04]),
        Buffer.alloc(64),
      ]);

      await assert.rejects(
        () => createMedia(zip, "picture.png"),
        (error) =>
          error.statusCode === 400 && error.code === "unsupported_file_type",
      );
      assert.strictEqual(provider.put.called, false);
      assert.strictEqual(stored.length, 0);
    });

    it("rejects a file that only pretends to be an image", async function () {
      await assert.rejects(
        () => createMedia(Buffer.from("this is plain text"), "picture.png"),
        (error) => error.statusCode === 400,
      );
    });

    it("rejects an empty upload", async function () {
      await assert.rejects(
        () => createMedia(Buffer.alloc(0), "empty.png"),
        (error) => error.code === "empty_file",
      );
    });

    it("accepts an SVG despite its missing magic bytes", async function () {
      const media = await createMedia(svg(), "logo.svg");

      assert.strictEqual(media.mimeType, "image/svg+xml");
      assert.strictEqual(media.kind, "image");
    });
  });

  describe("size limits", function () {
    it("refuses an image above the image limit", async function () {
      const data = await png(400);
      process.env.MEDIA_MAX_IMAGE_SIZE_MB = "0.001";

      await assert.rejects(
        () => createMedia(data, "big.png"),
        (error) => error.statusCode === 400 && error.code === "file_too_large",
      );
      assert.strictEqual(provider.put.called, false);
    });

    it("refuses a document above the document limit", async function () {
      process.env.MEDIA_MAX_DOCUMENT_SIZE_MB = "0.00001";

      await assert.rejects(
        () => createMedia(pdf(), "doc.pdf"),
        (error) => error.code === "file_too_large",
      );
    });

    it("judges an image against the image limit, not the document limit", async function () {
      process.env.MEDIA_MAX_IMAGE_SIZE_MB = "10";
      process.env.MEDIA_MAX_DOCUMENT_SIZE_MB = "0.00001";

      const media = await createMedia(await png(200), "small.png");

      assert.strictEqual(media.kind, "image");
    });

    it("keeps the global upload backstop above every media limit", function () {
      process.env.MEDIA_MAX_IMAGE_SIZE_MB = "15";
      process.env.MEDIA_MAX_DOCUMENT_SIZE_MB = "50";

      assert.ok(uploadBackstopBytes() > maxBytesForKind("document"));
      assert.ok(uploadBackstopBytes() > maxBytesForKind("image"));
    });

    it("never lets a configured backstop fall below a media limit", function () {
      process.env.MEDIA_MAX_DOCUMENT_SIZE_MB = "50";
      process.env.MEDIA_UPLOAD_BACKSTOP_SIZE_MB = "1";

      assert.ok(uploadBackstopBytes() > maxBytesForKind("document"));
    });

    it("refuses an upload the global backstop truncated", async function () {
      const file = { ...upload(await png(200), "big.png"), truncated: true };

      await assert.rejects(
        () => MediaService.createMedia({ tenantId: TENANT, file }),
        (error) => error.code === "file_too_large",
      );
    });
  });

  describe("image variants", function () {
    it("creates the full preset set for a large original", async function () {
      const media = await createMedia(await png(2000, 1000), "large.png");

      assert.deepStrictEqual(variantNames(media), ["thumb", "sm", "md", "lg"]);
      assert.ok(media.variants.every((variant) => variant.format === "webp"));
    });

    it("skips presets that would not shrink the original", async function () {
      const media = await createMedia(await png(600, 400), "medium.png");

      assert.deepStrictEqual(variantNames(media), ["thumb", "sm"]);
    });

    it("creates no variant at all for an original smaller than every preset", async function () {
      const media = await createMedia(await png(100), "tiny.png");

      assert.deepStrictEqual(variantNames(media), []);
      assert.strictEqual(provider.put.callCount, 1);
    });

    it("keeps the aspect ratio of width presets and crops the thumbnail square", async function () {
      const media = await createMedia(await png(2000, 1000), "large.png");

      const thumb = media.variants.find((variant) => variant.name === "thumb");
      const md = media.variants.find((variant) => variant.name === "md");

      assert.deepStrictEqual([thumb.width, thumb.height], [160, 160]);
      assert.deepStrictEqual([md.width, md.height], [800, 400]);
    });

    it("crops the thumbnail square even from a wide, flat original", async function () {
      const media = await createMedia(await png(600, 100), "panorama.png");

      const thumb = media.variants.find((variant) => variant.name === "thumb");

      assert.deepStrictEqual([thumb.width, thumb.height], [160, 160]);
    });

    it("stores every variant under its own key next to the original", async function () {
      const media = await createMedia(await png(2000), "large.png");

      const keys = provider.put.getCalls().map((call) => call.args[0].key);
      assert.deepStrictEqual(keys, [
        `${TENANT}/media/${media.id}/original.png`,
        `${TENANT}/media/${media.id}/thumb.webp`,
        `${TENANT}/media/${media.id}/sm.webp`,
        `${TENANT}/media/${media.id}/md.webp`,
        `${TENANT}/media/${media.id}/lg.webp`,
      ]);
      assert.ok(
        provider.put
          .getCalls()
          .slice(1)
          .every((call) => call.args[0].contentType === "image/webp"),
      );
    });

    it("records size and checksum of every variant", async function () {
      const media = await createMedia(await png(2000), "large.png");

      assert.ok(
        media.variants.every(
          (variant) =>
            variant.size > 0 && /^[0-9a-f]{64}$/.test(variant.checksum),
        ),
      );
    });

    it("rasterises an SVG into all presets and keeps the original vector", async function () {
      const media = await createMedia(svg(120, 120), "logo.svg");

      assert.deepStrictEqual(variantNames(media), ["thumb", "sm", "md", "lg"]);
      assert.ok(media.storage.key.endsWith("/original.svg"));

      const lg = media.variants.find((variant) => variant.name === "lg");
      assert.strictEqual(lg.width, 1600);
    });

    it("reduces an animated GIF to a still variant", async function () {
      const media = await createMedia(await animatedGif(), "moving.gif");

      const sm = media.variants.find((variant) => variant.name === "sm");
      const rendered = provider.put
        .getCalls()
        .find((call) => call.args[0].key.endsWith("sm.webp")).args[0].data;
      const metadata = await sharp(rendered).metadata();

      assert.strictEqual(sm.format, "webp");
      assert.strictEqual(metadata.pages ?? 1, 1);
    });

    it("gives documents no variants", async function () {
      const media = await createMedia(pdf(), "invoice.pdf");

      assert.deepStrictEqual(media.variants, []);
      assert.strictEqual(provider.put.callCount, 1);
    });
  });

  describe("atomicity", function () {
    function mediaFolderOf(key) {
      return key.split("/").slice(0, -1).join("/");
    }

    it("writes no medium and removes the media folder when a byte write fails", async function () {
      const data = await png(2000);
      provider.put.onCall(2).rejects(new Error("storage down"));

      await assert.rejects(() => createMedia(data, "large.png"));

      assert.strictEqual(stored.length, 0);
      assert.strictEqual(provider.deletePrefix.callCount, 1);
      assert.strictEqual(
        provider.deletePrefix.firstCall.args[0].prefix,
        mediaFolderOf(provider.put.firstCall.args[0].key),
      );
    });

    it("removes the media folder when the medium cannot be stored", async function () {
      const data = await png(600);
      MediaManager.storeMedia.rejects(new Error("database down"));

      await assert.rejects(() => createMedia(data, "medium.png"));

      assert.strictEqual(provider.deletePrefix.callCount, 1);
      assert.strictEqual(
        provider.deletePrefix.firstCall.args[0].prefix,
        mediaFolderOf(provider.put.firstCall.args[0].key),
      );
    });
  });
});
