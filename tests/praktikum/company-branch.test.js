const mock = require("mock-require");
const { expect } = require("chai");
const sinon = require("sinon");

describe("CompanyService — branches", () => {
  let sandbox;
  let CompanyManager;
  let CompanyBranchManager;
  let TaxonomyTermManager;
  let CompanyMemberManager;
  let MemberInvitationManager;
  let OfferManager;
  let CompanyService;

  const existingBranch = () => ({
    id: "b1",
    tenantId: "kielregion",
    companyId: "c1",
    name: "Hauptsitz",
    street: "Haßstraße 3-5",
    postalCode: "24103",
    city: "Kiel",
    districtId: "district-kiel",
    location: { type: "Point", coordinates: [10.13, 54.32] },
    logoUrl: "",
    created: 1,
  });

  beforeEach(() => {
    sandbox = sinon.createSandbox();
    CompanyManager = { getCompany: sandbox.stub().resolves({ id: "c1" }) };
    CompanyBranchManager = {
      getBranchesByCompany: sandbox.stub().resolves([]),
      getBranch: sandbox.stub().resolves(null),
      storeBranch: sandbox.stub().callsFake(async (b) => b),
      removeBranch: sandbox.stub().resolves(),
    };
    TaxonomyTermManager = {
      getTerm: sandbox.stub().resolves({ type: "district", active: true }),
    };
    CompanyMemberManager = {
      getMembersByCompany: sandbox.stub().resolves([]),
    };
    MemberInvitationManager = {
      getPendingByCompany: sandbox.stub().resolves([]),
    };
    OfferManager = { countByBranch: sandbox.stub().resolves(0) };

    mock("../../src/commons/data-managers/company-manager", CompanyManager);
    mock("../../src/commons/data-managers/offer-manager", OfferManager);
    mock(
      "../../src/commons/data-managers/company-branch-manager",
      CompanyBranchManager,
    );
    mock(
      "../../src/commons/data-managers/taxonomy-term-manager",
      TaxonomyTermManager,
    );
    mock(
      "../../src/commons/data-managers/company-member-manager",
      CompanyMemberManager,
    );
    mock(
      "../../src/commons/data-managers/member-invitation-manager",
      MemberInvitationManager,
    );

    CompanyService = mock.reRequire(
      "../../src/commons/services/company/company-service",
    );
  });

  afterEach(() => {
    sandbox.restore();
    mock.stopAll();
  });

  const expectStatus = async (fn, status, messageIncludes) => {
    let error;
    try {
      await fn();
    } catch (e) {
      error = e;
    }
    expect(error && error.status).to.equal(status);
    if (messageIncludes) {
      expect(error.message).to.contain(messageIncludes);
    }
  };

  describe("createCompanyBranch", () => {
    it("throws 404 when the company does not exist", async () => {
      CompanyManager.getCompany.resolves(null);
      await expectStatus(
        () =>
          CompanyService.createCompanyBranch("kielregion", "c1", {
            name: "X",
            city: "Kiel",
          }),
        404,
      );
    });

    it("rejects a missing name (400)", async () => {
      await expectStatus(
        () =>
          CompanyService.createCompanyBranch("kielregion", "c1", {
            city: "Kiel",
          }),
        400,
      );
    });

    it("rejects a missing city (400)", async () => {
      await expectStatus(
        () =>
          CompanyService.createCompanyBranch("kielregion", "c1", { name: "X" }),
        400,
      );
    });

    it("rejects a non-5-digit postal code (400)", async () => {
      await expectStatus(
        () =>
          CompanyService.createCompanyBranch("kielregion", "c1", {
            name: "X",
            city: "Kiel",
            postalCode: "123",
          }),
        400,
      );
    });

    it("rejects an invalid district (400)", async () => {
      TaxonomyTermManager.getTerm.resolves(null);
      await expectStatus(
        () =>
          CompanyService.createCompanyBranch("kielregion", "c1", {
            name: "X",
            city: "Kiel",
            districtId: "bogus",
          }),
        400,
      );
    });

    it("rejects only one of lat/lng (400)", async () => {
      await expectStatus(
        () =>
          CompanyService.createCompanyBranch("kielregion", "c1", {
            name: "X",
            city: "Kiel",
            lat: 54.3,
          }),
        400,
      );
    });

    it("rejects out-of-range coordinates (400)", async () => {
      await expectStatus(
        () =>
          CompanyService.createCompanyBranch("kielregion", "c1", {
            name: "X",
            city: "Kiel",
            lat: 200,
            lng: 10,
          }),
        400,
      );
    });

    it("rejects non-numeric coordinate types (400)", async () => {
      await expectStatus(
        () =>
          CompanyService.createCompanyBranch("kielregion", "c1", {
            name: "X",
            city: "Kiel",
            lat: true,
            lng: false,
          }),
        400,
      );
    });

    it("stores a GeoJSON Point [lng,lat] and returns lat/lng", async () => {
      const dto = await CompanyService.createCompanyBranch("kielregion", "c1", {
        name: "Hauptsitz",
        city: "Kiel",
        lat: 54.32,
        lng: 10.13,
      });
      const stored = CompanyBranchManager.storeBranch.firstCall.args[0];
      expect(stored.location).to.deep.equal({
        type: "Point",
        coordinates: [10.13, 54.32],
      });
      expect(stored.id).to.be.a("string");
      expect(dto.lat).to.equal(54.32);
      expect(dto.lng).to.equal(10.13);
      expect(dto).to.not.have.property("location");
    });

    it("stores location null when no coordinates are given", async () => {
      await CompanyService.createCompanyBranch("kielregion", "c1", {
        name: "X",
        city: "Kiel",
      });
      const stored = CompanyBranchManager.storeBranch.firstCall.args[0];
      expect(stored.location).to.equal(null);
    });
  });

  describe("updateCompanyBranch", () => {
    it("throws 404 when the branch is missing", async () => {
      CompanyBranchManager.getBranch.resolves(null);
      await expectStatus(
        () =>
          CompanyService.updateCompanyBranch("kielregion", "c1", "b1", {
            name: "X",
            city: "Kiel",
          }),
        404,
      );
    });

    it("throws 404 when the branch belongs to another company", async () => {
      CompanyBranchManager.getBranch.resolves({
        ...existingBranch(),
        companyId: "other",
      });
      await expectStatus(
        () =>
          CompanyService.updateCompanyBranch("kielregion", "c1", "b1", {
            name: "X",
            city: "Kiel",
          }),
        404,
      );
    });

    it("preserves id/companyId/created and updates fields", async () => {
      CompanyBranchManager.getBranch.resolves(existingBranch());
      const dto = await CompanyService.updateCompanyBranch(
        "kielregion",
        "c1",
        "b1",
        { name: "Neu", city: "Kiel" },
      );
      const stored = CompanyBranchManager.storeBranch.firstCall.args[0];
      expect(stored.id).to.equal("b1");
      expect(stored.companyId).to.equal("c1");
      expect(stored.created).to.equal(1);
      expect(stored.name).to.equal("Neu");
      expect(dto.name).to.equal("Neu");
    });

    it("preserves the existing location when no coordinates are sent", async () => {
      CompanyBranchManager.getBranch.resolves(existingBranch());
      await CompanyService.updateCompanyBranch("kielregion", "c1", "b1", {
        name: "Neu",
        city: "Kiel",
      });
      const stored = CompanyBranchManager.storeBranch.firstCall.args[0];
      expect(stored.location).to.deep.equal({
        type: "Point",
        coordinates: [10.13, 54.32],
      });
    });
  });

  describe("removeCompanyBranch", () => {
    it("throws 404 when the branch is missing", async () => {
      CompanyBranchManager.getBranch.resolves(null);
      await expectStatus(
        () => CompanyService.removeCompanyBranch("kielregion", "c1", "b1"),
        404,
      );
    });

    it("throws 404 when the branch belongs to another company", async () => {
      CompanyBranchManager.getBranch.resolves({
        ...existingBranch(),
        companyId: "other",
      });
      await expectStatus(
        () => CompanyService.removeCompanyBranch("kielregion", "c1", "b1"),
        404,
      );
      expect(CompanyBranchManager.removeBranch.called).to.equal(false);
    });

    it("removes the only branch when it has no offers, members or invitations", async () => {
      CompanyBranchManager.getBranch.resolves(existingBranch());
      const branch = await CompanyService.removeCompanyBranch(
        "kielregion",
        "c1",
        "b1",
      );
      expect(
        CompanyBranchManager.removeBranch.calledWith("kielregion", "b1"),
      ).to.equal(true);
      expect(branch.id).to.equal("b1");
    });

    it("throws 409 when the branch still has internships assigned", async () => {
      CompanyBranchManager.getBranch.resolves(existingBranch());
      OfferManager.countByBranch.resolves(2);
      await expectStatus(
        () => CompanyService.removeCompanyBranch("kielregion", "c1", "b1"),
        409,
        "internships assigned",
      );
      expect(CompanyBranchManager.removeBranch.called).to.equal(false);
    });

    it("throws 409 when a member is scoped to this branch", async () => {
      CompanyBranchManager.getBranch.resolves(existingBranch());
      CompanyMemberManager.getMembersByCompany.resolves([
        { userId: "u@x.de", branchId: "b1" },
      ]);
      await expectStatus(
        () => CompanyService.removeCompanyBranch("kielregion", "c1", "b1"),
        409,
        "members assigned",
      );
      expect(CompanyBranchManager.removeBranch.called).to.equal(false);
    });

    it("allows deletion when members exist but none are scoped to this branch", async () => {
      CompanyBranchManager.getBranch.resolves(existingBranch());
      CompanyMemberManager.getMembersByCompany.resolves([
        { userId: "owner@x.de", branchId: "" },
        { userId: "u2@x.de", branchId: "b2" },
      ]);
      await CompanyService.removeCompanyBranch("kielregion", "c1", "b1");
      expect(
        CompanyBranchManager.removeBranch.calledWith("kielregion", "b1"),
      ).to.equal(true);
    });

    it("throws 409 when a pending invitation is scoped to this branch", async () => {
      CompanyBranchManager.getBranch.resolves(existingBranch());
      MemberInvitationManager.getPendingByCompany.resolves([
        { email: "invitee@x.de", branchId: "b1" },
      ]);
      await expectStatus(
        () => CompanyService.removeCompanyBranch("kielregion", "c1", "b1"),
        409,
        "pending invitation",
      );
      expect(CompanyBranchManager.removeBranch.called).to.equal(false);
    });

    it("allows deletion when a pending invitation targets a different branch", async () => {
      CompanyBranchManager.getBranch.resolves(existingBranch());
      MemberInvitationManager.getPendingByCompany.resolves([
        { email: "invitee@x.de", branchId: "b2" },
      ]);
      await CompanyService.removeCompanyBranch("kielregion", "c1", "b1");
      expect(
        CompanyBranchManager.removeBranch.calledWith("kielregion", "b1"),
      ).to.equal(true);
    });
  });

  describe("getCompanyBranches", () => {
    it("maps to DTOs with lat/lng and no internal location", async () => {
      CompanyBranchManager.getBranchesByCompany.resolves([existingBranch()]);
      const list = await CompanyService.getCompanyBranches("kielregion", "c1");
      expect(list).to.have.length(1);
      expect(list[0].lat).to.equal(54.32);
      expect(list[0].lng).to.equal(10.13);
      expect(list[0]).to.not.have.property("location");
    });
  });

  describe("setBranchLogo", () => {
    it("throws 404 when the branch is missing", async () => {
      CompanyBranchManager.getBranch.resolves(null);
      await expectStatus(
        () => CompanyService.setBranchLogo("kielregion", "c1", "b1", "u"),
        404,
      );
    });

    it("stores the logo url", async () => {
      CompanyBranchManager.getBranch.resolves(existingBranch());
      await CompanyService.setBranchLogo(
        "kielregion",
        "c1",
        "b1",
        "http://x/l.png",
      );
      const stored = CompanyBranchManager.storeBranch.firstCall.args[0];
      expect(stored.logoUrl).to.equal("http://x/l.png");
    });
  });
});

describe("CompanyBranch entity", () => {
  const CompanyBranch = require("../../src/commons/entities/company/companyBranch");

  it("applies defaults (location null, logoUrl '') and keeps given fields", () => {
    const b = CompanyBranch.create({
      id: "b1",
      tenantId: "kielregion",
      companyId: "c1",
      name: "Hauptsitz",
    });
    expect(b.id).to.equal("b1");
    expect(b.name).to.equal("Hauptsitz");
    expect(b.location).to.equal(null);
    expect(b.logoUrl).to.equal("");
    expect(b.created).to.be.a("number");
  });

  it("throws when a required field (companyId) is missing", () => {
    expect(() =>
      CompanyBranch.create({ id: "b1", tenantId: "kielregion", name: "X" }),
    ).to.throw();
  });
});
