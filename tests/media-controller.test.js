const assert = require("assert");
const sinon = require("sinon");
const sharp = require("sharp");

const MediaControllerV2 = require("../src/platform/api/v2/controllers/media.controller");
const MediaManager = require("../src/commons/data-managers/media-manager");
const MediaService = require("../src/commons/services/media/media-service");
const MembershipManager = require("../src/commons/data-managers/membership-manager");
const PermissionService = require("../src/commons/services/permission-service");
const storage = require("../src/commons/services/storage");
const { Media } = require("../src/commons/entities/media/media");

const TENANT = "tenant1";
const OWNER = { id: "owner-1" };
const MEMBER = { id: "member-1" };

function createResponse() {
  return {
    statusCode: null,
    body: undefined,
    headers: {},
    ended: false,
    writableEnded: false,
    destroyed: false,
    status(code) {
      this.statusCode = code;
      return this;
    },
    json(payload) {
      this.body = payload;
      this.ended = true;
      return this;
    },
    headersSent: false,
    setHeader(name, value) {
      this.headers[name] = value;
    },
    removeHeader(name) {
      delete this.headers[name];
    },
    end() {
      this.ended = true;
      return this;
    },
    destroy() {
      this.destroyed = true;
    },
  };
}

function createRequest({
  user = null,
  params = {},
  query = {},
  body = {},
  headers = {},
  files,
} = {}) {
  return {
    user,
    params: { tenant: TENANT, ...params },
    query,
    body,
    headers,
    files,
    on() {},
  };
}

function createStream() {
  return {
    piped: null,
    destroyed: false,
    handlers: {},
    on(event, handler) {
      this.handlers[event] = handler;
      return this;
    },
    pipe(destination) {
      this.piped = destination;
      return destination;
    },
    destroy() {
      this.destroyed = true;
    },
  };
}

function mediaFixture(overrides = {}) {
  return new Media({
    id: "media-1",
    tenantId: TENANT,
    kind: "image",
    mimeType: "image/png",
    size: 12,
    checksum: "abc",
    originalFileName: "picture.png",
    title: "Picture",
    visibility: "public",
    uploadedBy: OWNER.id,
    storage: {
      provider: "nextcloud",
      key: `${TENANT}/media/media-1/original.png`,
    },
    ...overrides,
  });
}

// The upload pipeline decides on content, so the fixture has to be a real PNG.
// 100px wide is below every preset — no variants, one byte write.
let pngBytes;

function pngUpload() {
  return {
    name: "picture.png",
    mimetype: "image/png",
    data: pngBytes,
    size: pngBytes.length,
  };
}

function variantFixture(name, overrides = {}) {
  return {
    name,
    format: "webp",
    width: 480,
    height: 320,
    size: 4096,
    checksum: `checksum-${name}`,
    key: `${TENANT}/media/media-1/${name}.webp`,
    ...overrides,
  };
}

describe("MediaControllerV2", function () {
  let sandbox;
  let provider;
  let deliveryStream;

  before(async function () {
    pngBytes = await sharp({
      create: {
        width: 100,
        height: 100,
        channels: 3,
        background: { r: 10, g: 120, b: 200 },
      },
    })
      .png()
      .toBuffer();
  });

  beforeEach(function () {
    sandbox = sinon.createSandbox();

    provider = {
      name: "nextcloud",
      put: sandbox.stub().resolves({ key: "k", size: 16 }),
      getStream: sandbox.stub().resolves(createStream()),
      getBuffer: sandbox.stub().resolves(Buffer.alloc(0)),
      stat: sandbox.stub().resolves({ size: 16 }),
      delete: sandbox.stub().resolves(),
      deleteMany: sandbox.stub().resolves(),
    };

    sandbox.stub(storage, "getStorageProvider").returns(provider);
    sandbox.stub(PermissionService, "_isTenantOwner").resolves(false);
    sandbox
      .stub(MembershipManager, "getMembershipByTenantAndUserID")
      .resolves(null);
  });

  afterEach(function () {
    sandbox.restore();
  });

  /**
   * Puts a recording stream behind the storage so a delivery can be observed.
   */
  function stubDelivery() {
    deliveryStream = createStream();
    sandbox.stub(MediaService, "getStream").resolves(deliveryStream);
  }

  /**
   * Serves a medium and returns the recording response.
   */
  async function deliver(media, { query = {}, headers = {}, user } = {}) {
    sandbox.stub(MediaManager, "getMedia").resolves(media);
    const res = createResponse();

    await MediaControllerV2.getMediaFile(
      createRequest({ user, params: { id: "media-1" }, query, headers }),
      res,
    );

    return res;
  }

  describe("upload", function () {
    beforeEach(function () {
      PermissionService._isTenantOwner.resolves(true);
      sandbox
        .stub(MediaManager, "storeMedia")
        .callsFake(async (media) => media);
    });

    it("stores the bytes under the media key and returns the medium", async function () {
      const req = createRequest({
        user: OWNER,
        body: { name: "Beach", tags: "summer, beach", visibility: "intern" },
        files: { file: pngUpload() },
      });
      const res = createResponse();

      await MediaControllerV2.createMedia(req, res);

      assert.strictEqual(res.statusCode, 201);
      assert.strictEqual(res.body.title, "Beach");
      assert.deepStrictEqual(res.body.tags, ["summer", "beach"]);
      assert.strictEqual(res.body.visibility, "intern");
      assert.strictEqual(res.body.kind, "image");
      assert.strictEqual(res.body.uploadedBy, OWNER.id);
      assert.strictEqual(
        res.body.url,
        `/api/v2/${TENANT}/media/${res.body.id}/file`,
      );

      const putArgs = provider.put.firstCall.args[0];
      assert.strictEqual(
        putArgs.key,
        `${TENANT}/media/${res.body.id}/original.png`,
      );
      assert.strictEqual(putArgs.contentType, "image/png");
    });

    it("never exposes the storage key of a medium", async function () {
      const req = createRequest({
        user: OWNER,
        files: { file: pngUpload() },
      });
      const res = createResponse();

      await MediaControllerV2.createMedia(req, res);

      assert.deepStrictEqual(res.body.storage, { provider: "nextcloud" });
    });

    it("rejects an upload without a file", async function () {
      const req = createRequest({ user: OWNER, files: {} });

      await assert.rejects(
        () => MediaControllerV2.createMedia(req, createResponse()),
        (error) => error.statusCode === 400 && error.code === "missing_file",
      );
    });

    it("rejects more than one file per request", async function () {
      const req = createRequest({
        user: OWNER,
        files: { file: [pngUpload(), pngUpload()] },
      });

      await assert.rejects(
        () => MediaControllerV2.createMedia(req, createResponse()),
        (error) => error.code === "multiple_files_not_supported",
      );
    });

    it("rejects an unknown visibility", async function () {
      const req = createRequest({
        user: OWNER,
        body: { visibility: "secret" },
        files: { file: pngUpload() },
      });

      await assert.rejects(
        () => MediaControllerV2.createMedia(req, createResponse()),
        (error) => error.code === "invalid_visibility",
      );
    });

    it("refuses uploads from users who do not own the tenant", async function () {
      PermissionService._isTenantOwner.resolves(false);
      const req = createRequest({
        user: MEMBER,
        files: { file: pngUpload() },
      });

      await assert.rejects(
        () => MediaControllerV2.createMedia(req, createResponse()),
        (error) => error.statusCode === 403,
      );
      assert.strictEqual(provider.put.called, false);
    });

    it("refuses anonymous uploads", async function () {
      const req = createRequest({ files: { file: pngUpload() } });

      await assert.rejects(
        () => MediaControllerV2.createMedia(req, createResponse()),
        (error) => error.statusCode === 401,
      );
    });
  });

  describe("reading a medium", function () {
    it("serves a public medium to anonymous callers", async function () {
      sandbox.stub(MediaManager, "getMedia").resolves(mediaFixture());
      const res = createResponse();

      await MediaControllerV2.getMedia(
        createRequest({ params: { id: "media-1" } }),
        res,
      );

      assert.strictEqual(res.statusCode, 200);
      assert.strictEqual(res.body.id, "media-1");
    });

    it("refuses an internal medium to anonymous callers", async function () {
      sandbox
        .stub(MediaManager, "getMedia")
        .resolves(mediaFixture({ visibility: "intern" }));

      await assert.rejects(
        () =>
          MediaControllerV2.getMedia(
            createRequest({ params: { id: "media-1" } }),
            createResponse(),
          ),
        (error) => error.statusCode === 401,
      );
    });

    it("refuses an internal medium to a user without membership in the tenant", async function () {
      sandbox
        .stub(MediaManager, "getMedia")
        .resolves(mediaFixture({ visibility: "intern" }));

      await assert.rejects(
        () =>
          MediaControllerV2.getMedia(
            createRequest({ user: MEMBER, params: { id: "media-1" } }),
            createResponse(),
          ),
        (error) => error.statusCode === 403,
      );
    });

    it("refuses an internal medium to a member whose membership is not active", async function () {
      sandbox
        .stub(MediaManager, "getMedia")
        .resolves(mediaFixture({ visibility: "intern" }));
      MembershipManager.getMembershipByTenantAndUserID.resolves({
        status: "pending",
      });

      await assert.rejects(
        () =>
          MediaControllerV2.getMedia(
            createRequest({ user: MEMBER, params: { id: "media-1" } }),
            createResponse(),
          ),
        (error) => error.statusCode === 403,
      );
    });

    it("serves an internal medium to an active member of the tenant", async function () {
      sandbox
        .stub(MediaManager, "getMedia")
        .resolves(mediaFixture({ visibility: "intern" }));
      MembershipManager.getMembershipByTenantAndUserID.resolves({
        status: "active",
      });
      const res = createResponse();

      await MediaControllerV2.getMedia(
        createRequest({ user: MEMBER, params: { id: "media-1" } }),
        res,
      );

      assert.strictEqual(res.statusCode, 200);
    });

    it("reports an unknown medium as not found", async function () {
      sandbox.stub(MediaManager, "getMedia").resolves(null);

      await assert.rejects(
        () =>
          MediaControllerV2.getMedia(
            createRequest({ params: { id: "nope" } }),
            createResponse(),
          ),
        (error) => error.statusCode === 404,
      );
    });
  });

  describe("listing", function () {
    beforeEach(function () {
      sandbox.stub(MediaManager, "getMediaList").resolves({
        items: [mediaFixture()],
        total: 1,
        page: 1,
        pageSize: 25,
      });
    });

    it("shows anonymous callers public media only", async function () {
      const res = createResponse();

      await MediaControllerV2.getMediaList(createRequest(), res);

      assert.deepStrictEqual(
        MediaManager.getMediaList.firstCall.args[0].visibility,
        ["public"],
      );
      assert.strictEqual(res.body.total, 1);
      assert.strictEqual(res.body.items.length, 1);
    });

    it("shows active members public and internal media", async function () {
      MembershipManager.getMembershipByTenantAndUserID.resolves({
        status: "active",
      });

      await MediaControllerV2.getMediaList(
        createRequest({ user: MEMBER }),
        createResponse(),
      );

      assert.deepStrictEqual(
        MediaManager.getMediaList.firstCall.args[0].visibility,
        ["public", "intern"],
      );
    });

    it("narrows a requested visibility to what the caller may read", async function () {
      await MediaControllerV2.getMediaList(
        createRequest({ query: { visibility: "intern" } }),
        createResponse(),
      );

      assert.deepStrictEqual(
        MediaManager.getMediaList.firstCall.args[0].visibility,
        [],
      );
    });

    it("keeps a requested visibility the caller may read", async function () {
      MembershipManager.getMembershipByTenantAndUserID.resolves({
        status: "active",
      });

      await MediaControllerV2.getMediaList(
        createRequest({ user: MEMBER, query: { visibility: "intern" } }),
        createResponse(),
      );

      assert.deepStrictEqual(
        MediaManager.getMediaList.firstCall.args[0].visibility,
        ["intern"],
      );
    });

    it("passes the kind, tag and free-text filters through", async function () {
      await MediaControllerV2.getMediaList(
        createRequest({
          query: { kind: "document", tag: "invoice", q: "2026", page: "2" },
        }),
        createResponse(),
      );

      const args = MediaManager.getMediaList.firstCall.args[0];
      assert.strictEqual(args.kind, "document");
      assert.strictEqual(args.tag, "invoice");
      assert.strictEqual(args.q, "2026");
      assert.strictEqual(args.page, "2");
    });

    it("rejects an unknown kind filter", async function () {
      await assert.rejects(
        () =>
          MediaControllerV2.getMediaList(
            createRequest({ query: { kind: "video" } }),
            createResponse(),
          ),
        (error) => error.code === "invalid_kind",
      );
    });
  });

  describe("metadata update", function () {
    beforeEach(function () {
      PermissionService._isTenantOwner.resolves(true);
      sandbox.stub(MediaManager, "getMedia").resolves(mediaFixture());
      sandbox
        .stub(MediaManager, "storeMedia")
        .callsFake(async (media) => media);
    });

    it("changes title, alt text, tags and visibility", async function () {
      const res = createResponse();

      await MediaControllerV2.updateMedia(
        createRequest({
          user: OWNER,
          params: { id: "media-1" },
          body: {
            title: "New title",
            altText: "A beach",
            tags: ["summer"],
            visibility: "intern",
          },
        }),
        res,
      );

      assert.strictEqual(res.statusCode, 200);
      assert.strictEqual(res.body.title, "New title");
      assert.strictEqual(res.body.altText, "A beach");
      assert.deepStrictEqual(res.body.tags, ["summer"]);
      assert.strictEqual(res.body.visibility, "intern");
    });

    it("leaves the file of a medium untouched", async function () {
      const res = createResponse();

      await MediaControllerV2.updateMedia(
        createRequest({
          user: OWNER,
          params: { id: "media-1" },
          body: {
            title: "New title",
            mimeType: "application/pdf",
            size: 999,
            checksum: "tampered",
            storage: { provider: "s3", key: "elsewhere" },
          },
        }),
        res,
      );

      const stored = MediaManager.storeMedia.firstCall.args[0];
      assert.strictEqual(stored.mimeType, "image/png");
      assert.strictEqual(stored.size, 12);
      assert.strictEqual(stored.checksum, "abc");
      assert.strictEqual(
        stored.storage.key,
        `${TENANT}/media/media-1/original.png`,
      );
    });

    it("rejects a request without any updatable field", async function () {
      await assert.rejects(
        () =>
          MediaControllerV2.updateMedia(
            createRequest({
              user: OWNER,
              params: { id: "media-1" },
              body: { mimeType: "application/pdf" },
            }),
            createResponse(),
          ),
        (error) => error.code === "no_updatable_fields",
      );
    });

    it("refuses updates from users who do not own the tenant", async function () {
      PermissionService._isTenantOwner.resolves(false);

      await assert.rejects(
        () =>
          MediaControllerV2.updateMedia(
            createRequest({
              user: MEMBER,
              params: { id: "media-1" },
              body: { title: "x" },
            }),
            createResponse(),
          ),
        (error) => error.statusCode === 403,
      );
    });
  });

  describe("file delivery", function () {
    beforeEach(stubDelivery);

    it("streams the original with its content type", async function () {
      const res = await deliver(mediaFixture());

      assert.strictEqual(res.headers["Content-Type"], "image/png");
      assert.strictEqual(res.headers["Content-Disposition"], "inline");
      assert.strictEqual(deliveryStream.piped, res);
      assert.strictEqual(
        MediaService.getStream.firstCall.args[1],
        `${TENANT}/media/media-1/original.png`,
      );
    });

    it("serves the requested preset from its own key", async function () {
      const media = mediaFixture({
        variants: [variantFixture("thumb"), variantFixture("md")],
      });

      const res = await deliver(media, { query: { size: "md" } });

      assert.strictEqual(
        MediaService.getStream.firstCall.args[1],
        `${TENANT}/media/media-1/md.webp`,
      );
      assert.strictEqual(res.headers["Content-Type"], "image/webp");
    });

    it("degrades a missing preset to the next larger variant", async function () {
      const media = mediaFixture({ variants: [variantFixture("lg")] });

      await deliver(media, { query: { size: "sm" } });

      assert.strictEqual(
        MediaService.getStream.firstCall.args[1],
        `${TENANT}/media/media-1/lg.webp`,
      );
    });

    it("degrades to the original when no variant is large enough", async function () {
      const media = mediaFixture({ variants: [variantFixture("thumb")] });

      const res = await deliver(media, { query: { size: "lg" } });

      assert.strictEqual(
        MediaService.getStream.firstCall.args[1],
        `${TENANT}/media/media-1/original.png`,
      );
      assert.strictEqual(res.headers["Content-Type"], "image/png");
    });

    it("rejects an unknown preset name", async function () {
      sandbox.stub(MediaManager, "getMedia").resolves(mediaFixture());

      await assert.rejects(
        () =>
          MediaControllerV2.getMediaFile(
            createRequest({
              params: { id: "media-1" },
              query: { size: "xxl" },
            }),
            createResponse(),
          ),
        (error) => error.statusCode === 400 && error.code === "invalid_size",
      );
      assert.strictEqual(MediaService.getStream.called, false);
    });

    it("offers the original of a vector medium as a download", async function () {
      const media = mediaFixture({
        mimeType: "image/svg+xml",
        originalFileName: "logo.svg",
        storage: {
          provider: "nextcloud",
          key: `${TENANT}/media/media-1/original.svg`,
        },
        variants: [variantFixture("sm")],
      });

      const res = await deliver(media);

      assert.strictEqual(
        res.headers["Content-Disposition"],
        'attachment; filename="logo.svg"',
      );
    });

    it("hands a storage failure before the first byte to the error handler", async function () {
      sandbox.stub(MediaManager, "getMedia").resolves(mediaFixture());
      const res = createResponse();
      const next = sandbox.stub();

      await MediaControllerV2.getMediaFile(
        createRequest({ params: { id: "media-1" } }),
        res,
        next,
      );
      deliveryStream.handlers.error(new Error("storage down"));

      const error = next.firstCall.args[0];
      assert.strictEqual(error.name, "StorageError");
      assert.strictEqual(error.statusCode, 503);
      assert.strictEqual(error.code, "storage_stream_failed");
      assert.strictEqual(res.headers["Content-Type"], undefined);
      assert.strictEqual(res.headers["Cache-Control"], undefined);
    });

    it("cuts the connection when the storage fails mid-transfer", async function () {
      sandbox.stub(MediaManager, "getMedia").resolves(mediaFixture());
      const res = createResponse();
      const next = sandbox.stub();

      await MediaControllerV2.getMediaFile(
        createRequest({ params: { id: "media-1" } }),
        res,
        next,
      );
      res.headersSent = true;
      deliveryStream.handlers.error(new Error("storage down"));

      assert.strictEqual(next.called, false);
      assert.strictEqual(res.destroyed, true);
    });

    it("refuses to stream an internal medium to anonymous callers", async function () {
      sandbox
        .stub(MediaManager, "getMedia")
        .resolves(mediaFixture({ visibility: "intern" }));

      await assert.rejects(
        () =>
          MediaControllerV2.getMediaFile(
            createRequest({ params: { id: "media-1" } }),
            createResponse(),
          ),
        (error) => error.statusCode === 401,
      );
      assert.strictEqual(MediaService.getStream.called, false);
    });
  });

  describe("delivery caching", function () {
    beforeEach(stubDelivery);

    it("caches a public original for a year without a validator", async function () {
      const res = await deliver(mediaFixture());

      assert.strictEqual(
        res.headers["Cache-Control"],
        "public, max-age=31536000, immutable",
      );
      assert.strictEqual(res.headers["ETag"], undefined);
    });

    it("caches a public variant for a day against its own checksum", async function () {
      const media = mediaFixture({ variants: [variantFixture("sm")] });

      const res = await deliver(media, { query: { size: "sm" } });

      assert.strictEqual(res.headers["Cache-Control"], "public, max-age=86400");
      assert.strictEqual(res.headers["ETag"], '"checksum-sm"');
    });

    it("keeps a preset that degraded to the original revalidatable", async function () {
      const media = mediaFixture({ variants: [variantFixture("thumb")] });

      const res = await deliver(media, { query: { size: "lg" } });

      assert.strictEqual(res.headers["Cache-Control"], "public, max-age=86400");
      assert.strictEqual(res.headers["ETag"], '"abc"');
    });

    it("lets an internal medium be revalidated only privately", async function () {
      MembershipManager.getMembershipByTenantAndUserID.resolves({
        status: "active",
      });

      const res = await deliver(mediaFixture({ visibility: "intern" }), {
        user: MEMBER,
      });

      assert.strictEqual(res.headers["Cache-Control"], "private, no-cache");
      assert.strictEqual(res.headers["ETag"], '"abc"');
    });

    it("never stores a booking document", async function () {
      const res = await deliver(mediaFixture({ bookingId: "booking-1" }));

      assert.strictEqual(res.headers["Cache-Control"], "private, no-store");
      assert.strictEqual(res.headers["ETag"], undefined);
    });

    it("answers a matching validator with 304 and no bytes", async function () {
      const media = mediaFixture({ variants: [variantFixture("sm")] });

      const res = await deliver(media, {
        query: { size: "sm" },
        headers: { "if-none-match": '"checksum-sm"' },
      });

      assert.strictEqual(res.statusCode, 304);
      assert.strictEqual(MediaService.getStream.called, false);
    });

    it("serves the bytes when the validator does not match", async function () {
      const media = mediaFixture({ variants: [variantFixture("sm")] });

      const res = await deliver(media, {
        query: { size: "sm" },
        headers: { "if-none-match": '"stale"' },
      });

      assert.strictEqual(res.statusCode, null);
      assert.strictEqual(deliveryStream.piped, res);
    });
  });

  describe("deletion", function () {
    beforeEach(function () {
      PermissionService._isTenantOwner.resolves(true);
      sandbox.stub(MediaManager, "getMedia").resolves(mediaFixture());
    });

    it("removes the database document first and the bytes afterwards", async function () {
      const removeMedia = sandbox
        .stub(MediaManager, "removeMedia")
        .resolves(true);
      const res = createResponse();

      await MediaControllerV2.deleteMedia(
        createRequest({ user: OWNER, params: { id: "media-1" } }),
        res,
      );

      assert.strictEqual(res.statusCode, 204);
      assert.ok(removeMedia.calledBefore(provider.deleteMany));
      assert.deepStrictEqual(provider.deleteMany.firstCall.args[0].keys, [
        `${TENANT}/media/media-1/original.png`,
      ]);
    });

    it("still succeeds when the bytes cannot be removed", async function () {
      sandbox.stub(MediaManager, "removeMedia").resolves(true);
      provider.deleteMany.rejects(new Error("storage down"));
      const res = createResponse();

      await MediaControllerV2.deleteMedia(
        createRequest({ user: OWNER, params: { id: "media-1" } }),
        res,
      );

      assert.strictEqual(res.statusCode, 204);
    });

    it("refuses deletion from users who do not own the tenant", async function () {
      PermissionService._isTenantOwner.resolves(false);
      const removeMedia = sandbox.stub(MediaManager, "removeMedia");

      await assert.rejects(
        () =>
          MediaControllerV2.deleteMedia(
            createRequest({ user: MEMBER, params: { id: "media-1" } }),
            createResponse(),
          ),
        (error) => error.statusCode === 403,
      );
      assert.strictEqual(removeMedia.called, false);
    });
  });
});
