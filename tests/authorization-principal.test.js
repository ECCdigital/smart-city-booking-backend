/**
 * The principal at its seam (glossary "Prinzipal", "Ruhende
 * Mitgliedschaft"): built from the answer of `getUserPermissions`, the
 * membership in a declined tenant rests there - no member, no tenant
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
    manageBookings: { readAny: true },
    supervisionLevel,
    supervisionChangedAt: supervisionLevel === "free" ? null : CHANGED_AT,
    supervisionReason:
      supervisionLevel === "declined" ? "Kein Impressum" : null,
  };
}

function stubPermissions({ tenants = [], instanceOwner = false } = {}) {
  sinon.stub(UserManager, "getUserPermissions").resolves({
    tenants,
    instanceOwner,
    allowCreateTenant: false,
  });
}

describe("authorization principal: the resting membership", function () {
  afterEach(function () {
    sinon.restore();
  });

  it("gives a member of a free or pending tenant the membership whole", async function () {
    for (const level of ["free", "pending"]) {
      sinon.restore();
      stubPermissions({ tenants: [membership("t1", level)] });

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
    stubPermissions({ tenants: [membership("t1", "declined")] });

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
    stubPermissions({
      tenants: [membership("t1", "declined")],
      instanceOwner: true,
    });

    const principal = await loadPrincipal("u1", "t1");

    expect(decide(principal, "bookable", "read")).to.equal(REACH.ANY);
    expect(decide(principal, "tenant", "update")).to.equal(REACH.ANY);
  });

  it("has no membership that could rest outside the user's tenants and at the instance", async function () {
    stubPermissions({ tenants: [membership("t1", "declined")] });

    for (const tenantId of ["t2", null]) {
      const principal = await loadPrincipal("u1", tenantId);
      expect(principal.isMember, String(tenantId)).to.equal(false);
      expect(principal.restingMembership, String(tenantId)).to.equal(null);
    }
  });

  it("loads nothing for the anonymous", async function () {
    stubPermissions();

    const principal = await loadPrincipal(null, "t1");

    expect(principal.isMember).to.equal(false);
    expect(principal.restingMembership).to.equal(null);
    expect(UserManager.getUserPermissions.called).to.equal(false);
  });
});

describe("authorization principal: a question across tenants", function () {
  afterEach(function () {
    sinon.restore();
  });

  it("answers per tenant from one load, made on the first question", async function () {
    stubPermissions({
      tenants: [
        membership("t-free", "free"),
        membership("t-pending", "pending"),
        membership("t-declined", "declined"),
      ],
    });

    const readsIn = anyReachIn("u1", "dashboard", "read");
    expect(UserManager.getUserPermissions.called).to.equal(false);

    expect(await readsIn("t-free")).to.equal(true);
    expect(await readsIn("t-pending")).to.equal(true);
    expect(await readsIn("t-declined")).to.equal(false);
    expect(await readsIn("t-other")).to.equal(false);
    expect(UserManager.getUserPermissions.callCount).to.equal(1);
  });

  it("answers every tenant for the instance owner and none for the anonymous", async function () {
    stubPermissions({ instanceOwner: true });

    expect(await anyReachIn("admin", "booking", "operate")("t-any")).to.equal(
      true,
    );
    expect(await anyReachIn(null, "booking", "operate")("t-any")).to.equal(
      false,
    );
  });
});
