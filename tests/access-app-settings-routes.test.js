/**
 * The access application (glossary "Anbindung") of one provider, saved,
 * switched on and off and removed on its own (ECCdigital/tickets#1101):
 * `PUT /api/:tenant/access-apps/:provider`, `PUT …/:provider/active` and
 * `DELETE …/:provider`, under `accessApp.manage` like the connection test.
 * No answer carries a secret; per secret field it says whether one is
 * stored. What is stored afterwards is read off the tenant record of the
 * harness, which the tenant manager's writes change.
 */

const { expect } = require("chai");
const sinon = require("sinon");

const {
  installHarness,
  TENANT,
  OWNER,
  ROLE_HOLDER,
  CUSTOMER,
} = require("./helpers/booking-lifecycle-harness");
const { installRouteWorld } = require("./helpers/route-world");
const TenantManager = require("../src/commons/data-managers/tenant-manager");

const FORBIDDEN = {
  error: "ForbiddenError",
  code: "forbidden",
  statusCode: 403,
  params: {},
};

describe("access application of one provider over HTTP", function () {
  this.timeout(20000);

  let h;
  /** The applications of the tenant as the test starts. */
  let initialApplications;

  before(async function () {
    h = await installHarness({});
    installRouteWorld({
      tenantId: TENANT,
      tenant: h.tenant,
      ownerUserId: ROLE_HOLDER,
      bookables: h.bookables,
    });
    initialApplications = h.tenant.applications;

    const restub = (name, impl) => {
      TenantManager[name].restore();
      sinon.stub(TenantManager, name).callsFake(impl);
    };
    // The tenant's applications as the real manager writes them: one
    // access application replaced or added, one removed, nothing else.
    restub("storeAccessApplication", async (tenantId, app) => {
      const others = h.tenant.applications.filter(
        (a) => !(a.type === "access" && a.id === app.id),
      );
      h.tenant.applications = [...others, JSON.parse(JSON.stringify(app))];
    });
    restub("removeAccessApplication", async (tenantId, providerId) => {
      h.tenant.applications = h.tenant.applications.filter(
        (a) => !(a.type === "access" && a.id === providerId),
      );
    });
  });

  beforeEach(function () {
    h.tenant.applications = JSON.parse(JSON.stringify(initialApplications));
  });

  after(async function () {
    sinon.restore();
    await h.close();
  });

  const call = (method, path, userId, body) => {
    let req = h.api()[method](`/api/${TENANT}/access-apps${path}`);
    if (userId) req = req.set(h.as(userId));
    return req.send(body);
  };
  /** The stored access application of a provider, or undefined. */
  const stored = (provider) =>
    h.tenant.applications.find((a) => a.type === "access" && a.id === provider);

  describe("PUT /:provider", function () {
    it("is the tenant owner's, refused to the anonymous and the customer in the one form", async function () {
      const body = { apiToken: "token-1" };

      expect((await call("put", "/nuki", null, body)).status).to.equal(401);

      const customer = await call("put", "/nuki", CUSTOMER, body);
      expect(customer.status).to.equal(403);
      expect(customer.body).to.deep.equal(FORBIDDEN);

      const roleHolder = await call("put", "/nuki", ROLE_HOLDER, body);
      expect(roleHolder.status).to.equal(403);
      expect(roleHolder.body).to.deep.equal(FORBIDDEN);

      expect((await call("put", "/nuki", OWNER, body)).status).to.equal(200);
    });

    it("creates the application switched on and answers it without its secret", async function () {
      const res = await call("put", "/nuki", OWNER, {
        apiToken: "token-1",
        apiBaseUrl: "https://api.nuki.example",
      });

      expect(res.status).to.equal(200);
      expect(res.body).to.include({
        type: "access",
        id: "nuki",
        active: true,
        apiBaseUrl: "https://api.nuki.example",
      });
      expect(res.body).to.not.have.property("apiToken");
      expect(res.body.storedSecrets).to.deep.equal({ apiToken: true });
      expect(JSON.stringify(res.body)).to.not.include("token-1");

      expect(stored("nuki")).to.include({
        active: true,
        apiToken: "token-1",
        apiBaseUrl: "https://api.nuki.example",
      });
    });

    it("changes only this application: payment and the other providers stay as stored", async function () {
      h.tenant.applications.push(
        { type: "access", id: "nuki", active: true, apiToken: "token-1" },
        {
          type: "access",
          id: "open-locker",
          active: true,
          serverUrl: "https://locker.example",
          email: "technik@example.test",
          password: "locker-pw",
        },
      );
      const before = JSON.parse(JSON.stringify(h.tenant.applications));

      const res = await call("put", "/nuki", OWNER, {
        apiToken: "token-2",
        apiBaseUrl: "https://api.nuki.example",
      });

      expect(res.status).to.equal(200);
      expect(stored("nuki")).to.include({
        apiToken: "token-2",
        apiBaseUrl: "https://api.nuki.example",
      });
      const untouched = (apps) => apps.filter((a) => a.id !== "nuki");
      expect(untouched(h.tenant.applications)).to.have.deep.members(
        untouched(before),
      );
    });

    // Every provider, every secret: the form never sees a stored secret, so
    // an empty or missing one means "keep what is stored".
    const SECRETS = {
      nuki: { apiToken: "token-1" },
      "salto-ks": { clientSecret: "client-secret", password: "salto-pw" },
      "open-locker": { password: "locker-pw" },
      ifbs: { apiKey: "api-key", secretPhrase: "phrase" },
      pareva: { password: "pareva-pw" },
    };
    for (const [provider, secrets] of Object.entries(SECRETS)) {
      it(`keeps the stored secrets of ${provider} the save leaves empty or out`, async function () {
        h.tenant.applications.push({
          type: "access",
          id: provider,
          active: true,
          ...secrets,
        });
        const [first, ...rest] = Object.keys(secrets);
        const body = {
          customerService: { name: "Hausmeister" },
          [first]: "",
        };

        const res = await call("put", `/${provider}`, OWNER, body);

        expect(res.status).to.equal(200);
        expect(stored(provider)).to.include(secrets);
        expect(res.body.storedSecrets).to.deep.equal(
          Object.fromEntries(Object.keys(secrets).map((f) => [f, true])),
        );
        for (const field of [first, ...rest]) {
          expect(res.body).to.not.have.property(field);
        }
        for (const value of Object.values(secrets)) {
          expect(JSON.stringify(res.body)).to.not.include(value);
        }
      });
    }

    // A secret belongs to its identity (`secretIdentity`), as at the
    // connection test: a password to one account at one server.
    describe("once the identity a stored secret belongs to changes", function () {
      const openLocker = {
        type: "access",
        id: "open-locker",
        active: true,
        serverUrl: "https://locker.example",
        email: "technik@example.test",
        password: "locker-pw",
      };

      it("refuses a save that leaves the secret empty with 400 missing_secret, and stores nothing", async function () {
        h.tenant.applications.push({ ...openLocker });

        const res = await call("put", "/open-locker", OWNER, {
          serverUrl: "https://other-locker.example",
          email: "technik@example.test",
          password: "",
        });

        expect(res.status).to.equal(400);
        expect(res.body).to.deep.equal({
          error: "BadRequestError",
          code: "missing_secret",
          statusCode: 400,
          params: {
            provider: "open-locker",
            missing: [{ field: "password", reason: "server_url_changed" }],
          },
        });
        expect(stored("open-locker")).to.deep.equal(openLocker);
      });

      it("names every secret that cannot be kept, with the identity that changed", async function () {
        h.tenant.applications.push({
          type: "access",
          id: "salto-ks",
          active: true,
          environment: "accept",
          clientId: "client",
          clientSecret: "client-secret",
          username: "system@example.test",
          password: "salto-pw",
        });

        const res = await call("put", "/salto-ks", OWNER, {
          environment: "production",
          clientId: "client",
          username: "system@example.test",
        });

        expect(res.status).to.equal(400);
        expect(res.body.params.missing).to.deep.equal([
          { field: "clientSecret", reason: "environment_changed" },
          { field: "password", reason: "environment_changed" },
        ]);
        expect(stored("salto-ks").environment).to.equal("accept");
      });

      it("saves the new identity with its new secret", async function () {
        h.tenant.applications.push({ ...openLocker });

        const res = await call("put", "/open-locker", OWNER, {
          serverUrl: "https://other-locker.example",
          password: "other-pw",
        });

        expect(res.status).to.equal(200);
        expect(stored("open-locker")).to.include({
          serverUrl: "https://other-locker.example",
          password: "other-pw",
        });
      });

      it("saves a first secret-less application, as nothing stored belongs to another identity", async function () {
        const res = await call("put", "/open-locker", OWNER, {
          serverUrl: "https://locker.example",
          email: "technik@example.test",
        });

        expect(res.status).to.equal(200);
        expect(res.body.storedSecrets).to.deep.equal({ password: false });
      });
    });

    it("leaves switching on and off to its own call", async function () {
      h.tenant.applications.push({
        type: "access",
        id: "nuki",
        active: false,
        apiToken: "token-1",
      });

      const res = await call("put", "/nuki", OWNER, { active: true });

      expect(res.status).to.equal(200);
      expect(res.body.active).to.equal(false);
      expect(stored("nuki").active).to.equal(false);
    });

    it("keeps the Salto KS IQ activations, which the backend alone writes, and never answers them", async function () {
      const activation = { iqId: "iq-1", state: "activated" };
      h.tenant.applications.push({
        type: "access",
        id: "salto-ks",
        active: true,
        clientId: "client",
        clientSecret: "client-secret",
        username: "system@example.test",
        password: "salto-pw",
        iqActivations: [activation],
      });

      const res = await call("put", "/salto-ks", OWNER, {
        siteId: "site-2",
        iqActivations: [],
      });

      expect(res.status).to.equal(200);
      expect(res.body).to.not.have.property("iqActivations");
      expect(stored("salto-ks").iqActivations).to.deep.equal([activation]);
      expect(stored("salto-ks").siteId).to.equal("site-2");
    });

    it("answers 404 access_provider_not_found for a provider it does not know", async function () {
      const res = await call("put", "/unknown", OWNER, {});

      expect(res.status).to.equal(404);
      expect(res.body).to.deep.equal({
        error: "NotFoundError",
        code: "access_provider_not_found",
        statusCode: 404,
        params: { provider: "unknown" },
      });
    });
  });

  describe("PUT /:provider/active", function () {
    const nuki = (overrides = {}) => ({
      type: "access",
      id: "nuki",
      active: true,
      apiToken: "token-1",
      apiBaseUrl: "https://api.nuki.example",
      ...overrides,
    });

    it("is the tenant owner's, refused to the anonymous and the customer in the one form", async function () {
      h.tenant.applications.push(nuki());
      const body = { active: false };

      expect((await call("put", "/nuki/active", null, body)).status).to.equal(
        401,
      );

      const customer = await call("put", "/nuki/active", CUSTOMER, body);
      expect(customer.status).to.equal(403);
      expect(customer.body).to.deep.equal(FORBIDDEN);

      expect(
        (await call("put", "/nuki/active", ROLE_HOLDER, body)).status,
      ).to.equal(403);
      expect((await call("put", "/nuki/active", OWNER, body)).status).to.equal(
        200,
      );
    });

    it("switches off and keeps the credentials, and on again without a question", async function () {
      h.tenant.applications.push(nuki());

      const off = await call("put", "/nuki/active", OWNER, { active: false });

      expect(off.status).to.equal(200);
      expect(off.body).to.include({ id: "nuki", active: false });
      expect(off.body.storedSecrets).to.deep.equal({ apiToken: true });
      expect(JSON.stringify(off.body)).to.not.include("token-1");
      expect(stored("nuki")).to.deep.include(nuki({ active: false }));

      const on = await call("put", "/nuki/active", OWNER, {
        active: true,
        apiToken: "other",
      });

      expect(on.status).to.equal(200);
      expect(stored("nuki")).to.deep.include(nuki({ active: true }));
    });

    it("keeps the access points and their assignment: it touches the application alone", async function () {
      h.tenant.applications.push(nuki());
      const bookables = JSON.stringify(h.bookables);

      const off = await call("put", "/nuki/active", OWNER, { active: false });

      expect(off.status).to.equal(200);
      expect(JSON.stringify(h.bookables)).to.equal(bookables);
      const points = await h
        .api()
        .get(`/api/${TENANT}/accesspoints/`)
        .set(h.as(OWNER));
      expect(points.body.map((p) => p.id)).to.include("fx");
    });

    it("refuses an answer that is not true or false with 400", async function () {
      h.tenant.applications.push(nuki());

      const res = await call("put", "/nuki/active", OWNER, { active: "no" });

      expect(res.status).to.equal(400);
      expect(res.body).to.include({
        error: "BadRequestError",
        code: "access_app_active_invalid",
      });
      expect(stored("nuki").active).to.equal(true);
    });

    it("answers 404 access_app_not_found for a provider the tenant has not connected", async function () {
      const res = await call("put", "/nuki/active", OWNER, { active: true });

      expect(res.status).to.equal(404);
      expect(res.body).to.deep.equal({
        error: "NotFoundError",
        code: "access_app_not_found",
        statusCode: 404,
        params: { provider: "nuki" },
      });
      expect(stored("nuki")).to.equal(undefined);
    });
  });

  // The world's one access point is a Nuki door (`fx`).
  describe("DELETE /:provider", function () {
    const openLocker = () => ({
      type: "access",
      id: "open-locker",
      active: true,
      serverUrl: "https://locker.example",
      email: "technik@example.test",
      password: "locker-pw",
    });
    const nuki = () => ({
      type: "access",
      id: "nuki",
      active: true,
      apiToken: "token-1",
    });

    it("is the tenant owner's, refused to the anonymous and the customer in the one form", async function () {
      h.tenant.applications.push(openLocker());

      expect((await call("delete", "/open-locker")).status).to.equal(401);

      const customer = await call("delete", "/open-locker", CUSTOMER);
      expect(customer.status).to.equal(403);
      expect(customer.body).to.deep.equal(FORBIDDEN);

      expect(
        (await call("delete", "/open-locker", ROLE_HOLDER)).status,
      ).to.equal(403);
      expect((await call("delete", "/open-locker", OWNER)).status).to.equal(
        204,
      );
    });

    it("removes the application with its credentials, and nothing else", async function () {
      h.tenant.applications.push(nuki(), openLocker());
      const others = h.tenant.applications.filter(
        (a) => a.id !== "open-locker",
      );

      const res = await call("delete", "/open-locker", OWNER);

      expect(res.status).to.equal(204);
      expect(stored("open-locker")).to.equal(undefined);
      expect(h.tenant.applications).to.deep.equal(others);
    });

    it("answers 409 access_app_has_access_points while the provider still has access points", async function () {
      h.tenant.applications.push(nuki());

      const res = await call("delete", "/nuki", OWNER);

      expect(res.status).to.equal(409);
      expect(res.body).to.deep.equal({
        error: "ConflictError",
        code: "access_app_has_access_points",
        statusCode: 409,
        params: { provider: "nuki", accessPoints: 1 },
      });
      expect(stored("nuki")).to.deep.include(nuki());
    });

    it("answers 404 access_app_not_found for a provider the tenant has not connected", async function () {
      const res = await call("delete", "/pareva", OWNER);

      expect(res.status).to.equal(404);
      expect(res.body).to.deep.equal({
        error: "NotFoundError",
        code: "access_app_not_found",
        statusCode: 404,
        params: { provider: "pareva" },
      });
    });
  });
});
