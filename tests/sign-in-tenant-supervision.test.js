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
const JwtHelper = require("../src/commons/utilities/jwt-helper");
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
    sinon.stub(RoleManager, "getRolesByIds").resolves([]);
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

/**
 * The form of the sign-in answer, held through the role catalogue and the
 * membership picture (tickets 28 and 29 of the authorization map): the
 * fixture below is the answer of today, and stays.
 */
describe("UserManager.getUserPermissions: the form of the sign-in answer", function () {
  const GROUPS = [
    "manageUsers",
    "manageBookables",
    "manageBookings",
    "manageCoupons",
    "manageMedia",
    "manageRoles",
  ];
  const LEVELS = [
    "create",
    "readAny",
    "readOwn",
    "updateAny",
    "updateOwn",
    "deleteAny",
    "deleteOwn",
  ];
  /** A role group as a stored role carries it: every level, false unless named. */
  const group = (granted = []) =>
    Object.fromEntries(LEVELS.map((level) => [level, granted.includes(level)]));
  /** A stored role: every group present, like a document of the role model. */
  const storedRole = (id, tenantId, { groups = {}, ...rest } = {}) => ({
    id,
    name: id,
    tenantId,
    adminInterfaces: [],
    freeBookings: false,
    assignedUserId: null,
    ...Object.fromEntries(GROUPS.map((name) => [name, group(groups[name])])),
    ...rest,
  });
  const ROLES = {
    "t-roles": {
      kasse: storedRole("kasse", "t-roles", {
        groups: { manageBookings: ["create", "readAny"] },
        adminInterfaces: ["bookings"],
        freeBookings: true,
      }),
      medien: storedRole("medien", "t-roles", {
        groups: {
          manageMedia: ["readAny", "updateOwn"],
          manageBookings: ["readOwn"],
        },
        adminInterfaces: ["media", "bookings"],
      }),
    },
    "t-declined": {
      kasse: storedRole("kasse", "t-declined", {
        groups: { manageBookings: ["readAny"] },
      }),
    },
  };
  const OWNER_INTERFACES = [
    "tenants",
    "users",
    "locations",
    "roles",
    "bookings",
    "coupons",
    "rooms",
    "resources",
    "tickets",
    "events",
    "media",
  ];
  const FREE = {
    supervisionLevel: "free",
    supervisionChangedAt: null,
    supervisionReason: null,
  };
  const EMPTY_GROUPS = Object.fromEntries(GROUPS.map((name) => [name, {}]));

  beforeEach(function () {
    sinon.stub(InstanceManager, "getInstance").resolves({
      ownerUserIds: ["owner"],
      allowAllUsersToCreateTenant: false,
      allowedUsersToCreateTenant: [],
    });
    const roleOf = (id, tenantId) => ROLES[tenantId]?.[id] ?? null;
    sinon
      .stub(RoleManager, "getRolesByIds")
      .callsFake(async (ids, tenantId) =>
        ids.map((id) => roleOf(id, tenantId)).filter(Boolean),
      );
    sinon.stub(MembershipManager, "getMembershipsByUserID").resolves([
      { tenantId: "t-owner", status: "active", owner: true, roles: [] },
      {
        tenantId: "t-roles",
        status: "active",
        owner: false,
        roles: ["kasse", "medien", "gone"],
      },
      { tenantId: "t-member", status: "active", owner: false, roles: [] },
      {
        tenantId: "t-declined",
        status: "active",
        owner: true,
        roles: ["kasse"],
      },
      { tenantId: "t-left", status: "inactive", owner: true, roles: [] },
    ]);
    sinon.stub(TenantManager, "getTenantsByIds").resolves([
      { id: "t-owner", supervisionLevel: "free" },
      { id: "t-roles", supervisionLevel: "free" },
      { id: "t-member", supervisionLevel: "free" },
      {
        id: "t-declined",
        supervisionLevel: "declined",
        supervisionChangedAt: CHANGED_AT,
        supervisionReason: "Kein Impressum",
      },
    ]);
  });

  afterEach(function () {
    sinon.restore();
  });

  it("is the answer of today: owner defaults, merged roles, empty groups, the declined tenant whole", async function () {
    const permissions = await UserManager.getUserPermissions("owner");

    expect(permissions).to.deep.equal({
      instanceOwner: true,
      allowCreateTenant: true,
      tenants: [
        {
          tenantId: "t-owner",
          isOwner: true,
          adminInterfaces: OWNER_INTERFACES,
          freeBookings: false,
          ...EMPTY_GROUPS,
          ...FREE,
        },
        {
          tenantId: "t-roles",
          isOwner: false,
          adminInterfaces: ["bookings", "media"],
          freeBookings: true,
          ...EMPTY_GROUPS,
          manageBookings: group(["create", "readAny", "readOwn"]),
          manageMedia: group(["readAny", "updateOwn"]),
          manageUsers: group(),
          manageBookables: group(),
          manageCoupons: group(),
          manageRoles: group(),
          ...FREE,
        },
        {
          tenantId: "t-member",
          isOwner: false,
          adminInterfaces: [],
          freeBookings: false,
          ...EMPTY_GROUPS,
          ...FREE,
        },
        {
          tenantId: "t-declined",
          isOwner: true,
          adminInterfaces: OWNER_INTERFACES,
          freeBookings: false,
          ...EMPTY_GROUPS,
          manageBookings: group(["readAny"]),
          manageUsers: group(),
          manageBookables: group(),
          manageCoupons: group(),
          manageMedia: group(),
          manageRoles: group(),
          supervisionLevel: "declined",
          supervisionChangedAt: CHANGED_AT,
          supervisionReason: "Kein Impressum",
        },
      ],
    });
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

  it("carries the same entry in the answer of POST /auth/signin", async function () {
    h.tenant.supervisionLevel = "declined";
    h.tenant.supervisionChangedAt = CHANGED_AT;
    h.tenant.supervisionReason = "Kein Impressum";
    // The local strategy needs a verified local user who knows the
    // password; the tokens are the JWT helper's, whose refresh token would
    // write a session.
    UserManager.getUser.restore();
    sinon.stub(UserManager, "getUser").callsFake(async (id) => ({
      id,
      isVerified: true,
      isSuspended: false,
      authType: "local",
      verifyPassword: () => true,
    }));
    sinon.stub(JwtHelper, "generateToken").resolves("access");
    sinon.stub(JwtHelper, "generateRefreshToken").resolves("refresh");
    try {
      const res = await h
        .api()
        .post("/auth/signin")
        .send({ id: OWNER, password: "geheim" });

      expect(res.status).to.equal(200);
      const entry = res.body.permissions.tenants.find(
        (tenant) => tenant.tenantId === TENANT,
      );
      expect(entry).to.include({
        supervisionLevel: "declined",
        supervisionChangedAt: CHANGED_AT.toISOString(),
        supervisionReason: "Kein Impressum",
      });
    } finally {
      JwtHelper.generateToken.restore();
      JwtHelper.generateRefreshToken.restore();
      UserManager.getUser.restore();
      sinon.stub(UserManager, "getUser").callsFake(async (id) => ({ id }));
    }
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
