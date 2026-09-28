/**
 * The principal at its seam (glossary "Prinzipal", "Ruhende
 * Mitgliedschaft"): built from the membership picture (glossary
 * "Mitgliedschaftsbild", ADR 0004) `UserManager.getMembershipPicture`
 * loads once per user - the instance flags and, per active membership,
 * the tenant, the owner flag, the supervision of the tenant, the grants
 * merged over the role catalogue and the extras of the roles:
 *
 *   {
 *     instanceOwner: false,
 *     mayCreateTenant: false,
 *     memberships: [{
 *       tenantId: "t1",
 *       isOwner: true,
 *       supervision: { supervisionLevel, supervisionChangedAt, supervisionReason },
 *       grants: { manageBookings: { readAny: true }, ... },
 *       adminInterfaces: [],
 *       freeBookings: false,
 *     }],
 *   }
 *
 * The membership in a declined tenant rests there - no member, no tenant
 * owner, no role level, and what rests is kept for the answer that names
 * the declination. A free or pending tenant rests nothing. `anyReachIn`
 * asks the same across tenants, from one load.
 */

const { expect } = require("chai");
const sinon = require("sinon");

const UserManager = require("../src/commons/data-managers/user-manager");
const {
  loadPrincipal,
  anyReachIn,
  tenantsOf,
} = require("../src/commons/services/authorization/principal");
const {
  decide,
  REACH,
} = require("../src/commons/services/authorization/policy");
const { ROLE_GROUPS } = require("../src/commons/services/authorization/table");

const CHANGED_AT = new Date("2026-09-24T10:00:00.000Z");

/** A tenant owner who also holds `manageBookings.readAny`, per tenant level. */
function membership(tenantId, supervisionLevel) {
  return {
    tenantId,
    isOwner: true,
    supervision: {
      supervisionLevel,
      supervisionChangedAt: supervisionLevel === "free" ? null : CHANGED_AT,
      supervisionReason:
        supervisionLevel === "declined" ? "Kein Impressum" : null,
    },
    grants: { manageBookings: { readAny: true } },
    adminInterfaces: [],
    freeBookings: false,
  };
}

function stubPicture({ memberships = [], instanceOwner = false } = {}) {
  sinon.stub(UserManager, "getMembershipPicture").resolves({
    instanceOwner,
    mayCreateTenant: false,
    memberships,
  });
}

describe("authorization principal: the resting membership", function () {
  afterEach(function () {
    sinon.restore();
  });

  it("gives a member of a free or pending tenant the membership whole", async function () {
    for (const level of ["free", "pending"]) {
      sinon.restore();
      stubPicture({ memberships: [membership("t1", level)] });

      const principal = await loadPrincipal("u1", "t1");

      expect(principal.isMember, level).to.equal(true);
      expect(principal.isTenantOwner, level).to.equal(true);
      expect(principal.grants.manageBookings, level).to.deep.equal({
        readAny: true,
      });
      expect(principal.restingMembership, level).to.equal(null);
    }
  });

  it("lets the membership in a declined tenant rest and keeps why", async function () {
    stubPicture({ memberships: [membership("t1", "declined")] });

    const principal = await loadPrincipal("u1", "t1");

    expect(principal.isMember).to.equal(false);
    expect(principal.isTenantOwner).to.equal(false);
    for (const group of ROLE_GROUPS) {
      expect(principal.grants[group], group).to.deep.equal({});
    }
    expect(principal.restingMembership).to.deep.equal({
      supervisionLevel: "declined",
      supervisionChangedAt: CHANGED_AT,
      supervisionReason: "Kein Impressum",
    });
    // What any signed-in user has stays, nothing the membership gave.
    expect(decide(principal, "booking", "read")).to.equal(REACH.OWN);
    expect(decide(principal, "bookable", "read")).to.equal(null);
  });

  it("leaves the instance owner every right in a declined tenant", async function () {
    stubPicture({
      memberships: [membership("t1", "declined")],
      instanceOwner: true,
    });

    const principal = await loadPrincipal("u1", "t1");

    expect(decide(principal, "bookable", "read")).to.equal(REACH.ANY);
    expect(decide(principal, "tenant", "update")).to.equal(REACH.ANY);
  });

  it("has no membership that could rest outside the user's tenants and at the instance", async function () {
    stubPicture({ memberships: [membership("t1", "declined")] });

    for (const tenantId of ["t2", null]) {
      const principal = await loadPrincipal("u1", tenantId);
      expect(principal.isMember, String(tenantId)).to.equal(false);
      expect(principal.restingMembership, String(tenantId)).to.equal(null);
    }
  });

  it("loads nothing for the anonymous", async function () {
    stubPicture();

    const principal = await loadPrincipal(null, "t1");

    expect(principal.isMember).to.equal(false);
    expect(principal.restingMembership).to.equal(null);
    expect(UserManager.getMembershipPicture.called).to.equal(false);
  });
});

describe("authorization principal: a question across tenants", function () {
  afterEach(function () {
    sinon.restore();
  });

  it("answers per tenant from one load, made on the first question", async function () {
    stubPicture({
      memberships: [
        membership("t-free", "free"),
        membership("t-pending", "pending"),
        membership("t-declined", "declined"),
      ],
    });

    const readsIn = anyReachIn("u1", "dashboard", "read");
    expect(UserManager.getMembershipPicture.called).to.equal(false);

    expect(await readsIn("t-free")).to.equal(true);
    expect(await readsIn("t-pending")).to.equal(true);
    expect(await readsIn("t-declined")).to.equal(false);
    expect(await readsIn("t-other")).to.equal(false);
    expect(UserManager.getMembershipPicture.callCount).to.equal(1);
  });

  it("answers every tenant for the instance owner and none for the anonymous", async function () {
    stubPicture({ instanceOwner: true });

    expect(await anyReachIn("admin", "booking", "operate")("t-any")).to.equal(
      true,
    );
    expect(await anyReachIn(null, "booking", "operate")("t-any")).to.equal(
      false,
    );
  });
});

/**
 * The tenant sets of the principal (ADR 0002): what "own" means on the
 * instance level, computed from the same load. `member` lists every
 * tenant the user belongs to - the resting membership included, the
 * tenant stays theirs to see -, `owner` and `reach` the rights sets, in
 * which a resting membership counts for nothing.
 */
describe("authorization principal: the tenant sets", function () {
  afterEach(function () {
    sinon.restore();
  });

  it("lists the memberships, the owned tenants and the ones a tenant entry reaches with any", async function () {
    stubPicture({
      memberships: [
        membership("t-free", "free"),
        {
          tenantId: "t-member",
          isOwner: false,
          supervision: { supervisionLevel: "free" },
          grants: {},
        },
        {
          tenantId: "t-reader",
          isOwner: false,
          supervision: { supervisionLevel: "free" },
          grants: { manageBookings: { readAny: true } },
        },
        membership("t-pending", "pending"),
        membership("t-declined", "declined"),
      ],
    });

    const principal = await loadPrincipal("u1", "t-free");

    expect(principal.tenants.member).to.deep.equal([
      "t-free",
      "t-member",
      "t-reader",
      "t-pending",
      "t-declined",
    ]);
    expect(principal.tenants.owner).to.deep.equal(["t-free", "t-pending"]);
    // `dashboard.read` is `manageBookings.readAny`: the owner satisfies
    // it, the reader holds it, the plain member does not, the resting
    // membership holds nothing.
    expect(principal.tenants.reach).to.deep.equal({
      "dashboard.read": ["t-free", "t-reader", "t-pending"],
    });
    expect(UserManager.getMembershipPicture.callCount).to.equal(1);
  });

  it("answers an owner key's tenant set from the principal, and nothing for the anonymous", async function () {
    stubPicture({ memberships: [membership("t1", "free")] });
    const principal = await loadPrincipal("u1", null);
    expect(tenantsOf(principal, { tenantsOf: "membership" })).to.deep.equal([
      "t1",
    ]);
    expect(tenantsOf(principal, { tenantsOf: "ownership" })).to.deep.equal([
      "t1",
    ]);
    expect(
      tenantsOf(principal, { tenantsOf: "reach", entry: "dashboard.read" }),
    ).to.deep.equal(["t1"]);
    expect(() => tenantsOf(principal, { tenantsOf: "nowhere" })).to.throw(
      /unknown tenant set/,
    );

    const anonymous = await loadPrincipal(null, null);
    expect(tenantsOf(anonymous, { tenantsOf: "ownership" })).to.deep.equal([]);
  });
});
