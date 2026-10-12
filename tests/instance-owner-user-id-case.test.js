/**
 * The instance owner and the list of who may open a tenant compare user ids
 * as the memberships do (`normalizeUserId`): case and blanks at the edge
 * don't count (ECCdigital/tickets#312). Since the sign-in finds an account
 * whatever its case (ECCdigital/tickets#259), an account stored in another
 * case than its entry in `ownerUserIds` would otherwise lose the instance.
 */

const { expect } = require("chai");
const sinon = require("sinon");

const UserManager = require("../src/commons/data-managers/user-manager");
const InstanceManager = require("../src/commons/data-managers/instance-manager");
const InstanceModel = require("../src/commons/data-managers/models/instanceModel");
const MembershipManager = require("../src/commons/data-managers/membership-manager");
const TenantManager = require("../src/commons/data-managers/tenant-manager");
const JwtHelper = require("../src/commons/utilities/jwt-helper");
const { installHarness } = require("./helpers/booking-lifecycle-harness");

describe("UserManager.getUserPermissions: the instance owner in any case", function () {
  /** Stubs the instance with the given lists; the user is a member nowhere. */
  function instanceWith({
    ownerUserIds = [],
    allowedUsersToCreateTenant = [],
  } = {}) {
    sinon.stub(InstanceManager, "getInstance").resolves({
      ownerUserIds,
      allowAllUsersToCreateTenant: false,
      allowedUsersToCreateTenant,
    });
  }

  beforeEach(function () {
    sinon.stub(MembershipManager, "getMembershipsByUserID").resolves([]);
    sinon.stub(TenantManager, "getTenantsByIds").resolves([]);
  });

  afterEach(function () {
    sinon.restore();
  });

  it("makes the account stored as Owner@Example.de the owner named owner@example.de", async function () {
    instanceWith({ ownerUserIds: ["owner@example.de"] });

    const permissions =
      await UserManager.getUserPermissions("Owner@Example.de");

    expect(permissions).to.include({
      instanceOwner: true,
      allowCreateTenant: true,
    });
  });

  it("makes owner@example.de the owner named Owner@Example.de, the account the sign-in finds of two", async function () {
    instanceWith({ ownerUserIds: ["Owner@Example.de"] });

    const permissions =
      await UserManager.getUserPermissions("owner@example.de");

    expect(permissions).to.include({
      instanceOwner: true,
      allowCreateTenant: true,
    });
  });

  it("makes the owner named with blanks at the edge the owner", async function () {
    instanceWith({ ownerUserIds: [" owner@example.de\t"] });

    const permissions =
      await UserManager.getUserPermissions("owner@example.de");

    expect(permissions.instanceOwner).to.equal(true);
  });

  it("lets open a tenant who is listed in another case, without owning the instance", async function () {
    instanceWith({
      ownerUserIds: ["owner@example.de"],
      allowedUsersToCreateTenant: ["Anna@Example.de"],
    });

    const permissions = await UserManager.getUserPermissions("anna@example.de");

    expect(permissions).to.include({
      instanceOwner: false,
      allowCreateTenant: true,
    });
  });

  it("names neither for another address", async function () {
    instanceWith({
      ownerUserIds: ["owner@example.de"],
      allowedUsersToCreateTenant: ["anna@example.de"],
    });

    const permissions =
      await UserManager.getUserPermissions("owner2@example.de");

    expect(permissions).to.include({
      instanceOwner: false,
      allowCreateTenant: false,
    });
  });
});

/**
 * The two cases of the ticket from end to end: the account the sign-in
 * finds is stored in another case than the owner entry, or of two accounts
 * the sign-in finds the one in lower case while the owner entry names the
 * other.
 */
describe("POST /auth/signin and GET /auth/me: the instance owner in any case", function () {
  this.timeout(20000);

  const CASES = [
    {
      name: "the account is stored in another case than the owner entry",
      ownerEntry: "owner@example.de",
      account: "Owner@Example.de",
    },
    {
      name: "the sign-in finds the account in lower case, the owner entry names its twin",
      ownerEntry: "Owner@Example.de",
      account: "owner@example.de",
    },
  ];

  let h;

  afterEach(async function () {
    sinon.restore();
    await h?.close();
    h = null;
  });

  for (const { name, ownerEntry, account } of CASES) {
    describe(name, function () {
      beforeEach(async function () {
        h = await installHarness({ instance: { ownerUserIds: [ownerEntry] } });
      });

      it("answers instanceOwner to POST /auth/signin with the address in any case", async function () {
        // The account the sign-in finds, whatever case was typed
        // (ECCdigital/tickets#259); the tokens are the JWT helper's, whose
        // refresh token would write a session.
        UserManager.getUser.restore();
        sinon.stub(UserManager, "getUser").callsFake(async () => ({
          id: account,
          isVerified: true,
          isSuspended: false,
          authType: "local",
          verifyPassword: () => true,
        }));
        sinon.stub(JwtHelper, "generateToken").resolves("access");
        sinon.stub(JwtHelper, "generateRefreshToken").resolves("refresh");

        const res = await h
          .api()
          .post("/auth/signin")
          .send({ id: "OWNER@example.DE", password: "geheim" });

        expect(res.status).to.equal(200);
        expect(res.body.permissions).to.include({
          instanceOwner: true,
          allowCreateTenant: true,
        });
      });

      it("answers instanceOwner to GET /auth/me", async function () {
        const res = await h.api().get("/auth/me").set(h.as(account));

        expect(res.status).to.equal(200);
        expect(res.body.permissions).to.include({
          instanceOwner: true,
          allowCreateTenant: true,
        });
      });
    });
  }
});

describe("InstanceManager.reassignOwnerUserId: the owner entry in any case", function () {
  let stored;

  /**
   * The one instance document in memory: `findOne(…).lean()` hands out a
   * copy, `updateOne` understands the filter on an owner id and `$set` of the
   * whole list or of the entries an array filter names.
   */
  beforeEach(function () {
    sinon
      .stub(InstanceModel, "findOne")
      .callsFake(() => ({ lean: async () => structuredClone(stored) }));
    sinon
      .stub(InstanceModel, "updateOne")
      .callsFake(async (filter, update, options = {}) => {
        if (
          filter.ownerUserIds !== undefined &&
          !stored.ownerUserIds.includes(filter.ownerUserIds)
        ) {
          return { matchedCount: 0 };
        }
        const set = update.$set;
        if (set.ownerUserIds) {
          stored.ownerUserIds = [...set.ownerUserIds];
        }
        if (set["ownerUserIds.$[elem]"] !== undefined) {
          const named = options.arrayFilters[0].elem;
          stored.ownerUserIds = stored.ownerUserIds.map((id) =>
            id === named ? set["ownerUserIds.$[elem]"] : id,
          );
        }
        return { matchedCount: 1 };
      });
  });

  afterEach(function () {
    sinon.restore();
  });

  it("replaces the owner entry stored in another case by the new id", async function () {
    stored = {
      _id: "instance",
      ownerUserIds: ["Owner@Example.de", "other@example.de"],
    };

    await InstanceManager.reassignOwnerUserId(
      "owner@example.de",
      "neu@example.de",
    );

    expect(stored.ownerUserIds).to.deep.equal([
      "neu@example.de",
      "other@example.de",
    ]);
  });

  it("replaces the owner entry with blanks at the edge", async function () {
    stored = { _id: "instance", ownerUserIds: [" owner@example.de "] };

    await InstanceManager.reassignOwnerUserId(
      "Owner@Example.de",
      "neu@example.de",
    );

    expect(stored.ownerUserIds).to.deep.equal(["neu@example.de"]);
  });

  it("leaves the owners alone when none names the account", async function () {
    stored = { _id: "instance", ownerUserIds: ["other@example.de"] };

    await InstanceManager.reassignOwnerUserId(
      "owner@example.de",
      "neu@example.de",
    );

    expect(stored.ownerUserIds).to.deep.equal(["other@example.de"]);
  });
});
