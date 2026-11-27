const assert = require("assert");
const sinon = require("sinon");
const BookableController = require("../src/platform/api/controllers/bookable-controller");
const {
  BookableManager,
} = require("../src/commons/data-managers/bookable-manager");
const { Bookable } = require("../src/commons/entities/bookable/bookable");
const TenantManager = require("../src/commons/data-managers/tenant-manager");

// The checkout reads its bookable from `GET /bookables/public/:id` and shows
// the tenant's refund scale from it, as the detail page does from the JSON
// interface (ECCdigital/tickets#1179).

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

const TIERS = [
  { hoursBeforeStart: 168, refundPercentage: 100 },
  { hoursBeforeStart: 0, refundPercentage: 0 },
];

async function getPublicBookable() {
  const response = createMockResponse();
  await BookableController.getPublicBookable(
    {
      params: { tenant: "tenant-1", id: "bookable-1" },
      query: {},
      reach: "public",
    },
    response,
  );
  return response;
}

describe("BookableController.getPublicBookable carries the tenant's refund scale", () => {
  beforeEach(() => {
    sinon.stub(BookableManager, "getBookable").resolves(
      new Bookable({
        id: "bookable-1",
        tenantId: "tenant-1",
        title: "Seminarraum",
        isPublic: true,
      }),
    );
  });

  afterEach(() => {
    sinon.restore();
  });

  it("sends the tenant's cancellationRefundTiers with the bookable", async () => {
    const getTenant = sinon
      .stub(TenantManager, "getTenant")
      .resolves({ id: "tenant-1", cancellationRefundTiers: TIERS });

    const response = await getPublicBookable();

    assert.strictEqual(response.statusCode, 200);
    assert.deepStrictEqual(response.body.cancellationRefundTiers, TIERS);
    assert.strictEqual(response.body.title, "Seminarraum");
    // The tenant is read within the request's reach.
    assert.deepStrictEqual(getTenant.firstCall.args, [
      "tenant-1",
      { reach: "public", userId: null },
    ]);
  });

  it("sends an empty scale for a tenant without tiers", async () => {
    sinon.stub(TenantManager, "getTenant").resolves({ id: "tenant-1" });

    const response = await getPublicBookable();

    assert.strictEqual(response.statusCode, 200);
    assert.deepStrictEqual(response.body.cancellationRefundTiers, []);
  });
});
