const { expect } = require("chai");
const sinon = require("sinon");

process.env.CRYPTO_SECRET =
  process.env.CRYPTO_SECRET || "0123456789abcdef0123456789abcdef";

const AccessAppController = require("../src/platform/api/controllers/access-app-controller");
const SaltoKsIqActivationService = require("../src/commons/services/access/salto-ks-iq-activation-service");
const { BadRequestError } = require("../src/errors/BaseError");

const IQ_ID = "5dfdc54e-8335-11f0-a2ed-6045bd92d38f";

/**
 * The wizard renders what the activation service answers. Who may run it is
 * the route's (`accessApp.manage`: the tenant owner) and is pinned in
 * `authorization-access-routes.test.js`, not here.
 */
describe("AccessAppController Salto KS IQ wizard", () => {
  let sandbox;
  let request;
  let response;

  beforeEach(() => {
    sandbox = sinon.createSandbox();
    request = {
      params: { tenant: "tenant-1", iqId: IQ_ID },
      body: {},
      user: { id: "user-1" },
    };
    response = {
      status: sandbox.stub().returnsThis(),
      send: sandbox.stub(),
      sendStatus: sandbox.stub(),
    };
  });

  afterEach(() => {
    sandbox.restore();
  });

  it("lists the IQs with their local state for a tenant manager", async () => {
    const iqs = [{ id: IQ_ID, state: "activated" }];
    sandbox.stub(SaltoKsIqActivationService, "listIqs").resolves(iqs);

    await AccessAppController.saltoKsListIqs(request, response);

    expect(SaltoKsIqActivationService.listIqs.calledOnceWith("tenant-1")).to.be
      .true;
    expect(response.status.calledOnceWith(200)).to.be.true;
    expect(response.send.calledOnceWith(iqs)).to.be.true;
  });

  it("starts an activation", async () => {
    sandbox
      .stub(SaltoKsIqActivationService, "startActivation")
      .resolves({ iqId: IQ_ID, state: "pending_pin" });

    await AccessAppController.saltoKsStartIqActivation(request, response);

    expect(
      SaltoKsIqActivationService.startActivation.calledOnceWith(
        "tenant-1",
        IQ_ID,
      ),
    ).to.be.true;
    expect(response.status.calledOnceWith(200)).to.be.true;
    expect(response.send.firstCall.args[0]).to.deep.equal({
      iqId: IQ_ID,
      state: "pending_pin",
    });
  });

  it("renders a refused wizard step with its code", async () => {
    sandbox
      .stub(SaltoKsIqActivationService, "startActivation")
      .rejects(new BadRequestError("salto_iq_already_activated_at_salto"));

    await AccessAppController.saltoKsStartIqActivation(request, response);

    expect(response.status.calledOnceWith(400)).to.be.true;
    expect(response.send.firstCall.args[0].code).to.equal(
      "salto_iq_already_activated_at_salto",
    );
  });

  it("completes an activation with the mailed pin", async () => {
    request.body = { pin: "1234" };
    sandbox
      .stub(SaltoKsIqActivationService, "completeActivation")
      .resolves({ iqId: IQ_ID, state: "activated" });

    await AccessAppController.saltoKsCompleteIqActivation(request, response);

    expect(
      SaltoKsIqActivationService.completeActivation.calledOnceWith(
        "tenant-1",
        IQ_ID,
        "1234",
      ),
    ).to.be.true;
    expect(response.status.calledOnceWith(200)).to.be.true;
  });

  it("discards an activation", async () => {
    sandbox
      .stub(SaltoKsIqActivationService, "discardActivation")
      .resolves({ iqId: IQ_ID, state: "not_activated" });

    await AccessAppController.saltoKsDiscardIqActivation(request, response);

    expect(
      SaltoKsIqActivationService.discardActivation.calledOnceWith(
        "tenant-1",
        IQ_ID,
      ),
    ).to.be.true;
    expect(response.status.calledOnceWith(200)).to.be.true;
  });
});
