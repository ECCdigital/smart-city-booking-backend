const mock = require("mock-require");
const { expect } = require("chai");
const sinon = require("sinon");

describe("OfferController", () => {
  let sandbox;
  let CompanyController;
  let OfferService;
  let OfferManager;
  let NextcloudManager;
  let OfferController;

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
    params: { tenant: "kg", id: "c1", offerId: "o1", mediaId: "m1" },
    query: {},
    body: {},
    user: { id: "u1" },
    ...over,
  });

  beforeEach(() => {
    sandbox = sinon.createSandbox();
    CompanyController = {
      isMemberOrAdmin: sandbox.stub().resolves(true),
      canEditBranch: sandbox.stub().resolves(true),
      isTenantAdmin: sandbox.stub().resolves(true),
      getBranchAccess: sandbox.stub().resolves({ isAdmin: true, member: null }),
      hasAdminPermission: sandbox.stub().resolves(true),
      _memberBranchScope: sandbox.stub().returns(null),
    };
    OfferService = {
      getCompanyOffers: sandbox.stub().resolves([]),
      getCompanyOffer: sandbox.stub().resolves({ id: "o1" }),
      getCompanyStats: sandbox.stub().resolves({}),
      createOffer: sandbox.stub().resolves({ id: "o1" }),
      updateOffer: sandbox.stub().resolves({ id: "o1" }),
      deleteOffer: sandbox.stub().resolves({ removed: "o1" }),
      searchPublicOffers: sandbox.stub().resolves([]),
      getPublicOffer: sandbox.stub().resolves({ id: "o1" }),
      listForModeration: sandbox.stub().resolves([]),
      approveOffer: sandbox.stub().resolves({ id: "o1" }),
      rejectOffer: sandbox.stub().resolves({ id: "o1" }),
      deactivateOffer: sandbox.stub().resolves({ id: "o1" }),
      reactivateOffer: sandbox.stub().resolves({ id: "o1" }),
      archiveOffer: sandbox.stub().resolves({ id: "o1" }),
      reactivateCompanyOffer: sandbox.stub().resolves({ id: "o1" }),
      listOfferMedia: sandbox.stub().resolves([]),
      addOfferMedia: sandbox.stub().resolves({ id: "m1" }),
      removeOfferMedia: sandbox.stub().resolves({
        id: "m1",
        url: "http://x/api/kg/files/get?name=/public/offer-media/f",
      }),
    };
    OfferManager = {
      getOffer: sandbox
        .stub()
        .resolves({ id: "o1", companyId: "c1", branchId: "b1" }),
    };
    NextcloudManager = {
      createFile: sandbox.stub().resolves(),
      deleteFile: sandbox.stub().resolves(),
    };

    mock(
      "../../src/platform/api/controllers/company-controller",
      CompanyController,
    );
    mock("../../src/commons/services/company/offer-service", OfferService);
    mock("../../src/commons/data-managers/offer-manager", OfferManager);
    mock("../../src/commons/data-managers/file-manager", { NextcloudManager });
    OfferController = mock.reRequire(
      "../../src/platform/api/controllers/offer-controller",
    );
  });

  afterEach(() => {
    sandbox.restore();
    mock.stopAll();
  });

  describe("authorization", () => {
    it("listOffers -> 403 for a non-member/non-admin", async () => {
      CompanyController.getBranchAccess.resolves({
        isAdmin: false,
        member: null,
      });
      const r = res();
      await OfferController.listOffers(req(), r);
      expect(r.statusCode).to.equal(403);
      expect(OfferService.getCompanyOffers.called).to.equal(false);
    });

    it("listOffers -> 200 for a member", async () => {
      const r = res();
      await OfferController.listOffers(req(), r);
      expect(r.statusCode).to.equal(200);
    });

    it("listOffers -> a branch-scoped member only sees their branch", async () => {
      CompanyController.getBranchAccess.resolves({
        isAdmin: false,
        member: { branchId: "b1" },
      });
      CompanyController._memberBranchScope.returns("b1");
      const r = res();
      await OfferController.listOffers(req(), r);
      expect(r.statusCode).to.equal(200);
      expect(
        OfferService.getCompanyOffers.calledWith("kg", "c1", "b1"),
      ).to.equal(true);
    });

    it("getOffer -> 404 for a branch-scoped member reading another branch's offer", async () => {
      CompanyController.getBranchAccess.resolves({
        isAdmin: false,
        member: { branchId: "b1" },
      });
      CompanyController._memberBranchScope.returns("b1");
      OfferService.getCompanyOffer.resolves({ id: "o1", branchId: "b2" });
      const r = res();
      await OfferController.getOffer(req(), r);
      expect(r.statusCode).to.equal(404);
    });

    it("getStats -> a branch-scoped member's stats are forced to their branch", async () => {
      CompanyController.getBranchAccess.resolves({
        isAdmin: false,
        member: { branchId: "b1" },
      });
      CompanyController._memberBranchScope.returns("b1");
      const r = res();
      await OfferController.getStats(req({ query: { branchId: "b2" } }), r);
      expect(r.statusCode).to.equal(200);
      expect(OfferService.getCompanyStats.firstCall.args[2].branchId).to.equal(
        "b1",
      );
    });

    it("listMedia -> 404 for a branch-scoped member reading another branch's offer", async () => {
      CompanyController.getBranchAccess.resolves({
        isAdmin: false,
        member: { branchId: "b1" },
      });
      CompanyController._memberBranchScope.returns("b1");
      OfferManager.getOffer.resolves({
        id: "o1",
        companyId: "c1",
        branchId: "b2",
      });
      const r = res();
      await OfferController.listMedia(req(), r);
      expect(r.statusCode).to.equal(404);
    });

    it("createOffer -> 403 without branch edit rights", async () => {
      CompanyController.canEditBranch.resolves(false);
      const r = res();
      await OfferController.createOffer(req({ body: { branchId: "b1" } }), r);
      expect(r.statusCode).to.equal(403);
      expect(OfferService.createOffer.called).to.equal(false);
    });

    it("createOffer -> 201 and forwards the body", async () => {
      const r = res();
      await OfferController.createOffer(req({ body: { title: "X" } }), r);
      expect(r.statusCode).to.equal(201);
      expect(OfferService.createOffer.calledWith("kg", "c1")).to.equal(true);
    });

    it("updateOffer -> 404 when the offer doesn't exist", async () => {
      OfferManager.getOffer.resolves(null);
      const r = res();
      await OfferController.updateOffer(req(), r);
      expect(r.statusCode).to.equal(404);
    });

    it("updateOffer -> 404 when the offer belongs to another company", async () => {
      OfferManager.getOffer.resolves({ id: "o1", companyId: "other" });
      const r = res();
      await OfferController.updateOffer(req(), r);
      expect(r.statusCode).to.equal(404);
    });

    it("updateOffer -> 403 without branch edit rights", async () => {
      CompanyController.canEditBranch.resolves(false);
      const r = res();
      await OfferController.updateOffer(req(), r);
      expect(r.statusCode).to.equal(403);
      expect(OfferService.updateOffer.called).to.equal(false);
    });

    it('updateOffer -> 403 when a branch member moves the offer to company-level ("")', async () => {
      // Can edit their own branch (b1) but NOT company-level ("").
      CompanyController.canEditBranch.callsFake(
        async (userId, tenant, company, branchId) => branchId === "b1",
      );
      const r = res();
      await OfferController.updateOffer(req({ body: { branchId: "" } }), r);
      expect(r.statusCode).to.equal(403);
      expect(OfferService.updateOffer.called).to.equal(false);
    });

    it("listModeration -> 403 for a non-admin", async () => {
      CompanyController.isTenantAdmin.resolves(false);
      const r = res();
      await OfferController.listModeration(req(), r);
      expect(r.statusCode).to.equal(403);
    });

    it("listModeration forwards pagination + sort to the service", async () => {
      await OfferController.listModeration(
        req({
          query: { limit: "10", offset: "20", sort: "views", dir: "asc" },
        }),
        res(),
      );
      const filters = OfferService.listForModeration.firstCall.args[1];
      expect(filters.limit).to.equal(10);
      expect(filters.offset).to.equal(20);
      expect(filters.sort).to.equal("views");
      expect(filters.dir).to.equal("asc");
    });

    it("listModeration defaults dir to desc and only sorts when paginating", async () => {
      await OfferController.listModeration(
        req({ query: { limit: "10", dir: "sideways", sort: "views" } }),
        res(),
      );
      expect(OfferService.listForModeration.firstCall.args[1].dir).to.equal(
        "desc",
      );

      await OfferController.listModeration(
        req({ query: { sort: "views" } }),
        res(),
      );
      const full = OfferService.listForModeration.secondCall.args[1];
      expect(full.limit).to.equal(undefined);
      expect(full.sort).to.equal(undefined);
    });

    it("approveOffer -> 403 for a non-admin, 200 for an admin", async () => {
      CompanyController.isTenantAdmin.resolves(false);
      const r1 = res();
      await OfferController.approveOffer(req(), r1);
      expect(r1.statusCode).to.equal(403);
      CompanyController.isTenantAdmin.resolves(true);
      const r2 = res();
      await OfferController.approveOffer(req(), r2);
      expect(r2.statusCode).to.equal(200);
    });

    it("createOffer -> enforces the offers:create permission", async () => {
      const r = res();
      await OfferController.createOffer(req({ body: { title: "X" } }), r);
      expect(r.statusCode).to.equal(201);
      expect(CompanyController.hasAdminPermission.firstCall.args[3]).to.equal(
        "offers:create",
      );
    });

    it("createOffer -> 403 for an admin lacking offers:create (service untouched)", async () => {
      CompanyController.hasAdminPermission.resolves(false);
      const r = res();
      await OfferController.createOffer(req({ body: { title: "X" } }), r);
      expect(r.statusCode).to.equal(403);
      expect(OfferService.createOffer.called).to.equal(false);
    });

    it("updateOffer -> 403 for an admin lacking offers:edit", async () => {
      CompanyController.hasAdminPermission.resolves(false);
      const r = res();
      await OfferController.updateOffer(req(), r);
      expect(r.statusCode).to.equal(403);
      expect(OfferService.updateOffer.called).to.equal(false);
    });

    it("deleteOffer -> 403 for an admin lacking offers:delete", async () => {
      CompanyController.hasAdminPermission.resolves(false);
      const r = res();
      await OfferController.deleteOffer(req(), r);
      expect(r.statusCode).to.equal(403);
      expect(OfferService.deleteOffer.called).to.equal(false);
    });

    it("archiveOffer -> 403 for an admin lacking offers:edit", async () => {
      OfferManager.getOffer.resolves({
        id: "o1",
        companyId: "c1",
        branchId: "b1",
        status: "Online",
      });
      CompanyController.hasAdminPermission.resolves(false);
      const r = res();
      await OfferController.archiveOffer(req(), r);
      expect(r.statusCode).to.equal(403);
      expect(OfferService.archiveOffer.called).to.equal(false);
    });

    it("offer media upload -> 403 for an admin lacking offers:edit, before any upload", async () => {
      CompanyController.hasAdminPermission.resolves(false);
      const r = res();
      await OfferController.uploadMedia(
        req({
          files: {
            file: {
              name: "logo.png",
              mimetype: "image/png",
              data: Buffer.from("abc"),
            },
          },
        }),
        r,
      );
      expect(r.statusCode).to.equal(403);
      expect(NextcloudManager.createFile.called).to.equal(false);
    });
  });

  describe("searchOffers query coercion", () => {
    it("coerces filters to strings and builds a geo radius (km -> m)", async () => {
      const r = res();
      await OfferController.searchOffers(
        req({
          query: {
            industryId: "industry-it",
            city: "Kiel",
            q: "foo",
            age: "16",
            lat: "54.3",
            lng: "10.1",
            radius: "30",
          },
        }),
        r,
      );
      expect(r.statusCode).to.equal(200);
      const f = OfferService.searchPublicOffers.firstCall.args[1];
      expect(f.industryId).to.equal("industry-it");
      expect(f.city).to.equal("Kiel");
      expect(f.minAge).to.equal(16);
      expect(f.lat).to.equal(54.3);
      expect(f.lng).to.equal(10.1);
      expect(f.radiusMeters).to.equal(30000);
    });

    it("drops geo when radius is missing", async () => {
      const r = res();
      await OfferController.searchOffers(
        req({ query: { lat: "54.3", lng: "10.1" } }),
        r,
      );
      const f = OfferService.searchPublicOffers.firstCall.args[1];
      expect(f.lat).to.equal(undefined);
      expect(f.radiusMeters).to.equal(undefined);
    });

    it("passes the company-name filter through", async () => {
      const r = res();
      await OfferController.searchOffers(
        req({ query: { company: "Nordlicht" } }),
        r,
      );
      const f = OfferService.searchPublicOffers.firstCall.args[1];
      expect(f.company).to.equal("Nordlicht");
    });

    it("stringifies an operator-injection attempt ($ne) instead of passing the object", async () => {
      const r = res();
      await OfferController.searchOffers(
        req({ query: { industryId: { $ne: null } } }),
        r,
      );
      const f = OfferService.searchPublicOffers.firstCall.args[1];
      expect(f.industryId).to.be.a("string");
    });
  });

  describe("media upload validation", () => {
    it("400 when no file is attached", async () => {
      const r = res();
      await OfferController.uploadMedia(req({ files: undefined }), r);
      expect(r.statusCode).to.equal(400);
    });

    it("400 for a non-image/non-video file", async () => {
      const r = res();
      await OfferController.uploadMedia(
        req({
          files: {
            file: {
              name: "x.txt",
              mimetype: "text/plain",
              data: Buffer.from("x"),
            },
          },
        }),
        r,
      );
      expect(r.statusCode).to.equal(400);
    });

    it("413 for an oversize image", async () => {
      const r = res();
      await OfferController.uploadMedia(
        req({
          files: {
            file: {
              name: "big.png",
              mimetype: "image/png",
              data: { length: 9 * 1024 * 1024 },
            },
          },
        }),
        r,
      );
      expect(r.statusCode).to.equal(413);
      expect(NextcloudManager.createFile.called).to.equal(false);
    });

    it("201 happy path stores the file and the media row", async () => {
      const r = res();
      await OfferController.uploadMedia(
        req({
          files: {
            file: {
              name: "logo.png",
              mimetype: "image/png",
              data: Buffer.from("abc"),
            },
          },
        }),
        r,
      );
      expect(r.statusCode).to.equal(201);
      expect(NextcloudManager.createFile.calledOnce).to.equal(true);
      expect(OfferService.addOfferMedia.calledOnce).to.equal(true);
    });
  });

  describe("Nextcloud file cleanup", () => {
    it("removeMedia deletes the underlying file (name parsed from the url)", async () => {
      const r = res();
      await OfferController.removeMedia(req(), r);
      expect(r.statusCode).to.equal(200);
      expect(
        NextcloudManager.deleteFile.calledWith("kg", "/public/offer-media/f"),
      ).to.equal(true);
    });

    it("deleteOffer deletes every media file then the offer", async () => {
      OfferService.listOfferMedia.resolves([
        { url: "http://x/api/kg/files/get?name=/public/offer-media/a" },
        { url: "http://x/api/kg/files/get?name=/public/offer-media/b" },
      ]);
      const r = res();
      await OfferController.deleteOffer(req(), r);
      expect(r.statusCode).to.equal(200);
      expect(NextcloudManager.deleteFile.callCount).to.equal(2);
      expect(OfferService.deleteOffer.calledOnce).to.equal(true);
    });
  });

  describe("company archive + archived lock", () => {
    it("archiveOffer -> 200 for an authorized company manager", async () => {
      OfferManager.getOffer.resolves({
        id: "o1",
        companyId: "c1",
        branchId: "b1",
        status: "Online",
      });
      const r = res();
      await OfferController.archiveOffer(req(), r);
      expect(r.statusCode).to.equal(200);
      expect(OfferService.archiveOffer.calledWith("kg", "c1", "o1")).to.equal(
        true,
      );
    });

    it("archiveOffer -> 404 for another company's offer", async () => {
      OfferManager.getOffer.resolves({ id: "o1", companyId: "other" });
      const r = res();
      await OfferController.archiveOffer(req(), r);
      expect(r.statusCode).to.equal(404);
    });

    it("archiveOffer -> 403 without branch edit rights", async () => {
      CompanyController.canEditBranch.resolves(false);
      const r = res();
      await OfferController.archiveOffer(req(), r);
      expect(r.statusCode).to.equal(403);
      expect(OfferService.archiveOffer.called).to.equal(false);
    });

    it("reactivateCompanyOffer -> 200 for an authorized company manager", async () => {
      OfferManager.getOffer.resolves({
        id: "o1",
        companyId: "c1",
        branchId: "b1",
        status: "Archiv",
      });
      CompanyController.isTenantAdmin.resolves(false);
      const r = res();
      await OfferController.reactivateCompanyOffer(req(), r);
      expect(r.statusCode).to.equal(200);
      expect(
        OfferService.reactivateCompanyOffer.calledWith("kg", "c1", "o1"),
      ).to.equal(true);
    });

    it("reactivateCompanyOffer -> 404 for another company's offer", async () => {
      OfferManager.getOffer.resolves({ id: "o1", companyId: "other" });
      const r = res();
      await OfferController.reactivateCompanyOffer(req(), r);
      expect(r.statusCode).to.equal(404);
      expect(OfferService.reactivateCompanyOffer.called).to.equal(false);
    });

    it("reactivateCompanyOffer -> 403 without branch edit rights", async () => {
      CompanyController.canEditBranch.resolves(false);
      const r = res();
      await OfferController.reactivateCompanyOffer(req(), r);
      expect(r.statusCode).to.equal(403);
      expect(OfferService.reactivateCompanyOffer.called).to.equal(false);
    });

    it("updateOffer -> 403 on an archived offer for a non-admin", async () => {
      OfferManager.getOffer.resolves({
        id: "o1",
        companyId: "c1",
        branchId: "b1",
        status: "Archiv",
      });
      CompanyController.isTenantAdmin.resolves(false);
      const r = res();
      await OfferController.updateOffer(req(), r);
      expect(r.statusCode).to.equal(403);
      expect(OfferService.updateOffer.called).to.equal(false);
    });

    it("updateOffer -> 200 on an archived offer for an admin", async () => {
      OfferManager.getOffer.resolves({
        id: "o1",
        companyId: "c1",
        branchId: "b1",
        status: "Archiv",
      });
      const r = res();
      await OfferController.updateOffer(req(), r);
      expect(r.statusCode).to.equal(200);
    });

    it("deleteOffer -> 200 on an archived offer for the company (owner/member), not admin-only", async () => {
      OfferManager.getOffer.resolves({
        id: "o1",
        companyId: "c1",
        branchId: "b1",
        status: "Archiv",
      });
      CompanyController.isTenantAdmin.resolves(false);
      const r = res();
      await OfferController.deleteOffer(req(), r);
      expect(r.statusCode).to.equal(200);
      expect(OfferService.deleteOffer.calledWith("kg", "c1", "o1")).to.equal(
        true,
      );
    });
  });
});
