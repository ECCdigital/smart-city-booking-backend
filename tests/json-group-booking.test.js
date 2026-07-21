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

function createMockResponse() {
  const res = {
    statusCode: null,
    body: null,
    headers: {},
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
    setHeader(key, value) {
      this.headers[key] = value;
      return this;
    },
  };
  return res;
}

function createBookable(overrides = {}) {
  return new Bookable({
    id: "bookable-1",
    tenantId: "tenant-1",
    title: "Test Bookable",
    type: "resource",
    isPublic: true,
    isBookable: true,
    groupBooking: { enabled: false, permittedRoles: [] },
    ...overrides,
  });
}

describe("json-controller groupBookingAllowed", () => {
  let getBookableStub;
  let getInstanceStub;
  let externalPriceStub;
  let getMembershipStub;
  let getTenantStub;

  beforeEach(() => {
    getTenantStub = sinon.stub(TenantManager, "getTenant").resolves({
      id: "tenant-1",
      catalogParticipation: { restricted: false },
    });
    getInstanceStub = sinon.stub(InstanceManager, "getInstance").resolves(null);
    externalPriceStub = sinon
      .stub(ExternalPriceService, "resolve")
      .resolves(null);
    getMembershipStub = sinon.stub(
      MembershipManager,
      "getMembershipByTenantAndUserID",
    );
  });

  afterEach(() => {
    sinon.restore();
  });

  describe("getBookable", () => {
    it("sets groupBookingAllowed to true when enabled without role restrictions", async () => {
      const bookable = createBookable({
        groupBooking: { enabled: true, permittedRoles: [] },
      });
      getBookableStub = sinon
        .stub(BookableManager, "getBookable")
        .resolves(bookable);

      const req = {
        params: { tenant: "tenant-1", id: "bookable-1" },
        user: null,
      };
      const res = createMockResponse();

      await JSONController.getBookable(req, res);

      assert.strictEqual(res.statusCode, 200);
      assert.strictEqual(res.body.groupBookingAllowed, true);
      assert.ok(getBookableStub.calledOnce);
      assert.ok(getTenantStub.calledOnce);
    });

    it("sets groupBookingAllowed to false when roles are required but user is not logged in", async () => {
      const bookable = createBookable({
        groupBooking: { enabled: true, permittedRoles: ["staff"] },
      });
      getBookableStub = sinon
        .stub(BookableManager, "getBookable")
        .resolves(bookable);

      const req = {
        params: { tenant: "tenant-1", id: "bookable-1" },
        user: null,
      };
      const res = createMockResponse();

      await JSONController.getBookable(req, res);

      assert.strictEqual(res.statusCode, 200);
      assert.strictEqual(res.body.groupBookingAllowed, false);
    });

    it("sets groupBookingAllowed to true when user has a permitted role", async () => {
      const bookable = createBookable({
        groupBooking: { enabled: true, permittedRoles: ["staff"] },
      });
      getBookableStub = sinon
        .stub(BookableManager, "getBookable")
        .resolves(bookable);
      getMembershipStub.resolves({ roles: ["staff"] });

      const req = {
        params: { tenant: "tenant-1", id: "bookable-1" },
        user: { id: "user-1" },
      };
      const res = createMockResponse();

      await JSONController.getBookable(req, res);

      assert.strictEqual(res.statusCode, 200);
      assert.strictEqual(res.body.groupBookingAllowed, true);
      assert.ok(getMembershipStub.calledOnce);
    });

    it("sets groupBookingAllowed to false when group booking is disabled", async () => {
      const bookable = createBookable({
        groupBooking: { enabled: false, permittedRoles: [] },
      });
      getBookableStub = sinon
        .stub(BookableManager, "getBookable")
        .resolves(bookable);

      const req = {
        params: { tenant: "tenant-1", id: "bookable-1" },
        user: { id: "user-1" },
      };
      const res = createMockResponse();

      await JSONController.getBookable(req, res);

      assert.strictEqual(res.statusCode, 200);
      assert.strictEqual(res.body.groupBookingAllowed, false);
    });

    it("attaches tenant cancellationRefundTiers to the bookable response", async () => {
      const tiers = [
        { daysBeforeStart: 20, refundPercentage: 100 },
        { daysBeforeStart: 0, refundPercentage: 50 },
      ];
      getTenantStub.resolves({
        id: "tenant-1",
        catalogParticipation: { restricted: false },
        cancellationRefundTiers: tiers,
      });
      const bookable = createBookable();
      getBookableStub = sinon
        .stub(BookableManager, "getBookable")
        .resolves(bookable);
      sinon.stub(BookableManager, "getBookablesByIds").resolves([]);

      const req = {
        params: { tenant: "tenant-1", id: "bookable-1" },
        user: null,
      };
      const res = createMockResponse();

      await JSONController.getBookable(req, res);

      assert.strictEqual(res.statusCode, 200);
      assert.deepStrictEqual(res.body.cancellationRefundTiers, tiers);
      assert.ok(getTenantStub.calledOnce);
    });

    it("attaches an empty cancellationRefundTiers array when tenant has none", async () => {
      const bookable = createBookable();
      getBookableStub = sinon
        .stub(BookableManager, "getBookable")
        .resolves(bookable);
      sinon.stub(BookableManager, "getBookablesByIds").resolves([]);

      const req = {
        params: { tenant: "tenant-1", id: "bookable-1" },
        user: null,
      };
      const res = createMockResponse();

      await JSONController.getBookable(req, res);

      assert.strictEqual(res.statusCode, 200);
      assert.deepStrictEqual(res.body.cancellationRefundTiers, []);
    });

    it("attaches cancellationRefundTiers to related bookables", async () => {
      const tiers = [{ daysBeforeStart: 0, refundPercentage: 80 }];
      getTenantStub.resolves({
        id: "tenant-1",
        catalogParticipation: { restricted: false },
        cancellationRefundTiers: tiers,
      });
      const related = createBookable({
        id: "bookable-2",
        title: "Related",
      });
      const bookable = createBookable({
        relatedBookableIds: ["bookable-2"],
      });
      getBookableStub = sinon
        .stub(BookableManager, "getBookable")
        .resolves(bookable);
      sinon.stub(BookableManager, "getBookablesByIds").resolves([related]);

      const req = {
        params: { tenant: "tenant-1", id: "bookable-1" },
        user: null,
      };
      const res = createMockResponse();

      await JSONController.getBookable(req, res);

      assert.strictEqual(res.statusCode, 200);
      assert.deepStrictEqual(res.body.cancellationRefundTiers, tiers);
      assert.strictEqual(res.body.relatedBookables.length, 1);
      assert.deepStrictEqual(
        res.body.relatedBookables[0].cancellationRefundTiers,
        tiers,
      );
    });
  });

  describe("getBookables", () => {
    it("attaches tenant cancellationRefundTiers to each listed bookable", async () => {
      const tiers = [
        { daysBeforeStart: 14, refundPercentage: 100 },
        { daysBeforeStart: 0, refundPercentage: 0 },
      ];
      getTenantStub.resolves({
        id: "tenant-1",
        catalogParticipation: { restricted: false },
        cancellationRefundTiers: tiers,
      });
      sinon
        .stub(BookableManager, "getBookables")
        .resolves([
          createBookable({ id: "bookable-1" }),
          createBookable({ id: "bookable-2", title: "Second" }),
        ]);
      sinon.stub(BookableManager, "getBookablesByIds").resolves([]);

      const req = {
        params: { tenant: "tenant-1" },
        query: {},
        user: null,
      };
      const res = createMockResponse();

      await JSONController.getBookables(req, res);

      assert.strictEqual(res.statusCode, 200);
      assert.ok(Array.isArray(res.body));
      assert.strictEqual(res.body.length, 2);
      for (const pub of res.body) {
        assert.deepStrictEqual(pub.cancellationRefundTiers, tiers);
      }
      assert.ok(getTenantStub.calledOnce);
    });
  });
});
