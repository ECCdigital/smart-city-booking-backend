/**
 * The supervision routes (tenant supervision spec §6.2) over the lifecycle
 * harness: the instance owner sets a tenant's level, the history is read
 * by instance owner and tenant owner, the admin list filters by level, and
 * no tenant write can smuggle a level in.
 */

const { expect } = require("chai");
const sinon = require("sinon");

const {
  installHarness,
  bookable,
  TENANT,
  ADMIN,
  OWNER,
  ROLE_HOLDER,
  CUSTOMER,
} = require("./helpers/booking-lifecycle-harness");
const { installRouteWorld, FIXTURE_ID } = require("./helpers/route-world");
const TenantManager = require("../src/commons/data-managers/tenant-manager");
const SupervisionHistoryManager = require("../src/commons/data-managers/supervision-history-manager");
const SupervisionNotificationManager = require("../src/commons/data-managers/supervision-notification-manager");
const Tenant = require("../src/commons/entities/tenant/tenant");

describe("supervision routes", function () {
  this.timeout(20000);

  let h;
  let level;
  let changedAt;

  before(async function () {
    h = await installHarness({
      bookables: {
        [FIXTURE_ID]: bookable({
          id: FIXTURE_ID,
          title: "Fixture",
          ownerUserId: ROLE_HOLDER,
        }),
      },
    });
    installRouteWorld({
      tenantId: TENANT,
      tenant: h.tenant,
      ownerUserId: ROLE_HOLDER,
      bookables: h.bookables,
    });
  });

  after(async function () {
    sinon.restore();
    await h.close();
  });

  beforeEach(function () {
    level = "free";
    changedAt = null;
    const current = () =>
      new Tenant({
        ...h.tenant,
        supervisionLevel: level,
        supervisionChangedAt: changedAt,
      });
    TenantManager.getTenant.restore();
    sinon.stub(TenantManager, "getTenant").callsFake(async () => current());
    TenantManager.updateSupervisionLevel.restore();
    sinon
      .stub(TenantManager, "updateSupervisionLevel")
      .callsFake(async ({ from, to, changedAt: at }) => {
        if (from !== level) return null;
        level = to;
        changedAt = at;
        return current();
      });
    SupervisionHistoryManager.insert.resetHistory();
    SupervisionNotificationManager.record.resetHistory();
  });

  const call = (method, path, userId, body) => {
    let req = h.api()[method](`/api${path}`);
    if (userId) req = req.set(h.as(userId));
    if (body) req = req.send(body);
    return req;
  };

  describe("PUT /api/tenants/:tenant/supervision", function () {
    it("lets the instance owner block a tenant and answers level and time", async function () {
      const res = await call("put", `/tenants/${TENANT}/supervision`, ADMIN, {
        level: "blocked",
        reason: "Spam",
      });

      expect(res.status).to.equal(200);
      expect(res.body.supervisionLevel).to.equal("blocked");
      expect(new Date(res.body.supervisionChangedAt).getTime()).to.be.closeTo(
        Date.now(),
        5000,
      );
      expect(SupervisionHistoryManager.insert.calledOnce).to.be.true;
      expect(SupervisionHistoryManager.insert.firstCall.args[0]).to.include({
        tenantId: TENANT,
        from: "free",
        to: "blocked",
        reason: "Spam",
      });
      expect(
        SupervisionHistoryManager.insert.firstCall.args[0].actor.userId,
      ).to.equal(ADMIN);
      expect(SupervisionNotificationManager.record.calledOnce).to.be.true;
    });

    it("refuses the tenant owner, a role holder and the anonymous", async function () {
      expect(
        (
          await call("put", `/tenants/${TENANT}/supervision`, OWNER, {
            level: "blocked",
          })
        ).status,
      ).to.equal(403);
      expect(
        (
          await call("put", `/tenants/${TENANT}/supervision`, ROLE_HOLDER, {
            level: "blocked",
          })
        ).status,
      ).to.equal(403);
      expect(
        (
          await call("put", `/tenants/${TENANT}/supervision`, null, {
            level: "blocked",
          })
        ).status,
      ).to.equal(401);
      expect(level).to.equal("free");
    });

    it("refuses an unknown level with 400", async function () {
      const res = await call("put", `/tenants/${TENANT}/supervision`, ADMIN, {
        level: "banned",
      });

      expect(res.status).to.equal(400);
      expect(res.body.code).to.equal("invalid_supervision_level");
    });

    it("repeats an effective level as a no-op", async function () {
      level = "blocked";
      changedAt = new Date("2026-01-01T00:00:00.000Z");

      const res = await call("put", `/tenants/${TENANT}/supervision`, ADMIN, {
        level: "blocked",
      });

      expect(res.status).to.equal(200);
      expect(res.body.supervisionChangedAt).to.equal(
        "2026-01-01T00:00:00.000Z",
      );
      expect(SupervisionHistoryManager.insert.called).to.be.false;
      expect(SupervisionNotificationManager.record.called).to.be.false;
    });
  });

  describe("supervision history", function () {
    it("shows the tenant owner and the instance owner the tenant's history", async function () {
      const owner = await call(
        "get",
        `/tenants/${TENANT}/supervision/history?page=2&pageSize=10&offerType=bookable`,
        OWNER,
      );
      expect(owner.status).to.equal(200);
      expect(owner.body).to.have.keys(["items", "total", "page", "pageSize"]);
      expect(SupervisionHistoryManager.list.lastCall.args[0]).to.include({
        tenantId: TENANT,
        offerType: "bookable",
        page: "2",
        pageSize: "10",
      });

      expect(
        (await call("get", `/tenants/${TENANT}/supervision/history`, ADMIN))
          .status,
      ).to.equal(200);
      expect(
        (await call("get", `/tenants/${TENANT}/supervision/history`, CUSTOMER))
          .status,
      ).to.equal(403);
      expect(
        (
          await call(
            "get",
            `/tenants/${TENANT}/supervision/history`,
            ROLE_HOLDER,
          )
        ).status,
      ).to.equal(403);
    });

    it("refuses an unknown offer type in the filter", async function () {
      const res = await call(
        "get",
        `/tenants/${TENANT}/supervision/history?offerType=coupon`,
        OWNER,
      );
      expect(res.status).to.equal(400);
    });

    it("shows the instance owner alone the instance-wide history", async function () {
      const admin = await call(
        "get",
        `/instances/supervision/history?tenantId=${TENANT}`,
        ADMIN,
      );
      expect(admin.status).to.equal(200);
      expect(SupervisionHistoryManager.list.lastCall.args[0]).to.include({
        tenantId: TENANT,
      });

      expect(
        (await call("get", "/instances/supervision/history", OWNER)).status,
      ).to.equal(403);
      expect(
        (await call("get", "/instances/supervision/history")).status,
      ).to.equal(401);
    });

    it("does not swallow an infrastructure error as an empty list", async function () {
      SupervisionHistoryManager.list.rejects(new Error("mongo down"));
      try {
        const res = await call(
          "get",
          `/tenants/${TENANT}/supervision/history`,
          ADMIN,
        );
        expect(res.status).to.equal(500);
      } finally {
        SupervisionHistoryManager.list.resolves({
          items: [],
          total: 0,
          page: 1,
          pageSize: 50,
        });
      }
    });
  });

  describe("the tenant DTOs and writes", function () {
    it("filters the admin list by level", async function () {
      const res = await call("get", "/tenants?supervisionLevel=blocked", ADMIN);
      expect(res.status).to.equal(200);
      expect(TenantManager.getTenants.lastCall.args[1]).to.include({
        supervisionLevel: "blocked",
      });
    });

    it("refuses an unknown level in the list filter", async function () {
      expect(
        (await call("get", "/tenants?supervisionLevel=banned", ADMIN)).status,
      ).to.equal(400);
    });

    it("exposes level and change time in the admin DTO, the level alone publicly", async function () {
      level = "blocked";
      changedAt = new Date("2026-01-01T00:00:00.000Z");

      const admin = await call("get", `/tenants/${TENANT}`, ADMIN);
      expect(admin.status).to.equal(200);
      expect(admin.body.supervisionLevel).to.equal("blocked");
      expect(admin.body.supervisionChangedAt).to.equal(
        "2026-01-01T00:00:00.000Z",
      );

      const publicDto = new Tenant({
        id: "x",
        name: "X",
        supervisionLevel: "supervised",
        supervisionChangedAt: changedAt,
      }).exportPublic();
      expect(publicDto.supervisionLevel).to.equal("supervised");
      expect(publicDto).to.not.have.property("supervisionChangedAt");
    });

    it("strips a level from a created tenant and stores the server-side one", async function () {
      const res = await call("post", "/tenants", ADMIN, {
        name: "Neu",
        contactName: "Erika",
        mail: "neu@example.test",
        supervisionLevel: "blocked",
        supervisionChangedAt: "2020-01-01T00:00:00.000Z",
      });

      expect(res.status).to.equal(201);
      const stored = TenantManager.storeTenant.lastCall.args[0];
      expect(stored.supervisionLevel).to.equal("free");
      expect(stored.supervisionChangedAt).to.equal(null);
    });

    it("strips a level from the obsolete PUT that creates", async function () {
      TenantManager.getTenant.callsFake(async () => null);

      const res = await call("put", "/tenants", ADMIN, {
        id: "brand-new",
        name: "Neu",
        contactName: "Erika",
        mail: "neu@example.test",
        supervisionLevel: "blocked",
      });

      expect(res.status).to.equal(201);
      expect(
        TenantManager.storeTenant.lastCall.args[0].supervisionLevel,
      ).to.equal("free");
    });

    it("ignores a level on an update", async function () {
      const res = await call("put", "/tenants", ADMIN, {
        id: TENANT,
        name: "Umbenannt",
        supervisionLevel: "blocked",
      });

      expect(res.status).to.equal(200);
      expect(
        TenantManager.storeTenant.lastCall.args[0].supervisionLevel,
      ).to.equal("free");
      expect(TenantManager.updateSupervisionLevel.called).to.be.false;
    });
  });
});
