const { expect } = require("chai");
const sinon = require("sinon");

const AccessAppController = require("../src/platform/api/controllers/access-app-controller");
const AccessInfoService = require("../src/commons/services/access/access-info-service");
const TenantManager = require("../src/commons/data-managers/tenant-manager");

/**
 * The listing of a provider's locks, the one the admin UI's access point
 * dialog picks from. Who may read it is the route's (`accessApp.read`) and
 * is pinned in `authorization-access-routes.test.js`, not here.
 */
describe("AccessAppController.getAccessPoints", () => {
  let sandbox;
  let request;
  let response;

  beforeEach(() => {
    sandbox = sinon.createSandbox();
    request = {
      params: { tenant: "tenant-1", provider: "nuki" },
      user: { id: "user-1" },
    };
    response = {
      status: sandbox.stub().returnsThis(),
      send: sandbox.stub(),
      json: sandbox.stub(),
      set: sandbox.stub(),
    };
  });

  afterEach(() => {
    sandbox.restore();
  });

  it("sends the locks the provider lists", async () => {
    const locks = [{ id: "lock-1", provider: "nuki", externalId: "lock-1" }];
    sandbox.stub(AccessInfoService, "getAccessPoints").resolves(locks);

    await AccessAppController.getAccessPoints(request, response);

    expect(response.status.calledOnceWith(200)).to.be.true;
    expect(response.send.calledOnceWith(locks)).to.be.true;
  });

  // tickets#311: the admin UI tells "not switched on yet" apart from a
  // failure by this code, and lets the access point be saved unchecked.
  ["nuki", "ifbs", "salto-ks"].forEach((provider) => {
    const code = `${provider.replace("-", "_")}_application_not_found`;

    it(`answers 404 ${code} while the tenant's ${provider} application is not active`, async () => {
      sandbox.stub(TenantManager, "getTenant").resolves({
        id: "tenant-1",
        applications: [{ type: "access", id: provider, active: false }],
      });
      request.params.provider = provider;

      await AccessAppController.getAccessPoints(request, response);

      expect(response.status.calledOnceWith(404)).to.be.true;
      // In the one JSON form of the central error handler (`api-response`).
      expect(response.json.firstCall.args[0]).to.include({
        code,
        statusCode: 404,
      });
    });
  });

  it("keeps answering 500 when the provider fails otherwise", async () => {
    sandbox
      .stub(AccessInfoService, "getAccessPoints")
      .rejects(new Error("connect ECONNREFUSED"));

    await AccessAppController.getAccessPoints(request, response);

    expect(response.status.calledOnceWith(500)).to.be.true;
    expect(response.send.calledOnceWith("Could not get access points")).to.be
      .true;
  });
});
