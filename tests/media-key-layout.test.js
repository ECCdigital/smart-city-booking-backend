const assert = require("assert");

const {
  originalKey,
  variantKey,
} = require("../src/commons/services/storage/media-keys");

describe("media key layout", function () {
  it("derives the original key from the media identity", function () {
    assert.strictEqual(
      originalKey({
        tenantId: "tenant1",
        mediaId: "media-1",
        mimeType: "image/png",
        fileName: "holiday snapshot.PNG",
      }),
      "tenant1/media/media-1/original.png",
    );
  });

  it("places instance media under the instance prefix", function () {
    assert.strictEqual(
      originalKey({
        tenantId: null,
        mediaId: "media-1",
        mimeType: "application/pdf",
        fileName: "terms.pdf",
      }),
      "_instance/media/media-1/original.pdf",
    );
  });

  it("falls back to the file name extension for unknown MIME types", function () {
    assert.strictEqual(
      originalKey({
        tenantId: "tenant1",
        mediaId: "media-1",
        mimeType: "application/octet-stream",
        fileName: "archive.heic",
      }),
      "tenant1/media/media-1/original.heic",
    );
  });

  it("keeps variants next to their original", function () {
    assert.strictEqual(
      variantKey({
        tenantId: "tenant1",
        mediaId: "media-1",
        name: "thumb",
        format: "webp",
      }),
      "tenant1/media/media-1/thumb.webp",
    );
  });

  it("never encodes visibility in the key", function () {
    const key = originalKey({
      tenantId: "tenant1",
      mediaId: "media-1",
      mimeType: "image/png",
      fileName: "a.png",
    });

    assert.ok(!key.includes("public"));
    assert.ok(!key.includes("intern"));
    assert.ok(!key.includes("protected"));
  });

  it("rejects path traversal in the media identity", function () {
    assert.throws(() =>
      originalKey({
        tenantId: "../../etc",
        mediaId: "media-1",
        mimeType: "image/png",
        fileName: "a.png",
      }),
    );

    assert.throws(() =>
      originalKey({
        tenantId: "tenant1",
        mediaId: "..",
        mimeType: "image/png",
        fileName: "a.png",
      }),
    );
  });
});
