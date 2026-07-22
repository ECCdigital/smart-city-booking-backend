const mock = require("mock-require");
const { expect } = require("chai");
const sinon = require("sinon");

const capture = async (fn) => {
  try {
    await fn();
  } catch (e) {
    return e;
  }
  return null;
};

describe("TaxonomyService — admin CRUD", () => {
  let sandbox;
  let TaxonomyTermManager;
  let CompanyManager;
  let OfferManager;
  let CompanyBranchManager;
  let ApplicationManager;
  let AccountDeletionManager;
  let TaxonomyService;

  const T = "kg";

  beforeEach(() => {
    sandbox = sinon.createSandbox();
    TaxonomyTermManager = {
      getTerm: sandbox.stub().resolves(null),
      getTerms: sandbox.stub().resolves([]),
      createTerm: sandbox.stub().callsFake(async (t) => t),
      updateTerm: sandbox.stub().callsFake(async (tid, id, patch) => ({
        id,
        tenantId: tid,
        type: "industry",
        name: "X",
        color: "",
        active: true,
        sortOrder: 0,
        ...patch,
      })),
      removeTerm: sandbox.stub().resolves(true),
      setSortOrders: sandbox.stub().resolves(),
    };
    CompanyManager = { countByField: sandbox.stub().resolves(0) };
    OfferManager = { countByField: sandbox.stub().resolves(0) };
    CompanyBranchManager = { countByField: sandbox.stub().resolves(0) };
    ApplicationManager = { countByField: sandbox.stub().resolves(0) };
    AccountDeletionManager = { countByField: sandbox.stub().resolves(0) };

    mock(
      "../../src/commons/data-managers/taxonomy-term-manager",
      TaxonomyTermManager,
    );
    mock("../../src/commons/data-managers/company-manager", CompanyManager);
    mock("../../src/commons/data-managers/offer-manager", OfferManager);
    mock(
      "../../src/commons/data-managers/company-branch-manager",
      CompanyBranchManager,
    );
    mock(
      "../../src/commons/data-managers/application-manager",
      ApplicationManager,
    );
    mock(
      "../../src/commons/data-managers/account-deletion-manager",
      AccountDeletionManager,
    );

    TaxonomyService = mock.reRequire(
      "../../src/commons/services/taxonomy-service",
    );
  });

  afterEach(() => {
    sandbox.restore();
    mock.stopAll();
  });

  it("createTerm rejects an invalid type (400)", async () => {
    const e = await capture(() =>
      TaxonomyService.createTerm(T, { type: "nope", name: "X" }),
    );
    expect(e && e.status).to.equal(400);
    expect(TaxonomyTermManager.createTerm.called).to.equal(false);
  });

  it("createTerm rejects an empty name (400)", async () => {
    const e = await capture(() =>
      TaxonomyService.createTerm(T, { type: "industry", name: "   " }),
    );
    expect(e && e.status).to.equal(400);
  });

  it("createTerm assigns a uuid + next sortOrder and strips colour for non-industry", async () => {
    TaxonomyTermManager.getTerms.resolves([{ sortOrder: 0 }, { sortOrder: 3 }]);
    await TaxonomyService.createTerm(T, {
      type: "district",
      name: "Kiel",
      color: "#ffffff",
    });
    const arg = TaxonomyTermManager.createTerm.firstCall.args[0];
    expect(arg.type).to.equal("district");
    expect(arg.color).to.equal("");
    expect(arg.sortOrder).to.equal(4);
    expect(arg.id).to.be.a("string");
    expect(arg.id.length).to.be.greaterThan(0);
    expect(arg.active).to.equal(true);
  });

  it("createTerm keeps colour for an industry term", async () => {
    await TaxonomyService.createTerm(T, {
      type: "industry",
      name: "IT",
      color: "#123456",
    });
    expect(TaxonomyTermManager.createTerm.firstCall.args[0].color).to.equal(
      "#123456",
    );
  });

  it("createTerm keeps colour for an application_status term", async () => {
    await TaxonomyService.createTerm(T, {
      type: "application_status",
      name: "Neu",
      color: "#95c121",
    });
    expect(TaxonomyTermManager.createTerm.firstCall.args[0].color).to.equal(
      "#95c121",
    );
  });

  it("createTerm maps a duplicate-name key error (11000) to 409", async () => {
    TaxonomyTermManager.createTerm.rejects({ code: 11000 });
    const e = await capture(() =>
      TaxonomyService.createTerm(T, { type: "industry", name: "IT" }),
    );
    expect(e && e.status).to.equal(409);
  });

  it("updateTerm → 404 when the term is missing", async () => {
    const e = await capture(() =>
      TaxonomyService.updateTerm(T, "missing", { name: "X" }),
    );
    expect(e && e.status).to.equal(404);
  });

  it("updateTerm strips colour for a non-industry term", async () => {
    TaxonomyTermManager.getTerm.resolves({
      id: "d1",
      type: "district",
      name: "Kiel",
    });
    await TaxonomyService.updateTerm(T, "d1", { color: "#abcdef" });
    expect(TaxonomyTermManager.updateTerm.firstCall.args[2].color).to.equal("");
  });

  it("updateTerm keeps colour for an application_status term", async () => {
    TaxonomyTermManager.getTerm.resolves({
      id: "s1",
      type: "application_status",
      name: "Neu",
    });
    await TaxonomyService.updateTerm(T, "s1", { color: "#95c121" });
    expect(TaxonomyTermManager.updateTerm.firstCall.args[2].color).to.equal(
      "#95c121",
    );
  });

  it("updateTerm can toggle active", async () => {
    TaxonomyTermManager.getTerm.resolves({
      id: "i1",
      type: "industry",
      name: "IT",
    });
    await TaxonomyService.updateTerm(T, "i1", { active: false });
    expect(TaxonomyTermManager.updateTerm.firstCall.args[2].active).to.equal(
      false,
    );
  });

  it("updateTerm allows renaming an application_status term (stored by id)", async () => {
    TaxonomyTermManager.getTerm.resolves({
      id: "s1",
      type: "application_status",
      name: "Angenommen",
    });
    await TaxonomyService.updateTerm(T, "s1", { name: "Zugesagt" });
    expect(TaxonomyTermManager.updateTerm.calledOnce).to.equal(true);
    expect(TaxonomyTermManager.updateTerm.firstCall.args[2]).to.include({
      name: "Zugesagt",
    });
  });

  it("updateTerm blocks renaming the „andere“ fallback (409)", async () => {
    TaxonomyTermManager.getTerm.resolves({
      id: "f1",
      type: "district",
      name: "andere",
    });
    const e = await capture(() =>
      TaxonomyService.updateTerm(T, "f1", { name: "Sonstige" }),
    );
    expect(e && e.status).to.equal(409);
  });

  it("updateTerm blocks deactivating the „andere“ fallback (409)", async () => {
    TaxonomyTermManager.getTerm.resolves({
      id: "f1",
      type: "district",
      name: "andere",
    });
    const e = await capture(() =>
      TaxonomyService.updateTerm(T, "f1", { active: false }),
    );
    expect(e && e.status).to.equal(409);
  });

  it("reorderTerms persists 0-based sortOrder from the ordered ids, ignoring unknown ids", async () => {
    TaxonomyTermManager.getTerms.resolves([
      { id: "a" },
      { id: "b" },
      { id: "c" },
    ]);
    await TaxonomyService.reorderTerms(T, {
      type: "industry",
      orderedIds: ["c", "a", "zzz", "b"],
    });
    const updates = TaxonomyTermManager.setSortOrders.firstCall.args[1];
    expect(updates).to.deep.equal([
      { id: "c", sortOrder: 0 },
      { id: "a", sortOrder: 1 },
      { id: "b", sortOrder: 2 },
    ]);
  });

  it("reorderTerms dedupes ids and appends omitted terms", async () => {
    TaxonomyTermManager.getTerms.resolves([
      { id: "a" },
      { id: "b" },
      { id: "c" },
    ]);
    await TaxonomyService.reorderTerms(T, {
      type: "industry",
      orderedIds: ["b", "b", "a"],
    });
    const updates = TaxonomyTermManager.setSortOrders.firstCall.args[1];
    expect(updates).to.deep.equal([
      { id: "b", sortOrder: 0 },
      { id: "a", sortOrder: 1 },
      { id: "c", sortOrder: 2 },
    ]);
  });

  it("reorderTerms rejects an invalid type (400)", async () => {
    const e = await capture(() =>
      TaxonomyService.reorderTerms(T, { type: "nope", orderedIds: [] }),
    );
    expect(e && e.status).to.equal(400);
  });

  it("deleteTerm → 404 when the term is missing", async () => {
    const e = await capture(() => TaxonomyService.deleteTerm(T, "missing"));
    expect(e && e.status).to.equal(404);
  });

  it("deleteTerm blocks the „andere“ fallback term (409)", async () => {
    TaxonomyTermManager.getTerm.resolves({
      id: "x",
      type: "industry",
      name: "andere",
    });
    const e = await capture(() => TaxonomyService.deleteTerm(T, "x"));
    expect(e && e.status).to.equal(409);
    expect(TaxonomyTermManager.removeTerm.called).to.equal(false);
  });

  it("deleteTerm blocks an in-use industry term with 409 + usage count", async () => {
    TaxonomyTermManager.getTerm.resolves({
      id: "i1",
      type: "industry",
      name: "IT",
    });
    CompanyManager.countByField.resolves(2);
    OfferManager.countByField.resolves(1);
    const e = await capture(() => TaxonomyService.deleteTerm(T, "i1"));
    expect(e && e.status).to.equal(409);
    expect(e.usage).to.equal(3);
    expect(TaxonomyTermManager.removeTerm.called).to.equal(false);
  });

  it("deleteTerm checks application_status usage by id", async () => {
    TaxonomyTermManager.getTerm.resolves({
      id: "s1",
      type: "application_status",
      name: "Angenommen",
    });
    ApplicationManager.countByField.resolves(1);
    const e = await capture(() => TaxonomyService.deleteTerm(T, "s1"));
    expect(
      ApplicationManager.countByField.calledWith(T, "status", "s1"),
    ).to.equal(true);
    expect(e && e.status).to.equal(409);
  });

  it("deleteTerm removes an unused term", async () => {
    TaxonomyTermManager.getTerm.resolves({
      id: "i1",
      type: "industry",
      name: "IT",
    });
    const res = await TaxonomyService.deleteTerm(T, "i1");
    expect(TaxonomyTermManager.removeTerm.calledWith(T, "i1")).to.equal(true);
    expect(res).to.deep.equal({ deleted: "i1" });
  });

  it("listAllForAdmin groups all terms incl. inactive, with the active flag", async () => {
    TaxonomyTermManager.getTerms.resolves([
      {
        id: "i1",
        type: "industry",
        name: "IT",
        color: "#1",
        active: true,
        sortOrder: 0,
      },
      {
        id: "i2",
        type: "industry",
        name: "X",
        color: "",
        active: false,
        sortOrder: 1,
      },
      {
        id: "d1",
        type: "district",
        name: "Kiel",
        color: "",
        active: true,
        sortOrder: 0,
      },
    ]);
    const grouped = await TaxonomyService.listAllForAdmin(T);
    expect(grouped.industry).to.have.length(2);
    expect(grouped.industry[1].active).to.equal(false);
    expect(grouped.district).to.have.length(1);
    expect(
      TaxonomyTermManager.getTerms.calledWithMatch(T, { activeOnly: false }),
    ).to.equal(true);
  });
});

describe("TaxonomyController — admin guard", () => {
  let sandbox;
  let CompanyController;
  let TaxonomyService;
  let TaxonomyController;

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
  const req = (over = {}) => ({
    params: { tenant: "kg", ...(over.params || {}) },
    user: { id: "u1" },
    body: over.body || {},
    query: over.query || {},
  });

  beforeEach(() => {
    sandbox = sinon.createSandbox();
    CompanyController = { isTenantAdmin: sandbox.stub().resolves(false) };
    TaxonomyService = {
      listAllForAdmin: sandbox.stub().resolves({}),
      createTerm: sandbox.stub().resolves({ id: "n1" }),
      updateTerm: sandbox.stub().resolves({ id: "n1" }),
      reorderTerms: sandbox.stub().resolves({}),
      deleteTerm: sandbox.stub().resolves({ deleted: "n1" }),
    };
    mock(
      "../../src/platform/api/controllers/company-controller",
      CompanyController,
    );
    mock("../../src/commons/services/taxonomy-service", TaxonomyService);
    TaxonomyController = mock.reRequire(
      "../../src/platform/api/controllers/taxonomy-controller",
    );
  });

  afterEach(() => {
    sandbox.restore();
    mock.stopAll();
  });

  it("create → 403 for a non-admin (service not called)", async () => {
    const r = res();
    await TaxonomyController.create(
      req({ body: { type: "industry", name: "IT" } }),
      r,
    );
    expect(r.statusCode).to.equal(403);
    expect(TaxonomyService.createTerm.called).to.equal(false);
  });

  it("create → 201 for an admin and delegates to the service", async () => {
    CompanyController.isTenantAdmin.resolves(true);
    const r = res();
    await TaxonomyController.create(
      req({ body: { type: "industry", name: "IT" } }),
      r,
    );
    expect(r.statusCode).to.equal(201);
    expect(TaxonomyService.createTerm.calledOnce).to.equal(true);
  });

  it("remove → 409 surfaces the in-use service error", async () => {
    CompanyController.isTenantAdmin.resolves(true);
    TaxonomyService.deleteTerm.rejects({ status: 409, message: "in use" });
    const r = res();
    await TaxonomyController.remove(req({ params: { id: "i1" } }), r);
    expect(r.statusCode).to.equal(409);
    expect(r.body).to.equal("in use");
  });

  it("adminList → 403 for a non-admin", async () => {
    const r = res();
    await TaxonomyController.adminList(req(), r);
    expect(r.statusCode).to.equal(403);
    expect(TaxonomyService.listAllForAdmin.called).to.equal(false);
  });
});
