const assert = require("assert");
const sinon = require("sinon");

const FileController = require("../src/platform/api/controllers/file-controller");
const MediaManager = require("../src/commons/data-managers/media-manager");
const MediaService = require("../src/commons/services/media/media-service");
const MembershipManager = require("../src/commons/data-managers/membership-manager");
const {
  NextcloudManager,
} = require("../src/commons/data-managers/file-manager");
const { Media } = require("../src/commons/entities/media/media");
const {
  resetImportStatus,
} = require("../src/commons/services/media/media-import-status");

const TENANT = "tenant1";
const LEGACY_PATH = "/public/logos/logo.png";
const PROTECTED_PATH = "/protected/secret.png";

function createResponse() {
  return {
    statusCode: null,
    body: undefined,
    headers: {},
    ended: false,
    writableEnded: false,
    headersSent: false,
    piped: null,
    status(code) {
      this.statusCode = code;
      return this;
    },
    send(payload) {
      this.body = payload;
      this.ended = true;
      return this;
    },
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
      this.ended = true;
    },
  };
}

/**
 * The resolver runs behind `public("media", "file")` (tenant) and
 * `public("instanceMedia", "file")` (instance), so a request carries the
 * reach the marker decided: `public` for the anonymous, `own` for a
 * signed-in user without a media role.
 */
function createRequest({
  user = null,
  name = LEGACY_PATH,
  params = {},
  reach = user ? "own" : "public",
} = {}) {
  return {
    user,
    params,
    query: { name },
    headers: {},
    reach,
    principal: {
      userId: user?.id ?? null,
      isInstanceOwner: false,
      isTenantOwner: false,
      grants: {},
    },
    on() {},
  };
}

function createStream() {
  return {
    piped: null,
    on() {
      return this;
    },
    pipe(destination) {
      this.piped = destination;
      return destination;
    },
    destroy() {},
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
    originalFileName: "logo.png",
    title: "logo.png",
    visibility: "public",
    legacyPath: LEGACY_PATH,
    storage: {
      provider: "nextcloud",
      key: `${TENANT}/media/media-1/original.png`,
    },
    ...overrides,
  });
}

describe("legacy file resolver", () => {
  let sandbox;
  let stream;

  beforeEach(() => {
    sandbox = sinon.createSandbox();
    stream = createStream();

    // Nothing imported yet: the resolver may still fall back to the old tree.
    resetImportStatus();
    sandbox.stub(MediaManager, "countImportedMedia").resolves(0);
    sandbox.stub(MediaManager, "getMediaByLegacyPath").resolves(null);
    sandbox.stub(MediaService, "getStream").resolves(stream);
    sandbox
      .stub(MembershipManager, "getMembershipByTenantAndUserID")
      .resolves(null);
    sandbox
      .stub(NextcloudManager, "statFile")
      .resolves({ etag: "etag-1", lastmod: "Mon, 01 Jan 2024 00:00:00 GMT" });
    sandbox.stub(NextcloudManager, "createReadStream").resolves(stream);
  });

  afterEach(() => {
    sandbox.restore();
    resetImportStatus();
  });

  describe("with an imported medium", () => {
    it("serves a public medium anonymously, with the media cache policy", async () => {
      MediaManager.getMediaByLegacyPath
        .withArgs(TENANT, LEGACY_PATH)
        .resolves(mediaFixture());

      const response = createResponse();
      await FileController.getTenantFile(
        createRequest({ params: { tenant: TENANT } }),
        response,
        () => assert.fail("no error expected"),
      );

      assert.strictEqual(stream.piped, response);
      assert.strictEqual(
        response.headers["Cache-Control"],
        "public, max-age=31536000, immutable",
      );
      assert.strictEqual(response.headers["Content-Type"], "image/png");
      assert.strictEqual(NextcloudManager.createReadStream.callCount, 0);
    });

    it("refuses an internal medium without a session", async () => {
      MediaManager.getMediaByLegacyPath
        .withArgs(TENANT, LEGACY_PATH)
        .resolves(mediaFixture({ visibility: "intern" }));

      let caught;
      await FileController.getTenantFile(
        createRequest({ params: { tenant: TENANT } }),
        createResponse(),
        (error) => {
          caught = error;
        },
      );

      assert.strictEqual(caught?.statusCode, 401);
      assert.strictEqual(stream.piped, null);
    });

    it("refuses an internal medium for a user outside the tenant", async () => {
      MediaManager.getMediaByLegacyPath
        .withArgs(TENANT, LEGACY_PATH)
        .resolves(mediaFixture({ visibility: "intern" }));

      let caught;
      await FileController.getTenantFile(
        createRequest({ user: { id: "user-1" }, params: { tenant: TENANT } }),
        createResponse(),
        (error) => {
          caught = error;
        },
      );

      assert.strictEqual(caught?.statusCode, 403);
    });

    it("serves an internal medium to an active member", async () => {
      MediaManager.getMediaByLegacyPath
        .withArgs(TENANT, LEGACY_PATH)
        .resolves(mediaFixture({ visibility: "intern" }));
      MembershipManager.getMembershipByTenantAndUserID.resolves({
        status: "active",
      });

      const response = createResponse();
      await FileController.getTenantFile(
        createRequest({ user: { id: "user-1" }, params: { tenant: TENANT } }),
        response,
        () => assert.fail("no error expected"),
      );

      assert.strictEqual(stream.piped, response);
      assert.strictEqual(
        response.headers["Cache-Control"],
        "private, no-cache",
      );
    });

    it("resolves a tenant-less address as an instance medium", async () => {
      MediaManager.getMediaByLegacyPath
        .withArgs(null, LEGACY_PATH)
        .resolves(mediaFixture({ tenantId: null }));

      const response = createResponse();
      await FileController.getFile(createRequest(), response, () =>
        assert.fail("no error expected"),
      );

      assert.strictEqual(stream.piped, response);
    });
  });

  describe("without an imported medium", () => {
    it("falls back to serving the legacy tree directly", async () => {
      const response = createResponse();
      await FileController.getTenantFile(
        createRequest({ params: { tenant: TENANT } }),
        response,
        () => assert.fail("no error expected"),
      );

      assert.strictEqual(NextcloudManager.createReadStream.callCount, 1);
      assert.deepStrictEqual(NextcloudManager.createReadStream.firstCall.args, [
        { tenantID: TENANT, filename: LEGACY_PATH },
      ]);
      assert.strictEqual(stream.piped, response);
    });

    it("refuses a protected legacy file to a user outside the tenant", async () => {
      let caught;
      await FileController.getTenantFile(
        createRequest({
          user: { id: "user-1" },
          name: PROTECTED_PATH,
          params: { tenant: TENANT },
        }),
        createResponse(),
        (error) => {
          caught = error;
        },
      );

      assert.strictEqual(caught?.statusCode, 403);
      assert.strictEqual(NextcloudManager.createReadStream.callCount, 0);
    });

    it("serves a protected legacy file to an active member", async () => {
      MembershipManager.getMembershipByTenantAndUserID.resolves({
        status: "active",
      });

      const response = createResponse();
      await FileController.getTenantFile(
        createRequest({
          user: { id: "user-1" },
          name: PROTECTED_PATH,
          params: { tenant: TENANT },
        }),
        response,
        () => assert.fail("no error expected"),
      );

      assert.strictEqual(stream.piped, response);
      assert.strictEqual(
        response.headers["Cache-Control"],
        "private, no-cache",
      );
    });

    it("lets any signed-in user read a tenant-less protected file", async () => {
      const response = createResponse();
      await FileController.getFile(
        createRequest({ user: { id: "user-1" }, name: PROTECTED_PATH }),
        response,
        () => assert.fail("no error expected"),
      );

      assert.strictEqual(stream.piped, response);
      assert.deepStrictEqual(NextcloudManager.createReadStream.firstCall.args, [
        { tenantID: undefined, filename: PROTECTED_PATH },
      ]);
    });

    it("answers 404 once the installation is migrated", async () => {
      MediaManager.countImportedMedia.resolves(7);

      let caught;
      await FileController.getTenantFile(
        createRequest({ params: { tenant: TENANT } }),
        createResponse(),
        (error) => {
          caught = error;
        },
      );

      assert.strictEqual(caught?.statusCode, 404);
      assert.strictEqual(NextcloudManager.createReadStream.callCount, 0);
    });

    it("rejects a request without a file name", async () => {
      let caught;
      await FileController.getTenantFile(
        createRequest({ name: "", params: { tenant: TENANT } }),
        createResponse(),
        (error) => {
          caught = error;
        },
      );

      assert.strictEqual(caught?.statusCode, 400);
    });
  });
});
