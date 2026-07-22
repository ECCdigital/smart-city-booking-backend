const mock = require("mock-require");
const { expect } = require("chai");
const sinon = require("sinon");

// let the fire-and-forget notification settle before asserting on it
const flush = () => new Promise((resolve) => setImmediate(resolve));

describe("ApplicationService — submitApplication", () => {
  let sandbox;
  let StudentManager;
  let OfferManager;
  let UserManager;
  let ApplicationManager;
  let ApplicationService;
  let PlatformSettingsService;
  let CompanyMemberManager;
  let ApplicationNotificationMail;
  let AuditLogService;

  const tenantId = "kielregion";
  const userId = "lena@example.de";
  const offerId = "o-123";

  const validPayload = { motivation: "  Ich möchte lernen.  ", consent: true };

  beforeEach(() => {
    sandbox = sinon.createSandbox();
    StudentManager = {
      getStudentByUser: sandbox.stub().resolves({
        userId,
        tenantId,
        birthDate: "2008-03-14",
        targetGroups: ["pupil"],
      }),
    };
    OfferManager = {
      getOffer: sandbox.stub().resolves({
        id: offerId,
        companyId: "c-1",
        branchId: "b-1",
        status: "Online",
        title: "Praktikum IT",
        city: "Kiel",
      }),
      getOffersByIds: sandbox.stub().resolves([]),
    };
    UserManager = {
      getUserBy: sandbox.stub().resolves({
        id: userId,
        firstName: "Lena",
        lastName: "Petersen",
        phone: "0431 12345",
      }),
    };
    ApplicationManager = {
      getByOfferAndUser: sandbox.stub().resolves(null),
      listByUser: sandbox.stub().resolves([]),
      storeApplication: sandbox.stub().callsFake(async (a) => a),
    };
    mock("../../src/commons/data-managers/student-manager", StudentManager);
    mock("../../src/commons/data-managers/offer-manager", OfferManager);
    mock("../../src/commons/data-managers/user-manager", UserManager);
    mock(
      "../../src/commons/data-managers/application-manager",
      ApplicationManager,
    );
    mock("../../src/commons/data-managers/company-manager", {
      getCompany: sandbox
        .stub()
        .resolves({ id: "c-1", name: "Muster GmbH", status: "verified" }),
      getBlockedCompanyIds: sandbox.stub().resolves([]),
    });
    CompanyMemberManager = {
      getMembersByCompany: sandbox.stub().resolves([
        { userId: "owner@example.de", isOwner: true, branchId: "" },
        { userId: "allbranch@example.de", isOwner: false, branchId: "" },
        { userId: "b1@example.de", isOwner: false, branchId: "b-1" },
        { userId: "b2@example.de", isOwner: false, branchId: "b-2" },
      ]),
    };
    mock(
      "../../src/commons/data-managers/company-member-manager",
      CompanyMemberManager,
    );
    ApplicationNotificationMail = {
      sendApplicationReceived: sandbox.stub().resolves(),
      sendApplicationStatusChanged: sandbox.stub().resolves(),
    };
    mock(
      "../../src/commons/services/student/application-notification-mail",
      ApplicationNotificationMail,
    );
    AuditLogService = { record: sandbox.stub() };
    mock("../../src/commons/services/audit-log-service", AuditLogService);
    PlatformSettingsService = {
      getSettings: sandbox.stub().resolves({ defaultApplicationStatus: "Neu" }),
    };
    mock(
      "../../src/commons/services/platform-settings-service",
      PlatformSettingsService,
    );
    ApplicationService = mock.reRequire(
      "../../src/commons/services/student/application-service",
    );
  });

  afterEach(() => {
    sandbox.restore();
    mock.stopAll();
  });

  it("creates an application with the applicant snapshot, status Neu and consent", async () => {
    const res = await ApplicationService.submitApplication(
      tenantId,
      userId,
      offerId,
      validPayload,
    );
    expect(ApplicationManager.storeApplication.calledOnce).to.equal(true);
    const stored = ApplicationManager.storeApplication.firstCall.args[0];
    expect(stored.tenantId).to.equal(tenantId);
    expect(stored.offerId).to.equal(offerId);
    expect(stored.companyId).to.equal("c-1");
    expect(stored.branchId).to.equal("b-1");
    expect(stored.studentUserId).to.equal(userId);
    expect(stored.firstName).to.equal("Lena");
    expect(stored.lastName).to.equal("Petersen");
    expect(stored.email).to.equal(userId);
    expect(stored.phone).to.equal("0431 12345");
    expect(stored.birthDate).to.equal("2008-03-14");
    expect(stored.motivation).to.equal("Ich möchte lernen.");
    expect(stored.consent).to.equal(true);
    expect(stored.consentAt).to.be.a("number");
    expect(stored.status).to.equal("Neu");
    expect(stored.documents).to.deep.equal([]);
    expect(res.id).to.be.a("string").and.to.have.length.greaterThan(0);
  });

  it("notifies the owner, all-branch members and the offer's branch members", async () => {
    await ApplicationService.submitApplication(
      tenantId,
      userId,
      offerId,
      validPayload,
    );
    await flush();
    expect(
      ApplicationNotificationMail.sendApplicationReceived.calledOnce,
    ).to.equal(true);
    const arg =
      ApplicationNotificationMail.sendApplicationReceived.firstCall.args[0];
    expect(arg.recipients).to.have.members([
      "owner@example.de",
      "allbranch@example.de",
      "b1@example.de",
    ]);
    expect(arg.recipients).to.not.include("b2@example.de");
    expect(arg.isUnsolicited).to.equal(false);
    expect(arg.offerTitle).to.equal("Praktikum IT");
    expect(arg.companyName).to.equal("Muster GmbH");
  });

  it("still succeeds when the company notification fails", async () => {
    ApplicationNotificationMail.sendApplicationReceived.rejects(
      new Error("smtp down"),
    );
    const res = await ApplicationService.submitApplication(
      tenantId,
      userId,
      offerId,
      validPayload,
    );
    expect(res.id).to.be.a("string");
    expect(ApplicationManager.storeApplication.calledOnce).to.equal(true);
    await flush();
    expect(
      AuditLogService.record.getCalls().some((c) => c.args[1] === "error"),
    ).to.equal(true);
  });

  it("uses the default application status configured in the platform settings", async () => {
    PlatformSettingsService.getSettings.resolves({
      defaultApplicationStatus: "In Prüfung",
    });
    await ApplicationService.submitApplication(
      tenantId,
      userId,
      offerId,
      validPayload,
    );
    const stored = ApplicationManager.storeApplication.firstCall.args[0];
    expect(stored.status).to.equal("In Prüfung");
  });

  it("→ 403 when the caller is not a student", async () => {
    StudentManager.getStudentByUser.resolves(null);
    let err;
    try {
      await ApplicationService.submitApplication(
        tenantId,
        userId,
        offerId,
        validPayload,
      );
    } catch (e) {
      err = e;
    }
    expect(err && err.status).to.equal(403);
    expect(ApplicationManager.storeApplication.called).to.equal(false);
  });

  it("→ 400 when consent is not given", async () => {
    let err;
    try {
      await ApplicationService.submitApplication(tenantId, userId, offerId, {
        motivation: "x",
        consent: false,
      });
    } catch (e) {
      err = e;
    }
    expect(err && err.status).to.equal(400);
    expect(ApplicationManager.storeApplication.called).to.equal(false);
  });

  it("→ 400 when the motivation exceeds the max length", async () => {
    let err;
    try {
      await ApplicationService.submitApplication(tenantId, userId, offerId, {
        motivation: "x".repeat(5001),
        consent: true,
      });
    } catch (e) {
      err = e;
    }
    expect(err && err.status).to.equal(400);
    expect(ApplicationManager.storeApplication.called).to.equal(false);
  });

  it("→ 404 when the offer does not exist", async () => {
    OfferManager.getOffer.resolves(null);
    let err;
    try {
      await ApplicationService.submitApplication(
        tenantId,
        userId,
        offerId,
        validPayload,
      );
    } catch (e) {
      err = e;
    }
    expect(err && err.status).to.equal(404);
  });

  it("→ 404 when the offer is not Online", async () => {
    OfferManager.getOffer.resolves({
      id: offerId,
      companyId: "c-1",
      branchId: "",
      status: "Entwurf",
    });
    let err;
    try {
      await ApplicationService.submitApplication(
        tenantId,
        userId,
        offerId,
        validPayload,
      );
    } catch (e) {
      err = e;
    }
    expect(err && err.status).to.equal(404);
    expect(ApplicationManager.storeApplication.called).to.equal(false);
  });

  it("→ 409 when the application deadline has passed", async () => {
    OfferManager.getOffer.resolves({
      id: offerId,
      companyId: "c-1",
      branchId: "b-1",
      status: "Online",
      title: "Praktikum IT",
      city: "Kiel",
      applicationDeadline: "2020-01-01",
    });
    let err;
    try {
      await ApplicationService.submitApplication(
        tenantId,
        userId,
        offerId,
        validPayload,
      );
    } catch (e) {
      err = e;
    }
    expect(err && err.status).to.equal(409);
    expect(ApplicationManager.storeApplication.called).to.equal(false);
  });

  it("→ 409 when the student has already applied to this offer", async () => {
    ApplicationManager.getByOfferAndUser.resolves({ id: "existing" });
    let err;
    try {
      await ApplicationService.submitApplication(
        tenantId,
        userId,
        offerId,
        validPayload,
      );
    } catch (e) {
      err = e;
    }
    expect(err && err.status).to.equal(409);
    expect(ApplicationManager.storeApplication.called).to.equal(false);
  });

  it("→ 409 when a concurrent submit collides on the unique index (E11000)", async () => {
    ApplicationManager.storeApplication.rejects({ code: 11000 });
    let err;
    try {
      await ApplicationService.submitApplication(
        tenantId,
        userId,
        offerId,
        validPayload,
      );
    } catch (e) {
      err = e;
    }
    expect(err && err.status).to.equal(409);
  });
});

describe("ApplicationService — submitUnsolicitedApplication", () => {
  let sandbox;
  let StudentManager;
  let UserManager;
  let CompanyManager;
  let ApplicationManager;
  let ApplicationService;
  let PlatformSettingsService;
  let CompanyMemberManager;
  let ApplicationNotificationMail;

  const tenantId = "kielregion";
  const userId = "lena@example.de";
  const companyId = "c-1";
  const validPayload = {
    motivation: "  Ich will mich vorstellen.  ",
    consent: true,
  };

  beforeEach(() => {
    sandbox = sinon.createSandbox();
    StudentManager = {
      getStudentByUser: sandbox.stub().resolves({
        userId,
        tenantId,
        birthDate: "2008-03-14",
        targetGroups: ["pupil"],
      }),
    };
    UserManager = {
      getUserBy: sandbox.stub().resolves({
        id: userId,
        firstName: "Lena",
        lastName: "Petersen",
        phone: "0431 12345",
      }),
    };
    CompanyManager = {
      getCompany: sandbox.stub().resolves({
        id: companyId,
        tenantId,
        name: "Muster GmbH",
        status: "verified",
        acceptsUnsolicitedApplications: true,
      }),
    };
    ApplicationManager = {
      storeApplication: sandbox.stub().callsFake(async (a) => a),
    };
    mock("../../src/commons/data-managers/student-manager", StudentManager);
    mock("../../src/commons/data-managers/user-manager", UserManager);
    mock("../../src/commons/data-managers/company-manager", CompanyManager);
    mock(
      "../../src/commons/data-managers/application-manager",
      ApplicationManager,
    );
    mock("../../src/commons/data-managers/offer-manager", {});
    CompanyMemberManager = {
      getMembersByCompany: sandbox.stub().resolves([
        { userId: "owner@example.de", isOwner: true, branchId: "" },
        { userId: "allbranch@example.de", isOwner: false, branchId: "" },
        { userId: "b1@example.de", isOwner: false, branchId: "b-1" },
      ]),
    };
    mock(
      "../../src/commons/data-managers/company-member-manager",
      CompanyMemberManager,
    );
    ApplicationNotificationMail = {
      sendApplicationReceived: sandbox.stub().resolves(),
      sendApplicationStatusChanged: sandbox.stub().resolves(),
    };
    mock(
      "../../src/commons/services/student/application-notification-mail",
      ApplicationNotificationMail,
    );
    PlatformSettingsService = {
      getSettings: sandbox.stub().resolves({ defaultApplicationStatus: "Neu" }),
    };
    mock(
      "../../src/commons/services/platform-settings-service",
      PlatformSettingsService,
    );
    ApplicationService = mock.reRequire(
      "../../src/commons/services/student/application-service",
    );
  });

  afterEach(() => {
    sandbox.restore();
    mock.stopAll();
  });

  it("stores an unsolicited application with empty offer/branch and the flag set", async () => {
    const res = await ApplicationService.submitUnsolicitedApplication(
      tenantId,
      userId,
      companyId,
      validPayload,
    );
    expect(ApplicationManager.storeApplication.calledOnce).to.equal(true);
    const stored = ApplicationManager.storeApplication.firstCall.args[0];
    expect(stored.offerId).to.equal("");
    expect(stored.branchId).to.equal("");
    expect(stored.isUnsolicited).to.equal(true);
    expect(stored.companyId).to.equal(companyId);
    expect(stored.studentUserId).to.equal(userId);
    expect(stored.firstName).to.equal("Lena");
    expect(stored.email).to.equal(userId);
    expect(stored.motivation).to.equal("Ich will mich vorstellen.");
    expect(stored.consent).to.equal(true);
    expect(stored.status).to.equal("Neu");
    expect(res.id).to.be.a("string").and.to.have.length.greaterThan(0);
  });

  it("notifies only the owner and all-branch managers (no branch)", async () => {
    await ApplicationService.submitUnsolicitedApplication(
      tenantId,
      userId,
      companyId,
      validPayload,
    );
    await flush();
    expect(
      ApplicationNotificationMail.sendApplicationReceived.calledOnce,
    ).to.equal(true);
    const arg =
      ApplicationNotificationMail.sendApplicationReceived.firstCall.args[0];
    expect(arg.recipients).to.have.members([
      "owner@example.de",
      "allbranch@example.de",
    ]);
    expect(arg.recipients).to.not.include("b1@example.de");
    expect(arg.isUnsolicited).to.equal(true);
    expect(arg.offerTitle).to.equal(null);
  });

  it("→ 403 when the caller is not a student", async () => {
    StudentManager.getStudentByUser.resolves(null);
    let err;
    try {
      await ApplicationService.submitUnsolicitedApplication(
        tenantId,
        userId,
        companyId,
        validPayload,
      );
    } catch (e) {
      err = e;
    }
    expect(err && err.status).to.equal(403);
    expect(ApplicationManager.storeApplication.called).to.equal(false);
  });

  it("→ 400 when consent is not given", async () => {
    let err;
    try {
      await ApplicationService.submitUnsolicitedApplication(
        tenantId,
        userId,
        companyId,
        { motivation: "x", consent: false },
      );
    } catch (e) {
      err = e;
    }
    expect(err && err.status).to.equal(400);
    expect(ApplicationManager.storeApplication.called).to.equal(false);
  });

  it("→ 404 when the company does not exist", async () => {
    CompanyManager.getCompany.resolves(null);
    let err;
    try {
      await ApplicationService.submitUnsolicitedApplication(
        tenantId,
        userId,
        companyId,
        validPayload,
      );
    } catch (e) {
      err = e;
    }
    expect(err && err.status).to.equal(404);
    expect(ApplicationManager.storeApplication.called).to.equal(false);
  });

  it("→ 404 when the company is blocked", async () => {
    CompanyManager.getCompany.resolves({
      id: companyId,
      status: "blocked",
      acceptsUnsolicitedApplications: true,
    });
    let err;
    try {
      await ApplicationService.submitUnsolicitedApplication(
        tenantId,
        userId,
        companyId,
        validPayload,
      );
    } catch (e) {
      err = e;
    }
    expect(err && err.status).to.equal(404);
  });

  it("→ 409 when the company does not accept unsolicited applications", async () => {
    CompanyManager.getCompany.resolves({
      id: companyId,
      status: "verified",
      acceptsUnsolicitedApplications: false,
    });
    let err;
    try {
      await ApplicationService.submitUnsolicitedApplication(
        tenantId,
        userId,
        companyId,
        validPayload,
      );
    } catch (e) {
      err = e;
    }
    expect(err && err.status).to.equal(409);
    expect(ApplicationManager.storeApplication.called).to.equal(false);
  });

  it("does not dedup, so a second application to the same company is allowed", async () => {
    await ApplicationService.submitUnsolicitedApplication(
      tenantId,
      userId,
      companyId,
      validPayload,
    );
    await ApplicationService.submitUnsolicitedApplication(
      tenantId,
      userId,
      companyId,
      validPayload,
    );
    expect(ApplicationManager.storeApplication.callCount).to.equal(2);
  });
});

describe("ApplicationService — listMyApplications", () => {
  let sandbox;
  let OfferManager;
  let ApplicationManager;
  let ApplicationService;
  const tenantId = "kielregion";
  const userId = "lena@example.de";

  beforeEach(() => {
    sandbox = sinon.createSandbox();
    OfferManager = { getOffersByIds: sandbox.stub() };
    ApplicationManager = { listByUser: sandbox.stub() };
    mock("../../src/commons/data-managers/offer-manager", OfferManager);
    mock(
      "../../src/commons/data-managers/application-manager",
      ApplicationManager,
    );
    mock("../../src/commons/data-managers/student-manager", {});
    mock("../../src/commons/data-managers/user-manager", {});
    mock("../../src/commons/data-managers/company-manager", {
      getBlockedCompanyIds: sandbox.stub().resolves([]),
    });
    mock("../../src/commons/data-managers/taxonomy-term-manager", {
      getTerms: sandbox.stub().resolves([
        { id: "st-neu", name: "Neu" },
        { id: "st-eingeladen", name: "Eingeladen" },
      ]),
    });
    ApplicationService = mock.reRequire(
      "../../src/commons/services/student/application-service",
    );
  });

  afterEach(() => {
    sandbox.restore();
    mock.stopAll();
  });

  it("returns [] when the student has no applications", async () => {
    ApplicationManager.listByUser.resolves([]);
    const list = await ApplicationService.listMyApplications(tenantId, userId);
    expect(list).to.deep.equal([]);
    expect(OfferManager.getOffersByIds.called).to.equal(false);
  });

  it("hydrates each application with an offer summary + its application status", async () => {
    ApplicationManager.listByUser.resolves([
      {
        id: "a-1",
        offerId: "o-1",
        companyId: "c-1",
        status: "st-neu",
        created: 111,
      },
      {
        id: "a-2",
        offerId: "o-x",
        companyId: "c-9",
        status: "st-eingeladen",
        created: 222,
      },
    ]);
    OfferManager.getOffersByIds.resolves([
      {
        id: "o-1",
        title: "IT",
        city: "Kiel",
        companyId: "c-1",
        status: "Online",
      },
    ]);
    const list = await ApplicationService.listMyApplications(tenantId, userId);
    expect(list).to.deep.equal([
      {
        id: "a-1",
        offerId: "o-1",
        companyId: "c-1",
        isUnsolicited: false,
        statusId: "st-neu",
        status: "Neu",
        createdAt: 111,
        offer: {
          id: "o-1",
          title: "IT",
          city: "Kiel",
          companyId: "c-1",
          status: "Online",
        },
        documents: [],
      },
      {
        id: "a-2",
        offerId: "o-x",
        companyId: "c-9",
        isUnsolicited: false,
        statusId: "st-eingeladen",
        status: "Eingeladen",
        createdAt: 222,
        offer: null,
        documents: [],
      },
    ]);
  });
});

describe("ApplicationController", () => {
  let sandbox;
  let ApplicationService;
  let ApplicationController;
  let NextcloudManager;

  const CV = () => ({
    name: "cv.pdf",
    mimetype: "application/pdf",
    data: Buffer.from("%PDF-1.4 test"),
  });

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
  });

  beforeEach(() => {
    sandbox = sinon.createSandbox();
    ApplicationService = {
      submitApplication: sandbox.stub().resolves({ id: "a-1" }),
      submitUnsolicitedApplication: sandbox.stub().resolves({ id: "a-2" }),
      listMyApplications: sandbox.stub().resolves([{ id: "a-1" }]),
      addDocumentRef: sandbox.stub().resolves(),
      deleteApplication: sandbox.stub().resolves({ removed: 1 }),
    };
    mock(
      "../../src/commons/services/student/application-service",
      ApplicationService,
    );
    mock("../../src/commons/services/platform-settings-service", {
      getSettings: sandbox
        .stub()
        .resolves({ maxDocSizeMb: 10, maxDocsPerInternship: 5 }),
    });
    NextcloudManager = { createFile: sandbox.stub().resolves() };
    mock("../../src/commons/data-managers/file-manager", { NextcloudManager });
    ApplicationController = mock.reRequire(
      "../../src/platform/api/controllers/application-controller",
    );
  });

  afterEach(() => {
    sandbox.restore();
    mock.stopAll();
  });

  it("submit stores the CV with the application and returns 201 (consent coerced from the multipart string)", async () => {
    const r = res();
    await ApplicationController.submit(
      {
        params: { tenant: "kielregion", offerId: "o-123" },
        user: { id: "lena@example.de" },
        body: { consent: "true", motivation: "hi" },
        files: { file: CV() },
      },
      r,
    );
    expect(r.statusCode).to.equal(201);
    expect(r.body).to.deep.equal({ id: "a-1" });
    const args = ApplicationService.submitApplication.firstCall.args;
    expect(args[0]).to.equal("kielregion");
    expect(args[1]).to.equal("lena@example.de");
    expect(args[2]).to.equal("o-123");
    expect(args[3]).to.deep.equal({ motivation: "hi", consent: true });
    expect(NextcloudManager.createFile.calledOnce).to.equal(true);
    expect(ApplicationService.addDocumentRef.calledOnce).to.equal(true);
    expect(ApplicationService.deleteApplication.called).to.equal(false);
  });

  it("submit rejects a missing CV with 400 and never creates the application", async () => {
    const r = res();
    await ApplicationController.submit(
      {
        params: { tenant: "kielregion", offerId: "o-123" },
        user: { id: "x@y.de" },
        body: { consent: "true", motivation: "" },
        files: {},
      },
      r,
    );
    expect(r.statusCode).to.equal(400);
    expect(ApplicationService.submitApplication.called).to.equal(false);
  });

  it("submit maps a service error to its status", async () => {
    ApplicationService.submitApplication.rejects({
      message: "nope",
      status: 409,
    });
    const r = res();
    await ApplicationController.submit(
      {
        params: { tenant: "kielregion", offerId: "o-123" },
        user: { id: "x@y.de" },
        body: { consent: "true" },
        files: { file: CV() },
      },
      r,
    );
    expect(r.statusCode).to.equal(409);
  });

  it("rolls the application back when the CV file write fails", async () => {
    NextcloudManager.createFile.rejects(new Error("nextcloud down"));
    const r = res();
    await ApplicationController.submit(
      {
        params: { tenant: "kielregion", offerId: "o-123" },
        user: { id: "x@y.de" },
        body: { consent: "true", motivation: "hi" },
        files: { file: CV() },
      },
      r,
    );
    expect(
      ApplicationService.deleteApplication.calledOnceWith("kielregion", "a-1"),
    ).to.equal(true);
    expect(r.statusCode).to.equal(500);
  });

  it("submitUnsolicited stores the CV, returns 201 and passes the path company id", async () => {
    const r = res();
    await ApplicationController.submitUnsolicited(
      {
        params: { tenant: "kielregion", id: "c-9" },
        user: { id: "lena@example.de" },
        body: { consent: "true", motivation: "hallo" },
        files: { file: CV() },
      },
      r,
    );
    expect(r.statusCode).to.equal(201);
    expect(r.body).to.deep.equal({ id: "a-2" });
    const args = ApplicationService.submitUnsolicitedApplication.firstCall.args;
    expect(args[0]).to.equal("kielregion");
    expect(args[1]).to.equal("lena@example.de");
    expect(args[2]).to.equal("c-9");
    expect(args[3]).to.deep.equal({ motivation: "hallo", consent: true });
    expect(NextcloudManager.createFile.calledOnce).to.equal(true);
    expect(ApplicationService.addDocumentRef.calledOnce).to.equal(true);
  });

  it("submitUnsolicited rejects a missing CV with 400 and never creates the application", async () => {
    const r = res();
    await ApplicationController.submitUnsolicited(
      {
        params: { tenant: "kielregion", id: "c-9" },
        user: { id: "x@y.de" },
        body: { consent: "true" },
        files: {},
      },
      r,
    );
    expect(r.statusCode).to.equal(400);
    expect(ApplicationService.submitUnsolicitedApplication.called).to.equal(
      false,
    );
  });

  it("listMine returns 200 with the acting student's applications", async () => {
    const r = res();
    await ApplicationController.listMine(
      { params: { tenant: "kielregion" }, user: { id: "lena@example.de" } },
      r,
    );
    expect(r.statusCode).to.equal(200);
    expect(
      ApplicationService.listMyApplications.calledWith(
        "kielregion",
        "lena@example.de",
      ),
    ).to.equal(true);
  });
});

describe("ApplicationService — updateApplicationStatus", () => {
  let sandbox;
  let TaxonomyTermManager;
  let ApplicationManager;
  let CompanyManager;
  let OfferManager;
  let ApplicationNotificationMail;
  let ApplicationService;

  const tenantId = "kielregion";
  const companyId = "c-1";

  beforeEach(() => {
    sandbox = sinon.createSandbox();
    TaxonomyTermManager = {
      getTerms: sandbox.stub().resolves([
        { id: "st-neu", name: "Neu" },
        { id: "st-eingeladen", name: "Eingeladen" },
      ]),
    };
    ApplicationManager = {
      getById: sandbox.stub().resolves({
        id: "a-1",
        companyId,
        offerId: "o-1",
        email: "lena@example.de",
        firstName: "Lena",
        status: "st-neu",
      }),
      updateStatus: sandbox.stub().resolves(),
    };
    CompanyManager = {
      getCompany: sandbox
        .stub()
        .resolves({ id: companyId, name: "Muster GmbH" }),
    };
    OfferManager = {
      getOffer: sandbox.stub().resolves({ id: "o-1", title: "Praktikum IT" }),
    };
    ApplicationNotificationMail = {
      sendApplicationReceived: sandbox.stub().resolves(),
      sendApplicationStatusChanged: sandbox.stub().resolves(),
    };
    mock(
      "../../src/commons/data-managers/taxonomy-term-manager",
      TaxonomyTermManager,
    );
    mock(
      "../../src/commons/data-managers/application-manager",
      ApplicationManager,
    );
    mock("../../src/commons/data-managers/company-manager", CompanyManager);
    mock("../../src/commons/data-managers/offer-manager", OfferManager);
    mock("../../src/commons/data-managers/student-manager", {});
    mock("../../src/commons/data-managers/user-manager", {});
    mock("../../src/commons/data-managers/company-member-manager", {});
    mock("../../src/commons/services/audit-log-service", {
      record: sandbox.stub().resolves(),
    });
    mock(
      "../../src/commons/services/student/application-notification-mail",
      ApplicationNotificationMail,
    );
    ApplicationService = mock.reRequire(
      "../../src/commons/services/student/application-service",
    );
  });

  afterEach(() => {
    sandbox.restore();
    mock.stopAll();
  });

  it("notifies the student with the old and new status names", async () => {
    await ApplicationService.updateApplicationStatus(
      tenantId,
      companyId,
      "a-1",
      "st-eingeladen",
      null,
    );
    await flush();
    expect(
      ApplicationNotificationMail.sendApplicationStatusChanged.calledOnce,
    ).to.equal(true);
    const arg =
      ApplicationNotificationMail.sendApplicationStatusChanged.firstCall
        .args[0];
    expect(arg.to).to.equal("lena@example.de");
    expect(arg.oldStatus).to.equal("Neu");
    expect(arg.newStatus).to.equal("Eingeladen");
    expect(arg.offerTitle).to.equal("Praktikum IT");
    expect(arg.companyName).to.equal("Muster GmbH");
  });
});

describe("application-notification-mail", () => {
  let sandbox;
  let MailerService;
  let mailModule;

  beforeEach(() => {
    sandbox = sinon.createSandbox();
    MailerService = { send: sandbox.stub().resolves() };
    mock("../../src/commons/mail-service/mail-service", MailerService);
    mock("../../src/commons/data-managers/instance-manager", {
      getInstance: sandbox.stub().resolves({ mailTemplate: "<x>" }),
    });
    mailModule = mock.reRequire(
      "../../src/commons/services/student/application-notification-mail",
    );
  });

  afterEach(() => {
    sandbox.restore();
    mock.stopAll();
  });

  it("sends one mail per recipient", async () => {
    await mailModule.sendApplicationReceived({
      recipients: ["a@b.de", "c@d.de"],
      companyName: "X",
      applicantName: "Y",
      offerTitle: "Z",
      isUnsolicited: false,
    });
    expect(MailerService.send.callCount).to.equal(2);
  });

  it("skips sending when there are no recipients", async () => {
    await mailModule.sendApplicationReceived({ recipients: [] });
    expect(MailerService.send.called).to.equal(false);
  });
});
