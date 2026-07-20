const mock = require("mock-require");
const { expect } = require("chai");
const sinon = require("sinon");

describe("CompanyService", () => {
  let sandbox;
  let UserManager;
  let UserService;
  let MembershipManager;
  let TenantManager;
  let TaxonomyTermManager;
  let CompanyManager;
  let CompanyMemberManager;
  let CompanyRoleService;
  let MailController;
  let MemberInvitationMail;
  let MemberInvitationManager;
  let JwtHelper;
  let CompanyService;

  const validPayload = () => ({
    owner: {
      id: "Owner@Example.de",
      password: "secret123",
      firstName: "Anna",
      lastName: "Berg",
    },
    company: {
      name: "Test Firma GmbH",
      mail: "info@test.de",
      street: "Hauptstr. 1",
      postalCode: "24103",
      city: "Kiel",
      phone: "0431 123456",
    },
    consents: {
      privacyConsent: true,
      authorizedToRepresent: true,
      consent: true,
    },
  });

  beforeEach(() => {
    sandbox = sinon.createSandbox();

    UserManager = {
      getUserBy: sandbox.stub().resolves(null),
      updateUser: sandbox.stub().resolves(),
    };
    UserService = { singUpUser: sandbox.stub().resolves() };
    MembershipManager = {
      getMembershipByTenantAndUserID: sandbox.stub().resolves(null),
      addMembership: sandbox.stub().resolves(),
      updateMembership: sandbox.stub().resolves(),
      addRoleToMembership: sandbox.stub().resolves(),
      removeRoleFromMembership: sandbox.stub().resolves(),
    };
    TenantManager = {
      getTenant: sandbox.stub().resolves({ id: "kielregion" }),
    };
    TaxonomyTermManager = { getTerm: sandbox.stub().resolves(null) };
    CompanyManager = {
      getCompany: sandbox.stub(),
      storeCompany: sandbox.stub().callsFake(async (company) => company),
      setStatus: sandbox.stub().resolves(),
    };
    CompanyMemberManager = {
      storeMember: sandbox.stub().resolves(),
      getMembersByCompany: sandbox.stub().resolves([]),
      getMemberByUser: sandbox.stub().resolves(null),
    };
    CompanyRoleService = {
      ensureUnternehmenRole: sandbox.stub().resolves({ id: "unternehmen" }),
    };
    MailController = {
      sendVerificationRequest: sandbox.stub().resolves(),
    };
    MemberInvitationMail = { sendMemberInvitation: sandbox.stub().resolves() };
    MemberInvitationManager = {
      getPendingByEmailInTenant: sandbox.stub().resolves(null),
      store: sandbox.stub().callsFake(async (invitation) => invitation),
    };
    JwtHelper = { revokeAllUserTokens: sandbox.stub().resolves() };

    mock("../../src/commons/data-managers/user-manager", UserManager);
    mock("../../src/commons/services/user-service", UserService);
    mock(
      "../../src/commons/data-managers/membership-manager",
      MembershipManager,
    );
    mock("../../src/commons/data-managers/tenant-manager", TenantManager);
    mock(
      "../../src/commons/data-managers/taxonomy-term-manager",
      TaxonomyTermManager,
    );
    mock("../../src/commons/data-managers/company-manager", CompanyManager);
    mock(
      "../../src/commons/data-managers/company-member-manager",
      CompanyMemberManager,
    );
    mock("../../src/commons/services/company/company-role-service", {
      CompanyRoleService,
    });
    mock("../../src/commons/mail-service/mail-controller", MailController);
    mock(
      "../../src/commons/services/company/member-invitation-mail",
      MemberInvitationMail,
    );
    mock(
      "../../src/commons/data-managers/member-invitation-manager",
      MemberInvitationManager,
    );
    mock("../../src/commons/utilities/jwt-helper", JwtHelper);

    CompanyService = mock.reRequire(
      "../../src/commons/services/company/company-service",
    );
  });

  afterEach(() => {
    sandbox.restore();
    mock.stopAll();
  });

  describe("registerCompany", () => {
    it("creates user, pending membership, company and owner member", async () => {
      const company = await CompanyService.registerCompany(
        "kielregion",
        validPayload(),
      );

      expect(UserService.singUpUser.calledOnce).to.equal(true);

      const membershipArgs = MembershipManager.addMembership.firstCall.args;
      expect(membershipArgs[0]).to.equal("kielregion");
      expect(membershipArgs[1].userId).to.equal("owner@example.de");
      expect(membershipArgs[1].source).to.equal("public");
      expect(membershipArgs[1].status).to.equal("pending");
      expect(membershipArgs[1].owner).to.equal(false);

      const storedCompany = CompanyManager.storeCompany.firstCall.args[0];
      expect(storedCompany.status).to.equal("unverified");
      expect(storedCompany.tenantId).to.equal("kielregion");
      expect(storedCompany.name).to.equal("Test Firma GmbH");

      const memberArgs = CompanyMemberManager.storeMember.firstCall.args[0];
      expect(memberArgs.userId).to.equal("owner@example.de");
      expect(memberArgs.isOwner).to.equal(true);
      expect(memberArgs.companyId).to.equal(storedCompany.id);

      expect(company.name).to.equal("Test Firma GmbH");
    });

    it("normalizes the owner email to lowercase", async () => {
      await CompanyService.registerCompany("kielregion", validPayload());
      expect(UserManager.getUserBy.firstCall.args[0]).to.deep.equal({
        id: "owner@example.de",
      });
    });

    it("rejects when required fields are missing (400)", async () => {
      const payload = validPayload();
      delete payload.company.name;
      let error;
      try {
        await CompanyService.registerCompany("kielregion", payload);
      } catch (e) {
        error = e;
      }
      expect(error).to.exist;
      expect(error.status).to.equal(400);
      expect(UserService.singUpUser.called).to.equal(false);
    });

    it("rejects when the password is too short (400)", async () => {
      const payload = validPayload();
      payload.owner.password = "short";
      let error;
      try {
        await CompanyService.registerCompany("kielregion", payload);
      } catch (e) {
        error = e;
      }
      expect(error.status).to.equal(400);
      expect(UserService.singUpUser.called).to.equal(false);
    });

    it("rejects when a consent is missing (400)", async () => {
      const payload = validPayload();
      payload.consents.authorizedToRepresent = false;
      let error;
      try {
        await CompanyService.registerCompany("kielregion", payload);
      } catch (e) {
        error = e;
      }
      expect(error.status).to.equal(400);
    });

    const expectReject = async (mutate) => {
      const payload = validPayload();
      mutate(payload);
      let error;
      try {
        await CompanyService.registerCompany("kielregion", payload);
      } catch (e) {
        error = e;
      }
      expect(error && error.status).to.equal(400);
      expect(UserService.singUpUser.called).to.equal(false);
    };

    it("rejects an invalid email (400)", () =>
      expectReject((p) => (p.owner.id = "1")));
    it("rejects a purely-numeric password (400)", () =>
      expectReject((p) => (p.owner.password = "123456789")));
    it("rejects a letters-only password (400)", () =>
      expectReject((p) => (p.owner.password = "abcdefgh")));
    it("rejects a non-5-digit PLZ (400)", () =>
      expectReject((p) => (p.company.postalCode = "1")));
    it("rejects a too-short phone (400)", () =>
      expectReject((p) => (p.company.phone = "1")));
    it("rejects a single-character company name (400)", () =>
      expectReject((p) => (p.company.name = "1")));
    it("rejects an invalid website (400)", () =>
      expectReject((p) => (p.company.website = "not-a-url")));
    it("accepts a valid https website (no throw)", async () => {
      const payload = validPayload();
      payload.company.website = "https://example.de";
      await CompanyService.registerCompany("kielregion", payload);
      expect(UserService.singUpUser.calledOnce).to.equal(true);
    });
    it("rejects a description over the max length (400)", () =>
      expectReject((p) => (p.company.description = "x".repeat(2001))));
    it("accepts a description at the max length (no throw)", async () => {
      const payload = validPayload();
      payload.company.description = "x".repeat(2000);
      await CompanyService.registerCompany("kielregion", payload);
      expect(UserService.singUpUser.calledOnce).to.equal(true);
    });
    it("stores the location as a GeoJSON Point when lat/lng are provided", async () => {
      const payload = validPayload();
      payload.company.lat = 54.32;
      payload.company.lng = 10.14;
      await CompanyService.registerCompany("kielregion", payload);
      const stored = CompanyManager.storeCompany.firstCall.args[0];
      expect(stored.location).to.deep.equal({
        type: "Point",
        coordinates: [10.14, 54.32],
      });
    });
    it("rejects lat without lng (400)", () =>
      expectReject((p) => {
        p.company.lat = 54.32;
      }));

    it("rejects when the tenant does not exist (404)", async () => {
      TenantManager.getTenant.resolves(null);
      let error;
      try {
        await CompanyService.registerCompany("ghost", validPayload());
      } catch (e) {
        error = e;
      }
      expect(error.status).to.equal(404);
      expect(UserService.singUpUser.called).to.equal(false);
    });

    it("rejects when the selected Kreis is not in the database (400)", async () => {
      const payload = validPayload();
      payload.company.districtId = "district-bogus";
      TaxonomyTermManager.getTerm.resolves(null);
      let error;
      try {
        await CompanyService.registerCompany("kielregion", payload);
      } catch (e) {
        error = e;
      }
      expect(error.status).to.equal(400);
      expect(UserService.singUpUser.called).to.equal(false);
    });

    it("accepts a valid Kreis taxonomy reference", async () => {
      const payload = validPayload();
      payload.company.districtId = "district-kiel";
      TaxonomyTermManager.getTerm.resolves({
        id: "district-kiel",
        type: "district",
        active: true,
      });
      const company = await CompanyService.registerCompany(
        "kielregion",
        payload,
      );
      expect(company.districtId).to.equal("district-kiel");
    });

    it("rejects when the email is already in use (409)", async () => {
      UserManager.getUserBy.resolves({ id: "owner@example.de" });
      let error;
      try {
        await CompanyService.registerCompany("kielregion", validPayload());
      } catch (e) {
        error = e;
      }
      expect(error.status).to.equal(409);
      expect(UserService.singUpUser.called).to.equal(false);
    });
  });

  describe("verifyCompany", () => {
    it("activates members, assigns the role and verifies the company", async () => {
      CompanyManager.getCompany.resolves({ id: "c1", status: "unverified" });
      CompanyMemberManager.getMembersByCompany.resolves([
        { userId: "a@x.de" },
        { userId: "b@x.de" },
      ]);

      await CompanyService.verifyCompany("kielregion", "c1");

      expect(
        CompanyRoleService.ensureUnternehmenRole.calledWith("kielregion"),
      ).to.equal(true);
      expect(MembershipManager.updateMembership.callCount).to.equal(2);
      expect(
        MembershipManager.updateMembership.calledWith("kielregion", "a@x.de", {
          status: "active",
        }),
      ).to.equal(true);
      expect(
        MembershipManager.addRoleToMembership.calledWith(
          "kielregion",
          "b@x.de",
          "unternehmen",
        ),
      ).to.equal(true);
      expect(
        CompanyManager.setStatus.calledWith("kielregion", "c1", "verified"),
      ).to.equal(true);
    });

    it("un-suspends the member user accounts (unblock path)", async () => {
      CompanyManager.getCompany.resolves({ id: "c1", status: "blocked" });
      CompanyMemberManager.getMembersByCompany.resolves([{ userId: "a@x.de" }]);
      UserManager.getUserBy.resolves({ id: "a@x.de", isSuspended: true });

      await CompanyService.verifyCompany("kielregion", "c1");

      expect(UserManager.getUserBy.calledWith({ id: "a@x.de" }, true)).to.equal(
        true,
      );
      const saved = UserManager.updateUser.firstCall.args[0];
      expect(saved.isSuspended).to.equal(false);
    });

    it("throws 404 when the company does not exist", async () => {
      CompanyManager.getCompany.resolves(null);
      let error;
      try {
        await CompanyService.verifyCompany("kielregion", "missing");
      } catch (e) {
        error = e;
      }
      expect(error.status).to.equal(404);
    });
  });

  describe("blockCompany", () => {
    it("suspends members and blocks the company", async () => {
      CompanyManager.getCompany.resolves({ id: "c1", status: "verified" });
      CompanyMemberManager.getMembersByCompany.resolves([{ userId: "a@x.de" }]);

      await CompanyService.blockCompany("kielregion", "c1");

      expect(
        MembershipManager.updateMembership.calledWith("kielregion", "a@x.de", {
          status: "suspended",
        }),
      ).to.equal(true);
      expect(
        CompanyManager.setStatus.calledWith("kielregion", "c1", "blocked"),
      ).to.equal(true);
      expect(
        JwtHelper.revokeAllUserTokens.calledWith("a@x.de", "company_blocked"),
      ).to.equal(true);
    });

    it("suspends the member user accounts so they can no longer log in", async () => {
      CompanyManager.getCompany.resolves({ id: "c1", status: "verified" });
      CompanyMemberManager.getMembersByCompany.resolves([{ userId: "a@x.de" }]);
      UserManager.getUserBy.resolves({ id: "a@x.de", isSuspended: false });

      await CompanyService.blockCompany("kielregion", "c1");

      expect(UserManager.getUserBy.calledWith({ id: "a@x.de" }, true)).to.equal(
        true,
      );
      const saved = UserManager.updateUser.firstCall.args[0];
      expect(saved.isSuspended).to.equal(true);
    });
  });

  describe("resendVerification", () => {
    it("regenerates the hook and re-sends the email for an unverified member", async () => {
      CompanyMemberManager.getMemberByUser.resolves({
        userId: "test@company.com",
      });
      const addHook = sandbox.stub().returns({ id: "hook-1" });
      UserManager.getUserBy.resolves({
        id: "test@company.com",
        isVerified: false,
        addHook,
      });

      await CompanyService.resendVerification("kielregion", "Test@Company.com");

      expect(addHook.calledOnce).to.equal(true);
      expect(UserManager.updateUser.calledOnce).to.equal(true);
      expect(
        MailController.sendVerificationRequest.calledWith(
          "test@company.com",
          "hook-1",
        ),
      ).to.equal(true);
    });

    it("does nothing for an already-verified user", async () => {
      CompanyMemberManager.getMemberByUser.resolves({
        userId: "test@company.com",
      });
      UserManager.getUserBy.resolves({
        id: "test@company.com",
        isVerified: true,
        addHook: sandbox.stub(),
      });

      await CompanyService.resendVerification("kielregion", "test@company.com");

      expect(MailController.sendVerificationRequest.called).to.equal(false);
    });

    it("does nothing for a non-member email (no enumeration)", async () => {
      CompanyMemberManager.getMemberByUser.resolves(null);

      await CompanyService.resendVerification("kielregion", "stranger@x.de");

      expect(UserManager.getUserBy.called).to.equal(false);
      expect(MailController.sendVerificationRequest.called).to.equal(false);
    });

    it("rejects when the email is missing (400)", async () => {
      let error;
      try {
        await CompanyService.resendVerification("kielregion", "");
      } catch (e) {
        error = e;
      }
      expect(error.status).to.equal(400);
    });

    it("throttles a second resend within the cooldown (429)", async () => {
      CompanyMemberManager.getMemberByUser.resolves({
        userId: "test@company.com",
      });
      UserManager.getUserBy.resolves({
        id: "test@company.com",
        isVerified: false,
        addHook: sandbox.stub().returns({ id: "hook-1" }),
      });

      await CompanyService.resendVerification("kielregion", "test@company.com");

      let error;
      try {
        await CompanyService.resendVerification(
          "kielregion",
          "test@company.com",
        );
      } catch (e) {
        error = e;
      }
      expect(error && error.status).to.equal(429);
      expect(MailController.sendVerificationRequest.calledOnce).to.equal(true);
    });
  });

  describe("unverifyCompany", () => {
    it("throws 404 when the company does not exist", async () => {
      CompanyManager.getCompany.resolves(null);
      let error;
      try {
        await CompanyService.unverifyCompany("kielregion", "c1");
      } catch (e) {
        error = e;
      }
      expect(error && error.status).to.equal(404);
    });

    it("reverts members to pending, removes the role and sets status unverified", async () => {
      CompanyManager.getCompany.resolves({ id: "c1", status: "verified" });
      CompanyMemberManager.getMembersByCompany.resolves([{ userId: "m@x.de" }]);
      await CompanyService.unverifyCompany("kielregion", "c1");
      expect(
        MembershipManager.updateMembership.calledWith("kielregion", "m@x.de", {
          status: "pending",
        }),
      ).to.equal(true);
      expect(MembershipManager.removeRoleFromMembership.calledOnce).to.equal(
        true,
      );
      expect(
        CompanyManager.setStatus.calledWith("kielregion", "c1", "unverified"),
      ).to.equal(true);
    });

    it("lifts a block-suspension (blocked → unverified un-suspends members)", async () => {
      CompanyManager.getCompany.resolves({ id: "c1", status: "blocked" });
      CompanyMemberManager.getMembersByCompany.resolves([{ userId: "m@x.de" }]);
      UserManager.getUserBy.resolves({ id: "m@x.de", isSuspended: true });
      await CompanyService.unverifyCompany("kielregion", "c1");
      expect(UserManager.updateUser.calledOnce).to.equal(true);
      expect(UserManager.updateUser.firstCall.args[0].isSuspended).to.equal(
        false,
      );
    });
  });

  describe("adminCreateCompany", () => {
    const payload = () => ({
      owner: {
        email: "Owner@Example.de",
        firstName: "Anna",
        lastName: "Berg",
      },
      company: {
        name: "Neue Firma GmbH",
        street: "Hauptstr. 1",
        postalCode: "24103",
        city: "Kiel",
        phone: "0431 123456",
      },
    });

    it("creates a verified company and a pending OWNER invitation", async () => {
      const result = await CompanyService.adminCreateCompany(
        "kielregion",
        payload(),
      );
      expect(CompanyManager.storeCompany.calledOnce).to.equal(true);
      expect(CompanyManager.storeCompany.firstCall.args[0].status).to.equal(
        "verified",
      );
      const stored = MemberInvitationManager.store.firstCall.args[0];
      expect(stored.isOwner).to.equal(true);
      expect(stored.email).to.equal("owner@example.de");
      expect(stored.status).to.equal("pending");
      expect(result.invitation.isOwner).to.equal(true);
    });

    it("rejects an invalid owner email (400) and stores nothing", async () => {
      const bad = payload();
      bad.owner.email = "not-an-email";
      let error;
      try {
        await CompanyService.adminCreateCompany("kielregion", bad);
      } catch (e) {
        error = e;
      }
      expect(error && error.status).to.equal(400);
      expect(CompanyManager.storeCompany.called).to.equal(false);
    });

    it("rejects (409) when the email is already in use", async () => {
      UserManager.getUserBy.resolves({ id: "owner@example.de" });
      let error;
      try {
        await CompanyService.adminCreateCompany("kielregion", payload());
      } catch (e) {
        error = e;
      }
      expect(error && error.status).to.equal(409);
      expect(CompanyManager.storeCompany.called).to.equal(false);
    });

    it("rejects (409) when a membership already exists in this tenant", async () => {
      MembershipManager.getMembershipByTenantAndUserID.resolves({
        userId: "owner@example.de",
      });
      let error;
      try {
        await CompanyService.adminCreateCompany("kielregion", payload());
      } catch (e) {
        error = e;
      }
      expect(error && error.status).to.equal(409);
      expect(CompanyManager.storeCompany.called).to.equal(false);
    });

    it("rejects (409) when an invitation for this email is already pending", async () => {
      MemberInvitationManager.getPendingByEmailInTenant.resolves({
        id: "inv1",
      });
      let error;
      try {
        await CompanyService.adminCreateCompany("kielregion", payload());
      } catch (e) {
        error = e;
      }
      expect(error && error.status).to.equal(409);
      expect(CompanyManager.storeCompany.called).to.equal(false);
    });
  });
});
