const mock = require("mock-require");
const { expect } = require("chai");
const sinon = require("sinon");

const T = "kg";

describe("SettingsController — platform logo upload/remove", () => {
  let sandbox;
  let CompanyController;
  let PlatformSettingsService;
  let NextcloudManager;
  let deleteFileByUrl;
  let SettingsController;

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
  const req = (over = {}) => ({
    params: { tenant: T },
    user: { id: "admin" },
    files: {},
    ...over,
  });
  const imageFile = (bytes = 5, name = "logo.png") => ({
    file: { name, mimetype: "image/png", data: Buffer.alloc(bytes) },
  });

  beforeEach(() => {
    sandbox = sinon.createSandbox();
    CompanyController = { isTenantAdmin: sandbox.stub().resolves(true) };
    PlatformSettingsService = {
      getSettings: sandbox.stub().resolves({ tenantId: T, logoUrl: "" }),
      updateSettings: sandbox.stub().resolves({ tenantId: T, logoUrl: "new" }),
    };
    NextcloudManager = { createFile: sandbox.stub().resolves("path") };
    deleteFileByUrl = sandbox.stub().resolves();
    mock(
      "../../src/platform/api/controllers/company-controller",
      CompanyController,
    );
    mock(
      "../../src/commons/services/platform-settings-service",
      PlatformSettingsService,
    );
    mock("../../src/commons/data-managers/file-manager", { NextcloudManager });
    mock("../../src/commons/utilities/file-url", { deleteFileByUrl });
    mock("../../src/commons/utilities/upload-limits", { MAX_IMAGE_BYTES: 10 });
    SettingsController = mock.reRequire(
      "../../src/platform/api/controllers/settings-controller",
    );
  });

  afterEach(() => {
    sandbox.restore();
    mock.stopAll();
  });

  it("uploadLogo → 403 for a non-admin and never writes a file", async () => {
    CompanyController.isTenantAdmin.resolves(false);
    const r = res();
    await SettingsController.uploadLogo(req({ files: imageFile() }), r);
    expect(r.statusCode).to.equal(403);
    expect(NextcloudManager.createFile.called).to.equal(false);
  });

  it("uploadLogo → 400 when the file is missing", async () => {
    const r = res();
    await SettingsController.uploadLogo(req({ files: {} }), r);
    expect(r.statusCode).to.equal(400);
  });

  it("uploadLogo → 400 for a non-image file", async () => {
    const r = res();
    await SettingsController.uploadLogo(
      req({
        files: {
          file: {
            name: "x.pdf",
            mimetype: "application/pdf",
            data: Buffer.alloc(3),
          },
        },
      }),
      r,
    );
    expect(r.statusCode).to.equal(400);
  });

  it("uploadLogo → 413 when the file is too large", async () => {
    const r = res();
    await SettingsController.uploadLogo(req({ files: imageFile(11) }), r);
    expect(r.statusCode).to.equal(413);
  });

  it("uploadLogo → 200 stores the file and sets logoUrl", async () => {
    const r = res();
    await SettingsController.uploadLogo(
      req({ files: imageFile(5, "my logo!.png") }),
      r,
    );
    expect(r.statusCode).to.equal(200);
    expect(NextcloudManager.createFile.calledOnce).to.equal(true);
    const arg = NextcloudManager.createFile.firstCall.args[0];
    expect(arg.subFolder).to.equal("public/logos");
    expect(arg.file.name).to.equal("settings-logo-my_logo_.png"); // sanitised
    const saved = PlatformSettingsService.updateSettings.firstCall.args[1];
    expect(saved.logoUrl).to.contain(
      "/public/logos/settings-logo-my_logo_.png",
    );
  });

  it("uploadLogo deletes the previous logo file when replacing", async () => {
    PlatformSettingsService.getSettings.resolves({
      tenantId: T,
      logoUrl: "old-url",
    });
    const r = res();
    await SettingsController.uploadLogo(req({ files: imageFile() }), r);
    expect(r.statusCode).to.equal(200);
    expect(deleteFileByUrl.calledWith(T, "old-url")).to.equal(true);
  });

  it("removeLogo → 403 for a non-admin", async () => {
    CompanyController.isTenantAdmin.resolves(false);
    const r = res();
    await SettingsController.removeLogo(req(), r);
    expect(r.statusCode).to.equal(403);
    expect(deleteFileByUrl.called).to.equal(false);
  });

  it("removeLogo deletes the file and clears logoUrl", async () => {
    PlatformSettingsService.getSettings.resolves({
      tenantId: T,
      logoUrl: "old-url",
    });
    const r = res();
    await SettingsController.removeLogo(req(), r);
    expect(r.statusCode).to.equal(200);
    expect(deleteFileByUrl.calledWith(T, "old-url")).to.equal(true);
    expect(
      PlatformSettingsService.updateSettings.calledWith(T, { logoUrl: "" }),
    ).to.equal(true);
  });
});
