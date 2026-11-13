/**
 * The connection test of an access application (glossary "Anbindung") over
 * HTTP, and what it leaves behind (ECCdigital/tickets#1102): `POST
 * /api/:tenant/access-apps/:provider/test` takes the stored secret for one
 * the form leaves empty, at all five providers, as long as the identity it
 * belongs to stays; it records the last test at the application, and the
 * application answers its connection state - when read, saved and
 * switched. Stubbed is the border to the provider alone: a fake per
 * provider that knows the one right secret.
 */

const { expect } = require("chai");
const sinon = require("sinon");

const {
  installHarness,
  TENANT,
  OWNER,
} = require("./helpers/booking-lifecycle-harness");
const { installRouteWorld } = require("./helpers/route-world");
const {
  installFakeSaltoKsConnectApi,
  FAKE_SITE_ID,
} = require("./helpers/fake-salto-ks-api-client");
const TenantManager = require("../src/commons/data-managers/tenant-manager");
const {
  NukiApiClient,
} = require("../src/commons/services/access/clients/nuki-api-client");
const IfbsApiClient = require("../src/commons/services/access/clients/ifbs-api-client");
const ParevaApiClient = require("../src/commons/services/access/clients/pareva-api-client");
const {
  OpenLockerApiClient,
} = require("../src/commons/services/access/clients/open-locker-api-client");

const SALTO_ACCOUNT = {
  environment: "accept",
  clientId: "client-id",
  clientSecret: "client-secret",
  username: "system@example.test",
  password: "salto-pw",
};

/**
 * Per provider: the stored application, the secret a test leaves empty,
 * fields the test changes beside it (they belong to no secret's
 * identity), and a change of identity with the reason the test names.
 */
const PROVIDERS = {
  nuki: {
    stored: { apiBaseUrl: "https://api.nuki.example", apiToken: "token-1" },
    secret: "apiToken",
    changed: {},
    identity: { apiBaseUrl: "https://other.nuki.example" },
    reason: "api_base_url_changed",
  },
  "salto-ks": {
    stored: { ...SALTO_ACCOUNT, siteId: FAKE_SITE_ID },
    secret: "clientSecret",
    changed: { password: SALTO_ACCOUNT.password },
    identity: { clientId: "other-client" },
    reason: "client_id_changed",
  },
  ifbs: {
    stored: {
      serverUrl: "https://ifbs.example",
      apiKeyID: "key-1",
      apiKey: "api-key",
      secretPhrase: "phrase",
    },
    secret: "apiKey",
    changed: { secretPhrase: "new-phrase" },
    identity: { serverUrl: "https://other.ifbs.example" },
    reason: "server_url_changed",
    // The API key is issued under its key id.
    moreIdentity: { apiKeyID: { to: "key-2", reason: "api_key_id_changed" } },
  },
  pareva: {
    stored: {
      serverUrl: "https://pareva.example",
      lockerId: "locker-1",
      user: "pareva-user",
      password: "pareva-pw",
    },
    secret: "password",
    changed: { lockerId: "locker-2" },
    identity: { user: "other-user" },
    reason: "user_changed",
  },
  "open-locker": {
    stored: {
      serverUrl: "https://locker.example",
      email: "technik@example.test",
      password: "locker-pw",
    },
    secret: "password",
    changed: {},
    identity: { email: "other@example.test" },
    reason: "email_changed",
  },
};

describe("connection test of an access application over HTTP", function () {
  this.timeout(20000);

  let h;
  let initialApplications;
  /** The values each fake provider was asked with, per provider. */
  let asked;
  /** The secrets each fake provider accepts, per provider. */
  let accepted;

  before(async function () {
    h = await installHarness({});
    installRouteWorld({
      tenantId: TENANT,
      tenant: h.tenant,
      ownerUserId: OWNER,
      bookables: h.bookables,
    });
    initialApplications = h.tenant.applications;

    const restub = (name, impl) => {
      TenantManager[name].restore();
      sinon.stub(TenantManager, name).callsFake(impl);
    };
    const clone = (value) => JSON.parse(JSON.stringify(value));
    // The tenant's applications as the real manager writes them.
    restub("storeAccessApplication", async (tenantId, app) => {
      const others = h.tenant.applications.filter(
        (a) => !(a.type === "access" && a.id === app.id),
      );
      h.tenant.applications = [...others, clone(app)];
    });
    restub("recordAccessTest", async (tenantId, providerId, lastTest) => {
      const app = h.tenant.applications.find(
        (a) => a.type === "access" && a.id === providerId,
      );
      if (app) app.lastTest = clone(lastTest);
    });
    restub("storeTenant", async (tenant) => {
      h.tenant.applications = clone(tenant.applications);
      return TenantManager.getTenant(TENANT);
    });

    // The fakes at the border to the providers: each answers success only
    // for a secret it accepts.
    const fake = (provider, secretOf) =>
      async function (...args) {
        const values = secretOf(...args);
        asked[provider].push(values);
        return accepted[provider].includes(values.secret)
          ? { success: true, message: "Connection successful" }
          : { success: false, message: "Unauthorized" };
      };
    sinon.stub(NukiApiClient, "testConnection").callsFake(
      fake("nuki", (apiToken, apiBaseUrl) => ({
        secret: apiToken,
        apiBaseUrl,
      })),
    );
    sinon
      .stub(IfbsApiClient, "testConnection")
      .callsFake(
        fake("ifbs", (serverUrl, apiKey) => ({ secret: apiKey, serverUrl })),
      );
    sinon.stub(ParevaApiClient, "testConnection").callsFake(
      fake("pareva", (serverUrl, lockerId, user, password) => ({
        secret: password,
        serverUrl,
        lockerId,
        user,
      })),
    );
    sinon.stub(OpenLockerApiClient, "testConnection").callsFake(
      fake("open-locker", (serverUrl, email, password) => ({
        secret: password,
        serverUrl,
        email,
      })),
    );
    installFakeSaltoKsConnectApi(sinon, { accounts: [SALTO_ACCOUNT] });
  });

  beforeEach(function () {
    h.tenant.applications = JSON.parse(JSON.stringify(initialApplications));
    asked = Object.fromEntries(Object.keys(PROVIDERS).map((p) => [p, []]));
    accepted = Object.fromEntries(
      Object.entries(PROVIDERS).map(([p, { stored, secret }]) => [
        p,
        [stored[secret]],
      ]),
    );
  });

  after(async function () {
    sinon.restore();
    await h.close();
  });

  const call = (method, path, body) =>
    h
      .api()
      [method](`/api/${TENANT}/access-apps${path}`)
      .set(h.as(OWNER))
      .send(body);
  const store = (provider, fields, extra = {}) =>
    h.tenant.applications.push({
      type: "access",
      id: provider,
      active: true,
      ...fields,
      ...extra,
    });
  /** The access application of a provider as the tenant read answers it. */
  const read = async (provider) => {
    const res = await h.api().get(`/api/tenants/${TENANT}`).set(h.as(OWNER));
    expect(res.status).to.equal(200);
    return res.body.applications.find(
      (a) => a.type === "access" && a.id === provider,
    );
  };

  for (const [provider, spec] of Object.entries(PROVIDERS)) {
    describe(provider, function () {
      it("takes the stored secret the form leaves empty, beside changed fields", async function () {
        store(provider, spec.stored);

        const res = await call("post", `/${provider}/test`, {
          ...spec.stored,
          ...spec.changed,
          [spec.secret]: "",
        });

        expect(res.status).to.equal(200);
        expect(res.body.success).to.equal(true);
      });

      for (const [field, value] of Object.entries(spec.moreIdentity || {})) {
        it(`takes no stored secret once ${field} changed`, async function () {
          store(provider, spec.stored);

          const res = await call("post", `/${provider}/test`, {
            ...spec.stored,
            [field]: value.to,
            [spec.secret]: "",
          });

          expect(res.body).to.include({
            success: false,
            code: "missing_secret",
          });
          expect(res.body.missing).to.deep.include({
            field: spec.secret,
            reason: value.reason,
          });
          expect(asked[provider]).to.deep.equal([]);
        });
      }

      it("takes no stored secret once the identity it belongs to changed", async function () {
        store(provider, spec.stored);

        const res = await call("post", `/${provider}/test`, {
          ...spec.stored,
          ...spec.identity,
          [spec.secret]: "",
        });

        expect(res.status).to.equal(200);
        expect(res.body).to.include({
          success: false,
          code: "missing_secret",
        });
        expect(res.body.missing).to.deep.include({
          field: spec.secret,
          reason: spec.reason,
        });
        if (asked[provider]) {
          expect(asked[provider]).to.deep.equal([]);
        }
      });
    });
  }

  // The state the head of a provider's section shows, from the last test
  // and the stored values (glossary "Anbindung").
  describe("last test and connection state", function () {
    const NUKI = PROVIDERS.nuki.stored;
    const FINGERPRINT = /fingerprint/i;

    it("a test, then saving what was tested, is connected", async function () {
      accepted.nuki.push("token-2");
      store("nuki", NUKI);
      const tested = { ...NUKI, apiToken: "token-2" };

      const test = await call("post", "/nuki/test", tested);
      const saved = await call("put", "/nuki", tested);

      expect(test.body.success).to.equal(true);
      expect(saved.status).to.equal(200);
      expect(saved.body.connectionState).to.equal("connected");
      expect(saved.body.lastTest).to.have.all.keys(
        "success",
        "testedAt",
        "error",
      );
      expect(saved.body.lastTest).to.include({ success: true, error: null });
      expect(saved.body.lastTest.testedAt).to.be.a("number");
      expect(JSON.stringify(saved.body)).to.not.match(FINGERPRINT);

      const answered = await read("nuki");
      expect(answered.connectionState).to.equal("connected");
      expect(JSON.stringify(answered)).to.not.match(FINGERPRINT);
    });

    it("a failed test, then saving what was tested, is failing with the provider's message", async function () {
      store("nuki", NUKI);
      const tested = { ...NUKI, apiToken: "wrong" };

      const test = await call("post", "/nuki/test", tested);
      const saved = await call("put", "/nuki", tested);

      expect(test.body.success).to.equal(false);
      expect(saved.body.connectionState).to.equal("failing");
      expect(saved.body.lastTest).to.include({
        success: false,
        error: "Unauthorized",
      });
      expect((await read("nuki")).connectionState).to.equal("failing");
    });

    it("saving without a test is unchecked", async function () {
      const saved = await call("put", "/nuki", NUKI);

      expect(saved.body.connectionState).to.equal("unchecked");
      expect(saved.body.lastTest).to.equal(null);
      expect((await read("nuki")).connectionState).to.equal("unchecked");
    });

    it("saving other values than the last test checked is unchecked", async function () {
      store("nuki", NUKI);
      await call("post", "/nuki/test", { ...NUKI, apiToken: "" });

      const saved = await call("put", "/nuki", {
        ...NUKI,
        apiToken: "token-2",
      });

      expect(saved.body.connectionState).to.equal("unchecked");
      expect(saved.body.lastTest.success).to.equal(true);
    });

    it("a test with other values after saving is unchecked, until those are saved", async function () {
      store("nuki", NUKI);
      await call("post", "/nuki/test", { ...NUKI, apiToken: "" });
      expect((await read("nuki")).connectionState).to.equal("connected");

      await call("post", "/nuki/test", {
        apiBaseUrl: "https://other.nuki.example",
        apiToken: "token-3",
      });

      expect((await read("nuki")).connectionState).to.equal("unchecked");
    });

    it("switched off is disabled, whatever the last test said", async function () {
      store("nuki", NUKI);
      await call("post", "/nuki/test", { ...NUKI, apiToken: "" });

      const off = await call("put", "/nuki/active", { active: false });

      expect(off.body.connectionState).to.equal("disabled");
      expect(off.body.lastTest.success).to.equal(true);
      expect((await read("nuki")).connectionState).to.equal("disabled");

      const on = await call("put", "/nuki/active", { active: true });
      expect(on.body.connectionState).to.equal("connected");
    });

    it("saving the application or the whole tenant keeps the last test", async function () {
      store("nuki", NUKI);
      await call("post", "/nuki/test", { ...NUKI, apiToken: "" });

      const saved = await call("put", "/nuki", {
        ...NUKI,
        apiToken: "",
        lastTest: { success: false, testedAt: 1, error: "forged" },
        connectionState: "failing",
      });
      expect(saved.body.connectionState).to.equal("connected");

      const answered = await read("nuki");
      const tenant = await h
        .api()
        .put("/api/tenants")
        .set(h.as(OWNER))
        .send({
          id: TENANT,
          name: "Stadt",
          applications: [
            { ...answered, lastTest: null, connectionState: "unchecked" },
          ],
        });
      expect(tenant.status).to.equal(200);

      expect(await read("nuki")).to.deep.include({
        connectionState: "connected",
        lastTest: answered.lastTest,
      });
    });

    it("an iFBS key id other than the tested one is unchecked", async function () {
      const IFBS = PROVIDERS.ifbs.stored;
      store("ifbs", IFBS);
      await call("post", "/ifbs/test", { ...IFBS, apiKey: "" });
      expect((await read("ifbs")).connectionState).to.equal("connected");

      const saved = await call("put", "/ifbs", { ...IFBS, apiKeyID: "key-2" });

      expect(saved.status).to.equal(200);
      expect(saved.body.connectionState).to.equal("unchecked");
    });

    it("a test before the application is stored records nothing", async function () {
      const test = await call("post", "/nuki/test", NUKI);

      expect(test.body.success).to.equal(true);
      expect(await read("nuki")).to.equal(undefined);
    });
  });
});
