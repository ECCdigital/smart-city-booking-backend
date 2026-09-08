const assert = require("assert");
const sinon = require("sinon");
const DashboardControllerV2 = require("../src/platform/api/v2/controllers/dashboard.controller");
const DashboardService = require("../src/commons/services/dashboard/dashboard-service");
const {
  BadRequestError,
  ForbiddenError,
  NotFoundError,
} = require("../src/errors/BaseError");

function response(sandbox) {
  return {
    status: sandbox.stub().returnsThis(),
    json: sandbox.stub().returnsThis(),
  };
}

describe("DashboardControllerV2", function () {
  let sandbox;

  beforeEach(function () {
    sandbox = sinon.createSandbox();
  });

  afterEach(function () {
    sandbox.restore();
  });

  it("returns instance summary payload", async function () {
    const payload = { totals: { tenants: 1 }, byTenant: [] };
    sandbox.stub(DashboardService, "getInstanceSummary").resolves(payload);
    const res = response(sandbox);

    await DashboardControllerV2.getInstanceSummary(
      { user: { id: "u1" }, query: {} },
      res,
    );

    assert.strictEqual(res.status.calledWith(200), true);
    assert.deepStrictEqual(res.json.firstCall.args[0], {
      success: true,
      data: payload,
    });
  });

  it("maps forbidden errors for tenant summary", async function () {
    sandbox
      .stub(DashboardService, "getTenantSummary")
      .rejects(new ForbiddenError("Permission denied"));
    const res = response(sandbox);

    await DashboardControllerV2.getTenantSummary(
      { user: { id: "u1" }, params: { tenant: "demo" }, query: {} },
      res,
    );

    assert.strictEqual(res.status.calledWith(403), true);
    assert.strictEqual(res.json.firstCall.args[0].success, false);
  });

  it("maps bad request and not found", async function () {
    const badRes = response(sandbox);
    sandbox
      .stub(DashboardService, "getTenantSummary")
      .onFirstCall()
      .rejects(new BadRequestError("Invalid status filter"))
      .onSecondCall()
      .rejects(new NotFoundError("Tenant not found"));

    await DashboardControllerV2.getTenantSummary(
      { user: { id: "u1" }, params: { tenant: "demo" }, query: {} },
      badRes,
    );
    assert.strictEqual(badRes.status.calledWith(400), true);

    const missingRes = response(sandbox);
    await DashboardControllerV2.getTenantSummary(
      { user: { id: "u1" }, params: { tenant: "missing" }, query: {} },
      missingRes,
    );
    assert.strictEqual(missingRes.status.calledWith(404), true);
  });
});
