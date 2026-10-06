const mock = require("mock-require");
const { expect } = require("chai");
const sinon = require("sinon");

describe("RuleController", () => {
  let sandbox;
  let RuleController;
  let fakeRuleService;
  let req, res;

  beforeEach(() => {
    sandbox = sinon.createSandbox();

    fakeRuleService = {
      getMetadata: sandbox.stub(),
      getRules: sandbox.stub(),
      getRule: sandbox.stub(),
      createRule: sandbox.stub(),
      updateRule: sandbox.stub(),
      setRuleEnabled: sandbox.stub(),
      deleteRule: sandbox.stub(),
      runRule: sandbox.stub(),
      dryRunRule: sandbox.stub(),
      getExecutionLogs: sandbox.stub(),
    };

    mock("../src/commons/services/rule-service", fakeRuleService);

    RuleController = mock.reRequire(
      "../src/platform/api/controllers/rule-controller.js",
    );
    req = { user: { id: "owner1" }, params: {}, query: {}, body: {} };
    res = { status: sandbox.stub().returnsThis(), send: sandbox.stub() };
  });

  afterEach(() => {
    sandbox.restore();
    mock.stopAll();
  });

  // The right is the router's (`rule.*`): the controller checks nothing.
  it("returns the rules", async () => {
    const rules = [{ name: "CancelBooking" }, { name: "Test" }];
    fakeRuleService.getRules.resolves(rules);

    await RuleController.getRules(req, res);

    expect(fakeRuleService.getRules.calledOnce).to.be.true;
    expect(res.status.calledWith(200)).to.be.true;
    expect(res.send.calledWith(rules)).to.be.true;
  });

  it("creates a rule and returns 201", async () => {
    const created = { _id: "r1", name: "Test" };
    req.body = { name: "Test", resource: "Booking", schedule: "*/1 * * * *" };
    fakeRuleService.createRule.resolves(created);

    await RuleController.createRule(req, res);

    expect(fakeRuleService.createRule.calledOnceWith(req.body, "owner1")).to.be
      .true;
    expect(res.status.calledWith(201)).to.be.true;
    expect(res.send.calledWith(created)).to.be.true;
  });

  it("maps validation errors to status 400", async () => {
    const validationError = new Error('resource "Foo" is not allowed');
    validationError.statusCode = 400;
    validationError.errors = ['resource "Foo" is not allowed'];
    fakeRuleService.createRule.rejects(validationError);

    await RuleController.createRule(req, res);

    expect(res.status.calledWith(400)).to.be.true;
    expect(
      res.send.calledWithMatch({
        errors: ['resource "Foo" is not allowed'],
      }),
    ).to.be.true;
  });

  it("triggers a manual run", async () => {
    const executionLog = { status: "success" };
    req.params.id = "rule1";
    fakeRuleService.runRule.resolves(executionLog);

    await RuleController.runRule(req, res);

    expect(fakeRuleService.runRule.calledOnceWith("rule1")).to.be.true;
    expect(res.status.calledWith(200)).to.be.true;
    expect(res.send.calledWith(executionLog)).to.be.true;
  });

  it("returns 404 when a rule is not found", async () => {
    const notFound = new Error('Rule "missing" not found');
    notFound.statusCode = 404;
    req.params.id = "missing";
    fakeRuleService.getRule.rejects(notFound);

    await RuleController.getRule(req, res);

    expect(res.status.calledWith(404)).to.be.true;
  });
});
