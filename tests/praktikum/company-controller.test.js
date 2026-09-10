const mock = require("mock-require");
const { expect } = require("chai");
const sinon = require("sinon");

describe("CompanyController — authz & handlers", () => {
  let sandbox;
  let AdminAccessService;
  let CompanyMemberManager;
  let CompanyService;
  let CompanyManager;
  let NextcloudManager;
  let CompanyController;

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
    params: { tenant: "kielregion", id: "c1", ...(over.params || {}) },
    user: { id: "u1" },
    body: over.body || {},
    files: over.files || {},
    query: over.query || {},
  });

  const asAdmin = () => AdminAccessService.isAdmin.resolves(true);
  const asOwnerOf = (cid) =>
    CompanyMemberManager.getMemberByUser.resolves({
      companyId: cid,
      isOwner: true,
    });
  const asMemberOf = (cid) =>
    CompanyMemberManager.getMemberByUser.resolves({
      companyId: cid,
      isOwner: false,
    });

  beforeEach(() => {
    sandbox = sinon.createSandbox();
    AdminAccessService = {
      isAdmin: sandbox.stub().resolves(false),
      hasPermission: sandbox.stub().resolves(true),
    };
    CompanyMemberManager = { getMemberByUser: sandbox.stub().resolves(null) };
    CompanyService = {
      updateCompanyProfile: sandbox.stub().resolves({ id: "c1" }),
      setCompanyLogo: sandbox.stub().resolves({ id: "c1" }),
      removeCompanyLogo: sandbox.stub().resolves({ id: "c1" }),
      getCompanyMedia: sandbox.stub().resolves([]),
      addCompanyMedia: sandbox.stub().resolves({ id: "m1" }),
      removeCompanyMedia: sandbox
        .stub()
        .resolves({ id: "m1", fileName: "public/media/x" }),
      getCompanyBranches: sandbox.stub().resolves([]),
      getCompanyBranch: sandbox.stub().resolves({ id: "b1", logoUrl: "" }),
      createCompanyBranch: sandbox.stub().resolves({ id: "b1" }),
      updateCompanyBranch: sandbox.stub().resolves({ id: "b1" }),
      removeCompanyBranch: sandbox.stub().resolves({ id: "b1", logoUrl: "" }),
      setBranchLogo: sandbox.stub().resolves({ id: "b1" }),
      removeBranchLogo: sandbox.stub().resolves({ id: "b1", logoUrl: "" }),
      inviteMember: sandbox
        .stub()
        .resolves({ userId: "m@x.de", status: "pending" }),
      listCompanyMembers: sandbox.stub().resolves([]),
      removeCompanyMember: sandbox.stub().resolves({ removed: "m@x.de" }),
      acceptMemberInvitation: sandbox
        .stub()
        .resolves({ companyId: "c1", userId: "m@x.de" }),
      unverifyCompany: sandbox
        .stub()
        .resolves({ id: "c1", status: "unverified" }),
      adminCreateCompany: sandbox.stub().resolves({
        company: { id: "c9", status: "verified" },
        invitation: { email: "owner@x.de", isOwner: true },
      }),
      adminDeleteCompany: sandbox.stub().resolves({ deleted: "c1" }),
    };
    CompanyManager = {
      getCompany: sandbox
        .stub()
        .resolves({ id: "c1", status: "verified", logoUrl: "" }),
    };
    NextcloudManager = {
      createFile: sandbox.stub().resolves(),
      deleteFile: sandbox.stub().resolves(),
    };

    mock(
      "../../src/commons/services/admin-access/admin-access-service",
      AdminAccessService,
    );
    mock(
      "../../src/commons/data-managers/company-member-manager",
      CompanyMemberManager,
    );
    mock("../../src/commons/services/company/company-service", CompanyService);
    mock("../../src/commons/data-managers/company-manager", CompanyManager);
    mock("../../src/commons/data-managers/file-manager", { NextcloudManager });

    CompanyController = mock.reRequire(
      "../../src/platform/api/controllers/company-controller",
    );
  });

  afterEach(() => {
    sandbox.restore();
    mock.stopAll();
  });

  describe("updateProfile — permission matrix", () => {
    it("owner of the company can edit (200)", async () => {
      asOwnerOf("c1");
      const r = res();
      await CompanyController.updateProfile(req({ body: { name: "X" } }), r);
      expect(r.statusCode).to.equal(200);
      expect(CompanyService.updateCompanyProfile.calledOnce).to.equal(true);
    });

    it("tenant admin can edit (200)", async () => {
      asAdmin();
      const r = res();
      await CompanyController.updateProfile(req(), r);
      expect(r.statusCode).to.equal(200);
    });

    it("owner of ANOTHER company cannot edit this one (403)", async () => {
      asOwnerOf("other-company");
      const r = res();
      await CompanyController.updateProfile(req(), r);
      expect(r.statusCode).to.equal(403);
      expect(CompanyService.updateCompanyProfile.called).to.equal(false);
    });

    it("an all-scope member (branchId '') can edit (200)", async () => {
      CompanyMemberManager.getMemberByUser.resolves({
        companyId: "c1",
        isOwner: false,
        branchId: "",
      });
      const r = res();
      await CompanyController.updateProfile(req(), r);
      expect(r.statusCode).to.equal(200);
    });

    it("a branch-scoped member cannot edit (403)", async () => {
      CompanyMemberManager.getMemberByUser.resolves({
        companyId: "c1",
        isOwner: false,
        branchId: "b1",
      });
      const r = res();
      await CompanyController.updateProfile(req(), r);
      expect(r.statusCode).to.equal(403);
    });

    it("a stranger (no membership) cannot edit (403)", async () => {
      const r = res();
      await CompanyController.updateProfile(req(), r);
      expect(r.statusCode).to.equal(403);
    });

    it("surfaces a service validation error (400)", async () => {
      asAdmin();
      CompanyService.updateCompanyProfile.rejects({
        status: 400,
        message: "x",
      });
      const r = res();
      await CompanyController.updateProfile(req(), r);
      expect(r.statusCode).to.equal(400);
    });
  });

  describe("listMedia — member or admin may read", () => {
    it("a member (even non-owner) of the company can list (200)", async () => {
      asMemberOf("c1");
      const r = res();
      await CompanyController.listMedia(req(), r);
      expect(r.statusCode).to.equal(200);
    });

    it("a member of another company cannot (403)", async () => {
      asMemberOf("other-company");
      const r = res();
      await CompanyController.listMedia(req(), r);
      expect(r.statusCode).to.equal(403);
    });
  });

  describe("uploadLogo — authz + file validation", () => {
    it("cross-company owner is rejected before upload (403)", async () => {
      asOwnerOf("other-company");
      const r = res();
      await CompanyController.uploadLogo(
        req({ files: { file: { name: "l.png", data: Buffer.from("x") } } }),
        r,
      );
      expect(r.statusCode).to.equal(403);
      expect(NextcloudManager.createFile.called).to.equal(false);
    });

    it("missing file is rejected (400)", async () => {
      asAdmin();
      const r = res();
      await CompanyController.uploadLogo(req({ files: {} }), r);
      expect(r.statusCode).to.equal(400);
    });

    it("path-traversal filename is rejected (400)", async () => {
      asAdmin();
      const r = res();
      await CompanyController.uploadLogo(
        req({
          files: { file: { name: "../evil.png", data: Buffer.from("x") } },
        }),
        r,
      );
      expect(r.statusCode).to.equal(400);
    });
  });

  describe("removeMedia — authz + file deletion", () => {
    it("cross-company owner is rejected (403)", async () => {
      asOwnerOf("other-company");
      const r = res();
      await CompanyController.removeMedia(
        req({ params: { mediaId: "m1" } }),
        r,
      );
      expect(r.statusCode).to.equal(403);
      expect(CompanyService.removeCompanyMedia.called).to.equal(false);
      expect(NextcloudManager.deleteFile.called).to.equal(false);
    });

    it("owner removes media (200) and deletes the file", async () => {
      asOwnerOf("c1");
      const r = res();
      await CompanyController.removeMedia(
        req({ params: { mediaId: "m1" } }),
        r,
      );
      expect(r.statusCode).to.equal(200);
      expect(NextcloudManager.deleteFile.calledOnce).to.equal(true);
    });
  });

  describe("getPublicCompany", () => {
    it("verified company → 200 with media embedded", async () => {
      CompanyManager.getCompany.resolves({ id: "c1", status: "verified" });
      CompanyService.getCompanyMedia.resolves([
        { id: "m1", url: "http://x/m1.png", type: "image", created: 1 },
      ]);
      const r = res();
      await CompanyController.getPublicCompany(req(), r);
      expect(r.statusCode).to.equal(200);
      expect(r.body.media).to.have.length(1);
      expect(r.body.media[0]).to.have.property("url", "http://x/m1.png");
    });

    it("embeds the company's branches (Standorte)", async () => {
      CompanyManager.getCompany.resolves({ id: "c1", status: "verified" });
      CompanyService.getCompanyBranches.resolves([
        {
          id: "b1",
          companyId: "c1",
          name: "Hauptsitz",
          city: "Kiel",
          lat: 54.3,
          lng: 10.1,
          logoUrl: "",
        },
      ]);
      const r = res();
      await CompanyController.getPublicCompany(req(), r);
      expect(r.statusCode).to.equal(200);
      expect(r.body.branches).to.have.length(1);
      expect(r.body.branches[0]).to.include({
        id: "b1",
        name: "Hauptsitz",
        city: "Kiel",
      });
    });

    it("unverified company → 404", async () => {
      CompanyManager.getCompany.resolves({ id: "c1", status: "unverified" });
      const r = res();
      await CompanyController.getPublicCompany(req(), r);
      expect(r.statusCode).to.equal(404);
    });

    it("missing company → 404", async () => {
      CompanyManager.getCompany.resolves(null);
      const r = res();
      await CompanyController.getPublicCompany(req(), r);
      expect(r.statusCode).to.equal(404);
    });

    it("returns a public DTO without status/tenantId or internal media fileName", async () => {
      CompanyManager.getCompany.resolves({
        id: "c1",
        tenantId: "kielregion",
        name: "Muster GmbH",
        status: "verified",
        mail: "info@muster.de",
        logoUrl: "http://x/l.png",
        description: "hi",
      });
      CompanyService.getCompanyMedia.resolves([
        {
          id: "m1",
          tenantId: "kielregion",
          companyId: "c1",
          url: "http://x/m1.png",
          fileName: "public/media/secret.png",
          type: "image",
          created: 5,
        },
      ]);
      const r = res();
      await CompanyController.getPublicCompany(req(), r);
      expect(r.statusCode).to.equal(200);
      expect(r.body).to.not.have.property("status");
      expect(r.body).to.not.have.property("tenantId");
      expect(r.body.name).to.equal("Muster GmbH");
      expect(r.body.media).to.have.length(1);
      expect(r.body.media[0]).to.have.property("url", "http://x/m1.png");
      expect(r.body.media[0]).to.have.property("type", "image");
      expect(r.body.media[0]).to.have.property("created", 5);
      expect(r.body.media[0]).to.not.have.property("fileName");
      expect(r.body.media[0]).to.not.have.property("companyId");
      expect(r.body.media[0]).to.not.have.property("tenantId");
    });

    it("exposes acceptsUnsolicitedApplications (Initiativbewerbung opt-in)", async () => {
      CompanyManager.getCompany.resolves({
        id: "c1",
        status: "verified",
        name: "Muster GmbH",
        acceptsUnsolicitedApplications: true,
      });
      const r = res();
      await CompanyController.getPublicCompany(req(), r);
      expect(r.statusCode).to.equal(200);
      expect(r.body.acceptsUnsolicitedApplications).to.equal(true);
    });
  });

  describe("getUnsolicitedCompanies", () => {
    it("returns public summaries of verified opt-in companies", async () => {
      CompanyManager.getCompanies = sandbox.stub().resolves([
        {
          id: "c1",
          name: "A",
          slug: "a",
          logoUrl: "l",
          industryId: "i",
          city: "Kiel",
          districtId: "d",
          mail: "secret@x.de",
          status: "verified",
          acceptsUnsolicitedApplications: true,
        },
      ]);
      const r = res();
      await CompanyController.getUnsolicitedCompanies(req(), r);
      expect(r.statusCode).to.equal(200);
      expect(CompanyManager.getCompanies.firstCall.args[1]).to.deep.equal({
        status: "verified",
        acceptsUnsolicitedApplications: true,
      });
      expect(r.body).to.have.length(1);
      expect(r.body[0]).to.deep.equal({
        id: "c1",
        name: "A",
        slug: "a",
        logoUrl: "l",
        industryId: "i",
        city: "Kiel",
        districtId: "d",
      });
      expect(r.body[0]).to.not.have.property("mail");
      expect(r.body[0]).to.not.have.property("status");
    });
  });

  describe("getMyContext — role detection for redirect", () => {
    it("tenant admin → role admin", async () => {
      asAdmin();
      const r = res();
      await CompanyController.getMyContext(req(), r);
      expect(r.statusCode).to.equal(200);
      expect(r.body).to.deep.equal({
        role: "admin",
        companyId: null,
        isOwner: false,
        branchId: "",
      });
    });

    it("admin who is ALSO a company member → admin wins", async () => {
      asAdmin();
      CompanyMemberManager.getMemberByUser.resolves({
        companyId: "c1",
        isOwner: true,
        branchId: "",
      });
      const r = res();
      await CompanyController.getMyContext(req(), r);
      expect(r.body.role).to.equal("admin");
      expect(r.body.companyId).to.equal(null);
    });

    it("company owner → role company_owner with companyId", async () => {
      CompanyMemberManager.getMemberByUser.resolves({
        companyId: "c1",
        isOwner: true,
        branchId: "",
      });
      const r = res();
      await CompanyController.getMyContext(req(), r);
      expect(r.body.role).to.equal("company_owner");
      expect(r.body.companyId).to.equal("c1");
      expect(r.body.isOwner).to.equal(true);
    });

    it("company member → role company_member with branch scope", async () => {
      CompanyMemberManager.getMemberByUser.resolves({
        companyId: "c1",
        isOwner: false,
        branchId: "b1",
      });
      const r = res();
      await CompanyController.getMyContext(req(), r);
      expect(r.body.role).to.equal("company_member");
      expect(r.body.isOwner).to.equal(false);
      expect(r.body.branchId).to.equal("b1");
    });

    it("no admin and no membership → role student", async () => {
      const r = res();
      await CompanyController.getMyContext(req(), r);
      expect(r.body).to.deep.equal({
        role: "student",
        companyId: null,
        isOwner: false,
        branchId: "",
      });
    });
  });

  describe("branches — CRUD authz", () => {
    const asBranchMember = (cid, branchId) =>
      CompanyMemberManager.getMemberByUser.resolves({
        companyId: cid,
        isOwner: false,
        branchId,
      });

    describe("list / get (read = any member or admin)", () => {
      it("a member can list (200)", async () => {
        asMemberOf("c1");
        const r = res();
        await CompanyController.listBranches(req(), r);
        expect(r.statusCode).to.equal(200);
      });

      it("an admin can list (200)", async () => {
        asAdmin();
        const r = res();
        await CompanyController.listBranches(req(), r);
        expect(r.statusCode).to.equal(200);
      });

      it("a branch-scoped member sees only their own branch", async () => {
        asBranchMember("c1", "b1");
        CompanyService.getCompanyBranches.resolves([
          { id: "b1" },
          { id: "b2" },
        ]);
        const r = res();
        await CompanyController.listBranches(req(), r);
        expect(r.statusCode).to.equal(200);
        expect(r.body).to.deep.equal([{ id: "b1" }]);
      });

      it("an all-scope member sees all branches", async () => {
        asBranchMember("c1", "");
        CompanyService.getCompanyBranches.resolves([
          { id: "b1" },
          { id: "b2" },
        ]);
        const r = res();
        await CompanyController.listBranches(req(), r);
        expect(r.statusCode).to.equal(200);
        expect(r.body).to.have.length(2);
      });

      it("a stranger cannot list (403)", async () => {
        const r = res();
        await CompanyController.listBranches(req(), r);
        expect(r.statusCode).to.equal(403);
        expect(CompanyService.getCompanyBranches.called).to.equal(false);
      });

      it("a member of another company cannot list (403)", async () => {
        asMemberOf("other-company");
        const r = res();
        await CompanyController.listBranches(req(), r);
        expect(r.statusCode).to.equal(403);
        expect(CompanyService.getCompanyBranches.called).to.equal(false);
      });

      it("an all-scope member gets any branch (200)", async () => {
        asBranchMember("c1", "");
        const r = res();
        await CompanyController.getBranch(
          req({ params: { branchId: "b1" } }),
          r,
        );
        expect(r.statusCode).to.equal(200);
      });

      it("a branch-scoped member gets OWN branch (200)", async () => {
        asBranchMember("c1", "b1");
        const r = res();
        await CompanyController.getBranch(
          req({ params: { branchId: "b1" } }),
          r,
        );
        expect(r.statusCode).to.equal(200);
      });

      it("a branch-scoped member cannot get ANOTHER branch (403)", async () => {
        asBranchMember("c1", "b2");
        const r = res();
        await CompanyController.getBranch(
          req({ params: { branchId: "b1" } }),
          r,
        );
        expect(r.statusCode).to.equal(403);
        expect(CompanyService.getCompanyBranch.called).to.equal(false);
      });

      it("a member of another company cannot get one (403)", async () => {
        asMemberOf("other-company");
        const r = res();
        await CompanyController.getBranch(
          req({ params: { branchId: "b1" } }),
          r,
        );
        expect(r.statusCode).to.equal(403);
        expect(CompanyService.getCompanyBranch.called).to.equal(false);
      });

      it("surfaces a service 404 for an unknown branch", async () => {
        asOwnerOf("c1");
        CompanyService.getCompanyBranch.rejects({
          status: 404,
          message: "Branch not found",
        });
        const r = res();
        await CompanyController.getBranch(
          req({ params: { branchId: "x" } }),
          r,
        );
        expect(r.statusCode).to.equal(404);
      });
    });

    describe("create (owner / admin / all-scope member)", () => {
      it("owner creates (201) and the body is forwarded + result returned", async () => {
        asOwnerOf("c1");
        const r = res();
        await CompanyController.createBranch(req({ body: { name: "X" } }), r);
        expect(r.statusCode).to.equal(201);
        expect(
          CompanyService.createCompanyBranch.calledWith("kielregion", "c1", {
            name: "X",
          }),
        ).to.equal(true);
        expect(r.body).to.deep.equal({ id: "b1" });
      });

      it("admin creates (201)", async () => {
        asAdmin();
        const r = res();
        await CompanyController.createBranch(req({ body: { name: "X" } }), r);
        expect(r.statusCode).to.equal(201);
      });

      it("an all-scope member (branchId '') creates (201)", async () => {
        asBranchMember("c1", "");
        const r = res();
        await CompanyController.createBranch(req({ body: { name: "X" } }), r);
        expect(r.statusCode).to.equal(201);
      });

      it("a branch-scoped member cannot create (403)", async () => {
        asBranchMember("c1", "b1");
        const r = res();
        await CompanyController.createBranch(req({ body: { name: "X" } }), r);
        expect(r.statusCode).to.equal(403);
        expect(CompanyService.createCompanyBranch.called).to.equal(false);
      });

      it("a member of another company cannot create (403)", async () => {
        asOwnerOf("other-company");
        const r = res();
        await CompanyController.createBranch(req({ body: { name: "X" } }), r);
        expect(r.statusCode).to.equal(403);
        expect(CompanyService.createCompanyBranch.called).to.equal(false);
      });
    });

    describe("update (owner / admin / all-scope member / matching branch-scoped member)", () => {
      it("owner edits any branch (200)", async () => {
        asOwnerOf("c1");
        const r = res();
        await CompanyController.updateBranch(
          req({ params: { branchId: "b1" }, body: { name: "X" } }),
          r,
        );
        expect(r.statusCode).to.equal(200);
      });

      it("admin edits any branch (200)", async () => {
        asAdmin();
        const r = res();
        await CompanyController.updateBranch(
          req({ params: { branchId: "b1" } }),
          r,
        );
        expect(r.statusCode).to.equal(200);
      });

      it("an all-scope member (branchId '') edits any branch (200)", async () => {
        asBranchMember("c1", "");
        const r = res();
        await CompanyController.updateBranch(
          req({ params: { branchId: "b1" } }),
          r,
        );
        expect(r.statusCode).to.equal(200);
      });

      it("a branch-scoped member edits OWN branch (200)", async () => {
        asBranchMember("c1", "b1");
        const r = res();
        await CompanyController.updateBranch(
          req({ params: { branchId: "b1" } }),
          r,
        );
        expect(r.statusCode).to.equal(200);
      });

      it("a branch-scoped member cannot edit ANOTHER branch (403)", async () => {
        asBranchMember("c1", "b2");
        const r = res();
        await CompanyController.updateBranch(
          req({ params: { branchId: "b1" } }),
          r,
        );
        expect(r.statusCode).to.equal(403);
        expect(CompanyService.updateCompanyBranch.called).to.equal(false);
      });

      it("the OWNER of another company cannot edit this company's branch (403)", async () => {
        asOwnerOf("other-company");
        const r = res();
        await CompanyController.updateBranch(
          req({ params: { branchId: "b1" } }),
          r,
        );
        expect(r.statusCode).to.equal(403);
        expect(CompanyService.updateCompanyBranch.called).to.equal(false);
      });

      it("a member of another company cannot edit this company's branch (403)", async () => {
        asMemberOf("other-company");
        const r = res();
        await CompanyController.updateBranch(
          req({ params: { branchId: "b1" } }),
          r,
        );
        expect(r.statusCode).to.equal(403);
        expect(CompanyService.updateCompanyBranch.called).to.equal(false);
      });
    });

    describe("delete (owner / admin / all-scope member)", () => {
      it("owner deletes (200) and returns { id }", async () => {
        asOwnerOf("c1");
        const r = res();
        await CompanyController.removeBranch(
          req({ params: { branchId: "b1" } }),
          r,
        );
        expect(r.statusCode).to.equal(200);
        expect(
          CompanyService.removeCompanyBranch.calledWith(
            "kielregion",
            "c1",
            "b1",
          ),
        ).to.equal(true);
        expect(r.body).to.deep.equal({ id: "b1" });
      });

      it("an all-scope member (branchId '') deletes (200)", async () => {
        asBranchMember("c1", "");
        const r = res();
        await CompanyController.removeBranch(
          req({ params: { branchId: "b1" } }),
          r,
        );
        expect(r.statusCode).to.equal(200);
      });

      it("a branch-scoped member cannot delete (403)", async () => {
        asBranchMember("c1", "b1");
        const r = res();
        await CompanyController.removeBranch(
          req({ params: { branchId: "b1" } }),
          r,
        );
        expect(r.statusCode).to.equal(403);
        expect(CompanyService.removeCompanyBranch.called).to.equal(false);
      });

      it("a member of another company cannot delete (403)", async () => {
        asOwnerOf("other-company");
        const r = res();
        await CompanyController.removeBranch(
          req({ params: { branchId: "b1" } }),
          r,
        );
        expect(r.statusCode).to.equal(403);
        expect(CompanyService.removeCompanyBranch.called).to.equal(false);
      });

      it("surfaces the last-branch 409 from the service", async () => {
        asOwnerOf("c1");
        CompanyService.removeCompanyBranch.rejects({
          status: 409,
          message: "x",
        });
        const r = res();
        await CompanyController.removeBranch(
          req({ params: { branchId: "b1" } }),
          r,
        );
        expect(r.statusCode).to.equal(409);
      });
    });

    describe("branch logo (canEditBranch)", () => {
      const imgFile = (over = {}) => ({
        file: {
          name: "logo.png",
          mimetype: "image/png",
          data: Buffer.from("x"),
          ...over,
        },
      });

      it("a branch-scoped member uploads OWN branch logo (200), deleting the old file after the new one is stored", async () => {
        asBranchMember("c1", "b1");
        CompanyService.getCompanyBranch.resolves({
          id: "b1",
          logoUrl:
            "http://x/api/kielregion/files/get?name=/public/branch-logos/b1-old.png",
        });
        const r = res();
        await CompanyController.uploadBranchLogo(
          req({ params: { branchId: "b1" }, files: imgFile() }),
          r,
        );
        expect(r.statusCode).to.equal(200);
        expect(
          NextcloudManager.createFile.firstCall.args[0].file.name,
        ).to.equal("b1-logo.png");
        expect(
          NextcloudManager.createFile.firstCall.args[0].subFolder,
        ).to.equal("public/branch-logos");
        expect(
          NextcloudManager.deleteFile.calledWith(
            "kielregion",
            "/public/branch-logos/b1-old.png",
          ),
        ).to.equal(true);
        expect(
          NextcloudManager.deleteFile.calledAfter(NextcloudManager.createFile),
        ).to.equal(true);
        expect(CompanyService.setBranchLogo.calledOnce).to.equal(true);
      });

      it("an oversized branch logo → 413", async () => {
        asOwnerOf("c1");
        const r = res();
        await CompanyController.uploadBranchLogo(
          req({
            params: { branchId: "b1" },
            files: imgFile({ data: { length: 9 * 1024 * 1024 } }),
          }),
          r,
        );
        expect(r.statusCode).to.equal(413);
        expect(NextcloudManager.createFile.called).to.equal(false);
      });

      it("a path-traversal branch logo filename → 400", async () => {
        asOwnerOf("c1");
        const r = res();
        await CompanyController.uploadBranchLogo(
          req({
            params: { branchId: "b1" },
            files: imgFile({ name: "../evil.png" }),
          }),
          r,
        );
        expect(r.statusCode).to.equal(400);
        expect(NextcloudManager.createFile.called).to.equal(false);
      });

      it("a missing branch logo file → 400", async () => {
        asOwnerOf("c1");
        const r = res();
        await CompanyController.uploadBranchLogo(
          req({ params: { branchId: "b1" }, files: {} }),
          r,
        );
        expect(r.statusCode).to.equal(400);
        expect(NextcloudManager.createFile.called).to.equal(false);
      });

      it("a branch-scoped member cannot upload ANOTHER branch logo (403)", async () => {
        asBranchMember("c1", "b2");
        const r = res();
        await CompanyController.uploadBranchLogo(
          req({ params: { branchId: "b1" }, files: imgFile() }),
          r,
        );
        expect(r.statusCode).to.equal(403);
        expect(NextcloudManager.createFile.called).to.equal(false);
      });

      it("a non-image branch logo is rejected (400)", async () => {
        asOwnerOf("c1");
        const r = res();
        await CompanyController.uploadBranchLogo(
          req({
            params: { branchId: "b1" },
            files: imgFile({ mimetype: "application/pdf" }),
          }),
          r,
        );
        expect(r.statusCode).to.equal(400);
      });

      it("the OWNER of another company cannot upload a branch logo here (403)", async () => {
        asOwnerOf("other-company");
        const r = res();
        await CompanyController.uploadBranchLogo(
          req({ params: { branchId: "b1" }, files: imgFile() }),
          r,
        );
        expect(r.statusCode).to.equal(403);
        expect(NextcloudManager.createFile.called).to.equal(false);
      });

      it("a branch-scoped member removes OWN branch logo (200)", async () => {
        asBranchMember("c1", "b1");
        const r = res();
        await CompanyController.removeBranchLogo(
          req({ params: { branchId: "b1" } }),
          r,
        );
        expect(r.statusCode).to.equal(200);
        expect(CompanyService.removeBranchLogo.calledOnce).to.equal(true);
      });

      it("a branch-scoped member cannot remove ANOTHER branch logo (403)", async () => {
        asBranchMember("c1", "b2");
        const r = res();
        await CompanyController.removeBranchLogo(
          req({ params: { branchId: "b1" } }),
          r,
        );
        expect(r.statusCode).to.equal(403);
        expect(CompanyService.removeBranchLogo.called).to.equal(false);
      });

      it("a member of another company cannot remove a branch logo here (403)", async () => {
        asOwnerOf("other-company");
        const r = res();
        await CompanyController.removeBranchLogo(
          req({ params: { branchId: "b1" } }),
          r,
        );
        expect(r.statusCode).to.equal(403);
        expect(CompanyService.removeBranchLogo.called).to.equal(false);
      });
    });
  });

  describe("members — invite / list / remove / accept authz", () => {
    describe("invite (owner / admin / all-scope / own-branch member)", () => {
      const asBranchMember = (cid, branchId) =>
        CompanyMemberManager.getMemberByUser.resolves({
          companyId: cid,
          isOwner: false,
          branchId,
        });

      it("owner invites (201)", async () => {
        asOwnerOf("c1");
        const r = res();
        await CompanyController.inviteMember(
          req({ body: { email: "m@x.de", firstName: "M", lastName: "X" } }),
          r,
        );
        expect(r.statusCode).to.equal(201);
        expect(CompanyService.inviteMember.calledOnce).to.equal(true);
      });

      it("admin invites (201)", async () => {
        asAdmin();
        const r = res();
        await CompanyController.inviteMember(req({ body: {} }), r);
        expect(r.statusCode).to.equal(201);
      });

      it("an all-scope member (branchId '') invites into any branch (201)", async () => {
        asBranchMember("c1", "");
        const r = res();
        await CompanyController.inviteMember(
          req({ body: { email: "m@x.de", branchId: "b1" } }),
          r,
        );
        expect(r.statusCode).to.equal(201);
      });

      it("a branch-scoped member invites into their OWN branch (201)", async () => {
        asBranchMember("c1", "b1");
        const r = res();
        await CompanyController.inviteMember(
          req({ body: { email: "m@x.de", branchId: "b1" } }),
          r,
        );
        expect(r.statusCode).to.equal(201);
      });

      it("a branch-scoped member cannot invite into ANOTHER branch (403)", async () => {
        asBranchMember("c1", "b1");
        const r = res();
        await CompanyController.inviteMember(
          req({ body: { email: "m@x.de", branchId: "b2" } }),
          r,
        );
        expect(r.statusCode).to.equal(403);
        expect(CompanyService.inviteMember.called).to.equal(false);
      });

      it("a branch-scoped member cannot invite an all-scope member (403)", async () => {
        asBranchMember("c1", "b1");
        const r = res();
        await CompanyController.inviteMember(
          req({ body: { email: "m@x.de" } }),
          r,
        );
        expect(r.statusCode).to.equal(403);
        expect(CompanyService.inviteMember.called).to.equal(false);
      });

      it("a member of another company cannot invite (403)", async () => {
        asOwnerOf("other-company");
        const r = res();
        await CompanyController.inviteMember(req({ body: {} }), r);
        expect(r.statusCode).to.equal(403);
        expect(CompanyService.inviteMember.called).to.equal(false);
      });

      it("a stranger cannot invite (403)", async () => {
        const r = res();
        await CompanyController.inviteMember(req({ body: {} }), r);
        expect(r.statusCode).to.equal(403);
      });
    });

    describe("list (member or admin)", () => {
      it("a member can list (200)", async () => {
        asMemberOf("c1");
        const r = res();
        await CompanyController.listMembers(req(), r);
        expect(r.statusCode).to.equal(200);
      });

      it("a branch-scoped member sees only own-branch members", async () => {
        CompanyMemberManager.getMemberByUser.resolves({
          companyId: "c1",
          isOwner: false,
          branchId: "b1",
        });
        CompanyService.listCompanyMembers.resolves([
          { userId: "owner@x.de", branchId: "" },
          { userId: "a@x.de", branchId: "b1" },
          { userId: "b@x.de", branchId: "b2" },
        ]);
        const r = res();
        await CompanyController.listMembers(req(), r);
        expect(r.statusCode).to.equal(200);
        expect(r.body).to.deep.equal([{ userId: "a@x.de", branchId: "b1" }]);
      });

      it("an all-scope member sees all members", async () => {
        CompanyMemberManager.getMemberByUser.resolves({
          companyId: "c1",
          isOwner: false,
          branchId: "",
        });
        CompanyService.listCompanyMembers.resolves([
          { userId: "a@x.de", branchId: "b1" },
          { userId: "b@x.de", branchId: "b2" },
        ]);
        const r = res();
        await CompanyController.listMembers(req(), r);
        expect(r.statusCode).to.equal(200);
        expect(r.body).to.have.length(2);
      });

      it("a stranger cannot list (403)", async () => {
        const r = res();
        await CompanyController.listMembers(req(), r);
        expect(r.statusCode).to.equal(403);
        expect(CompanyService.listCompanyMembers.called).to.equal(false);
      });

      it("a member of another company cannot list (403)", async () => {
        asMemberOf("other-company");
        const r = res();
        await CompanyController.listMembers(req(), r);
        expect(r.statusCode).to.equal(403);
      });
    });

    describe("remove (owner / admin / all-scope / own-branch member)", () => {
      it("owner removes a member (200), no branch scope", async () => {
        asOwnerOf("c1");
        const r = res();
        await CompanyController.removeMember(
          req({ params: { userId: "m@x.de" } }),
          r,
        );
        expect(r.statusCode).to.equal(200);
        expect(r.body).to.deep.equal({ removed: "m@x.de" });
        expect(
          CompanyService.removeCompanyMember.calledWith(
            "kielregion",
            "c1",
            "m@x.de",
            null,
          ),
        ).to.equal(true);
      });

      it("an all-scope member (branchId '') removes a member (200), no branch scope", async () => {
        CompanyMemberManager.getMemberByUser.resolves({
          companyId: "c1",
          isOwner: false,
          branchId: "",
        });
        const r = res();
        await CompanyController.removeMember(
          req({ params: { userId: "m@x.de" } }),
          r,
        );
        expect(r.statusCode).to.equal(200);
        expect(
          CompanyService.removeCompanyMember.calledWith(
            "kielregion",
            "c1",
            "m@x.de",
            null,
          ),
        ).to.equal(true);
      });

      it("a branch-scoped member remove forwards its branch scope to the service", async () => {
        CompanyMemberManager.getMemberByUser.resolves({
          companyId: "c1",
          isOwner: false,
          branchId: "b1",
        });
        const r = res();
        await CompanyController.removeMember(
          req({ params: { userId: "m@x.de" } }),
          r,
        );
        expect(r.statusCode).to.equal(200);
        expect(
          CompanyService.removeCompanyMember.calledWith(
            "kielregion",
            "c1",
            "m@x.de",
            "b1",
          ),
        ).to.equal(true);
      });

      it("a member of another company cannot remove (403)", async () => {
        asOwnerOf("other-company");
        const r = res();
        await CompanyController.removeMember(
          req({ params: { userId: "m@x.de" } }),
          r,
        );
        expect(r.statusCode).to.equal(403);
        expect(CompanyService.removeCompanyMember.called).to.equal(false);
      });

      it("surfaces the owner-cannot-be-removed 403 from the service", async () => {
        asOwnerOf("c1");
        CompanyService.removeCompanyMember.rejects({
          status: 403,
          message: "The company owner cannot be removed",
        });
        const r = res();
        await CompanyController.removeMember(
          req({ params: { userId: "owner@x.de" } }),
          r,
        );
        expect(r.statusCode).to.equal(403);
      });
    });

    describe("accept (public, token)", () => {
      it("accepts an invitation (200)", async () => {
        const r = res();
        await CompanyController.acceptInvitation(
          req({ params: { token: "tok" }, body: { password: "secret123" } }),
          r,
        );
        expect(r.statusCode).to.equal(200);
        expect(r.body).to.deep.equal({ companyId: "c1", userId: "m@x.de" });
      });

      it("surfaces a 404 for an invalid token", async () => {
        CompanyService.acceptMemberInvitation.rejects({
          status: 404,
          message: "Invalid or expired invitation",
        });
        const r = res();
        await CompanyController.acceptInvitation(
          req({ params: { token: "bad" }, body: { password: "secret123" } }),
          r,
        );
        expect(r.statusCode).to.equal(404);
      });
    });
  });

  describe("getCompany — authenticated detail (IDOR)", () => {
    it("missing company → 404", async () => {
      CompanyManager.getCompany.resolves(null);
      const r = res();
      await CompanyController.getCompany(req(), r);
      expect(r.statusCode).to.equal(404);
    });

    it("a stranger (no membership) → 403", async () => {
      const r = res();
      await CompanyController.getCompany(req(), r);
      expect(r.statusCode).to.equal(403);
    });

    it("a member of ANOTHER company → 403", async () => {
      asMemberOf("other-company");
      const r = res();
      await CompanyController.getCompany(req(), r);
      expect(r.statusCode).to.equal(403);
    });

    it("a member of this company → 200", async () => {
      asMemberOf("c1");
      const r = res();
      await CompanyController.getCompany(req(), r);
      expect(r.statusCode).to.equal(200);
    });

    it("a tenant admin (not a member) → 200", async () => {
      asAdmin();
      const r = res();
      await CompanyController.getCompany(req(), r);
      expect(r.statusCode).to.equal(200);
    });
  });

  describe("uploadLogo — happy path + content validation", () => {
    const imgFile = (over = {}) => ({
      file: {
        name: "logo.png",
        mimetype: "image/png",
        data: Buffer.from("x"),
        ...over,
      },
    });

    it("owner uploads → 200, file stored under public/logos, setCompanyLogo called", async () => {
      asOwnerOf("c1");
      const r = res();
      await CompanyController.uploadLogo(req({ files: imgFile() }), r);
      expect(r.statusCode).to.equal(200);
      expect(NextcloudManager.createFile.calledOnce).to.equal(true);
      expect(NextcloudManager.createFile.firstCall.args[0].file.name).to.equal(
        "c1-logo.png",
      );
      expect(NextcloudManager.createFile.firstCall.args[0].subFolder).to.equal(
        "public/logos",
      );
      expect(CompanyService.setCompanyLogo.calledOnce).to.equal(true);
    });

    it("deletes the previous logo file after storing the new one", async () => {
      asOwnerOf("c1");
      CompanyManager.getCompany.resolves({
        id: "c1",
        logoUrl:
          "http://x/api/kielregion/files/get?name=/public/logos/c1-old.png",
      });
      const r = res();
      await CompanyController.uploadLogo(req({ files: imgFile() }), r);
      expect(r.statusCode).to.equal(200);
      expect(
        NextcloudManager.deleteFile.calledWith(
          "kielregion",
          "/public/logos/c1-old.png",
        ),
      ).to.equal(true);
      expect(
        NextcloudManager.deleteFile.calledAfter(NextcloudManager.createFile),
      ).to.equal(true);
    });

    it("404 when the company does not exist", async () => {
      asAdmin();
      CompanyManager.getCompany.resolves(null);
      const r = res();
      await CompanyController.uploadLogo(req({ files: imgFile() }), r);
      expect(r.statusCode).to.equal(404);
    });

    it("non-image mimetype → 400 before upload", async () => {
      asAdmin();
      const r = res();
      await CompanyController.uploadLogo(
        req({ files: imgFile({ mimetype: "application/pdf" }) }),
        r,
      );
      expect(r.statusCode).to.equal(400);
      expect(NextcloudManager.createFile.called).to.equal(false);
    });

    it("oversized image → 413 before upload", async () => {
      asAdmin();
      const r = res();
      await CompanyController.uploadLogo(
        req({ files: imgFile({ data: { length: 9 * 1024 * 1024 } }) }),
        r,
      );
      expect(r.statusCode).to.equal(413);
      expect(NextcloudManager.createFile.called).to.equal(false);
    });
  });

  describe("uploadMedia", () => {
    const mediaFile = (over = {}) => ({
      file: {
        name: "shot.png",
        mimetype: "image/png",
        data: Buffer.from("x"),
        ...over,
      },
    });

    it("owner uploads an image → 201, stored under public/media, type image", async () => {
      asOwnerOf("c1");
      const r = res();
      await CompanyController.uploadMedia(req({ files: mediaFile() }), r);
      expect(r.statusCode).to.equal(201);
      expect(NextcloudManager.createFile.firstCall.args[0].subFolder).to.equal(
        "public/media",
      );
      expect(CompanyService.addCompanyMedia.firstCall.args[2].type).to.equal(
        "image",
      );
    });

    it("a video mimetype → type video", async () => {
      asOwnerOf("c1");
      const r = res();
      await CompanyController.uploadMedia(
        req({ files: mediaFile({ name: "clip.mp4", mimetype: "video/mp4" }) }),
        r,
      );
      expect(r.statusCode).to.equal(201);
      expect(CompanyService.addCompanyMedia.firstCall.args[2].type).to.equal(
        "video",
      );
    });

    it("cross-company owner → 403 before upload", async () => {
      asOwnerOf("other-company");
      const r = res();
      await CompanyController.uploadMedia(req({ files: mediaFile() }), r);
      expect(r.statusCode).to.equal(403);
      expect(NextcloudManager.createFile.called).to.equal(false);
    });

    it("missing file → 400", async () => {
      asOwnerOf("c1");
      const r = res();
      await CompanyController.uploadMedia(req({ files: {} }), r);
      expect(r.statusCode).to.equal(400);
    });

    it("a non-image/non-video mimetype → 400", async () => {
      asOwnerOf("c1");
      const r = res();
      await CompanyController.uploadMedia(
        req({ files: mediaFile({ mimetype: "application/zip" }) }),
        r,
      );
      expect(r.statusCode).to.equal(400);
      expect(NextcloudManager.createFile.called).to.equal(false);
    });

    it("an oversized video → 413", async () => {
      asOwnerOf("c1");
      const r = res();
      await CompanyController.uploadMedia(
        req({
          files: mediaFile({
            name: "clip.mp4",
            mimetype: "video/mp4",
            data: { length: 200 * 1024 * 1024 },
          }),
        }),
        r,
      );
      expect(r.statusCode).to.equal(413);
      expect(NextcloudManager.createFile.called).to.equal(false);
    });

    it("an oversized image → 413", async () => {
      asOwnerOf("c1");
      const r = res();
      await CompanyController.uploadMedia(
        req({ files: mediaFile({ data: { length: 9 * 1024 * 1024 } }) }),
        r,
      );
      expect(r.statusCode).to.equal(413);
      expect(NextcloudManager.createFile.called).to.equal(false);
    });

    it("404 (no file written) when the company does not exist", async () => {
      asAdmin();
      CompanyManager.getCompany.resolves(null);
      const r = res();
      await CompanyController.uploadMedia(req({ files: mediaFile() }), r);
      expect(r.statusCode).to.equal(404);
      expect(NextcloudManager.createFile.called).to.equal(false);
    });
  });

  describe("removeLogo", () => {
    it("owner removes the logo → 200, deletes the file and clears the url", async () => {
      asOwnerOf("c1");
      CompanyManager.getCompany.resolves({
        id: "c1",
        logoUrl:
          "http://x/api/kielregion/files/get?name=/public/logos/c1-logo.png",
      });
      const r = res();
      await CompanyController.removeLogo(req(), r);
      expect(r.statusCode).to.equal(200);
      expect(
        NextcloudManager.deleteFile.calledWith(
          "kielregion",
          "/public/logos/c1-logo.png",
        ),
      ).to.equal(true);
      expect(CompanyService.removeCompanyLogo.calledOnce).to.equal(true);
    });

    it("404 when the company does not exist", async () => {
      asAdmin();
      CompanyManager.getCompany.resolves(null);
      const r = res();
      await CompanyController.removeLogo(req(), r);
      expect(r.statusCode).to.equal(404);
    });

    it("cross-company owner → 403", async () => {
      asOwnerOf("other-company");
      const r = res();
      await CompanyController.removeLogo(req(), r);
      expect(r.statusCode).to.equal(403);
    });
  });

  describe("removeMedia — file deletion details", () => {
    it("deletes the exact stored fileName", async () => {
      asOwnerOf("c1");
      const r = res();
      await CompanyController.removeMedia(
        req({ params: { mediaId: "m1" } }),
        r,
      );
      expect(
        NextcloudManager.deleteFile.calledWith("kielregion", "public/media/x"),
      ).to.equal(true);
    });

    it("still returns 200 when the Nextcloud delete fails", async () => {
      asOwnerOf("c1");
      NextcloudManager.deleteFile.rejects(new Error("boom"));
      const r = res();
      await CompanyController.removeMedia(
        req({ params: { mediaId: "m1" } }),
        r,
      );
      expect(r.statusCode).to.equal(200);
      expect(r.body).to.deep.equal({ id: "m1" });
    });

    it("skips the delete when the media has no fileName", async () => {
      asOwnerOf("c1");
      CompanyService.removeCompanyMedia.resolves({ id: "m1", fileName: "" });
      const r = res();
      await CompanyController.removeMedia(
        req({ params: { mediaId: "m1" } }),
        r,
      );
      expect(r.statusCode).to.equal(200);
      expect(NextcloudManager.deleteFile.called).to.equal(false);
    });
  });

  describe("listMedia — body + admin", () => {
    it("admin lists media → 200 with the array body", async () => {
      asAdmin();
      CompanyService.getCompanyMedia.resolves([{ id: "m1" }, { id: "m2" }]);
      const r = res();
      await CompanyController.listMedia(req(), r);
      expect(r.statusCode).to.equal(200);
      expect(r.body).to.have.length(2);
    });
  });

  describe("unverify", () => {
    it("→ 403 for a non-admin", async () => {
      const r = res();
      await CompanyController.unverify(req(), r);
      expect(r.statusCode).to.equal(403);
      expect(CompanyService.unverifyCompany.called).to.equal(false);
    });

    it("→ 200 for an admin and reverts the company", async () => {
      asAdmin();
      const r = res();
      await CompanyController.unverify(req(), r);
      expect(r.statusCode).to.equal(200);
      expect(CompanyService.unverifyCompany.calledOnce).to.equal(true);
    });
  });

  describe("adminCreate", () => {
    it("→ 403 for a non-admin", async () => {
      const r = res();
      await CompanyController.adminCreate(
        req({ body: { owner: {}, company: {} } }),
        r,
      );
      expect(r.statusCode).to.equal(403);
      expect(CompanyService.adminCreateCompany.called).to.equal(false);
    });

    it("→ 201 with the new id, status and owner invitation", async () => {
      asAdmin();
      const r = res();
      await CompanyController.adminCreate(
        req({ body: { owner: {}, company: {} } }),
        r,
      );
      expect(r.statusCode).to.equal(201);
      expect(r.body.id).to.equal("c9");
      expect(r.body.status).to.equal("verified");
      expect(r.body.invitation.isOwner).to.equal(true);
      expect(CompanyService.adminCreateCompany.calledOnce).to.equal(true);
    });
  });

  describe("adminDelete", () => {
    it("→ 403 for a non-admin", async () => {
      const r = res();
      await CompanyController.adminDelete(req(), r);
      expect(r.statusCode).to.equal(403);
      expect(CompanyService.adminDeleteCompany.called).to.equal(false);
    });

    it("→ 200 for an admin and force-deletes", async () => {
      asAdmin();
      const r = res();
      await CompanyController.adminDelete(req(), r);
      expect(r.statusCode).to.equal(200);
      expect(r.body.deleted).to.equal("c1");
      expect(CompanyService.adminDeleteCompany.calledOnce).to.equal(true);
    });
  });

  describe("granular admin permission gate (dual edit routes)", () => {
    it("updateProfile — an admin WITH companies:edit edits (200) and the permission is checked", async () => {
      asAdmin();
      AdminAccessService.hasPermission.resolves(true);
      const r = res();
      await CompanyController.updateProfile(req({ body: { name: "X" } }), r);
      expect(r.statusCode).to.equal(200);
      expect(
        AdminAccessService.hasPermission.calledWith(
          "u1",
          "kielregion",
          "companies:edit",
        ),
      ).to.equal(true);
    });

    it("updateProfile — an admin WITHOUT companies:edit is blocked (403), service untouched", async () => {
      asAdmin();
      AdminAccessService.hasPermission.resolves(false);
      const r = res();
      await CompanyController.updateProfile(req({ body: { name: "X" } }), r);
      expect(r.statusCode).to.equal(403);
      expect(CompanyService.updateCompanyProfile.called).to.equal(false);
    });

    it("updateProfile — a company owner is unaffected (200, permission not consulted)", async () => {
      asOwnerOf("c1");
      AdminAccessService.hasPermission.resolves(false);
      const r = res();
      await CompanyController.updateProfile(req({ body: { name: "X" } }), r);
      expect(r.statusCode).to.equal(200);
      expect(AdminAccessService.hasPermission.called).to.equal(false);
    });

    it("createBranch — an admin WITHOUT companies:edit is blocked (403)", async () => {
      asAdmin();
      AdminAccessService.hasPermission.resolves(false);
      const r = res();
      await CompanyController.createBranch(req({ body: { name: "X" } }), r);
      expect(r.statusCode).to.equal(403);
      expect(CompanyService.createCompanyBranch.called).to.equal(false);
    });

    it("removeBranch — an admin WITHOUT companies:edit is blocked (403)", async () => {
      asAdmin();
      AdminAccessService.hasPermission.resolves(false);
      const r = res();
      await CompanyController.removeBranch(
        req({ params: { branchId: "b1" } }),
        r,
      );
      expect(r.statusCode).to.equal(403);
      expect(CompanyService.removeCompanyBranch.called).to.equal(false);
    });

    it("updateBranch — an admin WITHOUT companies:edit is blocked (403)", async () => {
      asAdmin();
      AdminAccessService.hasPermission.resolves(false);
      const r = res();
      await CompanyController.updateBranch(
        req({ params: { branchId: "b1" } }),
        r,
      );
      expect(r.statusCode).to.equal(403);
      expect(CompanyService.updateCompanyBranch.called).to.equal(false);
    });

    it("updateBranch — a branch-scoped member is unaffected (200, permission not consulted)", async () => {
      CompanyMemberManager.getMemberByUser.resolves({
        companyId: "c1",
        isOwner: false,
        branchId: "b1",
      });
      AdminAccessService.hasPermission.resolves(false);
      const r = res();
      await CompanyController.updateBranch(
        req({ params: { branchId: "b1" } }),
        r,
      );
      expect(r.statusCode).to.equal(200);
      expect(AdminAccessService.hasPermission.called).to.equal(false);
    });

    it("uploadBranchLogo — an admin WITHOUT companies:edit is blocked before any upload (403)", async () => {
      asAdmin();
      AdminAccessService.hasPermission.resolves(false);
      const r = res();
      await CompanyController.uploadBranchLogo(
        req({
          params: { branchId: "b1" },
          files: {
            file: {
              name: "logo.png",
              mimetype: "image/png",
              data: Buffer.from("x"),
            },
          },
        }),
        r,
      );
      expect(r.statusCode).to.equal(403);
      expect(NextcloudManager.createFile.called).to.equal(false);
    });

    it("uploadMedia — an admin WITHOUT companies:edit is blocked before any upload (403)", async () => {
      asAdmin();
      AdminAccessService.hasPermission.resolves(false);
      const r = res();
      await CompanyController.uploadMedia(
        req({
          files: {
            file: {
              name: "shot.png",
              mimetype: "image/png",
              data: Buffer.from("x"),
            },
          },
        }),
        r,
      );
      expect(r.statusCode).to.equal(403);
      expect(NextcloudManager.createFile.called).to.equal(false);
    });

    it("removeLogo — an admin WITHOUT companies:edit is blocked (403)", async () => {
      asAdmin();
      AdminAccessService.hasPermission.resolves(false);
      const r = res();
      await CompanyController.removeLogo(req(), r);
      expect(r.statusCode).to.equal(403);
      expect(CompanyService.removeCompanyLogo.called).to.equal(false);
    });
  });
});
