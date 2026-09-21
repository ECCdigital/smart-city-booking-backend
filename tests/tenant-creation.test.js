/**
 * The tenant creation contract (tenant supervision spec §6.1, §6.3) over
 * the lifecycle harness: required contact, the creation right and
 * MAX_TENANTS for everyone, verification proof and the 24 h limit for a
 * Selbst-Anlage (glossary), the initial level, and the history and outbox
 * rows a creation leaves - the same over `POST /api/tenants` and the
 * obsolete `PUT /api/tenants` with an unknown id.
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
const UserManager = require("../src/commons/data-managers/user-manager");
const InstanceManager = require("../src/commons/data-managers/instance-manager");
const MembershipManager = require("../src/commons/data-managers/membership-manager");
const RateLimitEventManager = require("../src/commons/data-managers/rate-limit-event-manager");
const SupervisionHistoryManager = require("../src/commons/data-managers/supervision-history-manager");
const SupervisionNotificationManager = require("../src/commons/data-managers/supervision-notification-manager");
const Instance = require("../src/commons/entities/instance/instance");
const Tenant = require("../src/commons/entities/tenant/tenant");
const { User } = require("../src/commons/entities/user/user");
const {
  TenantController,
} = require("../src/platform/api/controllers/tenant-controller");

const VALID = Object.freeze({
  name: "Stadthalle",
  contactName: "Erika Muster",
  mail: "kontakt@stadthalle.example",
});

describe("tenant creation", function () {
  this.timeout(20000);

  let h;
  /** What the instance says; a test changes it before its request. */
  let instance;
  /** The stored users, by id; a test changes them before its request. */
  let users;
  /** The attempts the limiter has counted so far (its answer to countSince). */
  let attemptsInWindow;

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

  const restub = (Manager, name, impl) => {
    Manager[name].restore();
    sinon.stub(Manager, name).callsFake(impl);
  };

  beforeEach(function () {
    instance = new Instance({
      id: "instance",
      ownerUserIds: [ADMIN],
      allowAllUsersToCreateTenant: false,
      // The customer is on the Freigabeliste: a Selbst-Anlage.
      allowedUsersToCreateTenant: [CUSTOMER],
      mailEnabled: true,
    });
    users = {
      [ADMIN]: new User({ id: ADMIN, isVerified: true }),
      [CUSTOMER]: new User({ id: CUSTOMER, isVerified: true }),
      [OWNER]: new User({ id: OWNER, isVerified: true }),
    };
    attemptsInWindow = 1;

    restub(InstanceManager, "getInstance", async () => instance);
    restub(UserManager, "getUser", async (id) => users[id] ?? null);
    restub(RateLimitEventManager, "countSince", async () => attemptsInWindow);
    restub(TenantManager, "getTenant", async () => null);
    restub(TenantManager, "checkTenantCount", async () => true);
    TenantManager.storeTenant.resetHistory();
    TenantManager.removeTenant.resetHistory();
    MembershipManager.addMembership.resetHistory();
    MembershipManager.removeMembership.resetHistory();
    RateLimitEventManager.record.resetHistory();
    RateLimitEventManager.remove.resetHistory();
    SupervisionHistoryManager.insert.resetHistory();
    SupervisionNotificationManager.record.resetHistory();
  });

  const call = (method, path, userId, body) => {
    let req = h.api()[method](`/api${path}`);
    if (userId) req = req.set(h.as(userId));
    if (body) req = req.send(body);
    return req;
  };
  const create = (userId, body) => call("post", "/tenants", userId, body);
  const createLegacy = (userId, body) =>
    call("put", "/tenants", userId, { id: "brand-new", ...body });

  describe("the required contact", function () {
    it("refuses a creation without a contact name", async function () {
      const res = await create(ADMIN, { ...VALID, contactName: "  " });

      expect(res.status).to.equal(400);
      expect(res.body.code).to.equal("missing_contact_name");
      expect(TenantManager.storeTenant.called).to.be.false;
    });

    it("refuses a creation without a name", async function () {
      const res = await create(ADMIN, { ...VALID, name: undefined });

      expect(res.status).to.equal(400);
      expect(res.body.code).to.equal("missing_name");
    });

    it("refuses a formally invalid contact mail", async function () {
      const res = await create(ADMIN, { ...VALID, mail: "kontakt@" });

      expect(res.status).to.equal(400);
      expect(res.body.code).to.equal("invalid_mail");
      expect(res.body.params.field).to.equal("mail");
    });

    it("creates with the required contact alone and makes the creator the owner", async function () {
      const res = await create(ADMIN, VALID);

      expect(res.status).to.equal(201);
      const stored = TenantManager.storeTenant.lastCall.args[0];
      expect(stored).to.include(VALID);
      expect(stored.phone).to.equal("");
      expect(stored.ownerUserIds).to.deep.equal([ADMIN]);
      expect(stored.genericMailTemplate).to.be.a("string").that.is.not.empty;
      expect(stored.receiptTemplate).to.be.a("string").that.is.not.empty;
      expect(stored.invoiceTemplate).to.be.a("string").that.is.not.empty;
      expect(stored.mailSnippets).to.be.an("object");
      expect(stored.cancellationRefundTiers).to.be.an("array");

      const [tenantId, membership] =
        MembershipManager.addMembership.lastCall.args;
      expect(tenantId).to.equal(stored.id);
      expect(membership).to.include({
        userId: ADMIN,
        owner: true,
        status: "active",
      });
    });

    it("keeps the optional fields it is given", async function () {
      const res = await create(ADMIN, {
        ...VALID,
        phone: "+49 30 1234",
        website: "https://stadthalle.example",
        location: "Rathausplatz 1",
      });

      expect(res.status).to.equal(201);
      expect(TenantManager.storeTenant.lastCall.args[0]).to.include({
        phone: "+49 30 1234",
        website: "https://stadthalle.example",
        location: "Rathausplatz 1",
      });
    });

    it("updates an existing tenant without the new required contact", async function () {
      TenantManager.getTenant.callsFake(async () => new Tenant(h.tenant));

      const res = await call("put", "/tenants", ADMIN, {
        id: TENANT,
        name: "Umbenannt",
      });

      expect(res.status).to.equal(200);
      expect(TenantManager.storeTenant.calledOnce).to.be.true;
    });
  });

  describe("the right and the global limit", function () {
    it("refuses a user the instance does not let create", async function () {
      const res = await create(OWNER, VALID);

      expect(res.status).to.equal(403);
      expect(TenantManager.storeTenant.called).to.be.false;
    });

    it("refuses the instance owner too once MAX_TENANTS is reached", async function () {
      TenantManager.checkTenantCount.callsFake(async () => false);

      const res = await create(ADMIN, VALID);

      expect(res.status).to.equal(409);
      expect(res.body.code).to.equal("max_tenants_reached");
      expect(TenantManager.storeTenant.called).to.be.false;
    });

    it("refuses a self-creation once MAX_TENANTS is reached, spending no slot", async function () {
      TenantManager.checkTenantCount.callsFake(async () => false);

      const res = await create(CUSTOMER, VALID);

      expect(res.status).to.equal(409);
      expect(RateLimitEventManager.record.called).to.be.false;
    });
  });

  describe("the Selbst-Anlage", function () {
    it("re-checks the verification proof of a local account", async function () {
      users[CUSTOMER] = new User({ id: CUSTOMER, isVerified: false });

      const res = await create(CUSTOMER, VALID);

      expect(res.status).to.equal(403);
      expect(res.body.code).to.equal("email_verification_required");
      expect(res.body.params).to.include({ method: "email" });
      expect(TenantManager.storeTenant.called).to.be.false;
      expect(RateLimitEventManager.record.called).to.be.false;
    });

    it("takes no SSO account without the identity provider's proof", async function () {
      users[CUSTOMER] = new User({
        id: CUSTOMER,
        authType: "keycloak",
        isVerified: true,
        idpEmailVerifiedAt: null,
      });

      const res = await create(CUSTOMER, VALID);

      expect(res.status).to.equal(403);
      expect(res.body.code).to.equal("email_verification_required");
      expect(res.body.params).to.include({
        method: "identity_provider",
        provider: "keycloak",
      });
    });

    it("does not ask the instance owner for a proof", async function () {
      users[ADMIN] = new User({ id: ADMIN, isVerified: false });

      expect((await create(ADMIN, VALID)).status).to.equal(201);
    });

    it("lets a verified user on the Freigabeliste create, in the instance's initial level", async function () {
      instance.tenantInitialSupervisionLevel = "supervised";

      const res = await create(CUSTOMER, VALID);

      expect(res.status).to.equal(201);
      const stored = TenantManager.storeTenant.lastCall.args[0];
      expect(stored.supervisionLevel).to.equal("supervised");
      expect(stored.ownerUserIds).to.deep.equal([CUSTOMER]);
    });

    it("starts the instance owner's tenant free whatever the instance says", async function () {
      instance.tenantInitialSupervisionLevel = "supervised";

      await create(ADMIN, VALID);

      expect(
        TenantManager.storeTenant.lastCall.args[0].supervisionLevel,
      ).to.equal("free");
    });
  });

  describe("the initial level of a self-creation", function () {
    const storedLevel = () =>
      TenantManager.storeTenant.lastCall.args[0].supervisionLevel;
    const openCreation = () => {
      instance.allowedUsersToCreateTenant = [];
      instance.allowAllUsersToCreateTenant = true;
    };

    for (const level of ["free", "supervised", "blocked"]) {
      it(`starts a creation over the Freigabeliste ${level} when the instance says so`, async function () {
        instance.tenantInitialSupervisionLevel = level;

        expect((await create(CUSTOMER, VALID)).status).to.equal(201);
        expect(storedLevel()).to.equal(level);
        expect(SupervisionHistoryManager.insert.firstCall.args[0]).to.include({
          eventType: "tenant.created",
          from: null,
          to: level,
        });
      });

      it(`starts an open creation ${level} when the instance says so`, async function () {
        openCreation();
        instance.tenantInitialSupervisionLevel = level;

        expect((await create(OWNER, VALID)).status).to.equal(201);
        expect(storedLevel()).to.equal(level);
        expect(
          SupervisionNotificationManager.record.firstCall.args[0].payload
            .supervisionLevel,
        ).to.equal(level);
      });
    }

    it("refuses a user whom neither way permits", async function () {
      instance.allowedUsersToCreateTenant = [];

      expect((await create(CUSTOMER, VALID)).status).to.equal(403);
      expect(TenantManager.storeTenant.called).to.be.false;
    });

    it("starts free when the instance names no level", async function () {
      delete instance.tenantInitialSupervisionLevel;

      await create(CUSTOMER, VALID);

      expect(storedLevel()).to.equal("free");
    });

    it("reads the level at the time of each creation, not retroactively", async function () {
      instance.tenantInitialSupervisionLevel = "supervised";
      await create(CUSTOMER, VALID);
      const first = TenantManager.storeTenant.lastCall.args[0];

      instance.tenantInitialSupervisionLevel = "blocked";
      await create(CUSTOMER, VALID);

      expect(first.supervisionLevel).to.equal("supervised");
      expect(storedLevel()).to.equal("blocked");
      expect(TenantManager.updateSupervisionLevel.called).to.be.false;
    });

    it("ignores a level, a change time and a review in the body on both ways", async function () {
      const forged = {
        ...VALID,
        supervisionLevel: "free",
        supervisionChangedAt: "2020-01-01T00:00:00.000Z",
        review: { status: "approved" },
      };
      instance.tenantInitialSupervisionLevel = "blocked";

      await create(CUSTOMER, forged);
      let stored = TenantManager.storeTenant.lastCall.args[0];
      expect(stored.supervisionLevel).to.equal("blocked");
      expect(stored.supervisionChangedAt).to.equal(null);
      expect(stored).to.not.have.property("review");

      openCreation();
      await create(OWNER, forged);
      stored = TenantManager.storeTenant.lastCall.args[0];
      expect(stored.supervisionLevel).to.equal("blocked");
      expect(stored).to.not.have.property("review");
    });

    it("starts the instance owner's tenant free on every initial level, the forged body included", async function () {
      for (const level of ["supervised", "blocked"]) {
        instance.tenantInitialSupervisionLevel = level;

        await create(ADMIN, { ...VALID, supervisionLevel: level });

        expect(storedLevel()).to.equal("free");
      }
    });
  });

  describe("the limit of three self-creations per rolling 24 hours", function () {
    it("counts a successful self-creation against the user, and keeps the slot", async function () {
      const res = await create(CUSTOMER, VALID);

      expect(res.status).to.equal(201);
      expect(RateLimitEventManager.record.calledOnce).to.be.true;
      expect(RateLimitEventManager.record.firstCall.args[0]).to.equal(
        `tenant-self-creation:user:${CUSTOMER}`,
      );
      expect(RateLimitEventManager.remove.called).to.be.false;
    });

    it("answers the fourth creation within 24 hours with 429 and Retry-After", async function () {
      attemptsInWindow = 4;
      RateLimitEventManager.oldestAtWithin.callsFake(
        async () => new Date(Date.now() - 20 * 3600 * 1000),
      );

      const res = await create(CUSTOMER, VALID);

      expect(res.status).to.equal(429);
      expect(res.body.code).to.equal("too_many_requests");
      expect(Number(res.headers["retry-after"])).to.be.within(
        4 * 3600 - 5,
        4 * 3600,
      );
      expect(TenantManager.storeTenant.called).to.be.false;
      expect(MembershipManager.addMembership.called).to.be.false;
    });

    it("exempts the instance owner from the time limit", async function () {
      attemptsInWindow = 4;

      const res = await create(ADMIN, VALID);

      expect(res.status).to.equal(201);
      expect(RateLimitEventManager.record.called).to.be.false;
    });

    it("gives no quota back when a tenant is deleted", async function () {
      TenantManager.getTenant.callsFake(async () => new Tenant(h.tenant));

      const res = await call("delete", `/tenants/${TENANT}`, ADMIN);

      expect(res.status).to.equal(200);
      expect(RateLimitEventManager.remove.called).to.be.false;
    });

    it("gives the slot back and removes the tenant when the owner membership fails", async function () {
      MembershipManager.addMembership.callsFake(async () => {
        throw new Error("membership store down");
      });

      const res = await create(CUSTOMER, VALID);

      expect(res.status).to.equal(500);
      const tenantId = TenantManager.storeTenant.lastCall.args[0].id;
      expect(TenantManager.removeTenant.calledOnceWith(tenantId)).to.be.true;
      expect(RateLimitEventManager.remove.calledOnceWith(FIXTURE_ID)).to.be
        .true;
      expect(SupervisionHistoryManager.insert.called).to.be.false;
      expect(SupervisionNotificationManager.record.called).to.be.false;
      MembershipManager.addMembership.callsFake(async () => ({}));
    });
  });

  describe("history and outbox", function () {
    it("writes one tenant.created row and one tenant.selfCreated occasion for a self-creation", async function () {
      instance.tenantInitialSupervisionLevel = "supervised";

      const res = await create(CUSTOMER, VALID);

      expect(res.status).to.equal(201);
      const tenantId = TenantManager.storeTenant.lastCall.args[0].id;

      expect(SupervisionHistoryManager.insert.calledOnce).to.be.true;
      const row = SupervisionHistoryManager.insert.firstCall.args[0];
      expect(row).to.deep.include({
        tenantId,
        offerType: null,
        offerId: null,
        eventType: "tenant.created",
        actor: { type: "user", userId: CUSTOMER },
        from: null,
        to: "supervised",
        reason: null,
        origin: "api",
        dedupeKey: `tenant.created:${tenantId}`,
      });
      expect(row.occurredAt).to.be.instanceOf(Date);

      expect(SupervisionNotificationManager.record.calledOnce).to.be.true;
      const occasion = SupervisionNotificationManager.record.firstCall.args[0];
      expect(occasion).to.deep.include({
        type: "tenant.selfCreated",
        tenantId,
        payload: {
          tenantId,
          tenantName: VALID.name,
          creatorUserId: CUSTOMER,
          supervisionLevel: "supervised",
        },
        dedupeKey: `tenant.selfCreated:${tenantId}`,
      });
      expect(occasion.createdAt).to.equal(row.occurredAt);
    });

    it("writes the history row but no occasion for the instance owner's creation", async function () {
      await create(ADMIN, VALID);

      expect(SupervisionHistoryManager.insert.calledOnce).to.be.true;
      expect(SupervisionHistoryManager.insert.firstCall.args[0]).to.include({
        eventType: "tenant.created",
        to: "free",
      });
      expect(SupervisionNotificationManager.record.called).to.be.false;
    });
  });

  describe("the obsolete PUT with an unknown id", function () {
    it("uses the same contract: required contact", async function () {
      const res = await createLegacy(ADMIN, { ...VALID, mail: "nope" });

      expect(res.status).to.equal(400);
      expect(res.body.code).to.equal("invalid_mail");
    });

    it("uses the same contract: verification proof and the time limit", async function () {
      // At the router the obsolete PUT carries `tenant.update`, which only
      // the instance owner holds for a tenant that does not exist yet; the
      // adapter's second decision is exercised at the controller seam.
      const principal = {
        userId: CUSTOMER,
        tenantId: "brand-new",
        isInstanceOwner: false,
        isTenantOwner: false,
        grants: {},
        mayCreateTenant: true,
      };
      const request = (body) => ({
        user: { id: CUSTOMER },
        principal,
        reach: "any",
        params: {},
        query: {},
        body: { id: "brand-new", ...body },
      });
      const response = () => {
        const res = {
          statusCode: null,
          body: null,
          headers: {},
          status(code) {
            res.statusCode = code;
            return res;
          },
          set(name, value) {
            res.headers[name] = value;
          },
          json(body) {
            res.body = body;
            return res;
          },
          send(body) {
            res.body = body;
            return res;
          },
          sendStatus(code) {
            res.statusCode = code;
            return res;
          },
        };
        return res;
      };

      users[CUSTOMER] = new User({ id: CUSTOMER, isVerified: false });
      let res = response();
      await TenantController.storeTenant(request(VALID), res, sinon.stub());
      expect(res.statusCode).to.equal(403);
      expect(res.body.code).to.equal("email_verification_required");

      users[CUSTOMER] = new User({ id: CUSTOMER, isVerified: true });
      attemptsInWindow = 4;
      res = response();
      await TenantController.storeTenant(request(VALID), res, sinon.stub());
      expect(res.statusCode).to.equal(429);
      expect(res.headers["Retry-After"]).to.match(/^\d+$/);

      attemptsInWindow = 1;
      res = response();
      await TenantController.storeTenant(request(VALID), res, sinon.stub());
      expect(res.statusCode).to.equal(201);
      expect(
        TenantManager.storeTenant.lastCall.args[0].ownerUserIds,
      ).to.deep.equal([CUSTOMER]);
      expect(
        SupervisionNotificationManager.record.firstCall.args[0].type,
      ).to.equal("tenant.selfCreated");

      // The initial level is the instance's here too, whatever the body says.
      instance.tenantInitialSupervisionLevel = "supervised";
      res = response();
      await TenantController.storeTenant(
        request({ ...VALID, supervisionLevel: "free", review: {} }),
        res,
        sinon.stub(),
      );
      expect(res.statusCode).to.equal(201);
      const stored = TenantManager.storeTenant.lastCall.args[0];
      expect(stored.supervisionLevel).to.equal("supervised");
      expect(stored).to.not.have.property("review");
    });

    it("starts the instance owner's tenant free over the obsolete PUT as well", async function () {
      instance.tenantInitialSupervisionLevel = "blocked";

      const res = await createLegacy(ADMIN, {
        ...VALID,
        supervisionLevel: "blocked",
      });

      expect(res.status).to.equal(201);
      expect(
        TenantManager.storeTenant.lastCall.args[0].supervisionLevel,
      ).to.equal("free");
    });

    it("creates for the instance owner with owner membership and history like the POST", async function () {
      const res = await createLegacy(ADMIN, VALID);

      expect(res.status).to.equal(201);
      expect(MembershipManager.addMembership.calledOnce).to.be.true;
      expect(SupervisionHistoryManager.insert.calledOnce).to.be.true;
      expect(SupervisionNotificationManager.record.called).to.be.false;
    });
  });

  describe("repeating a request", function () {
    it("a repeated failed request writes nothing twice and spends no slot", async function () {
      TenantManager.storeTenant.callsFake(async () => {
        throw new Error("store down");
      });

      expect((await create(CUSTOMER, VALID)).status).to.equal(500);
      expect((await create(CUSTOMER, VALID)).status).to.equal(500);

      expect(RateLimitEventManager.record.callCount).to.equal(2);
      expect(RateLimitEventManager.remove.callCount).to.equal(2);
      expect(MembershipManager.addMembership.called).to.be.false;
      expect(SupervisionHistoryManager.insert.called).to.be.false;
      expect(SupervisionNotificationManager.record.called).to.be.false;
      TenantManager.storeTenant.callsFake(async (t) => t);
    });
  });
});
