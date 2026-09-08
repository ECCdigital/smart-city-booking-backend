const assert = require("assert");

const {
  validateMediaReference,
} = require("../src/commons/schemas/mediaSchema");

describe("media reference", function () {
  it("accepts a reference to a medium", function () {
    assert.strictEqual(
      validateMediaReference({ source: "media", mediaId: "media-1" }),
      true,
    );
  });

  it("accepts a reference to an external URL", function () {
    assert.strictEqual(
      validateMediaReference({
        source: "external",
        url: "https://example.org/image.png",
      }),
      true,
    );
  });

  it("rejects a reference carrying both a medium and a URL", function () {
    assert.strictEqual(
      validateMediaReference({
        source: "media",
        mediaId: "media-1",
        url: "https://example.org/image.png",
      }),
      false,
    );
  });

  it("rejects a reference carrying neither", function () {
    assert.strictEqual(validateMediaReference({ source: "media" }), false);
    assert.strictEqual(validateMediaReference({ source: "external" }), false);
  });

  it("rejects an unknown source", function () {
    assert.strictEqual(
      validateMediaReference({ source: "inline", url: "data:," }),
      false,
    );
  });
});
