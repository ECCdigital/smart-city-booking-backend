/**
 * The status of a membership knows `pending`, `active` and `rejected`; there
 * is no `suspended` at the tenant any more. The one
 * action of a tenant against a user is „Mitgliedschaft beenden“ (the
 * tenant's `remove-user`), and a user whose membership ended can come back
 * by a multi-use invitation or a public link.
 *
 * Runs over the real routers on the lifecycle harness; the newcomer's
 * membership and the invitations are kept in memory below the managers.
 */

const { expect } = require("chai");
const sinon = require("sinon");

const {
  installHarness,
  ADMIN,
  OWNER,
  ROLE_HOLDER,
  CUSTOMER,
  TENANT,
} = require("./helpers/booking-lifecycle-harness");
const UserManager = require("../src/commons/data-managers/user-manager");
const MembershipManager = require("../src/commons/data-managers/membership-manager");
const InvitationManager = require("../src/commons/data-managers/invitation-manager");
const mailService = require("../src/commons/mail-service");
const {
  account,
  installUserCollection,
} = require("./helpers/auth-user-collection");

const NEWCOMER = "neu@example.test";

describe("membership without suspended", function () {
  this.timeout(20000);

  let h;

  beforeEach(async function () {
    h = await installHarness();
    UserManager.getUser.restore();
    UserManager.getRawUser.restore();
    installUserCollection([
      account(ADMIN, "geheim-1234"),
      account(OWNER, "geheim-1234"),
      account(ROLE_HOLDER, "geheim-1234"),
      account(CUSTOMER, "geheim-1234"),
      account(NEWCOMER, "geheim-1234"),
    ]);
    sinon.stub(MembershipManager, "getMembershipsByTenantID").resolves([]);
    sinon.stub(UserManager, "getUsersById").resolves([]);
  });

  afterEach(async function () {
    sinon.restore();
    await h.close();
  });

  describe("POST /tenants/:tenant/update-user-status", function () {
    let updated;

    beforeEach(function () {
      updated = sinon.stub(MembershipManager, "updateMembership").resolves();
    });

    const setStatus = (status, by = OWNER) =>
      h
        .api()
        .post(`/api/tenants/${TENANT}/update-user-status`)
        .set(h.as(by))
        .send({ userId: CUSTOMER, status });

    it("refuses suspended with 400 and changes nothing", async function () {
      const res = await setStatus("suspended");

      expect(res.status).to.equal(400);
      expect(res.body.code).to.equal("membership_status_invalid");
      expect(updated.called).to.equal(false);
    });

    it("refuses any status outside pending, active and rejected", async function () {
      const res = await setStatus("blocked");

      expect(res.status).to.equal(400);
      expect(updated.called).to.equal(false);
    });

    it("still sets a status the membership knows", async function () {
      const res = await setStatus("active");

      expect(res.status).to.equal(200);
      expect(updated.calledOnceWith(TENANT, CUSTOMER, { status: "active" })).to
        .be.true;
    });
  });

  describe("„Mitgliedschaft beenden“ and coming back", function () {
    let membership;
    let invitations;

    const copy = (value) => JSON.parse(JSON.stringify(value));

    beforeEach(function () {
      membership = {
        userId: NEWCOMER,
        tenantId: TENANT,
        status: "active",
        source: "invite",
        owner: false,
        roles: [],
        invitations: [],
      };
      invitations = {
        "tok-link": {
          tenantId: TENANT,
          token: "tok-link",
          type: "multi",
          status: "active",
          intendedUserId: null,
          roles: [],
          challenges: [],
          usedCount: 0,
          maxUses: null,
          expiresAt: null,
        },
        "tok-old": {
          tenantId: TENANT,
          token: "tok-old",
          type: "single",
          status: "active",
          intendedUserId: NEWCOMER,
          roles: [],
          challenges: [],
          usedCount: 0,
          maxUses: 1,
          expiresAt: null,
        },
      };

      MembershipManager.getMembershipByTenantAndUserID
        .withArgs(TENANT, NEWCOMER)
        .callsFake(async () => copy(membership));
      MembershipManager.getMembershipsByUserID
        .withArgs(NEWCOMER)
        .callsFake(async () => (membership ? [copy(membership)] : []));
      sinon
        .stub(MembershipManager, "removeMembership")
        .callsFake(async (tenantId, userId) => {
          if (userId === NEWCOMER) membership = null;
        });
      sinon
        .stub(MembershipManager, "addMembership")
        .callsFake(async (tenantId, added) => {
          membership = { tenantId, roles: [], owner: false, ...copy(added) };
          return copy(membership);
        });
      sinon
        .stub(MembershipManager, "updateMembership")
        .callsFake(async (tenantId, userId, patch) => {
          Object.assign(membership, copy(patch));
        });

      sinon
        .stub(InvitationManager, "getInvitationByToken")
        .callsFake(async (token) => copy(invitations[token] ?? null));
      sinon
        .stub(InvitationManager, "getInvitationsByTenantIDAndUserID")
        .callsFake(async (tenantId, userId) =>
          Object.values(invitations)
            .filter((i) => i.tenantId === tenantId)
            .filter((i) => i.intendedUserId === userId)
            .map(copy),
        );
      sinon
        .stub(InvitationManager, "deleteInvitation")
        .callsFake(async (tenantId, token) => {
          delete invitations[token];
        });
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
      sinon.stub(mailService, "notify").resolves([]);
    });

    const endMembership = (by = ROLE_HOLDER) =>
      h
        .api()
        .post(`/api/tenants/${TENANT}/remove-user`)
        .set(h.as(by))
        .send({ userId: NEWCOMER });

    it("ends the membership with the open invitations of the user, without a mail", async function () {
      const res = await endMembership();

      expect(res.status).to.equal(200);
      expect(membership).to.equal(null);
      expect(Object.keys(invitations)).to.deep.equal(["tok-link"]);
      expect(mailService.notify.called).to.equal(false);
      expect(
        h.takeEffects().filter((effect) => effect.startsWith("mail.")),
      ).to.deep.equal([]);
    });

    it("lets the user come back by a multi-use link afterwards", async function () {
      await endMembership();

      const res = await h
        .api()
        .post(`/api/${TENANT}/invitations/tok-link/accept`)
        .set(h.as(NEWCOMER))
        .send({});

      expect(res.status).to.equal(200);
      expect(res.body.ok).to.equal(true);
      expect(membership).to.include({ userId: NEWCOMER, status: "active" });
    });
  });
});
