const mock = require("mock-require");
const { expect } = require("chai");
const sinon = require("sinon");

describe("ApplicationService — deleteByOffer / deleteByCompany", () => {
  let sandbox;
  let ApplicationManager;
  let NextcloudManager;
  let ApplicationService;

  beforeEach(() => {
    sandbox = sinon.createSandbox();
    ApplicationManager = {
      getByOffer: sandbox.stub().resolves([]),
      getByCompany: sandbox.stub().resolves([]),
      listByUser: sandbox.stub().resolves([]),
      getAllByStudent: sandbox.stub().resolves([]),
      removeByOffer: sandbox.stub().resolves(),
      removeByCompany: sandbox.stub().resolves(),
      removeByStudentAllTenants: sandbox.stub().resolves(),
    };
    NextcloudManager = { deleteFile: sandbox.stub().resolves() };
    mock(
      "../../src/commons/data-managers/application-manager",
      ApplicationManager,
    );
    mock("../../src/commons/data-managers/file-manager", { NextcloudManager });
    ApplicationService = mock.reRequire(
      "../../src/commons/services/student/application-service",
    );
  });

  afterEach(() => {
    sandbox.restore();
    mock.stopAll();
  });

  it("deleteByOffer deletes every document file, then the records", async () => {
    ApplicationManager.getByOffer.resolves([
      {
        id: "a1",
        documents: [{ fileName: "protected/f1" }, { fileName: "protected/f2" }],
      },
      { id: "a2", documents: [] },
    ]);
    const res = await ApplicationService.deleteByOffer("kg", "o1");
    expect(
      NextcloudManager.deleteFile.calledWith("kg", "protected/f1"),
    ).to.equal(true);
    expect(
      NextcloudManager.deleteFile.calledWith("kg", "protected/f2"),
    ).to.equal(true);
    expect(ApplicationManager.removeByOffer.calledWith("kg", "o1")).to.equal(
      true,
    );
    expect(res).to.deep.equal({ removed: 2 });
  });

  it("deleteByOffer still removes the records when a file delete fails", async () => {
    ApplicationManager.getByOffer.resolves([
      { id: "a1", documents: [{ fileName: "protected/f1" }] },
    ]);
    NextcloudManager.deleteFile.rejects(new Error("nextcloud down"));
    const res = await ApplicationService.deleteByOffer("kg", "o1");
    expect(ApplicationManager.removeByOffer.calledWith("kg", "o1")).to.equal(
      true,
    );
    expect(res).to.deep.equal({ removed: 1 });
  });

  it("deleteByCompany deletes document files, then the records", async () => {
    ApplicationManager.getByCompany.resolves([
      { id: "a1", documents: [{ fileName: "protected/f1" }] },
    ]);
    const res = await ApplicationService.deleteByCompany("kg", "c1");
    expect(
      NextcloudManager.deleteFile.calledWith("kg", "protected/f1"),
    ).to.equal(true);
    expect(ApplicationManager.removeByCompany.calledWith("kg", "c1")).to.equal(
      true,
    );
    expect(res).to.deep.equal({ removed: 1 });
  });

  it("deleteByStudent deletes documents across ALL tenants, then the records", async () => {
    ApplicationManager.getAllByStudent.resolves([
      { id: "a1", tenantId: "kg", documents: [{ fileName: "f1" }] },
      { id: "a2", tenantId: "other", documents: [{ fileName: "f2" }] },
    ]);
    const res = await ApplicationService.deleteByStudent("lena@x.de");
    expect(NextcloudManager.deleteFile.calledWith("kg", "f1")).to.equal(true);
    expect(NextcloudManager.deleteFile.calledWith("other", "f2")).to.equal(
      true,
    );
    expect(
      ApplicationManager.removeByStudentAllTenants.calledWith("lena@x.de"),
    ).to.equal(true);
    expect(res).to.deep.equal({ removed: 2 });
  });
});

describe("CompanyService — deleteOwnerAccount", () => {
  let sandbox;
  let CompanyManager;
  let CompanyMediaManager;
  let NextcloudManager;
  let CompanyMemberManager;
  let CompanyBranchManager;
  let MemberInvitationManager;
  let OfferManager;
  let OfferBookmarkManager;
  let UserManager;
  let MembershipManager;
  let ApplicationService;
  let AccountDeletionService;
  let JwtHelper;
  let CompanyService;

  const T = "kg";
  const CO = "c1";
  const OWNER = "owner@x.de";

  beforeEach(() => {
    sandbox = sinon.createSandbox();
    CompanyManager = {
      getCompany: sandbox.stub().resolves({ id: CO, name: "Muster GmbH" }),
      deleteCompany: sandbox.stub().resolves(),
    };
    CompanyMediaManager = {
      getMediaByCompany: sandbox.stub().resolves([]),
      removeMedia: sandbox.stub().resolves(),
    };
    NextcloudManager = { deleteFile: sandbox.stub().resolves() };
    CompanyMemberManager = {
      getMemberByUser: sandbox
        .stub()
        .resolves({ companyId: CO, isOwner: true, branchId: "" }),
      getMembersByCompany: sandbox
        .stub()
        .resolves([{ userId: OWNER, isOwner: true }]),
      removeMember: sandbox.stub().resolves(),
    };
    CompanyBranchManager = {
      getBranchesByCompany: sandbox.stub().resolves([]),
      removeBranch: sandbox.stub().resolves(),
    };
    MemberInvitationManager = {
      getPendingByCompany: sandbox.stub().resolves([]),
      remove: sandbox.stub().resolves(),
    };
    OfferManager = { getOffersByCompany: sandbox.stub().resolves([]) };
    OfferBookmarkManager = { removeByOffer: sandbox.stub().resolves() };
    UserManager = { deleteUser: sandbox.stub().resolves() };
    MembershipManager = {
      removeMembership: sandbox.stub().resolves(),
      getMembershipsByUserID: sandbox.stub().resolves([]),
    };
    ApplicationService = {
      deleteByCompany: sandbox.stub().resolves({ removed: 0 }),
    };
    AccountDeletionService = {
      assertValidReason: sandbox.stub().resolves("reason-company-x"),
      increment: sandbox.stub().resolves(),
    };
    JwtHelper = { revokeAllUserTokens: sandbox.stub().resolves() };

    mock("../../src/commons/data-managers/company-manager", CompanyManager);
    mock(
      "../../src/commons/data-managers/company-media-manager",
      CompanyMediaManager,
    );
    mock("../../src/commons/data-managers/file-manager", { NextcloudManager });
    mock(
      "../../src/commons/data-managers/company-member-manager",
      CompanyMemberManager,
    );
    mock(
      "../../src/commons/data-managers/company-branch-manager",
      CompanyBranchManager,
    );
    mock(
      "../../src/commons/data-managers/member-invitation-manager",
      MemberInvitationManager,
    );
    mock("../../src/commons/data-managers/offer-manager", OfferManager);
    mock(
      "../../src/commons/data-managers/offer-bookmark-manager",
      OfferBookmarkManager,
    );
    mock("../../src/commons/data-managers/user-manager", UserManager);
    mock(
      "../../src/commons/data-managers/membership-manager",
      MembershipManager,
    );
    mock(
      "../../src/commons/services/student/application-service",
      ApplicationService,
    );
    mock(
      "../../src/commons/services/account-deletion-service",
      AccountDeletionService,
    );
    mock("../../src/commons/utilities/jwt-helper", JwtHelper);
    mock("../../src/commons/services/company/company-role-service", {
      CompanyRoleService: {},
    });
    mock("../../src/commons/mail-service/mail-controller", {});

    CompanyService = mock.reRequire(
      "../../src/commons/services/company/company-service",
    );
  });

  afterEach(() => {
    sandbox.restore();
    mock.stopAll();
  });

  const run = () => CompanyService.deleteOwnerAccount(T, CO, OWNER, "reason");
  const expectError = async (fn) => {
    let error;
    try {
      await fn();
    } catch (e) {
      error = e;
    }
    return error;
  };

  it("→ 404 when the company does not exist", async () => {
    CompanyManager.getCompany.resolves(null);
    const error = await expectError(run);
    expect(error && error.status).to.equal(404);
  });

  it("→ 403 when the caller is not a member of the company", async () => {
    CompanyMemberManager.getMemberByUser.resolves(null);
    const error = await expectError(run);
    expect(error && error.status).to.equal(403);
  });

  it("→ 403 when the caller is a member but not the owner", async () => {
    CompanyMemberManager.getMemberByUser.resolves({
      companyId: CO,
      isOwner: false,
    });
    const error = await expectError(run);
    expect(error && error.status).to.equal(403);
  });

  it("→ 400 when the deletion reason is invalid", async () => {
    AccountDeletionService.assertValidReason.rejects({
      message: "A valid deletion reason is required",
      status: 400,
    });
    const error = await expectError(run);
    expect(error && error.status).to.equal(400);
    expect(CompanyManager.deleteCompany.called).to.equal(false);
  });

  it("→ 409 with counts when team members still exist", async () => {
    CompanyMemberManager.getMembersByCompany.resolves([
      { userId: OWNER, isOwner: true },
      { userId: "m1@x.de", isOwner: false },
      { userId: "m2@x.de", isOwner: false },
    ]);
    const error = await expectError(run);
    expect(error && error.status).to.equal(409);
    expect(error.memberCount).to.equal(2);
    expect(error.branchCount).to.equal(0);
    expect(error.offerCount).to.equal(0);
    expect(CompanyManager.deleteCompany.called).to.equal(false);
    expect(ApplicationService.deleteByCompany.called).to.equal(false);
  });

  it("→ 409 counts pending invitations as team members", async () => {
    MemberInvitationManager.getPendingByCompany.resolves([
      { id: "i1" },
      { id: "i2" },
    ]);
    const error = await expectError(run);
    expect(error && error.status).to.equal(409);
    expect(error.memberCount).to.equal(2);
    expect(CompanyManager.deleteCompany.called).to.equal(false);
  });

  it("→ 409 with counts when branches still exist", async () => {
    CompanyBranchManager.getBranchesByCompany.resolves([
      { id: "b1" },
      { id: "b2" },
    ]);
    const error = await expectError(run);
    expect(error && error.status).to.equal(409);
    expect(error.branchCount).to.equal(2);
    expect(error.memberCount).to.equal(0);
    expect(error.offerCount).to.equal(0);
    expect(CompanyManager.deleteCompany.called).to.equal(false);
    expect(ApplicationService.deleteByCompany.called).to.equal(false);
  });

  it("→ 409 with counts when internships still exist", async () => {
    OfferManager.getOffersByCompany.resolves([{ id: "o1" }, { id: "o2" }]);
    const error = await expectError(run);
    expect(error && error.status).to.equal(409);
    expect(error.memberCount).to.equal(0);
    expect(error.branchCount).to.equal(0);
    expect(error.offerCount).to.equal(2);
    expect(CompanyManager.deleteCompany.called).to.equal(false);
  });

  it("→ 409 reports both counts when members and internships exist", async () => {
    CompanyMemberManager.getMembersByCompany.resolves([
      { userId: OWNER, isOwner: true },
      { userId: "m1@x.de", isOwner: false },
    ]);
    OfferManager.getOffersByCompany.resolves([{ id: "o1" }]);
    const error = await expectError(run);
    expect(error && error.status).to.equal(409);
    expect(error.memberCount).to.equal(1);
    expect(error.offerCount).to.equal(1);
  });

  it("tears the company down completely when nothing remains to remove", async () => {
    const res = await run();

    expect(ApplicationService.deleteByCompany.calledWith(T, CO)).to.equal(true);
    expect(CompanyManager.deleteCompany.calledWith(T, CO)).to.equal(true);
    expect(CompanyMemberManager.removeMember.calledWith(T, CO, OWNER)).to.equal(
      true,
    );
    expect(
      AccountDeletionService.increment.calledWith(
        T,
        "company",
        "reason-company-x",
      ),
    ).to.equal(true);
    expect(MembershipManager.removeMembership.calledWith(T, OWNER)).to.equal(
      true,
    );
    expect(
      JwtHelper.revokeAllUserTokens.calledWith(OWNER, "account_deleted"),
    ).to.equal(true);
    expect(UserManager.deleteUser.calledWith(OWNER)).to.equal(true);
    expect(res).to.deep.equal({ deleted: OWNER });
  });

  it("keeps the user account when other memberships remain", async () => {
    MembershipManager.getMembershipsByUserID.resolves([{ tenantId: "other" }]);
    await run();
    expect(UserManager.deleteUser.called).to.equal(false);
  });

  it("deletes company media files + rows and the logo file on teardown", async () => {
    CompanyManager.getCompany.resolves({
      id: CO,
      name: "Muster GmbH",
      logoUrl: "http://x/api/kg/files/get?name=/public/logos/logo.png",
    });
    CompanyMediaManager.getMediaByCompany.resolves([
      { id: "m1", fileName: "public/media/a.jpg" },
      { id: "m2", fileName: "public/media/b.jpg" },
    ]);
    await run();
    expect(
      NextcloudManager.deleteFile.calledWith("kg", "public/media/a.jpg"),
    ).to.equal(true);
    expect(CompanyMediaManager.removeMedia.calledWith("kg", "m1")).to.equal(
      true,
    );
    expect(
      NextcloudManager.deleteFile.calledWith("kg", "/public/logos/logo.png"),
    ).to.equal(true);
  });
});

describe("CompanyService — adminDeleteCompany (force cascade)", () => {
  let sandbox;
  let CompanyManager;
  let CompanyMediaManager;
  let NextcloudManager;
  let CompanyMemberManager;
  let CompanyBranchManager;
  let MemberInvitationManager;
  let OfferManager;
  let OfferMediaManager;
  let OfferBookmarkManager;
  let UserManager;
  let MembershipManager;
  let ApplicationService;
  let JwtHelper;
  let CompanyService;

  const T = "kg";
  const CO = "c1";

  beforeEach(() => {
    sandbox = sinon.createSandbox();
    CompanyManager = {
      getCompany: sandbox
        .stub()
        .resolves({ id: CO, name: "Muster GmbH", logoUrl: "" }),
      deleteCompany: sandbox.stub().resolves(),
    };
    CompanyMediaManager = {
      getMediaByCompany: sandbox.stub().resolves([]),
      removeMedia: sandbox.stub().resolves(),
    };
    NextcloudManager = { deleteFile: sandbox.stub().resolves() };
    CompanyMemberManager = {
      getMembersByCompany: sandbox.stub().resolves([]),
      removeMember: sandbox.stub().resolves(),
    };
    CompanyBranchManager = {
      getBranchesByCompany: sandbox.stub().resolves([]),
      removeBranch: sandbox.stub().resolves(),
    };
    MemberInvitationManager = {
      getPendingByCompany: sandbox.stub().resolves([]),
      remove: sandbox.stub().resolves(),
    };
    OfferManager = {
      getOffersByCompany: sandbox.stub().resolves([]),
      removeOffer: sandbox.stub().resolves(),
    };
    OfferMediaManager = {
      getMediaByOffer: sandbox.stub().resolves([]),
      removeByOffer: sandbox.stub().resolves(),
    };
    OfferBookmarkManager = { removeByOffer: sandbox.stub().resolves() };
    UserManager = { deleteUser: sandbox.stub().resolves() };
    MembershipManager = {
      removeMembership: sandbox.stub().resolves(),
      getMembershipsByUserID: sandbox.stub().resolves([]),
    };
    ApplicationService = {
      deleteByCompany: sandbox.stub().resolves({ removed: 0 }),
    };
    JwtHelper = { revokeAllUserTokens: sandbox.stub().resolves() };

    mock("../../src/commons/data-managers/company-manager", CompanyManager);
    mock(
      "../../src/commons/data-managers/company-media-manager",
      CompanyMediaManager,
    );
    mock("../../src/commons/data-managers/file-manager", { NextcloudManager });
    mock(
      "../../src/commons/data-managers/company-member-manager",
      CompanyMemberManager,
    );
    mock(
      "../../src/commons/data-managers/company-branch-manager",
      CompanyBranchManager,
    );
    mock(
      "../../src/commons/data-managers/member-invitation-manager",
      MemberInvitationManager,
    );
    mock("../../src/commons/data-managers/offer-manager", OfferManager);
    mock(
      "../../src/commons/data-managers/offer-media-manager",
      OfferMediaManager,
    );
    mock(
      "../../src/commons/data-managers/offer-bookmark-manager",
      OfferBookmarkManager,
    );
    mock("../../src/commons/data-managers/user-manager", UserManager);
    mock(
      "../../src/commons/data-managers/membership-manager",
      MembershipManager,
    );
    mock(
      "../../src/commons/services/student/application-service",
      ApplicationService,
    );
    mock("../../src/commons/utilities/jwt-helper", JwtHelper);
    mock("../../src/commons/services/company/company-role-service", {
      CompanyRoleService: {},
    });
    mock("../../src/commons/mail-service/mail-controller", {});

    CompanyService = mock.reRequire(
      "../../src/commons/services/company/company-service",
    );
  });

  afterEach(() => {
    sandbox.restore();
    mock.stopAll();
  });

  it("→ 404 when the company does not exist", async () => {
    CompanyManager.getCompany.resolves(null);
    let error;
    try {
      await CompanyService.adminDeleteCompany(T, CO);
    } catch (e) {
      error = e;
    }
    expect(error && error.status).to.equal(404);
    expect(CompanyManager.deleteCompany.called).to.equal(false);
  });

  it("force-deletes offers, branches, invitations, members and the company", async () => {
    OfferManager.getOffersByCompany.resolves([{ id: "o1" }, { id: "o2" }]);
    CompanyBranchManager.getBranchesByCompany.resolves([
      { id: "b1", logoUrl: "" },
    ]);
    MemberInvitationManager.getPendingByCompany.resolves([{ id: "i1" }]);
    CompanyMemberManager.getMembersByCompany.resolves([
      { userId: "owner@x.de", isOwner: true },
      { userId: "m1@x.de", isOwner: false },
    ]);

    const res = await CompanyService.adminDeleteCompany(T, CO);

    expect(OfferMediaManager.removeByOffer.callCount).to.equal(2);
    expect(OfferBookmarkManager.removeByOffer.callCount).to.equal(2);
    expect(OfferManager.removeOffer.callCount).to.equal(2);
    expect(ApplicationService.deleteByCompany.calledWith(T, CO)).to.equal(true);
    expect(CompanyBranchManager.removeBranch.calledWith(T, "b1")).to.equal(
      true,
    );
    expect(MemberInvitationManager.remove.calledWith(T, "i1")).to.equal(true);
    expect(MembershipManager.removeMembership.callCount).to.equal(2);
    expect(CompanyMemberManager.removeMember.callCount).to.equal(2);
    expect(
      JwtHelper.revokeAllUserTokens.calledWith("owner@x.de", "company_deleted"),
    ).to.equal(true);
    expect(UserManager.deleteUser.callCount).to.equal(2);
    expect(CompanyManager.deleteCompany.calledWith(T, CO)).to.equal(true);
    expect(res).to.deep.equal({ deleted: CO });
  });

  it("deletes each offer's media files from storage before removing the offer", async () => {
    OfferManager.getOffersByCompany.resolves([{ id: "o1" }]);
    OfferMediaManager.getMediaByOffer.resolves([
      {
        id: "om1",
        url: "http://x/api/kg/files/get?name=/public/offer-media/a.png",
      },
      {
        id: "om2",
        url: "http://x/api/kg/files/get?name=/public/offer-media/b.mp4",
      },
    ]);

    await CompanyService.adminDeleteCompany(T, CO);

    expect(OfferMediaManager.getMediaByOffer.calledWith(T, "o1")).to.equal(
      true,
    );
    expect(
      NextcloudManager.deleteFile.calledWith(T, "/public/offer-media/a.png"),
    ).to.equal(true);
    expect(
      NextcloudManager.deleteFile.calledWith(T, "/public/offer-media/b.mp4"),
    ).to.equal(true);
    expect(OfferMediaManager.removeByOffer.calledWith(T, "o1")).to.equal(true);
    expect(OfferManager.removeOffer.calledWith(T, "o1")).to.equal(true);
  });

  it("keeps a user who still has other memberships", async () => {
    CompanyMemberManager.getMembersByCompany.resolves([
      { userId: "owner@x.de" },
    ]);
    MembershipManager.getMembershipsByUserID.resolves([{ tenantId: "other" }]);
    await CompanyService.adminDeleteCompany(T, CO);
    expect(UserManager.deleteUser.called).to.equal(false);
    expect(CompanyManager.deleteCompany.calledWith(T, CO)).to.equal(true);
  });
});
