const assert = require("assert");
const sinon = require("sinon");
const JSONController = require("../src/platform/json-engine/controllers/json-controller");
const {
  BookableManager,
} = require("../src/commons/data-managers/bookable-manager");
const MembershipManager = require("../src/commons/data-managers/membership-manager");
const InstanceManager = require("../src/commons/data-managers/instance-manager");
const ExternalPriceService = require("../src/commons/services/external-price-service");
const TenantManager = require("../src/commons/data-managers/tenant-manager");
const { Bookable } = require("../src/commons/entities/bookable/bookable");
const { REACH } = require("../src/commons/services/authorization/policy");

function createMockResponse() {
  return {
    statusCode: null,
    body: null,
    status(code) {
      this.statusCode = code;
      return this;
    },
    json(payload) {
      this.body = payload;
      return this;
    },
    send(payload) {
      this.body = payload;
      return this;
    },
    setHeader() {
      return this;
    },
  };
}

function createBookable(overrides = {}) {
  return new Bookable({
    id: "bookable-1",
    tenantId: "tenant-1",
    title: "Test Bookable",
    type: "resource",
    isPublic: true,
    isBookable: true,
    relatedBookableIds: ["listed", "unlisted"],
    ...overrides,
  });
}

// ECCdigital/tickets#556: related bookables follow the listed rule, so an
// offer without `isPublic` is left out - for the public and for staff.
describe("json-controller relatedBookables", () => {
  const listed = createBookable({ id: "listed", relatedBookableIds: [] });
  const unlisted = createBookable({
    id: "unlisted",
    isPublic: false,
    relatedBookableIds: [],
  });

  const requests = {
    public: { reach: REACH.PUBLIC, user: null },
    staff: { reach: REACH.ANY, user: { id: "staff-1" } },
  };

  beforeEach(() => {
    sinon.stub(TenantManager, "getTenant").resolves({
      id: "tenant-1",
      catalogParticipation: { restricted: false },
    });
    sinon.stub(InstanceManager, "getInstance").resolves(null);
    sinon.stub(ExternalPriceService, "resolve").resolves(null);
    sinon
      .stub(MembershipManager, "getMembershipByTenantAndUserID")
      .resolves({ roles: ["staff"] });
    sinon
      .stub(BookableManager, "getBookablesByIds")
      .resolves([listed, unlisted]);
  });

  afterEach(() => {
    sinon.restore();
  });

  for (const [who, request] of Object.entries(requests)) {
    it(`leaves an unlisted related bookable out of the detail (${who})`, async () => {
      sinon.stub(BookableManager, "getBookable").resolves(createBookable());
      const res = createMockResponse();

      await JSONController.getBookable(
        { ...request, params: { tenant: "tenant-1", id: "bookable-1" } },
        res,
      );

      assert.strictEqual(res.statusCode, 200);
      assert.deepStrictEqual(
        res.body.relatedBookables.map((b) => b.id),
        ["listed"],
      );
    });

    it(`leaves an unlisted related bookable out of the list (${who})`, async () => {
      sinon.stub(BookableManager, "getBookables").resolves([createBookable()]);
      const res = createMockResponse();

      await JSONController.getBookables(
        { ...request, params: { tenant: "tenant-1" }, query: {} },
        res,
      );

      assert.strictEqual(res.statusCode, 200);
      assert.deepStrictEqual(
        res.body[0].relatedBookables.map((b) => b.id),
        ["listed"],
      );
    });
  }
});
