/**
 * The access applications (glossary "Anbindung") in the tenant routes
 * (ECCdigital/tickets#1105): reading the tenant answers no secret of
 * theirs, per secret field only whether one is stored, as the save of one
 * provider does (`storedSecrets`); payment applications are answered as
 * stored. `PUT /api/tenants` keeps the access applications as stored,
 * whatever it sends - they are written only by their own routes. What is
 * stored afterwards is read off the tenant record of the harness, which
 * the tenant manager's writes change.
 */

const { expect } = require("chai");
const sinon = require("sinon");

const {
  installHarness,
  TENANT,
  OWNER,
} = require("./helpers/booking-lifecycle-harness");
const { installRouteWorld } = require("./helpers/route-world");
const TenantManager = require("../src/commons/data-managers/tenant-manager");

const PAYMENT = {
  type: "payment",
  id: "giroCockpit",
  active: true,
  paymentMerchantId: "merchant-1",
  paymentProjectId: "project-1",
  paymentSecret: "payment-secret",
};

/**
 * Per provider the stored access application and, per secret field,
 * whether one is stored.
 */
const ACCESS_APPS = {
  nuki: {
    stored: { apiBaseUrl: "https://api.nuki.example", apiToken: "nuki-token" },
    storedSecrets: { apiToken: true },
  },
  "salto-ks": {
    stored: {
      environment: "accept",
      clientId: "client-id",
      clientSecret: "salto-client-secret",
      username: "system@example.test",
      password: "",
      siteId: "site-1",
    },
    storedSecrets: { clientSecret: true, password: false },
  },
  ifbs: {
    stored: {
      serverUrl: "https://ifbs.example",
      apiKeyID: "key-1",
      apiKey: "ifbs-api-key",
      secretPhrase: "ifbs-phrase",
    },
    storedSecrets: { apiKey: true, secretPhrase: true },
  },
  pareva: {
    stored: {
      serverUrl: "https://pareva.example",
      lockerId: "locker-1",
      user: "pareva-user",
      password: "pareva-pw",
    },
    storedSecrets: { password: true },
  },
  "open-locker": {
    stored: {
      serverUrl: "https://locker.example",
      email: "technik@example.test",
      password: "locker-pw",
    },
    storedSecrets: { password: true },
  },
};

/** Every secret value of the fixture, none of which may leave. */
const SECRET_VALUES = [
  "nuki-token",
  "salto-client-secret",
  "ifbs-api-key",
  "ifbs-phrase",
  "pareva-pw",
  "locker-pw",
];

const clone = (value) => JSON.parse(JSON.stringify(value));

describe("access applications in the tenant routes over HTTP", function () {
  this.timeout(20000);

  let h;

  before(async function () {
    h = await installHarness({});
    installRouteWorld({
      tenantId: TENANT,
      tenant: h.tenant,
      ownerUserId: OWNER,
      bookables: h.bookables,
    });
    // The whole tenant as the real manager writes it: its applications
    // replace the stored ones.
    TenantManager.storeTenant.restore();
    sinon.stub(TenantManager, "storeTenant").callsFake(async (tenant) => {
      h.tenant.applications = clone(tenant.applications);
      return TenantManager.getTenant(TENANT);
    });
  });

  beforeEach(function () {
    h.tenant.applications = [
      clone(PAYMENT),
      ...Object.entries(ACCESS_APPS).map(([id, { stored }]) => ({
        type: "access",
        id,
        active: true,
        ...clone(stored),
      })),
    ];
  });

  after(async function () {
    sinon.restore();
    await h.close();
  });

  const accessAppsOf = (tenant) =>
    tenant.applications.filter((app) => app.type === "access");

  describe("GET /api/tenants/:tenant", function () {
    const read = () => h.api().get(`/api/tenants/${TENANT}`).set(h.as(OWNER));

    it("answers per secret field of every access application only whether one is stored", async function () {
      const res = await read();

      expect(res.status).to.equal(200);
      const answered = accessAppsOf(res.body);
      expect(answered.map((app) => app.id)).to.have.members(
        Object.keys(ACCESS_APPS),
      );
      for (const app of answered) {
        expect(app.storedSecrets, app.id).to.deep.equal(
          ACCESS_APPS[app.id].storedSecrets,
        );
        for (const field of Object.keys(ACCESS_APPS[app.id].storedSecrets)) {
          expect(app, app.id).to.not.have.property(field);
        }
      }
      for (const value of SECRET_VALUES) {
        expect(JSON.stringify(res.body)).to.not.include(value);
      }
    });

    it("answers what is no secret of an access application as stored", async function () {
      const res = await read();

      const nuki = accessAppsOf(res.body).find((app) => app.id === "nuki");
      expect(nuki).to.include({
        active: true,
        apiBaseUrl: "https://api.nuki.example",
        connectionState: "unchecked",
      });
    });

    it("answers a payment application as stored, its secrets included", async function () {
      const res = await read();

      expect(
        res.body.applications.find((app) => app.id === PAYMENT.id),
      ).to.deep.equal(PAYMENT);
    });

    it("answers the list of the tenants without secrets of access applications too", async function () {
      const res = await h.api().get("/api/tenants").set(h.as(OWNER));

      expect(res.status).to.equal(200);
      const tenant = res.body.find((t) => t.id === TENANT);
      expect(accessAppsOf(tenant)).to.have.length(5);
      for (const app of accessAppsOf(tenant)) {
        expect(app.storedSecrets, app.id).to.deep.equal(
          ACCESS_APPS[app.id].storedSecrets,
        );
      }
      for (const value of SECRET_VALUES) {
        expect(JSON.stringify(res.body)).to.not.include(value);
      }
      expect(
        tenant.applications.find((app) => app.id === PAYMENT.id),
      ).to.deep.equal(PAYMENT);
    });
  });

  describe("PUT /api/tenants", function () {
    const save = (body) =>
      h
        .api()
        .put("/api/tenants")
        .set(h.as(OWNER))
        .send({ id: TENANT, name: "Stadt", ...body });
    const storedAccessApps = () => clone(accessAppsOf(h.tenant));
    const storedPayment = () =>
      h.tenant.applications.find((app) => app.id === PAYMENT.id);

    it("without applications keeps every stored access application", async function () {
      const before = storedAccessApps();

      const res = await save({});

      expect(res.status).to.equal(200);
      expect(storedAccessApps()).to.deep.equal(before);
    });

    it("with the applications as read keeps every stored access application and its secrets", async function () {
      const before = storedAccessApps();
      const read = await h.api().get(`/api/tenants/${TENANT}`).set(h.as(OWNER));

      const res = await save({ applications: read.body.applications });

      expect(res.status).to.equal(200);
      expect(storedAccessApps()).to.deep.equal(before);
    });

    it("with changed, added or left-out access applications changes none of them", async function () {
      const before = storedAccessApps();

      const res = await save({
        applications: [
          clone(PAYMENT),
          {
            type: "access",
            id: "nuki",
            active: false,
            apiBaseUrl: "https://other.nuki.example",
            apiToken: "forged-token",
          },
          { type: "access", id: "unknown-provider", active: true },
        ],
      });

      expect(res.status).to.equal(200);
      expect(storedAccessApps()).to.deep.equal(before);
    });

    it("connects no provider the tenant has not connected", async function () {
      h.tenant.applications = [clone(PAYMENT)];

      const res = await save({
        applications: [
          clone(PAYMENT),
          { type: "access", id: "nuki", active: true, apiToken: "new-token" },
        ],
      });

      expect(res.status).to.equal(200);
      expect(storedAccessApps()).to.deep.equal([]);
    });

    it("still saves the payment applications it sends", async function () {
      const res = await save({
        applications: [
          { ...clone(PAYMENT), paymentSecret: "new-payment-secret" },
          ...storedAccessApps(),
        ],
      });

      expect(res.status).to.equal(200);
      expect(storedPayment().paymentSecret).to.equal("new-payment-secret");
    });

    it("answers the tenant without secrets of access applications", async function () {
      const res = await save({});

      expect(res.status).to.equal(200);
      for (const app of accessAppsOf(res.body)) {
        expect(app.storedSecrets, app.id).to.deep.equal(
          ACCESS_APPS[app.id].storedSecrets,
        );
      }
      for (const value of SECRET_VALUES) {
        expect(JSON.stringify(res.body)).to.not.include(value);
      }
    });
  });
});
