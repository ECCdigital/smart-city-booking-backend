const mock = require("mock-require");
const { expect } = require("chai");
const sinon = require("sinon");

describe("AccountDeletionManager — increment", () => {
  let sandbox;
  let AccountDeletionModel;
  let AccountDeletionManager;

  beforeEach(() => {
    sandbox = sinon.createSandbox();
    AccountDeletionModel = { updateOne: sandbox.stub().resolves() };
    mock(
      "../../src/commons/data-managers/models/accountDeletionModel",
      AccountDeletionModel,
    );
    AccountDeletionManager = mock.reRequire(
      "../../src/commons/data-managers/account-deletion-manager",
    );
  });

  afterEach(() => {
    sandbox.restore();
    mock.stopAll();
  });

  it("upserts the counter with $inc", async () => {
    await AccountDeletionManager.increment("kg", "student", "r-1", "2026-07");
    expect(AccountDeletionModel.updateOne.calledOnce).to.equal(true);
    const [filter, update, opts] =
      AccountDeletionModel.updateOne.firstCall.args;
    expect(filter).to.deep.equal({
      tenantId: "kg",
      role: "student",
      reasonId: "r-1",
      period: "2026-07",
    });
    expect(update).to.deep.equal({ $inc: { count: 1 } });
    expect(opts).to.deep.equal({ upsert: true });
  });

  it("retries once with a plain $inc when the upsert races on the unique index (E11000)", async () => {
    AccountDeletionModel.updateOne.onFirstCall().rejects({ code: 11000 });
    AccountDeletionModel.updateOne.onSecondCall().resolves();
    await AccountDeletionManager.increment("kg", "student", "r-1", "2026-07");
    expect(AccountDeletionModel.updateOne.callCount).to.equal(2);
    // The retry is a plain increment (no upsert) since the row now exists.
    expect(AccountDeletionModel.updateOne.secondCall.args[2]).to.equal(
      undefined,
    );
  });

  it("rethrows a non-duplicate error without retrying", async () => {
    AccountDeletionModel.updateOne.rejects({ code: 99, message: "boom" });
    let err;
    try {
      await AccountDeletionManager.increment("kg", "student", "r-1", "2026-07");
    } catch (e) {
      err = e;
    }
    expect(err && err.code).to.equal(99);
    expect(AccountDeletionModel.updateOne.calledOnce).to.equal(true);
  });
});

describe("AccountDeletionService — record", () => {
  let sandbox;
  let TaxonomyTermManager;
  let AccountDeletionManager;
  let AccountDeletionService;

  beforeEach(() => {
    sandbox = sinon.createSandbox();
    TaxonomyTermManager = {
      getTerm: sandbox.stub(),
      getTerms: sandbox.stub().resolves([]),
    };
    AccountDeletionManager = {
      increment: sandbox.stub().resolves(),
      list: sandbox.stub().resolves([]),
    };
    mock(
      "../../src/commons/data-managers/taxonomy-term-manager",
      TaxonomyTermManager,
    );
    mock(
      "../../src/commons/data-managers/account-deletion-manager",
      AccountDeletionManager,
    );
    AccountDeletionService = mock.reRequire(
      "../../src/commons/services/account-deletion-service",
    );
  });

  afterEach(() => {
    sandbox.restore();
    mock.stopAll();
  });

  it("increments the (student, reason, period) counter for a valid reason", async () => {
    TaxonomyTermManager.getTerm.resolves({
      id: "deletion_reason_student-x",
      type: "deletion_reason_student",
      name: "X",
    });
    await AccountDeletionService.record(
      "kielregion",
      "student",
      "deletion_reason_student-x",
    );
    expect(AccountDeletionManager.increment.calledOnce).to.equal(true);
    const args = AccountDeletionManager.increment.firstCall.args;
    expect(args[0]).to.equal("kielregion");
    expect(args[1]).to.equal("student");
    expect(args[2]).to.equal("deletion_reason_student-x");
    expect(args[3]).to.match(/^\d{4}-\d{2}$/);
  });

  it("assertValidReason trims and returns the reasonId without incrementing", async () => {
    TaxonomyTermManager.getTerm.resolves({
      id: "deletion_reason_student-x",
      type: "deletion_reason_student",
      name: "X",
    });
    const reasonId = await AccountDeletionService.assertValidReason(
      "kielregion",
      "student",
      "  deletion_reason_student-x  ",
    );
    expect(reasonId).to.equal("deletion_reason_student-x");
    expect(AccountDeletionManager.increment.called).to.equal(false);
  });

  it("→ 400 when the reason is missing (nothing incremented)", async () => {
    let err;
    try {
      await AccountDeletionService.record("kielregion", "student", "");
    } catch (e) {
      err = e;
    }
    expect(err && err.status).to.equal(400);
    expect(AccountDeletionManager.increment.called).to.equal(false);
  });

  it("→ 400 when the reason term is of the wrong type", async () => {
    TaxonomyTermManager.getTerm.resolves({
      id: "industry-elektro",
      type: "industry",
      name: "Elektro",
    });
    let err;
    try {
      await AccountDeletionService.record(
        "kielregion",
        "student",
        "industry-elektro",
      );
    } catch (e) {
      err = e;
    }
    expect(err && err.status).to.equal(400);
    expect(AccountDeletionManager.increment.called).to.equal(false);
  });

  it("→ 400 when the reason term does not exist", async () => {
    TaxonomyTermManager.getTerm.resolves(null);
    let err;
    try {
      await AccountDeletionService.record("kielregion", "student", "nope");
    } catch (e) {
      err = e;
    }
    expect(err && err.status).to.equal(400);
  });

  it("→ 400 for an invalid role (no taxonomy lookup)", async () => {
    let err;
    try {
      await AccountDeletionService.record("kielregion", "admin", "x");
    } catch (e) {
      err = e;
    }
    expect(err && err.status).to.equal(400);
    expect(TaxonomyTermManager.getTerm.called).to.equal(false);
  });
});

describe("AccountDeletionService — getStats", () => {
  let sandbox;
  let TaxonomyTermManager;
  let AccountDeletionManager;
  let AccountDeletionService;

  beforeEach(() => {
    sandbox = sinon.createSandbox();
    TaxonomyTermManager = {
      getTerm: sandbox.stub(),
      getTerms: sandbox.stub(),
    };
    AccountDeletionManager = {
      increment: sandbox.stub().resolves(),
      list: sandbox.stub(),
    };
    mock(
      "../../src/commons/data-managers/taxonomy-term-manager",
      TaxonomyTermManager,
    );
    mock(
      "../../src/commons/data-managers/account-deletion-manager",
      AccountDeletionManager,
    );
    AccountDeletionService = mock.reRequire(
      "../../src/commons/services/account-deletion-service",
    );
  });

  afterEach(() => {
    sandbox.restore();
    mock.stopAll();
  });

  it("aggregates counts per reason across periods, resolves names, sorts by count desc", async () => {
    AccountDeletionManager.list.resolves([
      { reasonId: "r-a", period: "2026-06", count: 2 },
      { reasonId: "r-a", period: "2026-07", count: 3 },
      { reasonId: "r-b", period: "2026-07", count: 4 },
    ]);
    TaxonomyTermManager.getTerms.resolves([
      { id: "r-a", name: "Grund A" },
      { id: "r-b", name: "Grund B" },
    ]);
    const stats = await AccountDeletionService.getStats(
      "kielregion",
      "student",
    );
    expect(stats).to.deep.equal([
      { reasonId: "r-a", name: "Grund A", count: 5 },
      { reasonId: "r-b", name: "Grund B", count: 4 },
    ]);
  });

  it("falls back to the reasonId when no taxonomy name exists", async () => {
    AccountDeletionManager.list.resolves([
      { reasonId: "r-old", period: "2026-05", count: 1 },
    ]);
    TaxonomyTermManager.getTerms.resolves([]);
    const stats = await AccountDeletionService.getStats(
      "kielregion",
      "student",
    );
    expect(stats).to.deep.equal([
      { reasonId: "r-old", name: "r-old", count: 1 },
    ]);
  });
});

describe("AccountDeletionController — getStats", () => {
  let sandbox;
  let AccountDeletionService;
  let CompanyController;
  let AccountDeletionController;

  const res = () => ({
    statusCode: null,
    body: undefined,
    status(c) {
      this.statusCode = c;
      return this;
    },
    send(b) {
      this.body = b;
      return this;
    },
    sendStatus(c) {
      this.statusCode = c;
      return this;
    },
  });

  beforeEach(() => {
    sandbox = sinon.createSandbox();
    AccountDeletionService = {
      getStats: sandbox
        .stub()
        .resolves([{ reasonId: "r-a", name: "A", count: 1 }]),
    };
    CompanyController = { isTenantAdmin: sandbox.stub().resolves(true) };
    mock(
      "../../src/commons/services/account-deletion-service",
      AccountDeletionService,
    );
    mock(
      "../../src/platform/api/controllers/company-controller",
      CompanyController,
    );
    AccountDeletionController = mock.reRequire(
      "../../src/platform/api/controllers/account-deletion-controller",
    );
  });

  afterEach(() => {
    sandbox.restore();
    mock.stopAll();
  });

  it("returns 200 with the stats for an admin (defaults role=student)", async () => {
    const r = res();
    await AccountDeletionController.getStats(
      {
        params: { tenant: "kielregion" },
        user: { id: "admin@example.com" },
        query: {},
      },
      r,
    );
    expect(r.statusCode).to.equal(200);
    expect(
      AccountDeletionService.getStats.calledWith("kielregion", "student"),
    ).to.equal(true);
  });

  it("→ 403 for a non-admin (no stats read)", async () => {
    CompanyController.isTenantAdmin.resolves(false);
    const r = res();
    await AccountDeletionController.getStats(
      {
        params: { tenant: "kielregion" },
        user: { id: "x@y.de" },
        query: {},
      },
      r,
    );
    expect(r.statusCode).to.equal(403);
    expect(AccountDeletionService.getStats.called).to.equal(false);
  });
});
