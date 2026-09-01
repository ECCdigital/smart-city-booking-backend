const assert = require("assert");
const sinon = require("sinon");
const sharp = require("sharp");

const MediaControllerV2 = require("../src/platform/api/v2/controllers/media.controller");
const InstanceManager = require("../src/commons/data-managers/instance-manager");
const MediaManager = require("../src/commons/data-managers/media-manager");
const MediaReferenceGuard = require("../src/commons/services/media/media-reference-guard");
const MediaService = require("../src/commons/services/media/media-service");
const MembershipManager = require("../src/commons/data-managers/membership-manager");
const UserManager = require("../src/commons/data-managers/user-manager");
const storage = require("../src/commons/services/storage");
const Instance = require("../src/commons/entities/instance/instance");
const { Media } = require("../src/commons/entities/media/media");
const {
  MediaUsageService,
} = require("../src/commons/services/media/media-usage");

const TENANT = "tenant1";
const OWNER = { id: "instance-owner" };
const SIGNED_IN = { id: "someone" };
const BACKEND_URL = "https://booking.example.org";

function createResponse() {
  return {
    statusCode: null,
    body: undefined,
    headers: {},
    ended: false,
    writableEnded: false,
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
    destroy() {},
  };
}

/**
 * A request on the instance routes: no `:tenant` at all — that absence is what
 * puts the shared handlers into the instance scope.
 */
function instanceRequest({
  user = null,
  params = {},
  query = {},
  body = {},
  files,
}) {
  return { user, params, query, body, files, headers: {}, on() {} };
}

function createStream() {
  return {
    handlers: {},
    on(event, handler) {
      this.handlers[event] = handler;
      return this;
    },
    pipe(destination) {
      return destination;
    },
    destroy() {},
  };
}

function instanceMediaFixture(overrides = {}) {
  return new Media({
    id: "media-1",
    tenantId: null,
    kind: "image",
    mimeType: "image/png",
    size: 12,
    checksum: "abc",
    originalFileName: "logo.png",
    title: "Logo",
    visibility: "public",
    uploadedBy: OWNER.id,
    storage: { provider: "nextcloud", key: "_instance/media/media-1/logo.png" },
    ...overrides,
  });
}

/**
 * A minimal but well-formed ICO: the ICONDIR header `file-type` recognises,
 * one directory entry, and a PNG payload behind it.
 */
function icoBytes(payload) {
  const header = Buffer.alloc(6);
  header.writeUInt16LE(0, 0);
  header.writeUInt16LE(1, 2);
  header.writeUInt16LE(1, 4);

  const entry = Buffer.alloc(16);
  entry.writeUInt8(16, 0);
  entry.writeUInt8(16, 1);
  entry.writeUInt32LE(payload.length, 8);
  entry.writeUInt32LE(header.length + 16, 12);

  return Buffer.concat([header, entry, payload]);
}

describe("instance media", function () {
  let sandbox;
  let provider;
  let instance;
  let pngBytes;

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
      deleteMany: sandbox.stub().resolves(),
      deletePrefix: sandbox.stub().resolves(),
    };

    instance = { ownerUserIds: [OWNER.id] };

    sandbox.stub(storage, "getStorageProvider").returns(provider);
    sandbox
      .stub(InstanceManager, "getInstance")
      .callsFake(async () => instance);
    // Nothing in the instance scope may fall back on a tenant membership or a
    // tenant role — every test would notice if it did.
    sandbox
      .stub(MembershipManager, "getMembershipByTenantAndUserID")
      .resolves({ status: "active", owner: true });
    sandbox
      .stub(UserManager, "getUserPermissions")
      .resolves({ tenants: [], instanceOwner: false });
    sandbox.stub(MediaUsageService, "findUsage").resolves([]);
  });

  afterEach(function () {
    sandbox.restore();
  });

  describe("owner-only management", function () {
    beforeEach(function () {
      sandbox.stub(MediaManager, "getMedia").resolves(instanceMediaFixture());
      sandbox
        .stub(MediaManager, "storeMedia")
        .callsFake(async (media) => media);
      sandbox
        .stub(MediaManager, "getMediaList")
        .resolves({ items: [], total: 0, page: 1, pageSize: 25 });
      sandbox.stub(MediaService, "deleteMedia").resolves(true);
    });

    const operations = [
      {
        name: "upload",
        run: (user) =>
          MediaControllerV2.createMedia(
            instanceRequest({
              user,
              body: { name: "Logo" },
            }),
            createResponse(),
          ),
      },
      {
        name: "listing",
        run: (user) =>
          MediaControllerV2.getMediaList(
            instanceRequest({ user }),
            createResponse(),
          ),
      },
      {
        name: "metadata",
        run: (user) =>
          MediaControllerV2.getMedia(
            instanceRequest({ user, params: { id: "media-1" } }),
            createResponse(),
          ),
      },
      {
        name: "usage proof",
        run: (user) =>
          MediaControllerV2.getMediaUsage(
            instanceRequest({ user, params: { id: "media-1" } }),
            createResponse(),
          ),
      },
      {
        name: "patch",
        run: (user) =>
          MediaControllerV2.updateMedia(
            instanceRequest({
              user,
              params: { id: "media-1" },
              body: { title: "New" },
            }),
            createResponse(),
          ),
      },
      {
        name: "delete",
        run: (user) =>
          MediaControllerV2.deleteMedia(
            instanceRequest({ user, params: { id: "media-1" } }),
            createResponse(),
          ),
      },
    ];

    for (const operation of operations) {
      it(`refuses ${operation.name} for a signed-in non-owner`, async function () {
        await assert.rejects(() => operation.run(SIGNED_IN), {
          statusCode: 403,
        });
      });

      it(`refuses ${operation.name} anonymously`, async function () {
        await assert.rejects(() => operation.run(null), { statusCode: 401 });
      });
    }

    it("lets the instance owner see the whole library, unnarrowed", async function () {
      await MediaControllerV2.getMediaList(
        instanceRequest({ user: OWNER }),
        createResponse(),
      );

      const args = MediaManager.getMediaList.firstCall.args[0];
      assert.strictEqual(args.tenantId, null);
      assert.strictEqual(args.uploadedBy, undefined);
    });

    it("lets the instance owner patch metadata", async function () {
      const res = createResponse();

      await MediaControllerV2.updateMedia(
        instanceRequest({
          user: OWNER,
          params: { id: "media-1" },
          body: { title: "New" },
        }),
        res,
      );

      assert.strictEqual(res.statusCode, 200);
      assert.strictEqual(res.body.title, "New");
    });

    it("lets the instance owner delete an unused medium", async function () {
      const res = createResponse();

      await MediaControllerV2.deleteMedia(
        instanceRequest({ user: OWNER, params: { id: "media-1" } }),
        res,
      );

      assert.strictEqual(res.statusCode, 204);
      assert.ok(MediaService.deleteMedia.calledOnce);
    });
  });

  describe("upload", function () {
    beforeEach(function () {
      sandbox
        .stub(MediaManager, "storeMedia")
        .callsFake(async (media) => media);
    });

    async function upload(file) {
      const res = createResponse();
      await MediaControllerV2.createMedia(
        instanceRequest({ user: OWNER, body: {}, files: { file } }),
        res,
      );
      return res;
    }

    it("stores the bytes under the instance prefix", async function () {
      const res = await upload({
        name: "logo.png",
        mimetype: "image/png",
        data: pngBytes,
        size: pngBytes.length,
      });

      assert.strictEqual(res.statusCode, 201);
      assert.strictEqual(res.body.tenantId, null);
      assert.strictEqual(
        res.body.url,
        `/api/v2/instance/media/${res.body.id}/file`,
      );
      assert.strictEqual(
        provider.put.firstCall.args[0].key,
        `_instance/media/${res.body.id}/original.png`,
      );
    });

    it("accepts an ICO and generates no variants for it", async function () {
      const data = icoBytes(pngBytes);

      const res = await upload({
        name: "favicon.ico",
        mimetype: "image/vnd.microsoft.icon",
        data,
        size: data.length,
      });

      assert.strictEqual(res.statusCode, 201);
      assert.strictEqual(res.body.kind, "image");
      assert.strictEqual(res.body.mimeType, "image/x-icon");
      assert.deepStrictEqual(res.body.variants, []);
      // One write: the original. A variant would have been a second one.
      assert.strictEqual(provider.put.callCount, 1);
      assert.strictEqual(
        provider.put.firstCall.args[0].key,
        `_instance/media/${res.body.id}/original.ico`,
      );
    });
  });

  describe("file access", function () {
    beforeEach(function () {
      sandbox.stub(MediaService, "getStream").resolves(createStream());
    });

    async function deliver(media, user) {
      sandbox.stub(MediaManager, "getMedia").resolves(media);
      const res = createResponse();

      await MediaControllerV2.getMediaFile(
        instanceRequest({ user, params: { id: "media-1" } }),
        res,
      );

      return res;
    }

    it("serves a public medium anonymously", async function () {
      const res = await deliver(instanceMediaFixture(), null);

      assert.strictEqual(res.headers["Content-Type"], "image/png");
    });

    it("serves an intern medium to any signed-in user", async function () {
      const res = await deliver(
        instanceMediaFixture({ visibility: "intern" }),
        SIGNED_IN,
      );

      assert.strictEqual(res.headers["Content-Type"], "image/png");
    });

    it("refuses an intern medium anonymously", async function () {
      sandbox
        .stub(MediaManager, "getMedia")
        .resolves(instanceMediaFixture({ visibility: "intern" }));

      await assert.rejects(
        () =>
          MediaControllerV2.getMediaFile(
            instanceRequest({ params: { id: "media-1" } }),
            createResponse(),
          ),
        { statusCode: 401 },
      );
    });
  });

  describe("separation from the tenants", function () {
    it("looks a medium up without a tenant", async function () {
      sandbox.stub(MediaManager, "getMedia").resolves(instanceMediaFixture());

      await MediaControllerV2.getMedia(
        instanceRequest({ user: OWNER, params: { id: "media-1" } }),
        createResponse(),
      );

      assert.deepStrictEqual(MediaManager.getMedia.firstCall.args, [
        "media-1",
        null,
      ]);
    });

    it("answers 404 for a tenant medium asked for as an instance medium", async function () {
      // The lookup is scoped, so a tenant medium is simply not there.
      sandbox.stub(MediaManager, "getMedia").resolves(null);

      await assert.rejects(
        () =>
          MediaControllerV2.getMedia(
            instanceRequest({ user: OWNER, params: { id: "media-1" } }),
            createResponse(),
          ),
        { statusCode: 404 },
      );
    });

    it("refuses a tenant medium in an instance reference site", async function () {
      // Scoped to the instance, a tenant medium is unknown.
      sandbox.stub(MediaManager, "getMedia").resolves(null);

      await assert.rejects(
        () =>
          MediaReferenceGuard.assertInstanceStorable(
            {
              branding: { logo: { source: "media", mediaId: "tenant-media" } },
            },
            OWNER.id,
          ),
        { statusCode: 400, code: "media_reference_unknown" },
      );
      assert.deepStrictEqual(MediaManager.getMedia.firstCall.args, [
        "tenant-media",
        null,
      ]);
    });

    it("refuses an instance medium in a tenant reference site", async function () {
      // The tenant-scoped lookup does not find a medium without a tenant.
      sandbox.stub(MediaManager, "getMedia").resolves(null);

      await assert.rejects(
        () =>
          MediaReferenceGuard.assertReferencesStorable({
            tenantId: TENANT,
            userId: OWNER.id,
            references: [{ source: "media", mediaId: "media-1" }],
            requirePublic: false,
          }),
        { statusCode: 400, code: "media_reference_unknown" },
      );
    });
  });

  describe("reference validation on the instance", function () {
    it("passes an instance medium the owner picked", async function () {
      sandbox.stub(MediaManager, "getMedia").resolves(instanceMediaFixture());

      await MediaReferenceGuard.assertInstanceStorable(
        {
          branding: { logo: { source: "media", mediaId: "media-1" } },
          dataProtection: {
            source: "url",
            url: "",
            reference: { source: "media", mediaId: "media-1" },
          },
        },
        OWNER.id,
      );
    });

    it("refuses references saved by anyone but the instance owner", async function () {
      sandbox.stub(MediaManager, "getMedia").resolves(instanceMediaFixture());

      await assert.rejects(
        () =>
          MediaReferenceGuard.assertInstanceStorable(
            { branding: { logo: { source: "media", mediaId: "media-1" } } },
            SIGNED_IN.id,
          ),
        { statusCode: 403 },
      );
    });

    it("refuses an intern medium as branding", async function () {
      sandbox
        .stub(MediaManager, "getMedia")
        .resolves(instanceMediaFixture({ visibility: "intern" }));

      await assert.rejects(
        () =>
          MediaReferenceGuard.assertInstanceStorable(
            { branding: { favicon: { source: "media", mediaId: "media-1" } } },
            OWNER.id,
          ),
        { statusCode: 400, code: "media_reference_not_public" },
      );
    });

    it("allows an intern medium as a legal document", async function () {
      sandbox
        .stub(MediaManager, "getMedia")
        .resolves(instanceMediaFixture({ visibility: "intern" }));

      await MediaReferenceGuard.assertInstanceStorable(
        {
          legalNotice: {
            source: "url",
            url: "",
            reference: { source: "media", mediaId: "media-1" },
          },
        },
        OWNER.id,
      );
    });

    it("leaves an instance without media references untouched", async function () {
      const getMedia = sandbox.stub(MediaManager, "getMedia");

      await MediaReferenceGuard.assertInstanceStorable(
        { branding: { logoUrl: "https://example.org/logo.png" } },
        SIGNED_IN.id,
      );

      assert.strictEqual(getMedia.called, false);
    });
  });

  describe("derived read fields", function () {
    let backendUrl;

    beforeEach(function () {
      backendUrl = process.env.BACKEND_URL;
      process.env.BACKEND_URL = BACKEND_URL;
    });

    afterEach(function () {
      process.env.BACKEND_URL = backendUrl;
    });

    it("derives logoUrl and faviconUrl from the stored references", function () {
      const exported = new Instance({
        branding: {
          active: true,
          logo: { source: "media", mediaId: "logo-1" },
          favicon: { source: "media", mediaId: "favicon-1" },
          logoUrl: "",
          faviconUrl: "",
        },
      }).exportWithMedia();

      // Absolute: the store front fetches these server side, with no origin of
      // its own to resolve a relative address against.
      assert.strictEqual(
        exported.branding.logoUrl,
        `${BACKEND_URL}/api/v2/instance/media/logo-1/file`,
      );
      assert.strictEqual(
        exported.branding.faviconUrl,
        `${BACKEND_URL}/api/v2/instance/media/favicon-1/file`,
      );
      // The reference itself keeps the relative URL every reference site carries.
      assert.strictEqual(
        exported.branding.logo.url,
        "/api/v2/instance/media/logo-1/file",
      );
    });

    it("prefers a stored reference over the legacy address beside it", function () {
      const exported = new Instance({
        branding: {
          active: true,
          logo: { source: "media", mediaId: "logo-1" },
          favicon: { source: "media", mediaId: "favicon-1" },
          logoUrl: "https://example.org/stale-logo.png",
          faviconUrl: "https://example.org/stale-favicon.ico",
        },
      }).exportWithMedia();

      assert.strictEqual(
        exported.branding.logoUrl,
        `${BACKEND_URL}/api/v2/instance/media/logo-1/file`,
      );
      assert.strictEqual(
        exported.branding.faviconUrl,
        `${BACKEND_URL}/api/v2/instance/media/favicon-1/file`,
      );
    });

    it("keeps a legacy branding URL when no reference is stored", function () {
      const exported = new Instance({
        branding: {
          active: true,
          logoUrl: "/api/files/get?name=/public/l.png",
        },
      }).exportWithMedia();

      assert.strictEqual(
        exported.branding.logoUrl,
        `${BACKEND_URL}/api/files/get?name=/public/l.png`,
      );
      assert.strictEqual(exported.branding.logo, null);
    });

    it("leaves an absolute legacy branding URL untouched", function () {
      const exported = new Instance({
        branding: {
          active: true,
          logoUrl: "https://cdn.example.org/logo.png",
        },
      }).exportWithMedia();

      assert.strictEqual(
        exported.branding.logoUrl,
        "https://cdn.example.org/logo.png",
      );
    });

    it("mirrors a legal document reference into its url", function () {
      const exported = new Instance({
        termsAndConditions: {
          source: "file",
          url: "",
          fileName: "agb.pdf",
          reference: { source: "media", mediaId: "doc-1" },
        },
      }).exportWithMedia();

      assert.strictEqual(
        exported.termsAndConditions.url,
        `${BACKEND_URL}/api/v2/instance/media/doc-1/file`,
      );
      // A medium is a plain URL to whoever reads it — nothing downstream has
      // to learn about media to follow it.
      assert.strictEqual(exported.termsAndConditions.source, "url");
      assert.strictEqual(exported.termsAndConditions.fileName, "agb.pdf");
    });

    it("leaves a legacy legal document untouched", function () {
      const exported = new Instance({
        legalNotice: {
          source: "url",
          url: "https://example.org/impressum",
          fileName: "",
        },
      }).exportWithMedia();

      assert.deepStrictEqual(exported.legalNotice, {
        source: "url",
        url: "https://example.org/impressum",
        fileName: "",
      });
    });

    it("prefers a document reference over the legacy address beside it", function () {
      const exported = new Instance({
        dataProtection: {
          source: "url",
          url: "https://example.org/stale-datenschutz",
          fileName: "",
          reference: { source: "media", mediaId: "doc-2" },
        },
      }).exportWithMedia();

      assert.strictEqual(
        exported.dataProtection.url,
        `${BACKEND_URL}/api/v2/instance/media/doc-2/file`,
      );
    });

    it("makes a relative legacy document address absolute", function () {
      const exported = new Instance({
        legalNotice: {
          source: "file",
          url: "/api/files/get?name=/public/impressum.pdf",
          fileName: "impressum.pdf",
        },
      }).exportWithMedia();

      assert.strictEqual(
        exported.legalNotice.url,
        `${BACKEND_URL}/api/files/get?name=/public/impressum.pdf`,
      );
    });
  });
});
