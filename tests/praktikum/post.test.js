const mock = require("mock-require");
const { expect } = require("chai");
const sinon = require("sinon");

describe("PostService", () => {
  let sandbox;
  let PostManager;
  let PostService;
  const T = "kielregion";

  const post = (over = {}) => ({
    id: "p1",
    tenantId: T,
    slug: "s1",
    title: "T1",
    audience: "all",
    type: "article",
    tags: ["Tipps"],
    excerpt: "ex",
    contentHtml: "<p>hi</p>",
    url: "",
    thumbnailUrl: "",
    attachments: [],
    published: true,
    companyDashboardOnly: false,
    publishedAt: 100,
    created: 1,
    updated: 2,
    ...over,
  });

  beforeEach(() => {
    sandbox = sinon.createSandbox();
    PostManager = {
      listPublished: sandbox.stub().resolves([]),
      getPublishedBySlug: sandbox.stub().resolves(null),
      publishedTags: sandbox.stub().resolves([]),
      listAll: sandbox.stub().resolves([]),
      listForCompany: sandbox.stub().resolves([]),
      getById: sandbox.stub().resolves(null),
      getBySlug: sandbox.stub().resolves(null),
      store: sandbox.stub().callsFake(async (p) => p),
      remove: sandbox.stub().resolves(),
    };
    mock("../../src/commons/data-managers/post-manager", PostManager);
    PostService = mock.reRequire("../../src/commons/services/post-service");
  });

  afterEach(() => {
    sandbox.restore();
    mock.stopAll();
  });

  it("listPublic returns list DTOs without contentHtml + passes validated filters", async () => {
    PostManager.listPublished.resolves([post()]);
    const res = await PostService.listPublic(T, {
      audience: "students",
      tag: "Tipps",
      q: "x",
      limit: "5",
      offset: "9",
    });
    expect(PostManager.listPublished.firstCall.args[1]).to.deep.equal({
      audience: "students",
      tag: "Tipps",
      q: "x",
      limit: 5,
      offset: 9,
    });
    expect(res[0]).to.not.have.property("contentHtml");
    expect(res[0]).to.not.have.property("attachments");
    expect(res[0].slug).to.equal("s1");
    expect(res[0].attachmentsCount).to.equal(0);
  });

  it("listPublic drops an invalid audience", async () => {
    await PostService.listPublic(T, { audience: "nope" });
    expect(PostManager.listPublished.firstCall.args[1].audience).to.equal(
      undefined,
    );
  });

  it("getPublicBySlug → 404 when not found (unpublished / unknown / dashboard-only)", async () => {
    let err;
    try {
      await PostService.getPublicBySlug(T, "x");
    } catch (e) {
      err = e;
    }
    expect(err && err.status).to.equal(404);
  });

  it("getPublicBySlug returns a detail DTO with contentHtml + attachments", async () => {
    PostManager.getPublishedBySlug.resolves(
      post({
        attachments: [{ id: "a1", filename: "x.pdf", url: "u", size: 1 }],
      }),
    );
    const res = await PostService.getPublicBySlug(T, "s1");
    expect(res.contentHtml).to.equal("<p>hi</p>");
    expect(res.attachments).to.have.length(1);
    expect(res.attachments[0].filename).to.equal("x.pdf");
  });

  it("create → 400 without a title", async () => {
    let err;
    try {
      await PostService.create(T, { title: "  " });
    } catch (e) {
      err = e;
    }
    expect(err && err.status).to.equal(400);
  });

  it("create slugifies the title + sets publishedAt when published", async () => {
    const res = await PostService.create(T, {
      title: "Mein Beitrag!",
      published: true,
    });
    const stored = PostManager.store.firstCall.args[0];
    expect(stored.slug).to.equal("mein-beitrag");
    expect(stored.published).to.equal(true);
    expect(stored.publishedAt).to.be.a("number");
    expect(res.slug).to.equal("mein-beitrag");
  });

  it("create dedupes the slug against an existing post", async () => {
    PostManager.getBySlug
      .withArgs(T, "mein-beitrag")
      .resolves(post({ id: "other", slug: "mein-beitrag" }));
    PostManager.getBySlug.withArgs(T, "mein-beitrag-2").resolves(null);
    await PostService.create(T, { title: "Mein Beitrag" });
    expect(PostManager.store.firstCall.args[0].slug).to.equal("mein-beitrag-2");
  });

  it("update → 404 when missing", async () => {
    let err;
    try {
      await PostService.update(T, "x", { title: "y" });
    } catch (e) {
      err = e;
    }
    expect(err && err.status).to.equal(404);
  });

  it("update re-slugs on a title change (excluding itself)", async () => {
    PostManager.getById.resolves(post({ id: "p1", slug: "old", title: "Old" }));
    PostManager.getBySlug.resolves(null);
    await PostService.update(T, "p1", { title: "New Title" });
    expect(PostManager.store.firstCall.args[0].slug).to.equal("new-title");
  });

  it("setPublished(true) sets publishedAt on a previously-unpublished post", async () => {
    PostManager.getById.resolves(post({ published: false, publishedAt: null }));
    await PostService.setPublished(T, "p1", true);
    const stored = PostManager.store.firstCall.args[0];
    expect(stored.published).to.equal(true);
    expect(stored.publishedAt).to.be.a("number");
  });

  it("remove → 404 when missing, else deletes", async () => {
    let err;
    try {
      await PostService.remove(T, "x");
    } catch (e) {
      err = e;
    }
    expect(err && err.status).to.equal(404);
    PostManager.getById.resolves(post());
    const res = await PostService.remove(T, "p1");
    expect(PostManager.remove.calledWith(T, "p1")).to.equal(true);
    expect(res).to.deep.equal({ removed: "p1" });
  });

  it("listForCompanyDashboard returns detail DTOs (incl. contentHtml, no flags)", async () => {
    PostManager.listForCompany.resolves([
      post({ companyDashboardOnly: true, contentHtml: "<p>only</p>" }),
    ]);
    const res = await PostService.listForCompanyDashboard(T);
    expect(res[0].contentHtml).to.equal("<p>only</p>");
    expect(res[0]).to.not.have.property("companyDashboardOnly");
  });

  it("setThumbnail → 404 when missing, else stores the url", async () => {
    let err;
    try {
      await PostService.setThumbnail(T, "x", "http://f/img");
    } catch (e) {
      err = e;
    }
    expect(err && err.status).to.equal(404);
    PostManager.getById.resolves(post());
    const res = await PostService.setThumbnail(T, "p1", "http://f/img");
    expect(PostManager.store.firstCall.args[0].thumbnailUrl).to.equal(
      "http://f/img",
    );
    expect(res.thumbnailUrl).to.equal("http://f/img");
  });

  it("addAttachment appends the ref", async () => {
    PostManager.getById.resolves(post({ attachments: [{ id: "a0" }] }));
    const ref = {
      id: "a1",
      filename: "x.pdf",
      url: "http://f/x.pdf",
      size: 10,
    };
    const res = await PostService.addAttachment(T, "p1", ref);
    expect(PostManager.store.firstCall.args[0].attachments).to.have.length(2);
    expect(res.attachments[1].id).to.equal("a1");
  });

  it("removeAttachment → 404 for an unknown attachment, else removes + returns its url", async () => {
    PostManager.getById.resolves(
      post({ attachments: [{ id: "a1", url: "http://f/x.pdf" }] }),
    );
    let err;
    try {
      await PostService.removeAttachment(T, "p1", "nope");
    } catch (e) {
      err = e;
    }
    expect(err && err.status).to.equal(404);
    const res = await PostService.removeAttachment(T, "p1", "a1");
    expect(res.removedUrl).to.equal("http://f/x.pdf");
    expect(res.post.attachments).to.have.length(0);
  });
});

describe("PostController — admin authz", () => {
  let sandbox;
  let PostService;
  let CompanyController;
  let PostController;

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
    PostService = {
      listForAdmin: sandbox.stub().resolves([]),
      create: sandbox.stub().resolves({ id: "p1" }),
    };
    CompanyController = { isTenantAdmin: sandbox.stub().resolves(false) };
    mock("../../src/commons/services/post-service", PostService);
    mock(
      "../../src/platform/api/controllers/company-controller",
      CompanyController,
    );
    PostController = mock.reRequire(
      "../../src/platform/api/controllers/post-controller",
    );
  });

  afterEach(() => {
    sandbox.restore();
    mock.stopAll();
  });

  it("adminList → 403 for a non-admin", async () => {
    const r = res();
    await PostController.adminList(
      { params: { tenant: "kielregion" }, user: { id: "u@x.de" } },
      r,
    );
    expect(r.statusCode).to.equal(403);
    expect(PostService.listForAdmin.called).to.equal(false);
  });

  it("create → 201 for an admin", async () => {
    CompanyController.isTenantAdmin.resolves(true);
    const r = res();
    await PostController.create(
      {
        params: { tenant: "kielregion" },
        user: { id: "admin@x.de" },
        body: { title: "X" },
      },
      r,
    );
    expect(r.statusCode).to.equal(201);
    expect(PostService.create.calledOnce).to.equal(true);
  });
});

describe("PostController — company feed + media", () => {
  let sandbox;
  let PostService;
  let CompanyController;
  let CompanyMemberManager;
  let Nextcloud;
  let PostController;

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
    params: { tenant: "kielregion", id: "p1" },
    user: { id: "u@x.de" },
    ...over,
  });

  const withFile = (file, over = {}) => req({ files: { file }, ...over });

  beforeEach(() => {
    sandbox = sinon.createSandbox();
    PostService = {
      listForCompanyDashboard: sandbox.stub().resolves([{ slug: "s1" }]),
      getAdminById: sandbox
        .stub()
        .resolves({ id: "p1", thumbnailUrl: "", attachments: [] }),
      setThumbnail: sandbox.stub().resolves({ id: "p1", thumbnailUrl: "u" }),
      addAttachment: sandbox
        .stub()
        .resolves({ id: "p1", attachments: [{ id: "a1" }] }),
      removeAttachment: sandbox.stub().resolves({
        removedUrl:
          "http://b/api/kielregion/files/get?name=/public/post-media/f.pdf",
        post: { id: "p1", attachments: [] },
      }),
    };
    CompanyController = { isTenantAdmin: sandbox.stub().resolves(false) };
    CompanyMemberManager = { getMemberByUser: sandbox.stub().resolves(null) };
    Nextcloud = {
      NextcloudManager: {
        createFile: sandbox.stub().resolves(),
        deleteFile: sandbox.stub().resolves(),
      },
    };
    mock("../../src/commons/services/post-service", PostService);
    mock(
      "../../src/platform/api/controllers/company-controller",
      CompanyController,
    );
    mock(
      "../../src/commons/data-managers/company-member-manager",
      CompanyMemberManager,
    );
    mock("../../src/commons/data-managers/file-manager", Nextcloud);
    PostController = mock.reRequire(
      "../../src/platform/api/controllers/post-controller",
    );
  });

  afterEach(() => {
    sandbox.restore();
    mock.stopAll();
  });

  it("companyList → 403 for a non-member, non-admin", async () => {
    const r = res();
    await PostController.companyList(req(), r);
    expect(r.statusCode).to.equal(403);
    expect(PostService.listForCompanyDashboard.called).to.equal(false);
  });

  it("companyList → 200 for a company member", async () => {
    CompanyMemberManager.getMemberByUser.resolves({ companyId: "c1" });
    const r = res();
    await PostController.companyList(req(), r);
    expect(r.statusCode).to.equal(200);
    expect(PostService.listForCompanyDashboard.calledOnce).to.equal(true);
  });

  it("companyList → 200 for an admin without a membership lookup", async () => {
    CompanyController.isTenantAdmin.resolves(true);
    const r = res();
    await PostController.companyList(req(), r);
    expect(r.statusCode).to.equal(200);
    expect(CompanyMemberManager.getMemberByUser.called).to.equal(false);
  });

  it("uploadThumbnail → 403 for a non-admin", async () => {
    const r = res();
    await PostController.uploadThumbnail(
      withFile({
        name: "a.png",
        mimetype: "image/png",
        data: Buffer.from([1]),
      }),
      r,
    );
    expect(r.statusCode).to.equal(403);
  });

  it("uploadThumbnail → 400 for a non-image", async () => {
    CompanyController.isTenantAdmin.resolves(true);
    const r = res();
    await PostController.uploadThumbnail(
      withFile({
        name: "a.txt",
        mimetype: "text/plain",
        data: Buffer.from([1]),
      }),
      r,
    );
    expect(r.statusCode).to.equal(400);
  });

  it("uploadThumbnail → 413 when too large", async () => {
    CompanyController.isTenantAdmin.resolves(true);
    const r = res();
    await PostController.uploadThumbnail(
      withFile({
        name: "a.png",
        mimetype: "image/png",
        data: { length: 9 * 1024 * 1024 },
      }),
      r,
    );
    expect(r.statusCode).to.equal(413);
  });

  it("uploadThumbnail → 200 stores the file + sets the url", async () => {
    CompanyController.isTenantAdmin.resolves(true);
    const r = res();
    await PostController.uploadThumbnail(
      withFile({
        name: "a.png",
        mimetype: "image/png",
        data: Buffer.from([1, 2, 3]),
      }),
      r,
    );
    expect(Nextcloud.NextcloudManager.createFile.calledOnce).to.equal(true);
    expect(PostService.setThumbnail.calledOnce).to.equal(true);
    expect(r.statusCode).to.equal(200);
  });

  it("uploadAttachment → 400 for a non-PDF (mimetype/magic-byte mismatch)", async () => {
    CompanyController.isTenantAdmin.resolves(true);
    const r = res();
    await PostController.uploadAttachment(
      withFile({
        name: "a.txt",
        mimetype: "text/plain",
        data: Buffer.from("hello"),
      }),
      r,
    );
    expect(r.statusCode).to.equal(400);
    expect(Nextcloud.NextcloudManager.createFile.called).to.equal(false);
  });

  it("uploadAttachment → 201 for a valid PDF", async () => {
    CompanyController.isTenantAdmin.resolves(true);
    const r = res();
    await PostController.uploadAttachment(
      withFile({
        name: "cv.pdf",
        mimetype: "application/pdf",
        data: Buffer.from("%PDF-1.4 body"),
      }),
      r,
    );
    expect(Nextcloud.NextcloudManager.createFile.calledOnce).to.equal(true);
    expect(PostService.addAttachment.calledOnce).to.equal(true);
    expect(r.statusCode).to.equal(201);
  });

  it("removeAttachment → deletes the Nextcloud file + returns 200", async () => {
    CompanyController.isTenantAdmin.resolves(true);
    const r = res();
    await PostController.removeAttachment(
      req({ params: { tenant: "kielregion", id: "p1", attId: "a1" } }),
      r,
    );
    expect(Nextcloud.NextcloudManager.deleteFile.calledOnce).to.equal(true);
    expect(r.statusCode).to.equal(200);
  });
});
