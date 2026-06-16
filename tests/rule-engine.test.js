const mock = require("mock-require");
const { expect } = require("chai");
const sinon = require("sinon");
const mongoose = require("mongoose");

// The two rules currently living in the database. They must keep working.
const CANCEL_BOOKING_RULE = {
  _id: "6825b3ae1048381dc166a54d",
  name: "CancelBooking",
  enabled: true,
  resource: "Booking",
  schedule: "*/1 * * * *",
  actions: [{ type: "cancelBooking", params: { reason: "inaktive" } }],
  conditions: { "==": [{ var: "isPayed" }, false] },
  query: {
    $expr: {
      $lt: [
        "$timeCreated",
        {
          $toLong: {
            $dateSubtract: {
              startDate: "$$NOW",
              unit: "hour",
              amount: 48,
            },
          },
        },
      ],
    },
    isPayed: false,
    isRejected: false,
    isCommitted: true,
  },
};

const TEST_RULE = {
  _id: "68249a1c1048381dc166a54b",
  name: "Test",
  enabled: true,
  resource: "Booking",
  schedule: "*/1 * * * *",
  actions: [{ type: "test", params: {} }],
  conditions: { "==": [{ var: "isPayed" }, true] },
  // no query on purpose
};

describe("RuleEngine.executeRule", () => {
  let sandbox;
  let RuleEngine;
  let fakeRuleModel;
  let fakeExecutionLog;
  let fakeActions;
  let createdLogs;
  let foundDocs;

  beforeEach(() => {
    sandbox = sinon.createSandbox();
    createdLogs = [];
    foundDocs = [];

    fakeRuleModel = {
      find: () => ({ lean: async () => [] }),
      findById: (id) => ({
        lean: async () =>
          [CANCEL_BOOKING_RULE, TEST_RULE].find((r) => r._id === id) || null,
      }),
      updateOne: sandbox.stub().resolves(),
    };

    fakeExecutionLog = {
      create: async (doc) => {
        createdLogs.push(doc);
        return doc;
      },
    };

    fakeActions = {
      test: sandbox.stub().resolves("test"),
      cancelBooking: sandbox.stub().resolves(),
    };

    mock("../src/rule-engine/RuleModel", fakeRuleModel);
    mock("../src/rule-engine/RuleExecutionLogModel", fakeExecutionLog);
    mock("../src/rule-engine/actionRegistry", fakeActions);

    sandbox.stub(mongoose, "model").returns({
      find: () => ({ lean: async () => foundDocs }),
    });

    RuleEngine = mock.reRequire("../src/rule-engine/ruleEngine");
  });

  afterEach(() => {
    sandbox.restore();
    mock.stopAll();
  });

  it("executes matching docs and logs a success run", async () => {
    foundDocs = [{ id: "b1", isPayed: false, createdAt: new Date() }];

    const log = await RuleEngine.runRule(CANCEL_BOOKING_RULE);

    expect(fakeActions.cancelBooking.calledOnce).to.be.true;
    expect(fakeActions.cancelBooking.firstCall.args[1]).to.deep.equal({
      reason: "inaktive",
    });
    expect(log.status).to.equal("success");
    expect(log.matchedCount).to.equal(1);
    expect(log.processedCount).to.equal(1);
    expect(log.trigger).to.equal("manual");
    expect(createdLogs).to.have.lengthOf(1);
    expect(fakeRuleModel.updateOne.calledOnce).to.be.true;
  });

  it("skips actions on a dry run", async () => {
    foundDocs = [{ id: "b1", isPayed: false, createdAt: new Date() }];

    const log = await RuleEngine.dryRunRule(CANCEL_BOOKING_RULE);

    expect(fakeActions.cancelBooking.called).to.be.false;
    expect(log.status).to.equal("skipped");
    expect(log.matchedCount).to.equal(1);
    expect(log.processedCount).to.equal(0);
    expect(log.actionResults[0].status).to.equal("skipped");
  });

  it("reports a partial status when an action fails", async () => {
    foundDocs = [
      { id: "b1", isPayed: false, createdAt: new Date() },
      { id: "b2", isPayed: false, createdAt: new Date() },
    ];
    fakeActions.cancelBooking.onFirstCall().resolves();
    fakeActions.cancelBooking.onSecondCall().rejects(new Error("boom"));

    const log = await RuleEngine.runRule(CANCEL_BOOKING_RULE);

    expect(log.status).to.equal("partial");
    const statuses = log.actionResults.map((r) => r.status);
    expect(statuses).to.include("success");
    expect(statuses).to.include("error");
  });

  it("handles a rule without a query (Test rule)", async () => {
    foundDocs = [{ id: "b1", isPayed: true, createdAt: new Date() }];

    const log = await RuleEngine.runRule(TEST_RULE);

    expect(fakeActions.test.calledOnce).to.be.true;
    expect(log.status).to.equal("success");
    expect(log.matchedCount).to.equal(1);
  });

  it("does not run actions when conditions do not match", async () => {
    // Test rule requires isPayed === true
    foundDocs = [{ id: "b1", isPayed: false, createdAt: new Date() }];

    const log = await RuleEngine.runRule(TEST_RULE);

    expect(fakeActions.test.called).to.be.false;
    expect(log.matchedCount).to.equal(0);
    expect(log.status).to.equal("success");
  });

  it("validates resource and action allowlist", () => {
    const valid = RuleEngine.validateRuleDefinition(CANCEL_BOOKING_RULE);
    expect(valid.valid).to.be.true;

    const invalid = RuleEngine.validateRuleDefinition({
      name: "Bad",
      schedule: "*/1 * * * *",
      resource: "User",
      actions: [{ type: "unknownAction" }],
    });
    expect(invalid.valid).to.be.false;
    expect(invalid.errors.join(" ")).to.contain("User");
    expect(invalid.errors.join(" ")).to.contain("unknownAction");
  });
});
