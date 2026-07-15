const assert = require("assert");
const sinon = require("sinon");
const {
  TenantController,
} = require("../src/platform/api/controllers/tenant-controller");
const TenantManager = require("../src/commons/data-managers/tenant-manager");
const PermissionService = require("../src/commons/services/permission-service");

function response(sandbox) {
  return {
    status: sandbox.stub().returnsThis(),
    send: sandbox.stub().returnsThis(),
    sendStatus: sandbox.stub().returnsThis(),
  };
}

describe("TenantController cancellation refund tiers", function () {
  let sandbox;

  beforeEach(function () {
    sandbox = sinon.createSandbox();
    sandbox.stub(PermissionService, "_isTenantOwner").resolves(true);
  });

  afterEach(function () {
    sandbox.restore();
  });

  it("updates valid cancellation refund tiers", async function () {
    const tenant = { id: "tenant-1", name: "Tenant" };
    const tiers = [
      { daysBeforeStart: 0, refundPercentage: 50 },
      { daysBeforeStart: 20, refundPercentage: 100 },
    ];
    sandbox.stub(TenantManager, "getTenant").resolves(tenant);
    const storeTenant = sandbox
      .stub(TenantManager, "storeTenant")
      .callsFake(async (value) => value);
    const res = response(sandbox);

    await TenantController.updateTenant(
      {
        user: { id: "admin-1" },
        body: { id: "tenant-1", cancellationRefundTiers: tiers },
      },
      res,
    );

    assert.strictEqual(storeTenant.calledOnce, true);
    assert.deepStrictEqual(tenant.cancellationRefundTiers, tiers);
    assert.strictEqual(res.status.calledWith(200), true);
  });

  it("returns 400 for invalid cancellation refund tiers", async function () {
    sandbox.stub(TenantManager, "getTenant").resolves({
      id: "tenant-1",
      name: "Tenant",
    });
    const storeTenant = sandbox.stub(TenantManager, "storeTenant");
    const res = response(sandbox);

    await TenantController.updateTenant(
      {
        user: { id: "admin-1" },
        body: {
          id: "tenant-1",
          cancellationRefundTiers: [
            { daysBeforeStart: 0, refundPercentage: 101 },
          ],
        },
      },
      res,
    );

    assert.strictEqual(res.status.calledWith(400), true);
    assert.strictEqual(storeTenant.called, false);
  });
});
