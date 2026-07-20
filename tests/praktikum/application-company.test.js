const mock = require("mock-require");
const { expect } = require("chai");
const sinon = require("sinon");

describe("ApplicationService — company inbox + status", () => {
  let sandbox;
  let ApplicationManager;
  let OfferManager;
  let CompanyBranchManager;
  let TaxonomyTermManager;
  let ApplicationService;
  const T = "kielregion";
  const CO = "c-1";

  beforeEach(() => {
    sandbox = sinon.createSandbox();
    ApplicationManager = {
      getByCompany: sandbox.stub(),
      getById: sandbox.stub(),
      updateStatus: sandbox.stub().resolves(),
    };
    OfferManager = {
      getOffersByIds: sandbox.stub().resolves([]),
      getOffer: sandbox.stub().resolves(null),
    };
    CompanyBranchManager = {
      getBranchesByCompany: sandbox.stub().resolves([]),
    };
    TaxonomyTermManager = {
      getTerms: sandbox.stub().resolves([
        { id: "st-neu", name: "Neu" },
        { id: "st-pruefung", name: "In Prüfung" },
        { id: "st-eingeladen", name: "Eingeladen" },
        { id: "st-abgesagt", name: "Abgesagt" },
      ]),
    };
    mock(
      "../../src/commons/data-managers/application-manager",
      ApplicationManager,
    );
    mock("../../src/commons/data-managers/offer-manager", OfferManager);
    mock(
      "../../src/commons/data-managers/company-branch-manager",
      CompanyBranchManager,
    );
    mock(
      "../../src/commons/data-managers/taxonomy-term-manager",
      TaxonomyTermManager,
    );
    mock("../../src/commons/data-managers/student-manager", {});
    mock("../../src/commons/data-managers/user-manager", {});
    ApplicationService = mock.reRequire(
      "../../src/commons/services/student/application-service",
    );
  });

  afterEach(() => {
    sandbox.restore();
    mock.stopAll();
  });

  it("lists company applications hydrated with offer title, branch name, derived age and document DTOs", async () => {
    ApplicationManager.getByCompany.resolves([
      {
        id: "a-1",
        offerId: "o-1",
        companyId: CO,
        branchId: "b-1",
        firstName: "Lena",
        lastName: "P",
        email: "lena@x.de",
        phone: "0431",
        birthDate: "2008-03-14",
        motivation: "hi",
        status: "st-neu",
        created: 111,
        documents: [
          {
            id: "d-1",
            type: "lebenslauf",
            originalName: "cv.pdf",
            fileName: "protected/x",
            size: 10,
            created: 5,
          },
        ],
      },
    ]);
    OfferManager.getOffersByIds.resolves([
      { id: "o-1", title: "IT", city: "Kiel", companyId: CO, branchId: "b-1" },
    ]);
    CompanyBranchManager.getBranchesByCompany.resolves([
      { id: "b-1", name: "HQ Kiel" },
    ]);
    const list = await ApplicationService.listCompanyApplications(T, CO, null);
    expect(list).to.have.length(1);
    const dto = list[0];
    expect(dto.offerTitle).to.equal("IT");
    expect(dto.branchName).to.equal("HQ Kiel");
    expect(dto.applicant.email).to.equal("lena@x.de");
    expect(dto.applicant.age).to.be.a("number");
    expect(dto.motivation).to.equal("hi");
    expect(dto.statusId).to.equal("st-neu");
    expect(dto.status).to.equal("Neu");
    expect(dto.documents[0]).to.include({
      id: "d-1",
      type: "lebenslauf",
      name: "cv.pdf",
      size: 10,
    });
    expect(dto.documents[0].fileName).to.equal(undefined);
    expect(dto.documents[0].downloadUrl).to.contain(
      "/api/kielregion/applications/a-1/documents/d-1/download",
    );
  });

  it("filters to the caller's branch when a branch scope is given", async () => {
    ApplicationManager.getByCompany.resolves([
      {
        id: "a-1",
        offerId: "o-1",
        companyId: CO,
        branchId: "b-1",
        documents: [],
      },
      {
        id: "a-2",
        offerId: "o-2",
        companyId: CO,
        branchId: "b-2",
        documents: [],
      },
    ]);
    OfferManager.getOffersByIds.resolves([]);
    const list = await ApplicationService.listCompanyApplications(T, CO, "b-1");
    expect(list.map((a) => a.id)).to.deep.equal(["a-1"]);
  });

  it("uses the offer's CURRENT branch, not the value snapshotted on the application", async () => {
    ApplicationManager.getByCompany.resolves([
      {
        id: "a-1",
        offerId: "o-1",
        companyId: CO,
        branchId: "b-1",
        documents: [],
      },
    ]);
    OfferManager.getOffersByIds.resolves([
      { id: "o-1", title: "IT", companyId: CO, branchId: "b-2" },
    ]);
    CompanyBranchManager.getBranchesByCompany.resolves([
      { id: "b-1", name: "Alt" },
      { id: "b-2", name: "Neu" },
    ]);
    const all = await ApplicationService.listCompanyApplications(T, CO, null);
    expect(all[0].branchId).to.equal("b-2");
    expect(all[0].branchName).to.equal("Neu");
    const oldScope = await ApplicationService.listCompanyApplications(
      T,
      CO,
      "b-1",
    );
    expect(oldScope).to.have.length(0);
    const newScope = await ApplicationService.listCompanyApplications(
      T,
      CO,
      "b-2",
    );
    expect(newScope.map((a) => a.id)).to.deep.equal(["a-1"]);
  });

  it("updates the status for a company's own application", async () => {
    ApplicationManager.getById.resolves({
      id: "a-1",
      companyId: CO,
      branchId: "b-1",
    });
    const res = await ApplicationService.updateApplicationStatus(
      T,
      CO,
      "a-1",
      "st-eingeladen",
      null,
    );
    expect(
      ApplicationManager.updateStatus.calledWith(T, "a-1", "st-eingeladen"),
    ).to.equal(true);
    expect(res).to.deep.equal({ id: "a-1", status: "st-eingeladen" });
  });

  it("→ 400 on an invalid status", async () => {
    let err;
    try {
      await ApplicationService.updateApplicationStatus(
        T,
        CO,
        "a-1",
        "Nope",
        null,
      );
    } catch (e) {
      err = e;
    }
    expect(err && err.status).to.equal(400);
    expect(ApplicationManager.getById.called).to.equal(false);
  });

  it("→ 404 when the application belongs to another company", async () => {
    ApplicationManager.getById.resolves({ id: "a-1", companyId: "other" });
    let err;
    try {
      await ApplicationService.updateApplicationStatus(
        T,
        CO,
        "a-1",
        "st-neu",
        null,
      );
    } catch (e) {
      err = e;
    }
    expect(err && err.status).to.equal(404);
    expect(ApplicationManager.updateStatus.called).to.equal(false);
  });

  it("→ 403 when a branch-scoped caller targets another branch's application", async () => {
    ApplicationManager.getById.resolves({
      id: "a-1",
      companyId: CO,
      branchId: "b-2",
    });
    let err;
    try {
      await ApplicationService.updateApplicationStatus(
        T,
        CO,
        "a-1",
        "st-neu",
        "b-1",
      );
    } catch (e) {
      err = e;
    }
    expect(err && err.status).to.equal(403);
    expect(ApplicationManager.updateStatus.called).to.equal(false);
  });

  it("getApplicationById → 404 when missing", async () => {
    ApplicationManager.getById.resolves(null);
    let err;
    try {
      await ApplicationService.getApplicationById(T, "nope");
    } catch (e) {
      err = e;
    }
    expect(err && err.status).to.equal(404);
  });
});

describe("ApplicationController — company inbox + documents", () => {
  let sandbox;
  let ApplicationService;
  let CompanyController;
  let PlatformSettingsService;
  let NextcloudManager;
  let OfferManager;
  let ApplicationController;

  const res = () => ({
    statusCode: null,
    body: undefined,
    headers: {},
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
    setHeader(k, v) {
      this.headers[k] = v;
    },
  });

  beforeEach(() => {
    sandbox = sinon.createSandbox();
    ApplicationService = {
      listCompanyApplications: sandbox.stub().resolves([]),
      updateApplicationStatus: sandbox
        .stub()
        .resolves({ id: "a-1", status: "Neu" }),
      getApplicationById: sandbox.stub(),
      addDocumentRef: sandbox.stub().resolves(),
      removeDocumentRef: sandbox.stub().resolves({ removed: "d-1" }),
      documentDtos: sandbox
        .stub()
        .callsFake((t, appId, docs) => (docs || []).map((d) => ({ id: d.id }))),
    };
    CompanyController = {
      getBranchAccess: sandbox.stub().resolves({ isAdmin: true, member: null }),
      _memberBranchScope: sandbox.stub().returns(null),
      isTenantAdmin: sandbox.stub().resolves(false),
    };
    PlatformSettingsService = {
      getSettings: sandbox
        .stub()
        .resolves({ maxDocsPerInternship: 5, maxDocSizeMb: 10 }),
    };
    NextcloudManager = {
      createFile: sandbox.stub().resolves(),
      getFile: sandbox.stub().resolves(Buffer.from("%PDF-1.4")),
      deleteFile: sandbox.stub().resolves(),
    };
    OfferManager = {
      getOffer: sandbox
        .stub()
        .resolves({ id: "o-1", companyId: "c-1", branchId: "b-1" }),
    };
    mock(
      "../../src/commons/services/student/application-service",
      ApplicationService,
    );
    mock(
      "../../src/platform/api/controllers/company-controller",
      CompanyController,
    );
    mock(
      "../../src/commons/services/platform-settings-service",
      PlatformSettingsService,
    );
    mock("../../src/commons/data-managers/file-manager", {
      NextcloudManager,
    });
    mock("../../src/commons/data-managers/offer-manager", OfferManager);
    ApplicationController = mock.reRequire(
      "../../src/platform/api/controllers/application-controller",
    );
  });

  afterEach(() => {
    sandbox.restore();
    mock.stopAll();
  });

  const reqBase = (over = {}) => ({
    user: { id: "u-1" },
    body: {},
    ...over,
    params: { tenant: "kielregion", id: "c-1", ...over.params },
  });

  it("listForCompany → 403 when the caller is neither admin nor a member", async () => {
    CompanyController.getBranchAccess.resolves({
      isAdmin: false,
      member: null,
    });
    const r = res();
    await ApplicationController.listForCompany(reqBase(), r);
    expect(r.statusCode).to.equal(403);
    expect(ApplicationService.listCompanyApplications.called).to.equal(false);
  });

  it("listForCompany → 200 and passes the resolved branch scope", async () => {
    CompanyController.getBranchAccess.resolves({
      isAdmin: false,
      member: { branchId: "b-9" },
    });
    CompanyController._memberBranchScope.returns("b-9");
    const r = res();
    await ApplicationController.listForCompany(reqBase(), r);
    expect(r.statusCode).to.equal(200);
    expect(
      ApplicationService.listCompanyApplications.calledWith(
        "kielregion",
        "c-1",
        "b-9",
      ),
    ).to.equal(true);
  });

  it("uploadDocument → 403 when the caller is not the applicant", async () => {
    ApplicationService.getApplicationById.resolves({
      id: "a-1",
      studentUserId: "someone-else",
      documents: [],
    });
    const r = res();
    await ApplicationController.uploadDocument(
      reqBase({ params: { id: "a-1" }, files: { file: { name: "cv.pdf" } } }),
      r,
    );
    expect(r.statusCode).to.equal(403);
    expect(NextcloudManager.createFile.called).to.equal(false);
  });

  it("uploadDocument → 400 for a non-PDF file", async () => {
    ApplicationService.getApplicationById.resolves({
      id: "a-1",
      studentUserId: "u-1",
      documents: [],
    });
    const r = res();
    await ApplicationController.uploadDocument(
      reqBase({
        params: { id: "a-1" },
        files: {
          file: {
            name: "cv.png",
            mimetype: "image/png",
            data: Buffer.from("x"),
          },
        },
      }),
      r,
    );
    expect(r.statusCode).to.equal(400);
    expect(NextcloudManager.createFile.called).to.equal(false);
  });

  it("uploadDocument → 400 when the PDF mimetype is spoofed on non-PDF bytes", async () => {
    ApplicationService.getApplicationById.resolves({
      id: "a-1",
      studentUserId: "u-1",
      documents: [],
    });
    const r = res();
    await ApplicationController.uploadDocument(
      reqBase({
        params: { id: "a-1" },
        files: {
          file: {
            name: "cv.pdf",
            mimetype: "application/pdf",
            data: Buffer.from("<html>not a pdf</html>"),
          },
        },
      }),
      r,
    );
    expect(r.statusCode).to.equal(400);
    expect(NextcloudManager.createFile.called).to.equal(false);
  });

  it("uploadDocument → 413 when the file exceeds maxDocSizeMb", async () => {
    ApplicationService.getApplicationById.resolves({
      id: "a-1",
      studentUserId: "u-1",
      documents: [],
    });
    PlatformSettingsService.getSettings.resolves({
      maxDocsPerInternship: 5,
      maxDocSizeMb: 1,
    });
    const big = {
      name: "cv.pdf",
      mimetype: "application/pdf",
      data: Buffer.concat([
        Buffer.from("%PDF-1.4"),
        Buffer.alloc(2 * 1024 * 1024),
      ]),
    };
    const r = res();
    await ApplicationController.uploadDocument(
      reqBase({ params: { id: "a-1" }, files: { file: big } }),
      r,
    );
    expect(r.statusCode).to.equal(413);
  });

  const pdfUpload = (over = {}) =>
    reqBase({
      params: { id: "a-1" },
      files: {
        file: {
          name: "cv.pdf",
          mimetype: "application/pdf",
          data: Buffer.from("%PDF-1.4"),
        },
      },
      ...over,
    });

  it("uploadDocument → 400 once the CV plus maxDocsPerInternship extras are present", async () => {
    // maxDocsPerInternship counts the extras beyond the CV, so the total cap is N + 1.
    PlatformSettingsService.getSettings.resolves({
      maxDocsPerInternship: 2,
      maxDocSizeMb: 10,
    });
    ApplicationService.getApplicationById.resolves({
      id: "a-1",
      studentUserId: "u-1",
      documents: [{ id: "d1" }, { id: "d2" }, { id: "d3" }],
    });
    const r = res();
    await ApplicationController.uploadDocument(pdfUpload(), r);
    expect(r.statusCode).to.equal(400);
    expect(NextcloudManager.createFile.called).to.equal(false);
  });

  it("uploadDocument → 201 while still below the CV + extras cap", async () => {
    PlatformSettingsService.getSettings.resolves({
      maxDocsPerInternship: 2,
      maxDocSizeMb: 10,
    });
    ApplicationService.getApplicationById.resolves({
      id: "a-1",
      studentUserId: "u-1",
      documents: [{ id: "d1" }, { id: "d2" }],
    });
    const r = res();
    await ApplicationController.uploadDocument(pdfUpload(), r);
    expect(r.statusCode).to.equal(201);
    expect(NextcloudManager.createFile.calledOnce).to.equal(true);
  });

  it("uploadDocument → 201 for the CV when maxDocsPerInternship is 0 and none exist yet", async () => {
    PlatformSettingsService.getSettings.resolves({
      maxDocsPerInternship: 0,
      maxDocSizeMb: 10,
    });
    ApplicationService.getApplicationById.resolves({
      id: "a-1",
      studentUserId: "u-1",
      documents: [],
    });
    const r = res();
    await ApplicationController.uploadDocument(pdfUpload(), r);
    expect(r.statusCode).to.equal(201);
    expect(NextcloudManager.createFile.calledOnce).to.equal(true);
  });

  it("uploadDocument → 400 when maxDocsPerInternship is 0 and the CV already exists (only 1 doc total)", async () => {
    PlatformSettingsService.getSettings.resolves({
      maxDocsPerInternship: 0,
      maxDocSizeMb: 10,
    });
    ApplicationService.getApplicationById.resolves({
      id: "a-1",
      studentUserId: "u-1",
      documents: [{ id: "d1" }],
    });
    const r = res();
    await ApplicationController.uploadDocument(pdfUpload(), r);
    expect(r.statusCode).to.equal(400);
    expect(NextcloudManager.createFile.called).to.equal(false);
  });

  it("uploadDocument → 201 stores the PDF privately and persists the ref", async () => {
    ApplicationService.getApplicationById.resolves({
      id: "a-1",
      studentUserId: "u-1",
      documents: [],
    });
    const r = res();
    await ApplicationController.uploadDocument(
      reqBase({
        params: { id: "a-1" },
        body: { type: "Lebenslauf" },
        files: {
          file: {
            name: "cv.pdf",
            mimetype: "application/pdf",
            data: Buffer.from("%PDF-1.4"),
          },
        },
      }),
      r,
    );
    expect(r.statusCode).to.equal(201);
    expect(NextcloudManager.createFile.calledOnce).to.equal(true);
    const args = NextcloudManager.createFile.firstCall.args;
    expect(args[0].subFolder).to.equal("application-documents/a-1");
    expect(args[0].subFolder.startsWith("protected/")).to.equal(false);
    const ref = ApplicationService.addDocumentRef.firstCall.args[2];
    expect(ref.type).to.equal("lebenslauf");
    expect(ref.fileName).to.contain("application-documents/a-1/");
    expect(ref.originalName).to.equal("cv.pdf");
  });

  it("downloadDocument streams the PDF for the applicant", async () => {
    ApplicationService.getApplicationById.resolves({
      id: "a-1",
      studentUserId: "u-1",
      companyId: "c-1",
      branchId: "",
      documents: [
        { id: "d-1", fileName: "protected/x", originalName: "cv.pdf" },
      ],
    });
    const r = res();
    await ApplicationController.downloadDocument(
      reqBase({ params: { id: "a-1", docId: "d-1" } }),
      r,
    );
    expect(r.statusCode).to.equal(200);
    expect(
      NextcloudManager.getFile.calledWith({
        tenant: "kielregion",
        filename: "protected/x",
      }),
    ).to.equal(true);
    expect(r.headers["Content-Type"]).to.equal("application/pdf");
  });

  it("downloadDocument → 403 for an unrelated user", async () => {
    ApplicationService.getApplicationById.resolves({
      id: "a-1",
      studentUserId: "someone-else",
      companyId: "c-1",
      branchId: "",
      documents: [{ id: "d-1", fileName: "protected/x" }],
    });
    CompanyController.getBranchAccess.resolves({
      isAdmin: false,
      member: null,
    });
    const r = res();
    await ApplicationController.downloadDocument(
      reqBase({ params: { id: "a-1", docId: "d-1" } }),
      r,
    );
    expect(r.statusCode).to.equal(403);
    expect(NextcloudManager.getFile.called).to.equal(false);
  });

  it("downloadDocument → 200 for an all-branches company member", async () => {
    ApplicationService.getApplicationById.resolves({
      id: "a-1",
      studentUserId: "someone-else",
      companyId: "c-1",
      branchId: "b-1",
      documents: [
        { id: "d-1", fileName: "protected/x", originalName: "cv.pdf" },
      ],
    });
    CompanyController.getBranchAccess.resolves({
      isAdmin: false,
      member: { branchId: null },
    });
    CompanyController._memberBranchScope.returns(null);
    const r = res();
    await ApplicationController.downloadDocument(
      reqBase({ params: { id: "a-1", docId: "d-1" } }),
      r,
    );
    expect(r.statusCode).to.equal(200);
    expect(
      NextcloudManager.getFile.calledWith({
        tenant: "kielregion",
        filename: "protected/x",
      }),
    ).to.equal(true);
  });

  it("downloadDocument → 200 for a member scoped to the application's branch", async () => {
    ApplicationService.getApplicationById.resolves({
      id: "a-1",
      studentUserId: "someone-else",
      companyId: "c-1",
      branchId: "b-1",
      documents: [
        { id: "d-1", fileName: "protected/x", originalName: "cv.pdf" },
      ],
    });
    CompanyController.getBranchAccess.resolves({
      isAdmin: false,
      member: { branchId: "b-1" },
    });
    CompanyController._memberBranchScope.returns("b-1");
    const r = res();
    await ApplicationController.downloadDocument(
      reqBase({ params: { id: "a-1", docId: "d-1" } }),
      r,
    );
    expect(r.statusCode).to.equal(200);
    expect(NextcloudManager.getFile.called).to.equal(true);
  });

  it("downloadDocument → 403 for a member scoped to a different branch", async () => {
    ApplicationService.getApplicationById.resolves({
      id: "a-1",
      studentUserId: "someone-else",
      companyId: "c-1",
      branchId: "b-1",
      documents: [
        { id: "d-1", fileName: "protected/x", originalName: "cv.pdf" },
      ],
    });
    CompanyController.getBranchAccess.resolves({
      isAdmin: false,
      member: { branchId: "b-2" },
    });
    CompanyController._memberBranchScope.returns("b-2");
    const r = res();
    await ApplicationController.downloadDocument(
      reqBase({ params: { id: "a-1", docId: "d-1" } }),
      r,
    );
    expect(r.statusCode).to.equal(403);
    expect(NextcloudManager.getFile.called).to.equal(false);
  });

  it("downloadDocument scopes by the offer's current branch, not the application snapshot", async () => {
    // The offer moved from b-1 (still snapshotted on the application) to b-2, so
    // a member scoped to the old branch b-1 must no longer reach its documents.
    ApplicationService.getApplicationById.resolves({
      id: "a-1",
      studentUserId: "someone-else",
      companyId: "c-1",
      offerId: "o-1",
      branchId: "b-1",
      documents: [
        { id: "d-1", fileName: "protected/x", originalName: "cv.pdf" },
      ],
    });
    OfferManager.getOffer.resolves({
      id: "o-1",
      companyId: "c-1",
      branchId: "b-2",
    });
    CompanyController.getBranchAccess.resolves({
      isAdmin: false,
      member: { branchId: "b-1" },
    });
    CompanyController._memberBranchScope.returns("b-1");
    const r = res();
    await ApplicationController.downloadDocument(
      reqBase({ params: { id: "a-1", docId: "d-1" } }),
      r,
    );
    expect(r.statusCode).to.equal(403);
    expect(NextcloudManager.getFile.called).to.equal(false);
  });

  it("removeDocument → 403 when the caller is not the applicant", async () => {
    ApplicationService.getApplicationById.resolves({
      id: "a-1",
      studentUserId: "other",
      documents: [{ id: "d-1", fileName: "protected/x" }],
    });
    const r = res();
    await ApplicationController.removeDocument(
      reqBase({ params: { id: "a-1", docId: "d-1" } }),
      r,
    );
    expect(r.statusCode).to.equal(403);
    expect(NextcloudManager.deleteFile.called).to.equal(false);
  });

  it("removeDocument deletes the Nextcloud file and the ref for the owner", async () => {
    ApplicationService.getApplicationById.resolves({
      id: "a-1",
      studentUserId: "u-1",
      documents: [{ id: "d-1", fileName: "protected/x" }],
    });
    const r = res();
    await ApplicationController.removeDocument(
      reqBase({ params: { id: "a-1", docId: "d-1" } }),
      r,
    );
    expect(r.statusCode).to.equal(200);
    expect(
      NextcloudManager.deleteFile.calledWith("kielregion", "protected/x"),
    ).to.equal(true);
    expect(
      ApplicationService.removeDocumentRef.calledWith(
        "kielregion",
        "a-1",
        "d-1",
      ),
    ).to.equal(true);
  });
});
