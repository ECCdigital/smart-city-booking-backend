const mock = require("mock-require");
const { expect } = require("chai");
const sinon = require("sinon");

describe("CompanyService — members & invitations", () => {
  let sandbox;
  let CompanyManager;
  let CompanyMemberManager;
  let MemberInvitationManager;
  let UserManager;
  let MembershipManager;
  let CompanyRoleService;
  let CompanyBranchManager;
  let MemberInvitationMail;
  let CompanyService;

  beforeEach(() => {
    sandbox = sinon.createSandbox();
    CompanyManager = {
      getCompany: sandbox
        .stub()
        .resolves({ id: "c1", name: "Muster GmbH", status: "verified" }),
    };
    CompanyMemberManager = {
      getMemberByUser: sandbox.stub().resolves(null),
      getMembersByCompany: sandbox.stub().resolves([]),
      storeMember: sandbox.stub().resolves(),
      removeMember: sandbox.stub().resolves(),
    };
    MemberInvitationManager = {
      getPendingByEmail: sandbox.stub().resolves(null),
      getPendingByEmailInTenant: sandbox.stub().resolves(null),
      getPendingByCompany: sandbox.stub().resolves([]),
      getByToken: sandbox.stub().resolves(null),
      store: sandbox.stub().callsFake(async (i) => i),
      remove: sandbox.stub().resolves(),
    };
    UserManager = {
      getUser: sandbox
        .stub()
        .resolves({ firstName: "Maja", lastName: "M", phone: "1" }),
      getUserBy: sandbox.stub().resolves(null),
      createUser: sandbox.stub().resolves(),
      deleteUser: sandbox.stub().resolves(),
    };
    MembershipManager = {
      getMembershipByTenantAndUserID: sandbox.stub().resolves(null),
      addMembership: sandbox.stub().resolves(),
      updateMembership: sandbox.stub().resolves(),
      addRoleToMembership: sandbox.stub().resolves(),
      removeMembership: sandbox.stub().resolves(),
      getMembershipsByUserID: sandbox.stub().resolves([]),
    };
    CompanyRoleService = {
      ensureUnternehmenRole: sandbox.stub().resolves({ id: "role1" }),
    };
    CompanyBranchManager = {
      getBranch: sandbox.stub().resolves({ id: "b1", companyId: "c1" }),
    };
    MemberInvitationMail = { sendMemberInvitation: sandbox.stub().resolves() };

    mock("../../src/commons/data-managers/company-manager", CompanyManager);
    mock(
      "../../src/commons/data-managers/company-member-manager",
      CompanyMemberManager,
    );
    mock(
      "../../src/commons/data-managers/member-invitation-manager",
      MemberInvitationManager,
    );
    mock("../../src/commons/data-managers/user-manager", UserManager);
    mock(
      "../../src/commons/data-managers/membership-manager",
      MembershipManager,
    );
    mock("../../src/commons/services/company/company-role-service", {
      CompanyRoleService,
    });
    mock(
      "../../src/commons/data-managers/company-branch-manager",
      CompanyBranchManager,
    );
    mock(
      "../../src/commons/services/company/member-invitation-mail",
      MemberInvitationMail,
    );

    CompanyService = mock.reRequire(
      "../../src/commons/services/company/company-service",
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

  const invitePayload = (over = {}) => ({
    email: "neu@team.de",
    firstName: "Nele",
    lastName: "Neu",
    ...over,
  });

  describe("inviteMember", () => {
    it("throws 404 when the company is missing", async () => {
      CompanyManager.getCompany.resolves(null);
      await expectStatus(
        () =>
          CompanyService.inviteMember(
            "kielregion",
            "c1",
            "owner",
            invitePayload(),
          ),
        404,
      );
    });

    it("rejects (403) inviting from a blocked company", async () => {
      CompanyManager.getCompany.resolves({
        id: "c1",
        name: "Muster GmbH",
        status: "blocked",
      });
      await expectStatus(
        () =>
          CompanyService.inviteMember(
            "kielregion",
            "c1",
            "owner",
            invitePayload(),
          ),
        403,
      );
    });

    it("rejects missing required fields (400)", async () => {
      await expectStatus(
        () =>
          CompanyService.inviteMember("kielregion", "c1", "owner", {
            email: "x@y.de",
          }),
        400,
      );
    });

    it("rejects an invalid email (400)", async () => {
      await expectStatus(
        () =>
          CompanyService.inviteMember(
            "kielregion",
            "c1",
            "owner",
            invitePayload({ email: "not-an-email" }),
          ),
        400,
      );
    });

    it("rejects a branch that does not belong to the company (400)", async () => {
      CompanyBranchManager.getBranch.resolves({ id: "b1", companyId: "other" });
      await expectStatus(
        () =>
          CompanyService.inviteMember(
            "kielregion",
            "c1",
            "owner",
            invitePayload({ branchId: "b1" }),
          ),
        400,
      );
    });

    it("rejects a branch that does not exist (400)", async () => {
      CompanyBranchManager.getBranch.resolves(null);
      await expectStatus(
        () =>
          CompanyService.inviteMember(
            "kielregion",
            "c1",
            "owner",
            invitePayload({ branchId: "ghost" }),
          ),
        400,
      );
    });

    it("rejects (409) an email that already has an account", async () => {
      UserManager.getUserBy.resolves({ id: "x@y.de" });
      await expectStatus(
        () =>
          CompanyService.inviteMember(
            "kielregion",
            "c1",
            "owner",
            invitePayload(),
          ),
        409,
      );
    });

    it("accepts a valid branch of this company", async () => {
      CompanyBranchManager.getBranch.resolves({ id: "b1", companyId: "c1" });
      const dto = await CompanyService.inviteMember(
        "kielregion",
        "c1",
        "owner",
        invitePayload({ branchId: "b1" }),
      );
      expect(
        CompanyBranchManager.getBranch.calledWith("kielregion", "b1"),
      ).to.equal(true);
      expect(dto.branchId).to.equal("b1");
    });

    it("accepts an all-branches scope ('') without validating a branch", async () => {
      const dto = await CompanyService.inviteMember(
        "kielregion",
        "c1",
        "owner",
        invitePayload({ branchId: "" }),
      );
      expect(CompanyBranchManager.getBranch.called).to.equal(false);
      expect(dto.branchId).to.equal("");
      expect(dto.status).to.equal("pending");
    });

    it("rejects when the user is already a member (409)", async () => {
      CompanyMemberManager.getMemberByUser.resolves({
        companyId: "c1",
        userId: "neu@team.de",
      });
      await expectStatus(
        () =>
          CompanyService.inviteMember(
            "kielregion",
            "c1",
            "owner",
            invitePayload(),
          ),
        409,
      );
    });

    it("rejects when an invitation is already pending anywhere in the tenant (409)", async () => {
      MemberInvitationManager.getPendingByEmailInTenant.resolves({ id: "i1" });
      await expectStatus(
        () =>
          CompanyService.inviteMember(
            "kielregion",
            "c1",
            "owner",
            invitePayload(),
          ),
        409,
      );
      expect(
        MemberInvitationManager.getPendingByEmailInTenant.calledWith(
          "kielregion",
          "neu@team.de",
        ),
      ).to.equal(true);
    });

    it("creates a pending invitation, sends the email, returns a DTO without the token", async () => {
      const dto = await CompanyService.inviteMember(
        "kielregion",
        "c1",
        "owner@x.de",
        invitePayload({ branchId: "b1", phone: "0431" }),
      );
      const stored = MemberInvitationManager.store.firstCall.args[0];
      expect(stored.email).to.equal("neu@team.de");
      expect(stored.status).to.equal("pending");
      expect(stored.branchId).to.equal("b1");
      expect(stored.token).to.be.a("string").with.length.greaterThan(20);
      expect(stored.invitedBy).to.equal("owner@x.de");
      expect(MemberInvitationMail.sendMemberInvitation.calledOnce).to.equal(
        true,
      );
      const mailArgs =
        MemberInvitationMail.sendMemberInvitation.firstCall.args[0];
      expect(mailArgs.companyName).to.equal("Muster GmbH");
      expect(mailArgs.sendTo).to.equal("neu@team.de");
      expect(mailArgs.token).to.equal(stored.token);
      expect(dto).to.deep.equal({
        userId: "neu@team.de",
        email: "neu@team.de",
        firstName: "Nele",
        lastName: "Neu",
        phone: "0431",
        branchId: "b1",
        isOwner: false,
        status: "pending",
      });
      expect(dto).to.not.have.property("token");
    });

    it("still succeeds if the invite email fails to send", async () => {
      MemberInvitationMail.sendMemberInvitation.rejects(new Error("mail down"));
      const dto = await CompanyService.inviteMember(
        "kielregion",
        "c1",
        "owner",
        invitePayload(),
      );
      expect(dto.status).to.equal("pending");
      expect(MemberInvitationManager.store.calledOnce).to.equal(true);
    });
  });

  describe("listCompanyMembers", () => {
    it("returns active members (with user details) and pending invitations, each with a status", async () => {
      CompanyMemberManager.getMembersByCompany.resolves([
        { userId: "owner@x.de", branchId: "", isOwner: true },
      ]);
      UserManager.getUserBy.resolves({
        firstName: "Olga",
        lastName: "Owner",
        phone: "999",
      });
      MemberInvitationManager.getPendingByCompany.resolves([
        {
          email: "neu@team.de",
          firstName: "Nele",
          lastName: "Neu",
          phone: "",
          branchId: "b1",
        },
      ]);
      const list = await CompanyService.listCompanyMembers("kielregion", "c1");
      expect(list).to.have.length(2);
      expect(list[0]).to.include({
        userId: "owner@x.de",
        firstName: "Olga",
        isOwner: true,
        status: "active",
      });
      expect(list[1]).to.include({
        userId: "neu@team.de",
        branchId: "b1",
        isOwner: false,
        status: "pending",
      });
    });
  });

  describe("removeCompanyMember", () => {
    it("refuses to remove the owner (403)", async () => {
      CompanyMemberManager.getMemberByUser.resolves({
        companyId: "c1",
        userId: "owner@x.de",
        isOwner: true,
      });
      await expectStatus(
        () =>
          CompanyService.removeCompanyMember("kielregion", "c1", "owner@x.de"),
        403,
      );
      expect(UserManager.deleteUser.called).to.equal(false);
    });

    it("removes an active member's account completely", async () => {
      CompanyMemberManager.getMemberByUser.resolves({
        companyId: "c1",
        userId: "m@x.de",
        isOwner: false,
      });
      const result = await CompanyService.removeCompanyMember(
        "kielregion",
        "c1",
        "m@x.de",
      );
      expect(
        CompanyMemberManager.removeMember.calledWith(
          "kielregion",
          "c1",
          "m@x.de",
        ),
      ).to.equal(true);
      expect(
        MembershipManager.removeMembership.calledWith("kielregion", "m@x.de"),
      ).to.equal(true);
      expect(UserManager.deleteUser.calledWith("m@x.de")).to.equal(true);
      expect(result.removed).to.equal("m@x.de");
    });

    it("keeps the user account when memberships remain elsewhere", async () => {
      CompanyMemberManager.getMemberByUser.resolves({
        companyId: "c1",
        userId: "m@x.de",
        isOwner: false,
      });
      MembershipManager.getMembershipsByUserID.resolves([
        { tenantId: "other", userId: "m@x.de" },
      ]);
      await CompanyService.removeCompanyMember("kielregion", "c1", "m@x.de");
      expect(
        MembershipManager.removeMembership.calledWith("kielregion", "m@x.de"),
      ).to.equal(true);
      expect(UserManager.deleteUser.called).to.equal(false);
    });

    it("cancels a pending invitation", async () => {
      CompanyMemberManager.getMemberByUser.resolves(null);
      MemberInvitationManager.getPendingByEmail.resolves({ id: "i1" });
      const result = await CompanyService.removeCompanyMember(
        "kielregion",
        "c1",
        "neu@team.de",
      );
      expect(
        MemberInvitationManager.remove.calledWith("kielregion", "i1"),
      ).to.equal(true);
      expect(UserManager.deleteUser.called).to.equal(false);
      expect(result.removed).to.equal("neu@team.de");
    });

    it("does not delete a user who is a member of a DIFFERENT company (404, no deletion)", async () => {
      CompanyMemberManager.getMemberByUser.resolves({
        companyId: "other",
        userId: "m@x.de",
        isOwner: false,
      });
      await expectStatus(
        () => CompanyService.removeCompanyMember("kielregion", "c1", "m@x.de"),
        404,
      );
      expect(UserManager.deleteUser.called).to.equal(false);
      expect(CompanyMemberManager.removeMember.called).to.equal(false);
    });

    it("throws 404 when neither a member nor a pending invite exists", async () => {
      await expectStatus(
        () => CompanyService.removeCompanyMember("kielregion", "c1", "x@x.de"),
        404,
      );
    });

    it("with a branch scope, removes a member in the same branch", async () => {
      CompanyMemberManager.getMemberByUser.resolves({
        companyId: "c1",
        userId: "m@x.de",
        isOwner: false,
        branchId: "b1",
      });
      const result = await CompanyService.removeCompanyMember(
        "kielregion",
        "c1",
        "m@x.de",
        "b1",
      );
      expect(UserManager.deleteUser.calledWith("m@x.de")).to.equal(true);
      expect(result.removed).to.equal("m@x.de");
    });

    it("with a branch scope, refuses a member in a different branch (403)", async () => {
      CompanyMemberManager.getMemberByUser.resolves({
        companyId: "c1",
        userId: "m@x.de",
        isOwner: false,
        branchId: "b2",
      });
      await expectStatus(
        () =>
          CompanyService.removeCompanyMember(
            "kielregion",
            "c1",
            "m@x.de",
            "b1",
          ),
        403,
      );
      expect(UserManager.deleteUser.called).to.equal(false);
      expect(CompanyMemberManager.removeMember.called).to.equal(false);
    });

    it("with a branch scope, cancels a pending invite in the same branch", async () => {
      CompanyMemberManager.getMemberByUser.resolves(null);
      MemberInvitationManager.getPendingByEmail.resolves({
        id: "i1",
        branchId: "b1",
      });
      const result = await CompanyService.removeCompanyMember(
        "kielregion",
        "c1",
        "neu@team.de",
        "b1",
      );
      expect(
        MemberInvitationManager.remove.calledWith("kielregion", "i1"),
      ).to.equal(true);
      expect(result.removed).to.equal("neu@team.de");
    });

    it("with a branch scope, refuses a pending invite in a different branch (403)", async () => {
      CompanyMemberManager.getMemberByUser.resolves(null);
      MemberInvitationManager.getPendingByEmail.resolves({
        id: "i1",
        branchId: "b2",
      });
      await expectStatus(
        () =>
          CompanyService.removeCompanyMember(
            "kielregion",
            "c1",
            "neu@team.de",
            "b1",
          ),
        403,
      );
      expect(MemberInvitationManager.remove.called).to.equal(false);
    });
  });

  describe("acceptMemberInvitation", () => {
    const pendingInvite = () => ({
      id: "i1",
      tenantId: "kielregion",
      companyId: "c1",
      email: "neu@team.de",
      firstName: "Nele",
      lastName: "Neu",
      phone: "0431-999",
      branchId: "b1",
      status: "pending",
    });

    it("throws 404 for an invalid/expired token", async () => {
      MemberInvitationManager.getByToken.resolves(null);
      await expectStatus(
        () =>
          CompanyService.acceptMemberInvitation(
            "kielregion",
            "tok",
            "secret123",
          ),
        404,
      );
    });

    it("throws 404 when the token belongs to another tenant", async () => {
      MemberInvitationManager.getByToken.resolves({
        ...pendingInvite(),
        tenantId: "other",
      });
      await expectStatus(
        () =>
          CompanyService.acceptMemberInvitation(
            "kielregion",
            "tok",
            "secret123",
          ),
        404,
      );
    });

    it("rejects a short password (400)", async () => {
      MemberInvitationManager.getByToken.resolves(pendingInvite());
      await expectStatus(
        () =>
          CompanyService.acceptMemberInvitation("kielregion", "tok", "short"),
        400,
      );
    });

    it("for a new user: creates the (verified) user, active membership + role, company_member, and removes the invite", async () => {
      MemberInvitationManager.getByToken.resolves(pendingInvite());
      UserManager.getUserBy.resolves(null);
      const result = await CompanyService.acceptMemberInvitation(
        "kielregion",
        "tok",
        "secret123",
      );
      expect(UserManager.createUser.calledOnce).to.equal(true);
      const createdUser = UserManager.createUser.firstCall.args[0];
      expect(createdUser.id).to.equal("neu@team.de");
      expect(createdUser.isVerified).to.equal(true);
      expect(createdUser.phone).to.equal("0431-999");
      expect(createdUser.secret).to.be.a("string").and.not.equal("");
      expect(
        MembershipManager.addRoleToMembership.calledWith(
          "kielregion",
          "neu@team.de",
          "role1",
        ),
      ).to.equal(true);
      const storedMember = CompanyMemberManager.storeMember.firstCall.args[0];
      expect(storedMember.userId).to.equal("neu@team.de");
      expect(storedMember.isOwner).to.equal(false);
      expect(storedMember.branchId).to.equal("b1");
      expect(
        MemberInvitationManager.remove.calledWith("kielregion", "i1"),
      ).to.equal(true);
      expect(result).to.deep.equal({
        companyId: "c1",
        userId: "neu@team.de",
      });
    });

    it("rejects (403) accepting into a blocked company", async () => {
      MemberInvitationManager.getByToken.resolves(pendingInvite());
      CompanyManager.getCompany.resolves({
        id: "c1",
        name: "Muster GmbH",
        status: "blocked",
      });
      await expectStatus(
        () =>
          CompanyService.acceptMemberInvitation(
            "kielregion",
            "tok",
            "secret123",
          ),
        403,
      );
      expect(UserManager.createUser.called).to.equal(false);
    });

    it("creates a PENDING membership without a role for an unverified company", async () => {
      MemberInvitationManager.getByToken.resolves(pendingInvite());
      UserManager.getUserBy.resolves(null);
      CompanyManager.getCompany.resolves({
        id: "c1",
        name: "Muster GmbH",
        status: "unverified",
      });
      await CompanyService.acceptMemberInvitation(
        "kielregion",
        "tok",
        "secret123",
      );
      const membership = MembershipManager.addMembership.firstCall.args[1];
      expect(membership.status).to.equal("pending");
      expect(MembershipManager.addRoleToMembership.called).to.equal(false);
    });

    it("rejects (409) an existing account and does not link or create anything", async () => {
      MemberInvitationManager.getByToken.resolves(pendingInvite());
      UserManager.getUserBy.resolves({ id: "neu@team.de", secret: "existing" });
      await expectStatus(
        () =>
          CompanyService.acceptMemberInvitation(
            "kielregion",
            "tok",
            "secret123",
          ),
        409,
      );
      expect(UserManager.createUser.called).to.equal(false);
      expect(CompanyMemberManager.storeMember.called).to.equal(false);
    });

    it("rejects (410) an expired invitation", async () => {
      MemberInvitationManager.getByToken.resolves({
        ...pendingInvite(),
        expiresAt: Date.now() - 1000,
      });
      await expectStatus(
        () =>
          CompanyService.acceptMemberInvitation(
            "kielregion",
            "tok",
            "secret123",
          ),
        410,
      );
    });

    it("rejects (400) a password without a digit", async () => {
      MemberInvitationManager.getByToken.resolves(pendingInvite());
      UserManager.getUserBy.resolves(null);
      await expectStatus(
        () =>
          CompanyService.acceptMemberInvitation(
            "kielregion",
            "tok",
            "onlyletters",
          ),
        400,
      );
    });

    it("rejects (409) if the invitee already belongs to a company (no duplicate row)", async () => {
      MemberInvitationManager.getByToken.resolves(pendingInvite());
      CompanyMemberManager.getMemberByUser.resolves({
        companyId: "other",
        userId: "neu@team.de",
      });
      await expectStatus(
        () =>
          CompanyService.acceptMemberInvitation(
            "kielregion",
            "tok",
            "secret123",
          ),
        409,
      );
      expect(CompanyMemberManager.storeMember.called).to.equal(false);
      expect(UserManager.createUser.called).to.equal(false);
    });

    it("keeps the scoped branch when it still exists", async () => {
      MemberInvitationManager.getByToken.resolves(pendingInvite());
      CompanyBranchManager.getBranch.resolves({ id: "b1", companyId: "c1" });
      await CompanyService.acceptMemberInvitation(
        "kielregion",
        "tok",
        "secret123",
      );
      const storedMember = CompanyMemberManager.storeMember.firstCall.args[0];
      expect(storedMember.branchId).to.equal("b1");
    });

    it("falls back to all-branches when the scoped branch was deleted", async () => {
      MemberInvitationManager.getByToken.resolves(pendingInvite());
      CompanyBranchManager.getBranch.resolves(null);
      await CompanyService.acceptMemberInvitation(
        "kielregion",
        "tok",
        "secret123",
      );
      const storedMember = CompanyMemberManager.storeMember.firstCall.args[0];
      expect(storedMember.branchId).to.equal("");
    });
  });
});
