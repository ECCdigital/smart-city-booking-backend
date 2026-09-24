/**
 * The sign-in carries the supervision of every tenant of the user (tenant
 * supervision spec §6.1, api contract §5): `permissions.tenants[]` names
 * per entry `supervisionLevel`, `supervisionChangedAt` and
 * `supervisionReason` (glossary "Begründung des jüngsten Stufenwechsels"),
 * so the Admin UI marks a declined or waiting tenant before its first
 * request. `UserManager.getUserPermissions` feeds `/auth/me`,
 * `/auth/signin`, the SSO and the card sign-in alike.
 */

const { expect } = require("chai");
const sinon = require("sinon");

const UserManager = require("../src/commons/data-managers/user-manager");
const InstanceManager = require("../src/commons/data-managers/instance-manager");
const MembershipManager = require("../src/commons/data-managers/membership-manager");
const { RoleManager } = require("../src/commons/data-managers/role-manager");
const TenantManager = require("../src/commons/data-managers/tenant-manager");
const {
  installHarness,
  TENANT,
  OWNER,
} = require("./helpers/booking-lifecycle-harness");

const CHANGED_AT = new Date("2026-09-24T10:00:00.000Z");

describe("UserManager.getUserPermissions: the supervision of the user's tenants", function () {
  beforeEach(function () {
    sinon.stub(InstanceManager, "getInstance").resolves({
      ownerUserIds: [],
      allowAllUsersToCreateTenant: false,
      allowedUsersToCreateTenant: [],
    });
    sinon.stub(RoleManager, "getRole").resolves(null);
    sinon.stub(MembershipManager, "getMembershipsByUserID").resolves([
      {
        tenantId: "t-declined",
        status: "active",
        owner: true,
        roles: [],
      },
      { tenantId: "t-gone", status: "active", owner: false, roles: [] },
      { tenantId: "t-left", status: "inactive", owner: false, roles: [] },
    ]);
    sinon.stub(TenantManager, "getTenantsByIds").callsFake(async (ids) =>
      ids.includes("t-declined")
        ? [
            {
              id: "t-declined",
              supervisionLevel: "declined",
              supervisionChangedAt: CHANGED_AT,
              supervisionReason: "Kein Impressum",
            },
          ]
        : [],
    );
  });

  afterEach(function () {
    sinon.restore();
  });

  it("names level, change time and reason per tenant entry", async function () {
    const permissions = await UserManager.getUserPermissions("owner");

    const declined = permissions.tenants.find(
      (entry) => entry.tenantId === "t-declined",
    );
    expect(declined).to.include({
      isOwner: true,
      supervisionLevel: "declined",
      supervisionChangedAt: CHANGED_AT,
      supervisionReason: "Kein Impressum",
    });
  });

  it("reads a tenant without a document, like one without a stored level, as free without a change", async function () {
    const permissions = await UserManager.getUserPermissions("owner");

    const gone = permissions.tenants.find(
      (entry) => entry.tenantId === "t-gone",
    );
    expect(gone).to.include({
      supervisionLevel: "free",
      supervisionChangedAt: null,
      supervisionReason: null,
    });
    expect(permissions.tenants.map((entry) => entry.tenantId)).to.deep.equal([
      "t-declined",
      "t-gone",
    ]);
  });
});

describe("GET /auth/me: the supervision of the user's tenants", function () {
  this.timeout(20000);

  let h;

  before(async function () {
    h = await installHarness();
  });

  after(async function () {
    sinon.restore();
    await h.close();
  });

  afterEach(function () {
    h.tenant.supervisionLevel = "free";
    delete h.tenant.supervisionChangedAt;
    delete h.tenant.supervisionReason;
  });

  it("answers the three fields of the declined tenant to its owner", async function () {
    h.tenant.supervisionLevel = "declined";
    h.tenant.supervisionChangedAt = CHANGED_AT;
    h.tenant.supervisionReason = "Kein Impressum";

    const res = await h.api().get("/auth/me").set(h.as(OWNER));

    expect(res.status).to.equal(200);
    const entry = res.body.permissions.tenants.find(
      (tenant) => tenant.tenantId === TENANT,
    );
    expect(entry).to.include({
      isOwner: true,
      supervisionLevel: "declined",
      supervisionChangedAt: CHANGED_AT.toISOString(),
      supervisionReason: "Kein Impressum",
    });
  });

  it("answers free and no change for a tenant that was never changed", async function () {
    const res = await h.api().get("/auth/me").set(h.as(OWNER));

    expect(res.status).to.equal(200);
    const entry = res.body.permissions.tenants.find(
      (tenant) => tenant.tenantId === TENANT,
    );
    expect(entry).to.include({
      supervisionLevel: "free",
      supervisionChangedAt: null,
      supervisionReason: null,
    });
  });
});
