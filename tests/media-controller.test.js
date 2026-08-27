const assert = require("assert");
const sinon = require("sinon");
const sharp = require("sharp");

const MediaControllerV2 = require("../src/platform/api/v2/controllers/media.controller");
const BookingManager = require("../src/commons/data-managers/booking-manager");
const InstanceManager = require("../src/commons/data-managers/instance-manager");
const MediaManager = require("../src/commons/data-managers/media-manager");
const MediaService = require("../src/commons/services/media/media-service");
const {
  MediaUsageService,
} = require("../src/commons/services/media/media-usage");
const MembershipManager = require("../src/commons/data-managers/membership-manager");
const UserManager = require("../src/commons/data-managers/user-manager");
const storage = require("../src/commons/services/storage");
const { Media } = require("../src/commons/entities/media/media");

const TENANT = "tenant1";
const OWNER = { id: "owner-1" };
const MEMBER = { id: "member-1" };
const CUSTOMER = { id: "customer-1" };

const NO_ACTIONS = {
  create: false,
  readAny: false,
  readOwn: false,
  updateAny: false,
  updateOwn: false,
  deleteAny: false,
  deleteOwn: false,
};

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

function bookingDocumentFixture(overrides = {}) {
  return mediaFixture({
    kind: "document",
    mimeType: "application/pdf",
    originalFileName: "invoice-1.pdf",
    title: "invoice-1.pdf",
    visibility: "intern",
    uploadedBy: null,
    bookingId: "booking-1",
    storage: {
      provider: "nextcloud",
      key: `${TENANT}/media/media-1/original.pdf`,
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

  // The three sources every permission check reads. Tests set them instead of
  // stubbing the PermissionService, so the real rules run.
  let instance;
  let membership;
  let permissions;

  // The usage proof is searched over the entities, which no unit test holds —
  // tests that care about it set this list.
  let usage;

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

    instance = { ownerUserIds: [] };
    membership = null;
    permissions = { tenants: [], instanceOwner: false };
    usage = [];

    sandbox.stub(storage, "getStorageProvider").returns(provider);
    sandbox
      .stub(InstanceManager, "getInstance")
      .callsFake(async () => instance);
    sandbox
      .stub(MembershipManager, "getMembershipByTenantAndUserID")
      .callsFake(async () => membership);
    sandbox
      .stub(UserManager, "getUserPermissions")
      .callsFake(async () => permissions);
    sandbox
      .stub(MediaUsageService, "findUsage")
      .callsFake(async () => usage.map((site) => ({ ...site })));
  });

  afterEach(function () {
    sandbox.restore();
  });

  /**
   * Grants role permissions in the tenant, e.g. `{ manageMedia: { create: true } }`.
   */
  function grant(dimensions) {
    permissions = {
      tenants: [
        {
          tenantId: TENANT,
          isOwner: false,
          adminInterfaces: [],
          manageMedia: { ...NO_ACTIONS },
          manageBookings: { ...NO_ACTIONS },
          ...Object.fromEntries(
            Object.entries(dimensions).map(([name, actions]) => [
              name,
              { ...NO_ACTIONS, ...actions },
            ]),
          ),
        },
      ],
      instanceOwner: false,
    };
  }

  function asTenantOwner() {
    membership = { status: "active", owner: true };
  }

  function asActiveMember() {
    membership = { status: "active", owner: false };
  }

  function asInstanceOwner(userId) {
    instance = { ownerUserIds: [userId] };
  }

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
      grant({ manageMedia: { create: true } });
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

    it("refuses uploads from users without the media create right", async function () {
      grant({ manageMedia: { readAny: true } });
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

    it("lets the tenant owner upload without any media role", async function () {
      grant({});
      asTenantOwner();
      const res = createResponse();

      await MediaControllerV2.createMedia(
        createRequest({ user: MEMBER, files: { file: pngUpload() } }),
        res,
      );

      assert.strictEqual(res.statusCode, 201);
    });

    it("lets the instance owner upload without any media role", async function () {
      grant({});
      asInstanceOwner(MEMBER.id);
      const res = createResponse();

      await MediaControllerV2.createMedia(
        createRequest({ user: MEMBER, files: { file: pngUpload() } }),
        res,
      );

      assert.strictEqual(res.statusCode, 201);
    });

    it("refuses anonymous uploads", async function () {
      const req = createRequest({ files: { file: pngUpload() } });

      await assert.rejects(
        () => MediaControllerV2.createMedia(req, createResponse()),
        (error) => error.statusCode === 401,
      );
    });
  });

  describe("reading the metadata of a medium", function () {
    it("refuses anonymous callers even for a public medium", async function () {
      sandbox.stub(MediaManager, "getMedia").resolves(mediaFixture());

      await assert.rejects(
        () =>
          MediaControllerV2.getMedia(
            createRequest({ params: { id: "media-1" } }),
            createResponse(),
          ),
        (error) => error.statusCode === 401,
      );
    });

    it("refuses a signed-in user without any media right", async function () {
      sandbox.stub(MediaManager, "getMedia").resolves(mediaFixture());
      asActiveMember();

      await assert.rejects(
        () =>
          MediaControllerV2.getMedia(
            createRequest({ user: MEMBER, params: { id: "media-1" } }),
            createResponse(),
          ),
        (error) => error.statusCode === 403,
      );
    });

    it("serves any medium to a user with readAny", async function () {
      sandbox.stub(MediaManager, "getMedia").resolves(mediaFixture());
      grant({ manageMedia: { readAny: true } });
      const res = createResponse();

      await MediaControllerV2.getMedia(
        createRequest({ user: MEMBER, params: { id: "media-1" } }),
        res,
      );

      assert.strictEqual(res.statusCode, 200);
      assert.strictEqual(res.body.id, "media-1");
    });

    it("serves an uploader their own medium with readOwn", async function () {
      sandbox
        .stub(MediaManager, "getMedia")
        .resolves(mediaFixture({ uploadedBy: MEMBER.id }));
      grant({ manageMedia: { readOwn: true } });
      const res = createResponse();

      await MediaControllerV2.getMedia(
        createRequest({ user: MEMBER, params: { id: "media-1" } }),
        res,
      );

      assert.strictEqual(res.statusCode, 200);
    });

    it("refuses a foreign medium to a user with readOwn only", async function () {
      sandbox.stub(MediaManager, "getMedia").resolves(mediaFixture());
      grant({ manageMedia: { readOwn: true } });

      await assert.rejects(
        () =>
          MediaControllerV2.getMedia(
            createRequest({ user: MEMBER, params: { id: "media-1" } }),
            createResponse(),
          ),
        (error) => error.statusCode === 403,
      );
    });

    it("serves the tenant owner without any media role", async function () {
      sandbox.stub(MediaManager, "getMedia").resolves(mediaFixture());
      asTenantOwner();
      const res = createResponse();

      await MediaControllerV2.getMedia(
        createRequest({ user: MEMBER, params: { id: "media-1" } }),
        res,
      );

      assert.strictEqual(res.statusCode, 200);
    });

    it("serves the instance owner without any media role", async function () {
      sandbox.stub(MediaManager, "getMedia").resolves(mediaFixture());
      asInstanceOwner(MEMBER.id);
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
            createRequest({ user: OWNER, params: { id: "nope" } }),
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

    it("refuses anonymous callers", async function () {
      await assert.rejects(
        () => MediaControllerV2.getMediaList(createRequest(), createResponse()),
        (error) => error.statusCode === 401,
      );
      assert.strictEqual(MediaManager.getMediaList.called, false);
    });

    it("refuses a signed-in user without any media right", async function () {
      asActiveMember();

      await assert.rejects(
        () =>
          MediaControllerV2.getMediaList(
            createRequest({ user: MEMBER }),
            createResponse(),
          ),
        (error) => error.statusCode === 403,
      );
      assert.strictEqual(MediaManager.getMediaList.called, false);
    });

    it("shows a user with readAny the whole library", async function () {
      grant({ manageMedia: { readAny: true } });
      const res = createResponse();

      await MediaControllerV2.getMediaList(
        createRequest({ user: MEMBER }),
        res,
      );

      assert.strictEqual(
        MediaManager.getMediaList.firstCall.args[0].uploadedBy,
        undefined,
      );
      assert.strictEqual(res.body.total, 1);
      assert.strictEqual(res.body.items.length, 1);
    });

    it("narrows the library to their own uploads for readOwn", async function () {
      grant({ manageMedia: { readOwn: true } });

      await MediaControllerV2.getMediaList(
        createRequest({ user: MEMBER }),
        createResponse(),
      );

      assert.strictEqual(
        MediaManager.getMediaList.firstCall.args[0].uploadedBy,
        MEMBER.id,
      );
    });

    it("shows the tenant owner the whole library", async function () {
      asTenantOwner();

      await MediaControllerV2.getMediaList(
        createRequest({ user: MEMBER }),
        createResponse(),
      );

      assert.strictEqual(
        MediaManager.getMediaList.firstCall.args[0].uploadedBy,
        undefined,
      );
    });

    it("shows the instance owner the whole library", async function () {
      asInstanceOwner(MEMBER.id);

      await MediaControllerV2.getMediaList(
        createRequest({ user: MEMBER }),
        createResponse(),
      );

      assert.strictEqual(
        MediaManager.getMediaList.firstCall.args[0].uploadedBy,
        undefined,
      );
    });

    it("passes the kind, tag, free-text and visibility filters through", async function () {
      grant({ manageMedia: { readAny: true } });

      await MediaControllerV2.getMediaList(
        createRequest({
          user: MEMBER,
          query: {
            kind: "document",
            tag: "invoice",
            q: "2026",
            page: "2",
            visibility: "intern",
          },
        }),
        createResponse(),
      );

      const args = MediaManager.getMediaList.firstCall.args[0];
      assert.strictEqual(args.kind, "document");
      assert.strictEqual(args.tag, "invoice");
      assert.strictEqual(args.q, "2026");
      assert.strictEqual(args.page, "2");
      assert.deepStrictEqual(args.visibility, ["intern"]);
    });

    it("rejects an unknown kind filter", async function () {
      grant({ manageMedia: { readAny: true } });

      await assert.rejects(
        () =>
          MediaControllerV2.getMediaList(
            createRequest({ user: MEMBER, query: { kind: "video" } }),
            createResponse(),
          ),
        (error) => error.code === "invalid_kind",
      );
    });
  });

  describe("metadata update", function () {
    beforeEach(function () {
      sandbox.stub(MediaManager, "getMedia").resolves(mediaFixture());
      sandbox
        .stub(MediaManager, "storeMedia")
        .callsFake(async (media) => media);
    });

    it("changes title, alt text, tags and visibility", async function () {
      grant({ manageMedia: { updateAny: true } });
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
      grant({ manageMedia: { updateAny: true } });
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
      grant({ manageMedia: { updateAny: true } });

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

    it("lets an uploader change their own medium with updateOwn", async function () {
      MediaManager.getMedia.resolves(mediaFixture({ uploadedBy: MEMBER.id }));
      grant({ manageMedia: { updateOwn: true } });
      const res = createResponse();

      await MediaControllerV2.updateMedia(
        createRequest({
          user: MEMBER,
          params: { id: "media-1" },
          body: { title: "Mine" },
        }),
        res,
      );

      assert.strictEqual(res.statusCode, 200);
    });

    it("refuses a foreign medium to a user with updateOwn only", async function () {
      grant({ manageMedia: { updateOwn: true } });

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
      assert.strictEqual(MediaManager.storeMedia.called, false);
    });

    it("refuses updates from users without any media right", async function () {
      asActiveMember();

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

    it("refuses anonymous updates", async function () {
      await assert.rejects(
        () =>
          MediaControllerV2.updateMedia(
            createRequest({ params: { id: "media-1" }, body: { title: "x" } }),
            createResponse(),
          ),
        (error) => error.statusCode === 401,
      );
    });
  });

  describe("booking documents", function () {
    beforeEach(function () {
      const booking = {
        id: "booking-1",
        tenantId: TENANT,
        assignedUserId: CUSTOMER.id,
      };
      sandbox.stub(BookingManager, "getBooking").resolves(booking);
    });

    describe("the receipt rule", function () {
      beforeEach(stubDelivery);

      it("refuses anonymous callers", async function () {
        await assert.rejects(
          () => deliver(bookingDocumentFixture()),
          (error) => error.statusCode === 401,
        );
        assert.strictEqual(MediaService.getStream.called, false);
      });

      it("refuses a signed-in user who neither reads bookings nor owns this one", async function () {
        asActiveMember();
        grant({ manageMedia: { readAny: true, updateAny: true } });

        await assert.rejects(
          () => deliver(bookingDocumentFixture(), { user: MEMBER }),
          (error) => error.statusCode === 403,
        );
      });

      it("serves a user with manageBookings.readAny", async function () {
        grant({ manageBookings: { readAny: true } });

        const res = await deliver(bookingDocumentFixture(), { user: MEMBER });

        assert.strictEqual(deliveryStream.piped, res);
      });

      it("serves the owner of the booking without any role", async function () {
        const res = await deliver(bookingDocumentFixture(), {
          user: CUSTOMER,
        });

        assert.strictEqual(deliveryStream.piped, res);
      });

      it("serves the tenant owner", async function () {
        asTenantOwner();

        const res = await deliver(bookingDocumentFixture(), { user: MEMBER });

        assert.strictEqual(deliveryStream.piped, res);
      });

      it("serves the instance owner", async function () {
        asInstanceOwner(MEMBER.id);

        const res = await deliver(bookingDocumentFixture(), { user: MEMBER });

        assert.strictEqual(deliveryStream.piped, res);
      });

      it("ignores the visibility of a booking document", async function () {
        await assert.rejects(
          () => deliver(bookingDocumentFixture({ visibility: "public" })),
          (error) => error.statusCode === 401,
        );
      });

      it("guards the metadata with the same rule", async function () {
        sandbox
          .stub(MediaManager, "getMedia")
          .resolves(bookingDocumentFixture());
        grant({ manageMedia: { readAny: true } });

        await assert.rejects(
          () =>
            MediaControllerV2.getMedia(
              createRequest({ user: MEMBER, params: { id: "media-1" } }),
              createResponse(),
            ),
          (error) => error.statusCode === 403,
        );
      });
    });

    it("lets a user with booking update rights change the metadata", async function () {
      sandbox.stub(MediaManager, "getMedia").resolves(bookingDocumentFixture());
      sandbox
        .stub(MediaManager, "storeMedia")
        .callsFake(async (media) => media);
      grant({ manageBookings: { updateAny: true } });
      const res = createResponse();

      await MediaControllerV2.updateMedia(
        createRequest({
          user: MEMBER,
          params: { id: "media-1" },
          body: { title: "Invoice 2026-1" },
        }),
        res,
      );

      assert.strictEqual(res.statusCode, 200);
    });

    it("ignores a visibility sent for a booking document", async function () {
      sandbox.stub(MediaManager, "getMedia").resolves(bookingDocumentFixture());
      sandbox
        .stub(MediaManager, "storeMedia")
        .callsFake(async (media) => media);
      grant({ manageBookings: { updateAny: true } });
      const res = createResponse();

      await MediaControllerV2.updateMedia(
        createRequest({
          user: MEMBER,
          params: { id: "media-1" },
          body: { title: "Invoice", visibility: "public" },
        }),
        res,
      );

      assert.strictEqual(
        MediaManager.storeMedia.firstCall.args[0].visibility,
        "intern",
      );
      assert.strictEqual(res.body.visibility, "intern");
    });

    it("refuses metadata changes to a user with media rights only", async function () {
      sandbox.stub(MediaManager, "getMedia").resolves(bookingDocumentFixture());
      grant({ manageMedia: { updateAny: true } });

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

    it("cannot be deleted, not even by the tenant owner", async function () {
      sandbox.stub(MediaManager, "getMedia").resolves(bookingDocumentFixture());
      const removeMedia = sandbox.stub(MediaManager, "removeMedia");
      asTenantOwner();

      await assert.rejects(
        () =>
          MediaControllerV2.deleteMedia(
            createRequest({ user: MEMBER, params: { id: "media-1" } }),
            createResponse(),
          ),
        (error) =>
          error.statusCode === 403 &&
          error.code === "booking_document_not_deletable",
      );
      assert.strictEqual(removeMedia.called, false);
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
      await assert.rejects(
        () => deliver(mediaFixture({ visibility: "intern" })),
        (error) => error.statusCode === 401,
      );
      assert.strictEqual(MediaService.getStream.called, false);
    });

    it("refuses an internal medium to a user without membership in the tenant", async function () {
      await assert.rejects(
        () => deliver(mediaFixture({ visibility: "intern" }), { user: MEMBER }),
        (error) => error.statusCode === 403,
      );
    });

    it("refuses an internal medium to a member whose membership is not active", async function () {
      membership = { status: "pending", owner: false };

      await assert.rejects(
        () => deliver(mediaFixture({ visibility: "intern" }), { user: MEMBER }),
        (error) => error.statusCode === 403,
      );
    });

    it("streams an internal medium to an active member without any media role", async function () {
      asActiveMember();

      const res = await deliver(mediaFixture({ visibility: "intern" }), {
        user: MEMBER,
      });

      assert.strictEqual(deliveryStream.piped, res);
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
      asActiveMember();

      const res = await deliver(mediaFixture({ visibility: "intern" }), {
        user: MEMBER,
      });

      assert.strictEqual(res.headers["Cache-Control"], "private, no-cache");
      assert.strictEqual(res.headers["ETag"], '"abc"');
    });

    it("never stores a booking document", async function () {
      sandbox
        .stub(BookingManager, "getBooking")
        .resolves({ id: "booking-1", tenantId: TENANT });
      grant({ manageBookings: { readAny: true } });

      const res = await deliver(bookingDocumentFixture(), { user: MEMBER });

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
      sandbox.stub(MediaManager, "getMedia").resolves(mediaFixture());
    });

    it("removes the database document first and the bytes afterwards", async function () {
      grant({ manageMedia: { deleteAny: true } });
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
      grant({ manageMedia: { deleteAny: true } });
      sandbox.stub(MediaManager, "removeMedia").resolves(true);
      provider.deleteMany.rejects(new Error("storage down"));
      const res = createResponse();

      await MediaControllerV2.deleteMedia(
        createRequest({ user: OWNER, params: { id: "media-1" } }),
        res,
      );

      assert.strictEqual(res.statusCode, 204);
    });

    it("lets an uploader delete their own medium with deleteOwn", async function () {
      MediaManager.getMedia.resolves(mediaFixture({ uploadedBy: MEMBER.id }));
      grant({ manageMedia: { deleteOwn: true } });
      sandbox.stub(MediaManager, "removeMedia").resolves(true);
      const res = createResponse();

      await MediaControllerV2.deleteMedia(
        createRequest({ user: MEMBER, params: { id: "media-1" } }),
        res,
      );

      assert.strictEqual(res.statusCode, 204);
    });

    it("refuses a foreign medium to a user with deleteOwn only", async function () {
      grant({ manageMedia: { deleteOwn: true } });
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

    it("refuses deletion from users without any media right", async function () {
      asActiveMember();
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

  describe("usage proof", function () {
    const USAGE = [
      { type: "bookable", id: "bookable-1", title: "Meeting room 1" },
      { type: "instance", id: null, title: "instance" },
    ];

    beforeEach(function () {
      sandbox.stub(MediaManager, "getMedia").resolves(mediaFixture());
    });

    it("answers where a medium is used", async function () {
      grant({ manageMedia: { readAny: true } });
      usage = USAGE;
      const res = createResponse();

      await MediaControllerV2.getMediaUsage(
        createRequest({ user: MEMBER, params: { id: "media-1" } }),
        res,
      );

      assert.strictEqual(res.statusCode, 200);
      assert.deepStrictEqual(res.body, USAGE);
      assert.deepStrictEqual(MediaUsageService.findUsage.firstCall.args[0], {
        tenantId: TENANT,
        mediaId: "media-1",
      });
    });

    it("answers an empty list for an unused medium", async function () {
      grant({ manageMedia: { readAny: true } });
      const res = createResponse();

      await MediaControllerV2.getMediaUsage(
        createRequest({ user: MEMBER, params: { id: "media-1" } }),
        res,
      );

      assert.deepStrictEqual(res.body, []);
    });

    it("needs the same right as reading the metadata", async function () {
      asActiveMember();

      await assert.rejects(
        () =>
          MediaControllerV2.getMediaUsage(
            createRequest({ user: MEMBER, params: { id: "media-1" } }),
            createResponse(),
          ),
        (error) => error.statusCode === 403,
      );
    });

    it("blocks the deletion of a medium in use with the same body", async function () {
      grant({ manageMedia: { readAny: true, deleteAny: true } });
      usage = USAGE;
      const removeMedia = sandbox.stub(MediaManager, "removeMedia");

      const usageResponse = createResponse();
      await MediaControllerV2.getMediaUsage(
        createRequest({ user: OWNER, params: { id: "media-1" } }),
        usageResponse,
      );

      let conflict;
      await assert.rejects(
        () =>
          MediaControllerV2.deleteMedia(
            createRequest({ user: OWNER, params: { id: "media-1" } }),
            createResponse(),
          ),
        (error) => {
          conflict = error;
          return error.statusCode === 409;
        },
      );

      assert.strictEqual(
        JSON.stringify(conflict.toJSON()),
        JSON.stringify(usageResponse.body),
      );
      assert.strictEqual(removeMedia.called, false);
      assert.strictEqual(provider.deleteMany.called, false);
    });
  });
});
