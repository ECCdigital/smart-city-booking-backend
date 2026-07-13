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

      const req = { params: { tenant: "tenant-1", id: "bookable-1" }, user: null };
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

      const req = { params: { tenant: "tenant-1", id: "bookable-1" }, user: null };
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
  });
});
