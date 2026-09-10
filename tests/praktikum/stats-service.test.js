const mock = require("mock-require");
const { expect } = require("chai");
const sinon = require("sinon");

const T = "kg";

describe("StatsService — admin aggregates", () => {
  let sandbox;
  let ApplicationManager;
  let CompanyManager;
  let CompanyBranchManager;
  let TaxonomyTermManager;
  let StatsService;

  beforeEach(() => {
    sandbox = sinon.createSandbox();
    ApplicationManager = {
      aggregateByStatus: sandbox.stub().resolves([]),
      aggregateMonthly: sandbox.stub().resolves([]),
    };
    CompanyManager = { countByDistrict: sandbox.stub().resolves([]) };
    CompanyBranchManager = { countByDistrict: sandbox.stub().resolves([]) };
    TaxonomyTermManager = { getTerms: sandbox.stub().resolves([]) };
    mock(
      "../../src/commons/data-managers/application-manager",
      ApplicationManager,
    );
    mock("../../src/commons/data-managers/company-manager", CompanyManager);
    mock(
      "../../src/commons/data-managers/company-branch-manager",
      CompanyBranchManager,
    );
    mock(
      "../../src/commons/data-managers/taxonomy-term-manager",
      TaxonomyTermManager,
    );
    StatsService = mock.reRequire("../../src/commons/services/stats-service");
  });

  afterEach(() => {
    sandbox.restore();
    mock.stopAll();
  });

  it("byStatus lists every application_status term (by id), 0-filled, in taxonomy order", async () => {
    TaxonomyTermManager.getTerms.resolves([
      { id: "s1", name: "Neu" },
      { id: "s2", name: "In Prüfung" },
      { id: "s3", name: "Angenommen" },
    ]);
    ApplicationManager.aggregateByStatus.resolves([
      { status: "s3", count: 1 },
      { status: "s1", count: 3 },
    ]);
    const res = await StatsService.getStats(T);
    expect(res.applications.byStatus).to.deep.equal([
      { status: "Neu", count: 3 },
      { status: "In Prüfung", count: 0 },
      { status: "Angenommen", count: 1 },
    ]);
  });

  it("byStatus aggregates counts for ids that match no term into a single dash entry", async () => {
    TaxonomyTermManager.getTerms.resolves([{ id: "s1", name: "Neu" }]);
    ApplicationManager.aggregateByStatus.resolves([
      { status: "s1", count: 2 },
      { status: "gone", count: 5 },
    ]);
    const res = await StatsService.getStats(T);
    expect(res.applications.byStatus).to.deep.equal([
      { status: "Neu", count: 2 },
      { status: "—", count: 5 },
    ]);
  });

  it("passes companyId through to the application aggregates", async () => {
    await StatsService.getStats(T, "c-1");
    expect(ApplicationManager.aggregateByStatus.calledWith(T, "c-1")).to.equal(
      true,
    );
    expect(
      ApplicationManager.aggregateMonthly.calledWith(T, "c-1", 12),
    ).to.equal(true);
  });

  it("locationsByDistrict sums HQ + branch counts per district, descending", async () => {
    CompanyManager.countByDistrict.resolves([
      { districtId: "kiel", count: 2 },
      { districtId: "ploen", count: 1 },
    ]);
    CompanyBranchManager.countByDistrict.resolves([
      { districtId: "kiel", count: 3 },
      { districtId: "nms", count: 4 },
    ]);
    const res = await StatsService.getStats(T);
    expect(res.locationsByDistrict).to.deep.equal([
      { districtId: "kiel", count: 5 },
      { districtId: "nms", count: 4 },
      { districtId: "ploen", count: 1 },
    ]);
  });

  it("returns the monthly series as provided by the manager", async () => {
    ApplicationManager.aggregateMonthly.resolves([
      { period: "2026-06", count: 2 },
      { period: "2026-07", count: 5 },
    ]);
    const res = await StatsService.getStats(T);
    expect(res.applications.monthly).to.deep.equal([
      { period: "2026-06", count: 2 },
      { period: "2026-07", count: 5 },
    ]);
  });
});

describe("StatsController", () => {
  let sandbox;
  let CompanyController;
  let StatsService;
  let StatsController;

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
    StatsService = { getStats: sandbox.stub().resolves({ ok: true }) };
    mock(
      "../../src/platform/api/controllers/company-controller",
      CompanyController,
    );
    mock("../../src/commons/services/stats-service", StatsService);
    StatsController = mock.reRequire(
      "../../src/platform/api/controllers/stats-controller",
    );
  });

  afterEach(() => {
    sandbox.restore();
    mock.stopAll();
  });

  it("returns 403 for a non-admin and never queries stats", async () => {
    CompanyController.isTenantAdmin.resolves(false);
    const r = res();
    await StatsController.getStats(
      { params: { tenant: T }, user: { id: "u" }, query: {} },
      r,
    );
    expect(r.statusCode).to.equal(403);
    expect(StatsService.getStats.called).to.equal(false);
  });

  it("returns 200 and forwards companyId to the service", async () => {
    const r = res();
    await StatsController.getStats(
      { params: { tenant: T }, user: { id: "u" }, query: { companyId: "c-1" } },
      r,
    );
    expect(r.statusCode).to.equal(200);
    expect(StatsService.getStats.calledWith(T, "c-1")).to.equal(true);
  });
});
