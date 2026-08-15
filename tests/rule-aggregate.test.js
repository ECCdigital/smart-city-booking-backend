const mock = require("mock-require");
const { expect } = require("chai");
const sinon = require("sinon");
const mongoose = require("mongoose");

describe("RuleEngine aggregate actions & $$TENANT_MAIL", () => {
  let sandbox;
  let RuleEngine;
  let fakeActions;
  let fakeAggregateActions;
  let createdLogs;
  let foundDocs;

  const AGG_RULE = {
    _id: "aggrule1",
    name: "Sammelmail",
    enabled: true,
    resource: "Booking",
    schedule: "*/5 * * * *",
    actions: [
      {
        type: "sendAggregatedEmail",
        params: { to: "$$TENANT_MAIL", subject: "Offen", body: "{{count}}" },
      },
    ],
  };

  const PERDOC_MAIL_RULE = {
    _id: "pd1",
    name: "PerDocMail",
    enabled: true,
    resource: "Booking",
    schedule: "*/5 * * * *",
    actions: [
      {
        type: "sendEmail",
        params: { to: "$$TENANT_MAIL", subject: "x", body: "y" },
      },
    ],
  };

  beforeEach(() => {
    sandbox = sinon.createSandbox();
    createdLogs = [];
    foundDocs = [];

    mock("../src/rule-engine/RuleModel", {
      find: () => ({ lean: async () => [] }),
      findById: () => ({ lean: async () => null }),
      updateOne: sandbox.stub().resolves(),
    });
    mock("../src/rule-engine/RuleExecutionLogModel", {
      create: async (doc) => {
        createdLogs.push(doc);
        return doc;
      },
    });

    fakeActions = { sendEmail: sandbox.stub().resolves() };
    fakeAggregateActions = { sendAggregatedEmail: sandbox.stub().resolves() };

    mock("../src/rule-engine/actionRegistry", fakeActions);
    mock("../src/rule-engine/aggregateActionRegistry", fakeAggregateActions);
    mock("../src/commons/data-managers/tenant-manager", {
      getTenant: async (id) => ({ mail: `admin-${id}@example.com` }),
    });

    sandbox.stub(mongoose, "model").returns({
      find: () => ({ lean: async () => foundDocs }),
    });

    RuleEngine = mock.reRequire("../src/rule-engine/ruleEngine");
  });

  afterEach(() => {
    sandbox.restore();
    mock.stopAll();
  });

  it("groups matched docs by tenant and calls the aggregate action once per tenant", async () => {
    foundDocs = [
      { id: "b1", tenantId: "t1" },
      { id: "b2", tenantId: "t1" },
      { id: "b3", tenantId: "t2" },
    ];

    const log = await RuleEngine.runRule(AGG_RULE);

    expect(fakeAggregateActions.sendAggregatedEmail.callCount).to.equal(2);

    const callsByTenant = {};
    for (const call of fakeAggregateActions.sendAggregatedEmail.getCalls()) {
      const [docs, params, context] = call.args;
      callsByTenant[context.tenantId] = { docs, params, context };
    }

    expect(callsByTenant.t1.docs).to.have.lengthOf(2);
    expect(callsByTenant.t2.docs).to.have.lengthOf(1);
    // $$TENANT_MAIL resolved per tenant group
    expect(callsByTenant.t1.params.to).to.equal("admin-t1@example.com");
    expect(callsByTenant.t2.params.to).to.equal("admin-t2@example.com");
    expect(callsByTenant.t1.context.tenantMail).to.equal(
      "admin-t1@example.com",
    );

    expect(log.matchedCount).to.equal(3);
    expect(log.status).to.equal("success");
    expect(log.actionResults).to.have.lengthOf(2);
  });

  it("skips aggregate actions on a dry run", async () => {
    foundDocs = [{ id: "b1", tenantId: "t1" }];

    const log = await RuleEngine.dryRunRule(AGG_RULE);

    expect(fakeAggregateActions.sendAggregatedEmail.called).to.be.false;
    expect(log.status).to.equal("skipped");
    expect(log.actionResults[0].status).to.equal("skipped");
  });

  it("resolves $$TENANT_MAIL for per-document actions", async () => {
    foundDocs = [{ id: "b1", tenantId: "t9", mail: "guest@example.com" }];

    await RuleEngine.runRule(PERDOC_MAIL_RULE);

    expect(fakeActions.sendEmail.calledOnce).to.be.true;
    const [doc, params] = fakeActions.sendEmail.firstCall.args;
    expect(doc.id).to.equal("b1");
    expect(params.to).to.equal("admin-t9@example.com");
  });
});
