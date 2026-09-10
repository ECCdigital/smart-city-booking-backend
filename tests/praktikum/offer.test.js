const mock = require("mock-require");
const { expect } = require("chai");
const sinon = require("sinon");

describe("OfferService", () => {
  let sandbox;
  let OfferManager;
  let OfferMediaManager;
  let OfferBookmarkManager;
  let CompanyManager;
  let CompanyBranchManager;
  let TaxonomyTermManager;
  let PlatformSettingsService;
  let ApplicationServiceMock;
  let ApplicationManagerMock;
  let OfferService;

  const branch = () => ({
    id: "b1",
    companyId: "c1",
    city: "Kiel",
    postalCode: "24103",
    districtId: "district-kiel",
    location: { type: "Point", coordinates: [10.13, 54.32] },
  });

  const basePayload = (overrides = {}) => ({
    title: "Fachinformatiker (m/w/d)",
    branchId: "b1",
    industryId: "industry-it",
    internshipTypeId: "internship_type-schulpraktikum",
    contactChannels: ["Per E-Mail"],
    ...overrides,
  });

  beforeEach(() => {
    sandbox = sinon.createSandbox();
    OfferManager = {
      getOffer: sandbox.stub().resolves(null),
      getOffersByCompany: sandbox.stub().resolves([]),
      storeOffer: sandbox.stub().callsFake(async (o) => o),
      removeOffer: sandbox.stub().resolves(),
      incrementViews: sandbox.stub().resolves(),
      searchOnline: sandbox.stub().resolves([]),
      listForModeration: sandbox.stub().resolves([]),
    };
    OfferMediaManager = {
      removeByOffer: sandbox.stub().resolves(),
      getMediaByOffer: sandbox.stub().resolves([]),
      getMedia: sandbox.stub().resolves(null),
      storeMedia: sandbox.stub().callsFake(async (m) => m),
      removeMedia: sandbox.stub().resolves(),
    };
    OfferBookmarkManager = {
      removeByOffer: sandbox.stub().resolves(),
    };
    CompanyManager = {
      getCompany: sandbox.stub().resolves({
        id: "c1",
        status: "verified",
        city: "Kiel",
        postalCode: "24103",
        districtId: "district-kiel",
        location: { type: "Point", coordinates: [9.99, 54.07] },
      }),
      getBlockedCompanyIds: sandbox.stub().resolves([]),
    };
    CompanyBranchManager = { getBranch: sandbox.stub().resolves(branch()) };
    TaxonomyTermManager = {
      getTerm: sandbox.stub().callsFake(async (t, id) => {
        if (!id) return null;
        if (id.startsWith("industry"))
          return { type: "industry", active: true };
        if (id.startsWith("internship_type"))
          return { type: "internship_type", active: true };
        return null;
      }),
    };
    PlatformSettingsService = {
      getSettings: sandbox.stub().resolves({ directPublishVerified: false }),
    };

    mock("../../src/commons/data-managers/offer-manager", OfferManager);
    mock(
      "../../src/commons/data-managers/offer-media-manager",
      OfferMediaManager,
    );
    mock(
      "../../src/commons/data-managers/offer-bookmark-manager",
      OfferBookmarkManager,
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
    mock(
      "../../src/commons/services/platform-settings-service",
      PlatformSettingsService,
    );
    ApplicationServiceMock = {
      deleteByOffer: sandbox.stub().resolves({ removed: 0 }),
    };
    mock(
      "../../src/commons/services/student/application-service",
      ApplicationServiceMock,
    );
    ApplicationManagerMock = {
      countByOffers: sandbox.stub().resolves({}),
    };
    mock(
      "../../src/commons/data-managers/application-manager",
      ApplicationManagerMock,
    );
    OfferService = mock.reRequire(
      "../../src/commons/services/company/offer-service",
    );
  });

  afterEach(() => {
    sandbox.restore();
    mock.stopAll();
  });

  const expectStatus = async (fn, status) => {
    let error;
    try {
      await fn();
    } catch (e) {
      error = e;
    }
    expect(error && error.status).to.equal(status);
  };

  describe("createOffer — validation", () => {
    it("rejects a missing title (400)", () =>
      expectStatus(
        () => OfferService.createOffer("kg", "c1", basePayload({ title: "" })),
        400,
      ));
    it("allows a missing branch and inherits the company address", async () => {
      const offer = await OfferService.createOffer(
        "kg",
        "c1",
        basePayload({ branchId: "" }),
      );
      const stored = OfferManager.storeOffer.firstCall.args[0];
      expect(stored.branchId).to.equal("");
      expect(stored.city).to.equal("Kiel");
      expect(stored.districtId).to.equal("district-kiel");
      expect(stored.location).to.deep.equal({
        type: "Point",
        coordinates: [9.99, 54.07],
      });
      expect(offer).to.exist;
    });
    it("rejects a branch of another company (400)", async () => {
      CompanyBranchManager.getBranch.resolves({
        ...branch(),
        companyId: "other",
      });
      await expectStatus(
        () => OfferService.createOffer("kg", "c1", basePayload()),
        400,
      );
    });
    it("rejects a missing industry (400)", () =>
      expectStatus(
        () =>
          OfferService.createOffer("kg", "c1", basePayload({ industryId: "" })),
        400,
      ));
    it("rejects when no contact channel is chosen (400)", () =>
      expectStatus(
        () =>
          OfferService.createOffer(
            "kg",
            "c1",
            basePayload({ contactChannels: [] }),
          ),
        400,
      ));
    it("requires an https link when the external channel is chosen (400)", () =>
      expectStatus(
        () =>
          OfferService.createOffer(
            "kg",
            "c1",
            basePayload({
              contactChannels: ["Externes Bewerbermanagementsystem"],
            }),
          ),
        400,
      ));
  });

  describe("createOffer — status + snapshot", () => {
    it("saves a draft as Entwurf and snapshots the branch location", async () => {
      const dto = await OfferService.createOffer(
        "kg",
        "c1",
        basePayload({ status: "Entwurf" }),
      );
      expect(dto.status).to.equal("Entwurf");
      expect(dto.city).to.equal("Kiel");
      expect(dto.districtId).to.equal("district-kiel");
      expect(dto.lat).to.equal(54.32);
      expect(dto.lng).to.equal(10.13);
      expect(dto.publishedAt).to.equal(null);
    });

    it("submits as In Prüfung when direct-publish is OFF", async () => {
      const dto = await OfferService.createOffer(
        "kg",
        "c1",
        basePayload({ status: "In Prüfung" }),
      );
      expect(dto.status).to.equal("In Prüfung");
      expect(dto.publishedAt).to.equal(null);
    });

    it("publishes directly when direct-publish is ON and the company is verified", async () => {
      PlatformSettingsService.getSettings.resolves({
        directPublishVerified: true,
      });
      const dto = await OfferService.createOffer(
        "kg",
        "c1",
        basePayload({ status: "In Prüfung" }),
      );
      expect(dto.status).to.equal("Online");
      expect(dto.publishedAt).to.be.a("number");
    });

    it("does NOT publish directly when direct-publish is ON but the company is unverified", async () => {
      PlatformSettingsService.getSettings.resolves({
        directPublishVerified: true,
      });
      CompanyManager.getCompany.resolves({ id: "c1", status: "unverified" });
      const dto = await OfferService.createOffer(
        "kg",
        "c1",
        basePayload({ status: "In Prüfung" }),
      );
      expect(dto.status).to.equal("In Prüfung");
    });

    it("never lets the client set Online directly", async () => {
      const dto = await OfferService.createOffer(
        "kg",
        "c1",
        basePayload({ status: "Online" }),
      );
      expect(dto.status).to.equal("Entwurf");
    });
  });

  describe("moderation", () => {
    it("approve: In Prüfung -> Online (sets publishedAt)", async () => {
      OfferManager.getOffer.resolves({
        id: "o1",
        companyId: "c1",
        status: "In Prüfung",
        publishedAt: null,
      });
      const dto = await OfferService.approveOffer("kg", "o1");
      expect(dto.status).to.equal("Online");
      expect(dto.publishedAt).to.be.a("number");
    });
    it("approve: only In Prüfung can be approved (409)", async () => {
      OfferManager.getOffer.resolves({ id: "o1", status: "Entwurf" });
      await expectStatus(() => OfferService.approveOffer("kg", "o1"), 409);
    });
    it("reject: requires a note (400)", async () => {
      OfferManager.getOffer.resolves({ id: "o1", status: "In Prüfung" });
      await expectStatus(() => OfferService.rejectOffer("kg", "o1", "  "), 400);
    });
    it("reject: In Prüfung -> Entwurf with the note", async () => {
      OfferManager.getOffer.resolves({ id: "o1", status: "In Prüfung" });
      const dto = await OfferService.rejectOffer("kg", "o1", "Mehr Details");
      expect(dto.status).to.equal("Entwurf");
      expect(dto.reviewNote).to.equal("Mehr Details");
    });
    it("deactivate: Online -> Archiv", async () => {
      OfferManager.getOffer.resolves({ id: "o1", status: "Online" });
      const dto = await OfferService.deactivateOffer("kg", "o1");
      expect(dto.status).to.equal("Archiv");
    });
    it("listForModeration: attaches applicationCount per offer (0 when none)", async () => {
      OfferManager.listForModeration.resolves([
        { id: "o1", companyId: "c1", status: "In Prüfung" },
        { id: "o2", companyId: "c1", status: "Online" },
      ]);
      ApplicationManagerMock.countByOffers.resolves({ o1: 3 });
      const list = await OfferService.listForModeration("kg", {});
      expect(ApplicationManagerMock.countByOffers.calledOnce).to.equal(true);
      expect(
        ApplicationManagerMock.countByOffers.firstCall.args[1],
      ).to.deep.equal(["o1", "o2"]);
      const byId = Object.fromEntries(
        list.map((o) => [o.id, o.applicationCount]),
      );
      expect(byId.o1).to.equal(3);
      expect(byId.o2).to.equal(0);
    });
    it("listForModeration paginated: returns { items, total } with counts", async () => {
      OfferManager.listForModeration.resolves({
        items: [{ id: "o1", companyId: "c1", status: "In Prüfung" }],
        total: 7,
      });
      ApplicationManagerMock.countByOffers.resolves({ o1: 2 });
      const res = await OfferService.listForModeration("kg", {
        limit: 10,
        offset: 0,
      });
      expect(res.total).to.equal(7);
      expect(res.items).to.have.length(1);
      expect(res.items[0].applicationCount).to.equal(2);
    });
    it("deactivate: only Online can be deactivated (409)", async () => {
      OfferManager.getOffer.resolves({ id: "o1", status: "Entwurf" });
      await expectStatus(() => OfferService.deactivateOffer("kg", "o1"), 409);
    });
    it("reactivate: Archiv -> Online", async () => {
      OfferManager.getOffer.resolves({ id: "o1", status: "Archiv" });
      const dto = await OfferService.reactivateOffer("kg", "o1");
      expect(dto.status).to.equal("Online");
    });
    it("reactivate: only Archiv can be reactivated (409)", async () => {
      OfferManager.getOffer.resolves({ id: "o1", status: "Online" });
      await expectStatus(() => OfferService.reactivateOffer("kg", "o1"), 409);
    });
    it("archive: Online -> Archiv (company-scoped)", async () => {
      OfferManager.getOffer.resolves({
        id: "o1",
        companyId: "c1",
        status: "Online",
      });
      const dto = await OfferService.archiveOffer("kg", "c1", "o1");
      expect(dto.status).to.equal("Archiv");
    });
    it("archive: 404 for another company's offer", async () => {
      OfferManager.getOffer.resolves({
        id: "o1",
        companyId: "other",
        status: "Online",
      });
      await expectStatus(
        () => OfferService.archiveOffer("kg", "c1", "o1"),
        404,
      );
    });
    it("archive: only Online can be archived (409)", async () => {
      OfferManager.getOffer.resolves({
        id: "o1",
        companyId: "c1",
        status: "Entwurf",
      });
      await expectStatus(
        () => OfferService.archiveOffer("kg", "c1", "o1"),
        409,
      );
    });
    it("reactivateCompanyOffer: Archiv -> Online (company-scoped)", async () => {
      OfferManager.getOffer.resolves({
        id: "o1",
        companyId: "c1",
        status: "Archiv",
      });
      const dto = await OfferService.reactivateCompanyOffer("kg", "c1", "o1");
      expect(dto.status).to.equal("Online");
    });
    it("reactivateCompanyOffer: 404 for another company's offer", async () => {
      OfferManager.getOffer.resolves({
        id: "o1",
        companyId: "other",
        status: "Archiv",
      });
      await expectStatus(
        () => OfferService.reactivateCompanyOffer("kg", "c1", "o1"),
        404,
      );
    });
    it("reactivateCompanyOffer: only Archiv can be reactivated (409)", async () => {
      OfferManager.getOffer.resolves({
        id: "o1",
        companyId: "c1",
        status: "Online",
      });
      await expectStatus(
        () => OfferService.reactivateCompanyOffer("kg", "c1", "o1"),
        409,
      );
    });
  });

  describe("public", () => {
    it("getPublicOffer: 404 for a non-online offer", async () => {
      OfferManager.getOffer.resolves({ id: "o1", status: "Entwurf" });
      await expectStatus(() => OfferService.getPublicOffer("kg", "o1"), 404);
    });
    it("getPublicOffer: increments views and hides reviewNote", async () => {
      OfferManager.getOffer.resolves({
        id: "o1",
        status: "Online",
        views: 4,
        reviewNote: "secret",
        location: null,
      });
      const dto = await OfferService.getPublicOffer("kg", "o1");
      expect(OfferManager.incrementViews.calledOnce).to.equal(true);
      expect(dto.views).to.equal(5);
      expect(dto).to.not.have.property("reviewNote");
      expect(dto.media).to.deep.equal([]);
    });
    it("getPublicOffer: attaches public media[] without fileName", async () => {
      OfferManager.getOffer.resolves({
        id: "o1",
        status: "Online",
        views: 0,
        location: null,
      });
      OfferMediaManager.getMediaByOffer.resolves([
        {
          id: "m1",
          offerId: "o1",
          url: "http://x/a",
          fileName: "public/offer-media/a",
          type: "image",
          created: 1,
        },
      ]);
      const dto = await OfferService.getPublicOffer("kg", "o1");
      expect(dto.media).to.have.length(1);
      expect(dto.media[0]).to.include({
        id: "m1",
        url: "http://x/a",
        type: "image",
      });
      expect(dto.media[0]).to.not.have.property("fileName");
    });
    it("searchPublicOffers: returns public DTOs without reviewNote", async () => {
      OfferManager.searchOnline.resolves([
        { id: "o1", status: "Online", reviewNote: "x", location: null },
      ]);
      const list = await OfferService.searchPublicOffers("kg", {});
      expect(list).to.have.length(1);
      expect(list[0]).to.not.have.property("reviewNote");
      expect(list[0]).to.not.have.property("contactPersons");
      expect(list[0]).to.not.have.property("media");
    });
  });

  describe("ownership", () => {
    it("getCompanyOffer: 404 when the offer belongs to another company", async () => {
      OfferManager.getOffer.resolves({ id: "o1", companyId: "other" });
      await expectStatus(
        () => OfferService.getCompanyOffer("kg", "c1", "o1"),
        404,
      );
    });
    it("deleteOffer: removes the offer, its media, its applications and its bookmarks", async () => {
      OfferManager.getOffer.resolves({ id: "o1", companyId: "c1" });
      await OfferService.deleteOffer("kg", "c1", "o1");
      expect(
        ApplicationServiceMock.deleteByOffer.calledWith("kg", "o1"),
      ).to.equal(true);
      expect(
        OfferBookmarkManager.removeByOffer.calledWith("kg", "o1"),
      ).to.equal(true);
      expect(OfferMediaManager.removeByOffer.calledWith("kg", "o1")).to.equal(
        true,
      );
      expect(OfferManager.removeOffer.calledWith("kg", "o1")).to.equal(true);
    });
  });

  describe("updateOffer", () => {
    const existingOffer = (over = {}) => ({
      id: "o1",
      tenantId: "kg",
      companyId: "c1",
      branchId: "b1",
      status: "Online",
      publishedAt: 1000,
      reviewNote: "old note",
      created: 5,
      views: 9,
      location: null,
      ...over,
    });

    it("preserves status/publishedAt/reviewNote when the payload omits status (no silent unpublish)", async () => {
      OfferManager.getOffer.resolves(existingOffer());
      const dto = await OfferService.updateOffer(
        "kg",
        "c1",
        "o1",
        basePayload(),
      );
      expect(dto.status).to.equal("Online");
      expect(dto.publishedAt).to.equal(1000);
      expect(dto.reviewNote).to.equal("old note");
    });

    it("re-snapshots the branch location on update", async () => {
      OfferManager.getOffer.resolves(existingOffer());
      const dto = await OfferService.updateOffer(
        "kg",
        "c1",
        "o1",
        basePayload(),
      );
      expect(dto.city).to.equal("Kiel");
      expect(dto.lat).to.equal(54.32);
    });

    it("ignores an explicit Entwurf on an Online offer (no self-unpublish)", async () => {
      OfferManager.getOffer.resolves(existingOffer());
      const dto = await OfferService.updateOffer(
        "kg",
        "c1",
        "o1",
        basePayload({ status: "Entwurf" }),
      );
      expect(dto.status).to.equal("Online");
      expect(dto.publishedAt).to.equal(1000);
      expect(dto.reviewNote).to.equal("old note");
    });

    it("does not republish an admin-archived offer (Archiv stays Archiv)", async () => {
      OfferManager.getOffer.resolves(
        existingOffer({ status: "Archiv", publishedAt: null, reviewNote: "" }),
      );
      const dto = await OfferService.updateOffer(
        "kg",
        "c1",
        "o1",
        basePayload({ status: "In Prüfung" }),
      );
      expect(dto.status).to.equal("Archiv");
    });

    it("submits a draft for review (Entwurf → In Prüfung, direct-publish OFF): clears the note, stays unpublished", async () => {
      OfferManager.getOffer.resolves(
        existingOffer({ status: "Entwurf", publishedAt: null }),
      );
      const dto = await OfferService.updateOffer(
        "kg",
        "c1",
        "o1",
        basePayload({ status: "In Prüfung" }),
      );
      expect(dto.status).to.equal("In Prüfung");
      expect(dto.publishedAt).to.equal(null);
      expect(dto.reviewNote).to.equal("");
    });

    it("withdraws a pending offer back to Entwurf (In Prüfung → Entwurf)", async () => {
      OfferManager.getOffer.resolves(
        existingOffer({ status: "In Prüfung", publishedAt: null }),
      );
      const dto = await OfferService.updateOffer(
        "kg",
        "c1",
        "o1",
        basePayload({ status: "Entwurf" }),
      );
      expect(dto.status).to.equal("Entwurf");
      expect(dto.publishedAt).to.equal(null);
    });

    it("404 when the offer belongs to another company", async () => {
      OfferManager.getOffer.resolves(existingOffer({ companyId: "other" }));
      await expectStatus(
        () => OfferService.updateOffer("kg", "c1", "o1", basePayload()),
        404,
      );
    });
  });

  describe("offer media", () => {
    it("addOfferMedia returns a clean DTO", async () => {
      const m = await OfferService.addOfferMedia("kg", "o1", {
        url: "u",
        fileName: "f",
        type: "image",
      });
      expect(m.offerId).to.equal("o1");
      expect(m.type).to.equal("image");
      expect(OfferMediaManager.storeMedia.calledOnce).to.equal(true);
    });

    it("removeOfferMedia returns the media (so the file can be cleaned up)", async () => {
      OfferMediaManager.getMedia.resolves({
        id: "m1",
        offerId: "o1",
        url: "http://x/?name=/p/f",
        fileName: "p/f",
        type: "image",
      });
      const m = await OfferService.removeOfferMedia("kg", "o1", "m1");
      expect(OfferMediaManager.removeMedia.calledWith("kg", "m1")).to.equal(
        true,
      );
      expect(m.url).to.equal("http://x/?name=/p/f");
    });

    it("removeOfferMedia 404 when the media belongs to another offer (cross-offer guard)", async () => {
      OfferMediaManager.getMedia.resolves({ id: "m1", offerId: "OTHER" });
      await expectStatus(
        () => OfferService.removeOfferMedia("kg", "o1", "m1"),
        404,
      );
      expect(OfferMediaManager.removeMedia.called).to.equal(false);
    });
  });

  describe("approve — publishedAt preservation", () => {
    it("re-approving an offer keeps its original publishedAt", async () => {
      OfferManager.getOffer.resolves({
        id: "o1",
        status: "In Prüfung",
        publishedAt: 4242,
      });
      const dto = await OfferService.approveOffer("kg", "o1");
      expect(dto.status).to.equal("Online");
      expect(dto.publishedAt).to.equal(4242);
    });
  });

  describe("getCompanyStats", () => {
    const offer = (over = {}) => ({
      id: "o",
      companyId: "c1",
      branchId: "",
      industryId: "",
      internshipTypeId: "",
      districtId: "",
      status: "Entwurf",
      views: 0,
      ...over,
    });

    it("empty company → zeros and empty arrays", async () => {
      OfferManager.getOffersByCompany.resolves([]);
      const s = await OfferService.getCompanyStats("kg", "c1");
      expect(s.total).to.equal(0);
      expect(s.byStatus).to.deep.equal({
        Entwurf: 0,
        "In Prüfung": 0,
        Online: 0,
        Archiv: 0,
      });
      expect(s.totalViews).to.equal(0);
      expect(s.byBranch).to.deep.equal([]);
      expect(s.byIndustry).to.deep.equal([]);
    });

    it("counts total, by status and total views", async () => {
      OfferManager.getOffersByCompany.resolves([
        offer({ status: "Online", views: 10 }),
        offer({ status: "Online", views: 5 }),
        offer({ status: "Entwurf", views: 1 }),
        offer({ status: "In Prüfung" }),
        offer({ status: "Archiv", views: 2 }),
      ]);
      const s = await OfferService.getCompanyStats("kg", "c1");
      expect(s.total).to.equal(5);
      expect(s.byStatus).to.deep.equal({
        Entwurf: 1,
        "In Prüfung": 1,
        Online: 2,
        Archiv: 1,
      });
      expect(s.totalViews).to.equal(18);
    });

    it("aggregates per branch with online counts (incl. company-level '')", async () => {
      OfferManager.getOffersByCompany.resolves([
        offer({ branchId: "b1", status: "Online" }),
        offer({ branchId: "b1", status: "Entwurf" }),
        offer({ branchId: "", status: "Online" }),
      ]);
      const s = await OfferService.getCompanyStats("kg", "c1");
      const b1 = s.byBranch.find((b) => b.branchId === "b1");
      const hq = s.byBranch.find((b) => b.branchId === "");
      expect(b1).to.deep.equal({ branchId: "b1", total: 2, online: 1 });
      expect(hq).to.deep.equal({ branchId: "", total: 1, online: 1 });
    });

    it("aggregates by industry, internship type and district", async () => {
      OfferManager.getOffersByCompany.resolves([
        offer({
          industryId: "industry-it",
          internshipTypeId: "internship_type-schulpraktikum",
          districtId: "district-kiel",
        }),
        offer({ industryId: "industry-it", districtId: "district-kiel" }),
        offer({ industryId: "industry-handwerk" }),
      ]);
      const s = await OfferService.getCompanyStats("kg", "c1");
      expect(s.byIndustry).to.have.deep.members([
        { id: "industry-it", count: 2 },
        { id: "industry-handwerk", count: 1 },
      ]);
      expect(s.byInternshipType).to.deep.equal([
        { id: "internship_type-schulpraktikum", count: 1 },
      ]);
      expect(s.byDistrict).to.deep.equal([{ id: "district-kiel", count: 2 }]);
    });

    it("applies branchId and industryId filters", async () => {
      OfferManager.getOffersByCompany.resolves([
        offer({ branchId: "b1", industryId: "industry-it", status: "Online" }),
        offer({ branchId: "b2", industryId: "industry-it", status: "Online" }),
        offer({
          branchId: "b1",
          industryId: "industry-handwerk",
          status: "Online",
        }),
      ]);
      const s = await OfferService.getCompanyStats("kg", "c1", {
        branchId: "b1",
        industryId: "industry-it",
      });
      expect(s.total).to.equal(1);
      expect(s.byStatus.Online).to.equal(1);
    });

    it("branchId '' filters to company-level offers only", async () => {
      OfferManager.getOffersByCompany.resolves([
        offer({ branchId: "" }),
        offer({ branchId: "" }),
        offer({ branchId: "b1" }),
      ]);
      const s = await OfferService.getCompanyStats("kg", "c1", {
        branchId: "",
      });
      expect(s.total).to.equal(2);
    });

    it("omitted branchId counts offers across all branches", async () => {
      OfferManager.getOffersByCompany.resolves([
        offer({ branchId: "" }),
        offer({ branchId: "b1" }),
        offer({ branchId: "b2" }),
      ]);
      const s = await OfferService.getCompanyStats("kg", "c1");
      expect(s.total).to.equal(3);
    });
  });
});

describe("OfferManager — searchOnline query building", () => {
  let sandbox;
  let captured;
  let OfferManager2;

  beforeEach(() => {
    sandbox = sinon.createSandbox();
    captured = {};
    const FakeModel = {
      find(query) {
        captured.query = query;
        const chain = {
          sort: () => chain,
          limit: (n) => {
            captured.limit = n;
            return chain;
          },
          skip: (n) => {
            captured.skip = n;
            return chain;
          },
          then: (resolve) => resolve([]),
        };
        return chain;
      },
    };
    mock("../../src/commons/data-managers/models/offerModel", FakeModel);
    OfferManager2 = mock.reRequire(
      "../../src/commons/data-managers/offer-manager",
    );
  });

  afterEach(() => {
    sandbox.restore();
    mock.stopAll();
  });

  it("always restricts to tenant + status Online", async () => {
    await OfferManager2.searchOnline("kg", {});
    expect(captured.query.tenantId).to.equal("kg");
    expect(captured.query.status).to.equal("Online");
  });

  it("q searches title + requirements + additionalInfo, regex-escaped", async () => {
    await OfferManager2.searchOnline("kg", { q: "(a+)+$" });
    const or = captured.query.$and[0].$or;
    expect(or.map((clause) => Object.keys(clause)[0])).to.deep.equal([
      "title",
      "requirements",
      "additionalInfo",
    ]);
    expect(or[0].title.$regex).to.equal("\\(a\\+\\)\\+\\$");
    expect(or[0].title.$options).to.equal("i");
  });

  it("builds a 2dsphere $near query for geo filters", async () => {
    await OfferManager2.searchOnline("kg", {
      lat: 54.3,
      lng: 10.1,
      radiusMeters: 30000,
    });
    expect(captured.query.location.$near.$maxDistance).to.equal(30000);
    expect(captured.query.location.$near.$geometry.coordinates).to.deep.equal([
      10.1, 54.3,
    ]);
  });

  it("passes through exact filters", async () => {
    await OfferManager2.searchOnline("kg", {
      industryId: "industry-it",
      city: "Kiel",
      companyId: "c1",
      districtId: "d1",
    });
    expect(captured.query.industryId).to.equal("industry-it");
    expect(captured.query.city).to.equal("Kiel");
    expect(captured.query.companyId).to.equal("c1");
    expect(captured.query.districtId).to.equal("d1");
  });

  it("minAge filter matches no-minAge OR minAge<=age", async () => {
    await OfferManager2.searchOnline("kg", { minAge: 16 });
    expect(captured.query.$and[0].$or).to.deep.equal([
      { minAge: null },
      { minAge: { $lte: 16 } },
    ]);
  });

  it("combines q and minAge under $and (no clobbering)", async () => {
    await OfferManager2.searchOnline("kg", { q: "tischler", minAge: 16 });
    expect(captured.query.$and).to.have.length(2);
    expect(Object.keys(captured.query.$and[0].$or[0])).to.deep.equal(["title"]);
    expect(captured.query.$and[1].$or).to.deep.equal([
      { minAge: null },
      { minAge: { $lte: 16 } },
    ]);
  });

  it("companyIds becomes a $in filter", async () => {
    await OfferManager2.searchOnline("kg", { companyIds: ["c1", "c2"] });
    expect(captured.query.companyId).to.deep.equal({ $in: ["c1", "c2"] });
  });

  it("exact companyId takes precedence over companyIds", async () => {
    await OfferManager2.searchOnline("kg", {
      companyId: "c1",
      companyIds: ["c2"],
    });
    expect(captured.query.companyId).to.equal("c1");
  });

  it("applies a default result cap and offset of 0", async () => {
    await OfferManager2.searchOnline("kg", {});
    expect(captured.limit).to.equal(50);
    expect(captured.skip).to.equal(0);
  });

  it("clamps an oversized limit to the max and applies the offset", async () => {
    await OfferManager2.searchOnline("kg", { limit: 5000, offset: 20 });
    expect(captured.limit).to.equal(2000);
    expect(captured.skip).to.equal(20);
  });
});

describe("OfferService — searchPublicOffers (company-name resolution)", () => {
  let sandbox;
  let CompanyManager;
  let OfferManager3;
  let OfferService3;

  beforeEach(() => {
    sandbox = sinon.createSandbox();
    CompanyManager = {
      getCompanyIdsByName: sandbox.stub().resolves([]),
      getBlockedCompanyIds: sandbox.stub().resolves([]),
    };
    OfferManager3 = { searchOnline: sandbox.stub().resolves([]) };
    mock("../../src/commons/data-managers/company-manager", CompanyManager);
    mock("../../src/commons/data-managers/offer-manager", OfferManager3);
    OfferService3 = mock.reRequire(
      "../../src/commons/services/company/offer-service",
    );
  });

  afterEach(() => {
    sandbox.restore();
    mock.stopAll();
  });

  it("resolves a company name to companyIds and passes them to searchOnline", async () => {
    CompanyManager.getCompanyIdsByName.resolves(["c1", "c2"]);
    await OfferService3.searchPublicOffers("kg", { company: "nord" });
    expect(
      CompanyManager.getCompanyIdsByName.calledWith("kg", "nord"),
    ).to.equal(true);
    expect(
      OfferManager3.searchOnline.firstCall.args[1].companyIds,
    ).to.deep.equal(["c1", "c2"]);
  });

  it("returns [] when no company matches the name", async () => {
    CompanyManager.getCompanyIdsByName.resolves([]);
    const res = await OfferService3.searchPublicOffers("kg", {
      company: "zzz",
    });
    expect(res).to.deep.equal([]);
    expect(OfferManager3.searchOnline.called).to.equal(false);
  });

  it("does not resolve companyIds when no company name is given", async () => {
    await OfferService3.searchPublicOffers("kg", { industryId: "industry-it" });
    expect(CompanyManager.getCompanyIdsByName.called).to.equal(false);
    expect(OfferManager3.searchOnline.firstCall.args[1].companyIds).to.equal(
      undefined,
    );
  });
});
