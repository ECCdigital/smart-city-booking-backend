const assert = require("assert");
const sinon = require("sinon");
const BookableController = require("../src/platform/api/controllers/bookable-controller");
const {
  BookableManager,
} = require("../src/commons/data-managers/bookable-manager");
const { Bookable } = require("../src/commons/entities/bookable/bookable");

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

describe("BookableController public routes resolve media references", () => {
  afterEach(() => {
    sinon.restore();
  });

  it("getPublicBookable serves imgUrl and image urls for media references", async () => {
    sinon.stub(BookableManager, "getBookable").resolves(mediaBookable());

    const response = createMockResponse();
    await BookableController.getPublicBookable(
      { params: { tenant: "tenant-1", id: "bookable-1" }, query: {} },
      response,
    );

    assert.strictEqual(response.statusCode, 200);
    assert.strictEqual(
      response.body.imgUrl,
      "/api/v2/tenant-1/media/media-1/file",
    );
    assert.strictEqual(
      response.body.images[0].url,
      "/api/v2/tenant-1/media/media-1/file",
    );
    assert.strictEqual(
      response.body.images[1].url,
      "https://example.org/a.png",
    );
    assert.strictEqual(
      response.body.attachments[0].url,
      "/api/v2/tenant-1/media/media-2/file",
    );
    // The raw stored fields stay untouched for other consumers.
    assert.strictEqual(response.body.title, "Week");
  });

  it("getPublicBookables serves resolved urls for every bookable", async () => {
    sinon.stub(BookableManager, "getBookables").resolves([mediaBookable()]);

    const response = createMockResponse();
    await BookableController.getPublicBookables(
      { params: { tenant: "tenant-1" }, query: {} },
      response,
    );

    assert.strictEqual(response.statusCode, 200);
    assert.strictEqual(
      response.body[0].imgUrl,
      "/api/v2/tenant-1/media/media-1/file",
    );
    assert.strictEqual(
      response.body[0].images[0].url,
      "/api/v2/tenant-1/media/media-1/file",
    );
  });
});
