const { expect } = require("chai");
const sinon = require("sinon");
const RuleMetadata = require("../src/rule-engine/ruleMetadata");
const RuleEngine = require("../src/rule-engine/ruleEngine");
const RuleService = require("../src/commons/services/rule-service");

describe("ruleMetadata", () => {
  it("exposes Booking as an allowed resource with fields", () => {
    const resources = RuleMetadata.getResources();
    const booking = resources.find((r) => r.name === "Booking");

    expect(booking).to.exist;
    expect(booking.fields.map((f) => f.name)).to.include.members([
      "isPayed",
      "isCommitted",
      "isRejected",
      "timeCreated",
      "mail",
    ]);
  });

  it("keeps the engine allowlist in sync with the catalog", () => {
    expect(RuleEngine.getAllowedResources()).to.deep.equal(["Booking"]);
  });

  it("describes actions including sendEmail with its params", () => {
    const actions = RuleMetadata.getActions(RuleEngine.getAllowedActions());
    const sendEmail = actions.find((a) => a.type === "sendEmail");

    expect(sendEmail).to.exist;
    const paramNames = sendEmail.params.map((p) => p.name);
    expect(paramNames).to.include.members(["to", "subject", "body"]);
  });

  it("reports the engine enabled flag based on the environment", () => {
    const original = process.env.RULE_ENGINE_ENABLED;

    process.env.RULE_ENGINE_ENABLED = "true";
    expect(RuleEngine.isEngineEnabled()).to.be.true;

    process.env.RULE_ENGINE_ENABLED = "false";
    expect(RuleEngine.isEngineEnabled()).to.be.false;

    process.env.RULE_ENGINE_ENABLED = original;
  });

  it("provides condition and query operators for the builder", () => {
    expect(RuleMetadata.CONDITION_OPERATORS.map((o) => o.operator)).to.include(
      "==",
    );
    expect(RuleMetadata.QUERY_OPERATORS.map((o) => o.operator)).to.include(
      "$expr",
    );
    expect(RuleMetadata.PLACEHOLDERS.map((p) => p.token)).to.include("$$NOW");
  });
});

describe("RuleService manual run guard", () => {
  let sandbox;

  beforeEach(() => {
    sandbox = sinon.createSandbox();
  });

  afterEach(() => {
    sandbox.restore();
  });

  it("blocks manual runs when the engine is disabled", async () => {
    sandbox.stub(RuleEngine, "isEngineEnabled").returns(false);
    const runStub = sandbox.stub(RuleEngine, "runRule");

    let error;
    try {
      await RuleService.runRule("rule1");
    } catch (err) {
      error = err;
    }

    expect(error).to.be.an("error");
    expect(error.statusCode).to.equal(409);
    expect(runStub.called).to.be.false;
  });

  it("still allows dry runs when the engine is disabled", async () => {
    sandbox.stub(RuleEngine, "isEngineEnabled").returns(false);
    sandbox.stub(RuleService, "getRule").resolves({ _id: "rule1" });
    const dryRunStub = sandbox
      .stub(RuleEngine, "dryRunRule")
      .resolves({ status: "skipped" });

    const result = await RuleService.dryRunRule("rule1");

    expect(dryRunStub.calledOnce).to.be.true;
    expect(result.status).to.equal("skipped");
  });
});
