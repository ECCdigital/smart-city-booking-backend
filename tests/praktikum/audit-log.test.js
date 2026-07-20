const mock = require("mock-require");
const { expect } = require("chai");
const sinon = require("sinon");

const T = "kg";

const flush = () => new Promise((resolve) => setImmediate(resolve));

describe("AuditLogManager", () => {
  let sandbox;
  let AuditLogModel;
  let chain;
  let AuditLogManager;

  beforeEach(() => {
    sandbox = sinon.createSandbox();
    chain = {
      sort: sandbox.stub().returnsThis(),
      skip: sandbox.stub().returnsThis(),
      limit: sandbox.stub().resolves([]),
    };
    AuditLogModel = {
      db: { readyState: 1 },
      create: sandbox.stub().resolves(),
      find: sandbox.stub().returns(chain),
      countDocuments: sandbox.stub().resolves(0),
    };
    mock("../../src/commons/data-managers/models/auditLogModel", AuditLogModel);
    AuditLogManager = mock.reRequire(
      "../../src/commons/data-managers/audit-log-manager",
    );
  });

  afterEach(() => {
    sandbox.restore();
    mock.stopAll();
  });

  it("append writes the entry when the connection is ready", async () => {
    await AuditLogManager.append({
      tenantId: T,
      action: "create",
      message: "x",
    });
    expect(AuditLogModel.create.calledOnce).to.equal(true);
    expect(AuditLogModel.create.firstCall.args[0]).to.deep.equal({
      tenantId: T,
      action: "create",
      message: "x",
    });
  });

  it("append skips the write when the connection is not ready", async () => {
    AuditLogModel.db.readyState = 0;
    await AuditLogManager.append({
      tenantId: T,
      action: "create",
      message: "x",
    });
    expect(AuditLogModel.create.called).to.equal(false);
  });

  it("list filters by tenant, sorts newest-first and paginates", async () => {
    await AuditLogManager.list(T, { limit: 25, offset: 50 });
    expect(AuditLogModel.find.firstCall.args[0]).to.deep.equal({ tenantId: T });
    expect(chain.sort.calledWith({ createdAt: -1 })).to.equal(true);
    expect(chain.skip.calledWith(50)).to.equal(true);
    expect(chain.limit.calledWith(25)).to.equal(true);
  });

  it("list adds the action filter and an escaped message regex", async () => {
    await AuditLogManager.list(T, { action: "update", q: "a.b*" });
    const filter = AuditLogModel.find.firstCall.args[0];
    expect(filter.action).to.equal("update");
    expect(filter.message).to.deep.equal({
      $regex: "a\\.b\\*",
      $options: "i",
    });
  });

  it("list maps rows to a clean DTO + returns the total", async () => {
    chain.limit.resolves([
      { _id: 1, action: "create", message: "m", createdAt: 42, extra: "no" },
    ]);
    AuditLogModel.countDocuments.resolves(1);
    const res = await AuditLogManager.list(T);
    expect(res.total).to.equal(1);
    expect(res.items).to.deep.equal([
      {
        id: "1",
        action: "create",
        message: "m",
        actorId: "",
        actorName: "",
        createdAt: 42,
      },
    ]);
  });
});

describe("AuditLogService.record — fire-and-forget", () => {
  let sandbox;
  let AuditLogManager;
  let AuditLogService;

  beforeEach(() => {
    sandbox = sinon.createSandbox();
    AuditLogManager = {
      append: sandbox.stub().resolves(),
      list: sandbox.stub().resolves([]),
    };
    mock("../../src/commons/data-managers/audit-log-manager", AuditLogManager);
    AuditLogService = mock.reRequire(
      "../../src/commons/services/audit-log-service",
    );
  });

  afterEach(() => {
    sandbox.restore();
    mock.stopAll();
  });

  it("appends a valid entry (no actor outside a request context)", async () => {
    await AuditLogService.record(T, "create", "something happened");
    await flush();
    expect(AuditLogManager.append.calledOnce).to.equal(true);
    expect(AuditLogManager.append.firstCall.args[0]).to.deep.equal({
      tenantId: T,
      action: "create",
      message: "something happened",
      actorId: "",
      actorName: "",
    });
  });

  it("captures the acting user from the request context and resolves the name", async () => {
    const UserManager = {
      getUser: sandbox
        .stub()
        .resolves({ firstName: "Lena", lastName: "Petersen" }),
    };
    mock("../../src/commons/data-managers/user-manager", UserManager);
    const requestContext = require("../../src/commons/utilities/request-context");
    AuditLogService = mock.reRequire(
      "../../src/commons/services/audit-log-service",
    );
    await requestContext.storage.run(
      { user: { id: "lena@kg.de" } },
      async () => {
        AuditLogService.record(T, "update", "did a thing");
        await flush();
      },
    );
    expect(UserManager.getUser.calledOnceWith("lena@kg.de")).to.equal(true);
    expect(AuditLogManager.append.firstCall.args[0]).to.deep.equal({
      tenantId: T,
      action: "update",
      message: "did a thing",
      actorId: "lena@kg.de",
      actorName: "Lena Petersen",
    });
  });

  it("ignores an unknown action", async () => {
    await AuditLogService.record(T, "login", "nope");
    expect(AuditLogManager.append.called).to.equal(false);
  });

  it("ignores a missing tenant or message", async () => {
    await AuditLogService.record("", "create", "m");
    await AuditLogService.record(T, "create", "");
    expect(AuditLogManager.append.called).to.equal(false);
  });

  it("never rejects into the caller when the write fails", async () => {
    AuditLogManager.append.rejects(new Error("db down"));
    await AuditLogService.record(T, "update", "m");
    await flush();
    expect(AuditLogManager.append.calledOnce).to.equal(true);
  });

  it("does not await the write (the caller is not blocked on it)", async () => {
    let resolveAppend;
    AuditLogManager.append.returns(
      new Promise((resolve) => {
        resolveAppend = resolve;
      }),
    );
    await AuditLogService.record(T, "create", "m");
    expect(AuditLogManager.append.calledOnce).to.equal(true);
    resolveAppend();
  });
});

describe("AuditLogController.list", () => {
  let sandbox;
  let CompanyController;
  let AuditLogService;
  let AuditLogController;

  const res = () => {
    const r = { statusCode: 0, body: undefined };
    r.status = (c) => {
      r.statusCode = c;
      return r;
    };
    r.send = (b) => {
      r.body = b;
      return r;
    };
    r.sendStatus = (c) => {
      r.statusCode = c;
      return r;
    };
    return r;
  };

  beforeEach(() => {
    sandbox = sinon.createSandbox();
    CompanyController = { isTenantAdmin: sandbox.stub().resolves(true) };
    AuditLogService = { list: sandbox.stub().resolves([{ id: "a" }]) };
    mock(
      "../../src/platform/api/controllers/company-controller",
      CompanyController,
    );
    mock("../../src/commons/services/audit-log-service", AuditLogService);
    AuditLogController = mock.reRequire(
      "../../src/platform/api/controllers/audit-log-controller",
    );
  });

  afterEach(() => {
    sandbox.restore();
    mock.stopAll();
  });

  it("returns 403 for a non-admin and never queries the log", async () => {
    CompanyController.isTenantAdmin.resolves(false);
    const r = res();
    await AuditLogController.list(
      { params: { tenant: T }, user: { id: "u" }, query: {} },
      r,
    );
    expect(r.statusCode).to.equal(403);
    expect(AuditLogService.list.called).to.equal(false);
  });

  it("returns 200 and forwards the search, action and pagination", async () => {
    const r = res();
    await AuditLogController.list(
      {
        params: { tenant: T },
        user: { id: "u" },
        query: { q: "firma", action: "create", limit: "10", offset: "20" },
      },
      r,
    );
    expect(r.statusCode).to.equal(200);
    expect(AuditLogService.list.firstCall.args[0]).to.equal(T);
    expect(AuditLogService.list.firstCall.args[1]).to.deep.equal({
      q: "firma",
      action: "create",
      limit: 10,
      offset: 20,
    });
  });

  it("clamps the limit to the allowed maximum", async () => {
    const r = res();
    await AuditLogController.list(
      {
        params: { tenant: T },
        user: { id: "u" },
        query: { limit: "9999" },
      },
      r,
    );
    expect(AuditLogService.list.firstCall.args[1].limit).to.equal(200);
  });
});

describe("Audit-log write-hook (representative)", () => {
  let sandbox;
  let TaxonomyTermManager;
  let AuditLogService;
  let TaxonomyService;

  beforeEach(() => {
    sandbox = sinon.createSandbox();
    TaxonomyTermManager = {
      getTerms: sandbox.stub().resolves([]),
      createTerm: sandbox.stub().callsFake(async (t) => t),
    };
    AuditLogService = { record: sandbox.stub().resolves() };
    mock(
      "../../src/commons/data-managers/taxonomy-term-manager",
      TaxonomyTermManager,
    );
    mock("../../src/commons/services/audit-log-service", AuditLogService);
    TaxonomyService = mock.reRequire(
      "../../src/commons/services/taxonomy-service",
    );
  });

  afterEach(() => {
    sandbox.restore();
    mock.stopAll();
  });

  it("createTerm records a 'create' entry naming the new term", async () => {
    await TaxonomyService.createTerm(T, { type: "industry", name: "IT" });
    expect(AuditLogService.record.calledOnce).to.equal(true);
    const [tenantId, action, message] = AuditLogService.record.firstCall.args;
    expect(tenantId).to.equal(T);
    expect(action).to.equal("create");
    expect(message).to.contain("IT");
  });
});
