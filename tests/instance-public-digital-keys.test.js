/**
 * Whether the instance uses digital keys (ECCdigital/tickets#459): the
 * public instance says yes as soon as one tenant the public sees has an
 * active access application, and says yes or no only.
 */

const { expect } = require("chai");
const sinon = require("sinon");

const InstanceController = require("../src/platform/api/controllers/instance-controller");
const InstanceManager = require("../src/commons/data-managers/instance-manager");
const TenantManager = require("../src/commons/data-managers/tenant-manager");
const TenantModel = require("../src/commons/data-managers/models/tenantModel");
const Instance = require("../src/commons/entities/instance/instance");
const {
  publicTenantCondition,
} = require("../src/commons/services/supervision/public-projection");
const { PUBLIC } = require("../src/commons/services/authorization");

function fakeResponse() {
  const res = {};
  res.status = sinon.stub().returns(res);
  res.send = sinon.stub().returns(res);
  return res;
}

describe("the public instance on digital keys", function () {
  afterEach(function () {
    sinon.restore();
  });

  for (const uses of [true, false]) {
    it(`answers usesDigitalKeys ${uses} as the public tenants decide`, async function () {
      sinon
        .stub(InstanceManager, "getInstance")
        .resolves(new Instance({ id: "instance", ownerUserIds: ["admin"] }));
      const asked = sinon
        .stub(TenantManager, "hasTenantWithDigitalKeys")
        .resolves(uses);
      const res = fakeResponse();

      await InstanceController.getPublicInstance({}, res);

      expect(res.status.firstCall.args[0]).to.equal(200);
      const body = res.send.firstCall.args[0];
      expect(body.usesDigitalKeys).to.equal(uses);
      expect(body).to.not.have.property("ownerUserIds");
      expect(asked.firstCall.args[0]).to.equal(PUBLIC);
    });
  }

  it("asks for an active access app among the tenants the public sees", async function () {
    const exists = sinon.stub(TenantModel, "exists").resolves({ _id: "x" });

    const uses = await TenantManager.hasTenantWithDigitalKeys(PUBLIC);

    expect(uses).to.equal(true);
    expect(exists.firstCall.args[0]).to.deep.equal({
      ...publicTenantCondition(),
      applications: { $elemMatch: { type: "access", active: true } },
    });
  });

  it("says no when no such tenant exists", async function () {
    sinon.stub(TenantModel, "exists").resolves(null);

    expect(await TenantManager.hasTenantWithDigitalKeys(PUBLIC)).to.equal(
      false,
    );
  });
});
