/**
 * The owners' notice of an invitation accepted (ECCdigital/tickets#36):
 * whoever becomes an active member of a tenant by an invitation - accepted
 * directly or after a manual approval, single invitation or multi-use link
 * - makes `InvitationService` call the mail module once with the tenant,
 * the new member and the names of their roles. Pending approvals, failed
 * challenges, rejections and a member taking a link again do not. A send
 * that fails leaves the membership and the answer alone.
 *
 * The data managers are an in-memory store, the mail module is stubbed at
 * `notify`; what the mail says is `mail-compose.test.js`.
 */

const { expect } = require("chai");
const sinon = require("sinon");

const InvitationService = require("../src/commons/services/invitation-service");
const mailService = require("../src/commons/mail-service");
const MembershipManager = require("../src/commons/data-managers/membership-manager");
const InvitationManager = require("../src/commons/data-managers/invitation-manager");
const ChallengeManager = require("../src/commons/data-managers/challenge-manager");
const { RoleManager } = require("../src/commons/data-managers/role-manager");
const ChallengeService = require("../src/commons/services/challenge/challenge-service");

const TENANT = "stadthalle";
const MEMBER = "neu@example.test";

describe("invitation service: the owners' notice of an invitation accepted", function () {
  let memberships;
  let invitations;
  let challengeAnswer;
  let notify;

  const copy = (value) => JSON.parse(JSON.stringify(value));

  function invitation(overrides = {}) {
    return {
      tenantId: TENANT,
      token: "tok-single",
      type: "single",
      status: "active",
      intendedUserId: MEMBER,
      roles: ["role-sekretariat"],
      challenges: [],
      usedCount: 0,
      maxUses: null,
      expiresAt: null,
      ...overrides,
    };
  }

  function given({ invitation: inv = invitation(), membership = null } = {}) {
    invitations = { [inv.token]: inv };
    memberships = membership ? { [membership.userId]: membership } : {};
  }

  beforeEach(function () {
    challengeAnswer = { success: true, message: "ok" };
    given();

    sinon
      .stub(InvitationManager, "getInvitationByToken")
      .callsFake(async (token) => copy(invitations[token] ?? null));
    sinon
      .stub(InvitationManager, "consumeUse")
      .callsFake(async (tenantId, token) => {
        invitations[token].usedCount += 1;
        return copy(invitations[token]);
      });
    sinon
      .stub(InvitationManager, "updateInvitation")
      .callsFake(async (tenantId, token, patch) => {
        Object.assign(invitations[token], patch);
      });

    sinon
      .stub(MembershipManager, "getMembershipByTenantAndUserID")
      .callsFake(async (tenantId, userId) => copy(memberships[userId] ?? null));
    sinon
      .stub(MembershipManager, "addMembership")
      .callsFake(async (tenantId, membership) => {
        memberships[membership.userId] = {
          tenantId,
          roles: [],
          ...copy(membership),
        };
        return copy(memberships[membership.userId]);
      });
    sinon
      .stub(MembershipManager, "updateMembership")
      .callsFake(async (tenantId, userId, patch) => {
        Object.assign(memberships[userId], copy(patch));
      });

    sinon
      .stub(ChallengeManager, "getChallengeByID")
      .callsFake(async (t, id) =>
        id === "ch-approval"
          ? { id, enabled: true, rolesToAssign: ["role-geprueft"] }
          : null,
      );
    sinon
      .stub(ChallengeService, "performChallenge")
      .callsFake(async () => challengeAnswer);
    sinon
      .stub(RoleManager, "getRolesByIds")
      .callsFake(async (ids) =>
        ids.map((id) => ({ id, name: id.replace("role-", "Rolle ") })),
      );

    notify = sinon.stub(mailService, "notify").resolves([]);
  });

  afterEach(function () {
    sinon.restore();
  });

  const accept = (token = "tok-single") =>
    InvitationService.acceptInvitation(TENANT, token, MEMBER);

  describe("tells the owners", function () {
    it("when a single invitation is accepted directly, naming the new member and their roles", async function () {
      const result = await accept();

      expect(result.success).to.equal(true);
      expect(memberships[MEMBER].status).to.equal("active");
      expect(notify.callCount).to.equal(1);
      expect(notify.firstCall.args).to.deep.equal([
        "INVITATION_ACCEPTED",
        {
          tenantId: TENANT,
          userId: MEMBER,
          roleNames: ["Rolle sekretariat"],
        },
      ]);
    });

    it("when a multi-use link is accepted directly", async function () {
      given({
        invitation: invitation({
          token: "tok-multi",
          type: "multi",
          intendedUserId: null,
          maxUses: 50,
        }),
      });

      await accept("tok-multi");

      expect(notify.callCount).to.equal(1);
      expect(notify.firstCall.args[1].userId).to.equal(MEMBER);
    });

    it("once the manual approval makes the person a member, not while it waits", async function () {
      given({ invitation: invitation({ challenges: ["ch-approval"] }) });
      challengeAnswer = {
        success: false,
        pendingApproval: true,
        message: "waiting",
      };

      const result = await accept();

      expect(result.pendingApproval).to.equal(true);
      expect(notify.callCount).to.equal(0);

      await InvitationService.approveManualChallenge(TENANT, {
        userId: MEMBER,
        challengeId: "ch-approval",
        adminId: "admin@example.test",
      });
      await InvitationService.tryFinalizePendingInvitationsForUser(
        TENANT,
        MEMBER,
      );

      expect(memberships[MEMBER].status).to.equal("active");
      expect(notify.callCount).to.equal(1);
      expect(notify.firstCall.args).to.deep.equal([
        "INVITATION_ACCEPTED",
        {
          tenantId: TENANT,
          userId: MEMBER,
          roleNames: ["Rolle sekretariat", "Rolle geprueft"],
        },
      ]);

      await InvitationService.tryFinalizePendingInvitationsForUser(
        TENANT,
        MEMBER,
      );
      expect(notify.callCount, "a second finalize").to.equal(1);
    });
  });

  describe("tells nobody", function () {
    it("when a challenge fails", async function () {
      given({ invitation: invitation({ challenges: ["ch-approval"] }) });
      challengeAnswer = { success: false, message: "nope" };

      const result = await accept();

      expect(result.success).to.equal(false);
      expect(notify.callCount).to.equal(0);
    });

    it("when the manual approval is rejected", async function () {
      given({ invitation: invitation({ challenges: ["ch-approval"] }) });
      challengeAnswer = {
        success: false,
        pendingApproval: true,
        message: "waiting",
      };
      await accept();

      await InvitationService.rejectManualChallenge(TENANT, {
        userId: MEMBER,
        challengeId: "ch-approval",
        adminId: "admin@example.test",
      });
      await InvitationService.tryFinalizePendingInvitationsForUser(
        TENANT,
        MEMBER,
      );

      expect(memberships[MEMBER].status).to.not.equal("active");
      expect(notify.callCount).to.equal(0);
    });

    it("when the person rejects the invitation", async function () {
      given({
        membership: {
          tenantId: TENANT,
          userId: MEMBER,
          status: "pending",
          roles: [],
          invitations: [],
        },
      });

      await InvitationService.rejectInvitation(TENANT, "tok-single", MEMBER);

      expect(notify.callCount).to.equal(0);
    });

    it("when an active member takes a link again", async function () {
      given({
        invitation: invitation({
          token: "tok-multi",
          type: "multi",
          intendedUserId: null,
        }),
        membership: {
          tenantId: TENANT,
          userId: MEMBER,
          status: "active",
          roles: ["role-alt"],
          invitations: [],
        },
      });

      const result = await accept("tok-multi");
      await accept("tok-multi");

      expect(result.success).to.equal(true);
      expect(notify.callCount).to.equal(0);
    });
  });

  it("keeps the member and answers without error when the mail cannot be sent", async function () {
    notify.rejects(new Error("smtp down"));

    const result = await accept();

    expect(result.success).to.equal(true);
    expect(memberships[MEMBER].status).to.equal("active");
    expect(notify.callCount).to.equal(1);
  });
});
