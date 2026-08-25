const mock = require("mock-require");
const { expect } = require("chai");
const sinon = require("sinon");

describe("PlatformSettingsService", () => {
  let sandbox;
  let PlatformSettingsManager;
  let TaxonomyTermManager;
  let PlatformSettingsService;

  beforeEach(() => {
    sandbox = sinon.createSandbox();
    PlatformSettingsManager = {
      getByTenant: sandbox.stub().resolves(null),
      store: sandbox.stub().callsFake(async (s) => s),
    };
    TaxonomyTermManager = {
      getTerms: sandbox.stub().resolves([
        { id: "st-neu", name: "Neu" },
        { id: "st-pruefung", name: "In Prüfung" },
        { id: "st-eingeladen", name: "Eingeladen" },
        { id: "st-angenommen", name: "Angenommen" },
        { id: "st-abgesagt", name: "Abgesagt" },
      ]),
    };
    mock(
      "../../src/commons/data-managers/platform-settings-manager",
      PlatformSettingsManager,
    );
    mock(
      "../../src/commons/data-managers/taxonomy-term-manager",
      TaxonomyTermManager,
    );
    PlatformSettingsService = mock.reRequire(
      "../../src/commons/services/platform-settings-service",
    );
  });

  afterEach(() => {
    sandbox.restore();
    mock.stopAll();
  });

  describe("getSettings", () => {
    it("returns defaults without persisting when none exist", async () => {
      const s = await PlatformSettingsService.getSettings("kielregion");
      expect(PlatformSettingsManager.store.called).to.equal(false);
      expect(s.tenantId).to.equal("kielregion");
      expect(s.directPublishVerified).to.equal(false);
      expect(s.maxDocsPerInternship).to.equal(5);
      expect(s.maxDocSizeMb).to.equal(10);
      expect(s.imprintText).to.equal("");
    });

    it("returns existing settings without storing", async () => {
      PlatformSettingsManager.getByTenant.resolves({
        tenantId: "kielregion",
        directPublishVerified: true,
      });
      const s = await PlatformSettingsService.getSettings("kielregion");
      expect(PlatformSettingsManager.store.called).to.equal(false);
      expect(s.directPublishVerified).to.equal(true);
    });
  });

  describe("updateSettings", () => {
    it("overlays only the provided fields and keeps the rest", async () => {
      const s = await PlatformSettingsService.updateSettings("kielregion", {
        directPublishVerified: true,
        maxDocsPerInternship: 7,
        privacyPolicyText: "<p>x</p>",
      });
      expect(s.directPublishVerified).to.equal(true);
      expect(s.maxDocsPerInternship).to.equal(7);
      expect(s.privacyPolicyText).to.equal("<p>x</p>");
      expect(s.maxDocSizeMb).to.equal(10); // untouched default
    });

    it("accepts maxDocsPerInternship 0 (CV only, no additional documents)", async () => {
      const s = await PlatformSettingsService.updateSettings("kielregion", {
        maxDocsPerInternship: 0,
      });
      expect(s.maxDocsPerInternship).to.equal(0);
    });

    it("rejects a negative maxDocsPerInternship (400)", async () => {
      let err;
      try {
        await PlatformSettingsService.updateSettings("kielregion", {
          maxDocsPerInternship: -1,
        });
      } catch (e) {
        err = e;
      }
      expect(err).to.not.equal(undefined);
      expect(err.status).to.equal(400);
    });

    it("coerces directPublishVerified to a boolean", async () => {
      const s = await PlatformSettingsService.updateSettings("kielregion", {
        directPublishVerified: "true",
      });
      expect(s.directPublishVerified).to.equal(true);
    });

    it("accepts a defaultApplicationStatus present in the taxonomy", async () => {
      const s = await PlatformSettingsService.updateSettings("kielregion", {
        defaultApplicationStatus: "st-angenommen",
      });
      expect(s.defaultApplicationStatus).to.equal("st-angenommen");
    });

    it("rejects a defaultApplicationStatus not in the taxonomy (400)", async () => {
      let err;
      try {
        await PlatformSettingsService.updateSettings("kielregion", {
          defaultApplicationStatus: "Bogus",
        });
      } catch (e) {
        err = e;
      }
      expect(err).to.not.equal(undefined);
      expect(err.status).to.equal(400);
    });
  });
});

describe("SettingsController", () => {
  let sandbox;
  let CompanyController;
  let PlatformSettingsService;
  let SettingsController;

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
    CompanyController = { isTenantAdmin: sandbox.stub().resolves(false) };
    PlatformSettingsService = {
      getSettings: sandbox.stub().resolves({ tenantId: "kielregion" }),
      updateSettings: sandbox
        .stub()
        .resolves({ tenantId: "kielregion", directPublishVerified: true }),
    };
    mock(
      "../../src/platform/api/controllers/company-controller",
      CompanyController,
    );
    mock(
      "../../src/commons/services/platform-settings-service",
      PlatformSettingsService,
    );
    SettingsController = mock.reRequire(
      "../../src/platform/api/controllers/settings-controller",
    );
  });

  afterEach(() => {
    sandbox.restore();
    mock.stopAll();
  });

  it("getSettings is public (200, no admin check)", async () => {
    const r = res();
    await SettingsController.getSettings(
      { params: { tenant: "kielregion" } },
      r,
    );
    expect(r.statusCode).to.equal(200);
    expect(CompanyController.isTenantAdmin.called).to.equal(false);
  });

  it("getSettings ?key=<field> returns only that key", async () => {
    PlatformSettingsService.getSettings.resolves({
      tenantId: "kielregion",
      directPublishVerified: true,
      imprintText: "<p>Impressum</p>",
    });
    const r = res();
    await SettingsController.getSettings(
      { params: { tenant: "kielregion" }, query: { key: "imprintText" } },
      r,
    );
    expect(r.statusCode).to.equal(200);
    expect(r.body).to.deep.equal({ imprintText: "<p>Impressum</p>" });
  });

  it("getSettings ?key=a,b returns only those keys", async () => {
    PlatformSettingsService.getSettings.resolves({
      tenantId: "kielregion",
      directPublishVerified: true,
      maxDocSizeMb: 10,
      imprintText: "<p>x</p>",
    });
    const r = res();
    await SettingsController.getSettings(
      {
        params: { tenant: "kielregion" },
        query: { key: "directPublishVerified, maxDocSizeMb" },
      },
      r,
    );
    expect(r.statusCode).to.equal(200);
    expect(r.body).to.deep.equal({
      directPublishVerified: true,
      maxDocSizeMb: 10,
    });
  });

  it("getSettings -> 400 for an unknown key", async () => {
    const r = res();
    await SettingsController.getSettings(
      { params: { tenant: "kielregion" }, query: { key: "nope" } },
      r,
    );
    expect(r.statusCode).to.equal(400);
  });

  it("updateSettings -> 403 for a non-admin", async () => {
    const r = res();
    await SettingsController.updateSettings(
      { params: { tenant: "kielregion" }, user: { id: "u@x.de" }, body: {} },
      r,
    );
    expect(r.statusCode).to.equal(403);
    expect(PlatformSettingsService.updateSettings.called).to.equal(false);
  });

  it("updateSettings -> 200 for an admin", async () => {
    CompanyController.isTenantAdmin.resolves(true);
    const r = res();
    await SettingsController.updateSettings(
      {
        params: { tenant: "kielregion" },
        user: { id: "admin@x.de" },
        body: { directPublishVerified: true },
      },
      r,
    );
    expect(r.statusCode).to.equal(200);
    expect(PlatformSettingsService.updateSettings.calledOnce).to.equal(true);
  });
});
