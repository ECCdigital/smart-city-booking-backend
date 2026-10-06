const assert = require("assert");
const sinon = require("sinon");
const BookableController = require("../src/platform/api/controllers/bookable-controller");
const {
  BookableManager,
} = require("../src/commons/data-managers/bookable-manager");
const { Bookable } = require("../src/commons/entities/bookable/bookable");
const TenantManager = require("../src/commons/data-managers/tenant-manager");

function createMockResponse() {
  return {
    statusCode: null,
    body: null,
    status(code) {
      this.statusCode = code;
      return this;
    },
    send(payload) {
      this.body = payload;
      return this;
    },
  };
}

function mediaBookable() {
  return new Bookable({
    id: "bookable-1",
    tenantId: "tenant-1",
    title: "Week",
    // The public list shows what asks to be listed (supervision spec §5.1).
    isPublic: true,
    imgUrl: "",
    images: [
      { source: "media", mediaId: "media-1", url: null },
      { source: "external", mediaId: null, url: "https://example.org/a.png" },
    ],
    attachments: [
      {
        id: "attachment-1",
        title: "House rules",
        type: "agreement",
        reference: { source: "media", mediaId: "media-2", url: null },
      },
    ],
  });
}

const BACKEND_URL = "https://booking.example.org";

describe("BookableController public routes resolve media references", () => {
  let backendUrl;

  before(() => {
    backendUrl = process.env.BACKEND_URL;
    process.env.BACKEND_URL = `${BACKEND_URL}/`;
  });

  after(() => {
    process.env.BACKEND_URL = backendUrl;
  });

  afterEach(() => {
    sinon.restore();
  });

  it("getPublicBookable serves absolute imgUrl and image urls for media references", async () => {
    sinon.stub(BookableManager, "getBookable").resolves(mediaBookable());

    const response = createMockResponse();
    await BookableController.getPublicBookable(
      { params: { tenant: "tenant-1", id: "bookable-1" }, query: {} },
      response,
    );

    assert.strictEqual(response.statusCode, 200);
    assert.strictEqual(
      response.body.imgUrl,
      `${BACKEND_URL}/api/v2/tenant-1/media/media-1/file`,
    );
    assert.strictEqual(
      response.body.images[0].url,
      `${BACKEND_URL}/api/v2/tenant-1/media/media-1/file`,
    );
    assert.strictEqual(
      response.body.images[1].url,
      "https://example.org/a.png",
    );
    assert.strictEqual(
      response.body.attachments[0].url,
      `${BACKEND_URL}/api/v2/tenant-1/media/media-2/file`,
    );
    assert.strictEqual(
      response.body.attachments[0].reference.url,
      `${BACKEND_URL}/api/v2/tenant-1/media/media-2/file`,
    );
    // The raw stored fields stay untouched for other consumers.
    assert.strictEqual(response.body.title, "Week");
  });

  it("getPublicBookables serves resolved urls for every bookable", async () => {
    sinon.stub(BookableManager, "getBookables").resolves([mediaBookable()]);
    sinon
      .stub(TenantManager, "getTenant")
      .resolves({ id: "tenant-1", supervisionLevel: "free" });

    const response = createMockResponse();
    await BookableController.getPublicBookables(
      { params: { tenant: "tenant-1" }, query: {} },
      response,
    );

    assert.strictEqual(response.statusCode, 200);
    assert.strictEqual(
      response.body[0].imgUrl,
      `${BACKEND_URL}/api/v2/tenant-1/media/media-1/file`,
    );
    assert.strictEqual(
      response.body[0].images[0].url,
      `${BACKEND_URL}/api/v2/tenant-1/media/media-1/file`,
    );
  });
});
