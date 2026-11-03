const assert = require("assert");
const sinon = require("sinon");
const StoredSecretService = require("../src/commons/services/stored-secret-service");
const { STORED_SECRET } = StoredSecretService;
const {
  TenantController,
} = require("../src/platform/api/controllers/tenant-controller");
const InstanceController = require("../src/platform/api/controllers/instance-controller");
const TenantManager = require("../src/commons/data-managers/tenant-manager");
const InstanceManager = require("../src/commons/data-managers/instance-manager");
const MediaReferenceGuard = require("../src/commons/services/media/media-reference-guard");
const AccessInfoService = require("../src/commons/services/access/access-info-service");
const ParevaApiClient = require("../src/commons/services/access/clients/pareva-api-client");
const Tenant = require("../src/commons/entities/tenant/tenant");

function response(sandbox) {
  return {
    status: sandbox.stub().returnsThis(),
    send: sandbox.stub().returnsThis(),
    sendStatus: sandbox.stub().returnsThis(),
  };
}

/** A tenant with one stored secret per kind, decrypted as the model reads it. */
function storedTenant() {
  return new Tenant({
    id: "tenant-1",
    name: "Verein",
    noreplyPassword: "smtp-pass",
    noreplyGraphClientSecret: "",
    applications: [
      {
        type: "payment",
        id: "giroCockpit",
        paymentSecret: "giro-key",
        paymentMerchantId: "m-1",
      },
      {
        type: "payment",
        id: "ePayBL",
        certPassphrase: "cert-pass",
        notificationSecret: "ntf-secret",
        clientP12: "p12-base64",
        merchantId: "e-1",
      },
      {
        type: "access",
        id: "pareva",
        serverUrl: "https://pareva.example",
        user: "u",
        password: "pareva-pass",
      },
      {
        type: "access",
        id: "ifbs",
        serverUrl: "https://ifbs.example",
        apiKeyID: "k-id",
        apiKey: "ifbs-key",
        secretPhrase: "s3cr3t-phrase",
      },
    ],
  });
}

const SECRETS = [
  "smtp-pass",
  "giro-key",
  "cert-pass",
  "ntf-secret",
  "p12-base64",
  "pareva-pass",
  "ifbs-key",
  "s3cr3t-phrase",
];

function appOf(tenant, id) {
  return tenant.applications.find((app) => app.id === id);
}

describe("StoredSecretService", function () {
  let sandbox;

  beforeEach(function () {
    sandbox = sinon.createSandbox();
  });

  afterEach(function () {
    sandbox.restore();
  });

  describe("mask", function () {
    it("sends the marker for every stored secret, never the secret", function () {
      const answer = StoredSecretService.mask(storedTenant().exportWithMedia());
      const json = JSON.stringify(answer);

      for (const secret of SECRETS) {
        assert.ok(!json.includes(secret), `${secret} left in the answer`);
      }
      assert.strictEqual(answer.noreplyPassword, STORED_SECRET);
      assert.strictEqual(appOf(answer, "pareva").password, STORED_SECRET);
      assert.strictEqual(appOf(answer, "ePayBL").clientP12, STORED_SECRET);
    });

    it("leaves an empty secret empty and other fields as they are", function () {
      const answer = StoredSecretService.mask(storedTenant().exportWithMedia());

      assert.strictEqual(answer.noreplyGraphClientSecret, "");
      assert.strictEqual(appOf(answer, "giroCockpit").paymentMerchantId, "m-1");
      assert.strictEqual(appOf(answer, "ifbs").apiKeyID, "k-id");
    });

    it("keeps the secrets of the entity it masks", function () {
      const tenant = storedTenant();

      StoredSecretService.mask(tenant.exportWithMedia());

      assert.strictEqual(appOf(tenant, "pareva").password, "pareva-pass");
    });

    it("masks the instance's Keycloak and card auth secrets", function () {
      const answer = StoredSecretService.mask({
        noreplyPassword: "",
        applications: [
          { type: "auth", id: "keycloak", privateClientSecret: "kc" },
          { type: "card-auth", id: "card-1", apiToken: "tok" },
        ],
      });

      assert.strictEqual(
        appOf(answer, "keycloak").privateClientSecret,
        STORED_SECRET,
      );
      assert.strictEqual(appOf(answer, "card-1").apiToken, STORED_SECRET);
    });
  });

  describe("restore", function () {
    it("keeps the stored secret where the marker comes back", function () {
      const next = StoredSecretService.mask(storedTenant().exportWithMedia());

      StoredSecretService.restore(storedTenant(), next);

      assert.strictEqual(next.noreplyPassword, "smtp-pass");
      assert.strictEqual(appOf(next, "pareva").password, "pareva-pass");
      assert.strictEqual(appOf(next, "ePayBL").clientP12, "p12-base64");
    });

    it("takes a new value and an emptied one as they come", function () {
      const next = StoredSecretService.mask(storedTenant().exportWithMedia());
      appOf(next, "pareva").password = "new-pass";
      appOf(next, "ifbs").apiKey = "";

      StoredSecretService.restore(storedTenant(), next);

      assert.strictEqual(appOf(next, "pareva").password, "new-pass");
      assert.strictEqual(appOf(next, "ifbs").apiKey, "");
    });

    it("stores no marker without a stored secret behind it", function () {
      const next = {
        noreplyPassword: STORED_SECRET,
        applications: [{ type: "access", id: "nuki", apiToken: STORED_SECRET }],
      };

      StoredSecretService.restore(null, next);

      assert.strictEqual(next.noreplyPassword, null);
      assert.strictEqual(appOf(next, "nuki").apiToken, null);
    });

    it("takes a card auth token only from the card auth of the same id", function () {
      const previous = {
        applications: [
          { type: "card-auth", id: "card-1", apiToken: "tok-1" },
          { type: "card-auth", id: "card-2", apiToken: "tok-2" },
        ],
      };
      const next = {
        applications: [
          { type: "card-auth", id: "card-2", apiToken: STORED_SECRET },
        ],
      };

      StoredSecretService.restore(previous, next);

      assert.strictEqual(appOf(next, "card-2").apiToken, "tok-2");
    });
  });

  describe("completeTestConfig", function () {
    it("tests with the stored secret where the form sends the marker", function () {
      const config = StoredSecretService.completeTestConfig(
        "pareva",
        { serverUrl: "https://pareva.example", password: STORED_SECRET },
        { password: "pareva-pass" },
      );

      assert.strictEqual(config.password, "pareva-pass");
    });

    it("hands Salto KS an empty secret, which its test completes itself", function () {
      const config = StoredSecretService.completeTestConfig(
        "salto-ks",
        { clientSecret: STORED_SECRET, password: "typed" },
        { clientSecret: "salto-secret", password: "salto-pass" },
      );

      assert.strictEqual(config.clientSecret, "");
      assert.strictEqual(config.password, "typed");
    });
  });

  describe("the tenant routes", function () {
    it("answer a tenant without its secrets", async function () {
      sandbox.stub(TenantManager, "getTenant").resolves(storedTenant());
      const res = response(sandbox);

      await TenantController.getTenant(
        { user: { id: "admin-1" }, params: { tenant: "tenant-1" } },
        res,
      );

      const json = JSON.stringify(res.send.firstCall.args[0]);
      for (const secret of SECRETS) {
        assert.ok(!json.includes(secret), `${secret} left in the answer`);
      }
    });

    it("store the secrets an update hands back as the marker", async function () {
      const answer = StoredSecretService.mask(storedTenant().exportWithMedia());
      sandbox
        .stub(TenantManager, "getTenant")
        .onFirstCall()
        .resolves(storedTenant())
        .onSecondCall()
        .resolves(storedTenant());
      sandbox.stub(MediaReferenceGuard, "assertTenantStorable").resolves();
      const storeTenant = sandbox
        .stub(TenantManager, "storeTenant")
        .callsFake(async (value) => value);
      const res = response(sandbox);

      await TenantController.updateTenant(
        { user: { id: "admin-1" }, body: answer },
        res,
      );

      const stored = storeTenant.firstCall.args[0];
      assert.strictEqual(stored.noreplyPassword, "smtp-pass");
      assert.strictEqual(appOf(stored, "pareva").password, "pareva-pass");
      assert.strictEqual(
        appOf(stored, "giroCockpit").paymentSecret,
        "giro-key",
      );
      assert.strictEqual(
        appOf(res.send.firstCall.args[0], "pareva").password,
        STORED_SECRET,
      );
    });
  });

  describe("the instance routes", function () {
    function storedInstance() {
      return {
        ownerUserIds: ["admin-1"],
        noreplyPassword: "smtp-pass",
        applications: [
          { type: "auth", id: "keycloak", privateClientSecret: "kc" },
        ],
        exportWithMedia() {
          return { ...this };
        },
      };
    }

    it("answer the instance without its secrets", async function () {
      sandbox.stub(InstanceManager, "getInstance").resolves(storedInstance());
      const res = response(sandbox);

      await InstanceController.getInstance({}, res);

      const answer = res.send.firstCall.args[0];
      assert.strictEqual(answer.noreplyPassword, STORED_SECRET);
      assert.strictEqual(
        appOf(answer, "keycloak").privateClientSecret,
        STORED_SECRET,
      );
    });

    it("store the secrets a save hands back as the marker", async function () {
      sandbox.stub(InstanceManager, "getInstance").resolves(storedInstance());
      sandbox.stub(MediaReferenceGuard, "assertInstanceStorable").resolves();
      const updateInstance = sandbox
        .stub(InstanceManager, "updateInstance")
        .callsFake(async (value) => storedInstance(value));
      const res = response(sandbox);

      await InstanceController.storeInstance(
        {
          user: { id: "admin-1" },
          body: {
            ownerUserIds: ["admin-1"],
            noreplyPassword: STORED_SECRET,
            applications: [
              {
                type: "auth",
                id: "keycloak",
                privateClientSecret: STORED_SECRET,
              },
            ],
          },
        },
        res,
      );

      const stored = updateInstance.firstCall.args[0];
      assert.strictEqual(stored.noreplyPassword, "smtp-pass");
      assert.strictEqual(appOf(stored, "keycloak").privateClientSecret, "kc");
    });
  });

  describe("the access connection test", function () {
    it("tests with the stored secret where the form sends the marker", async function () {
      sandbox.stub(TenantManager, "getTenant").resolves(storedTenant());
      const test = sandbox
        .stub(ParevaApiClient, "testConnection")
        .resolves({ success: true });

      await AccessInfoService.testConnection(
        "pareva",
        {
          serverUrl: "https://pareva.example",
          lockerId: "L1",
          user: "u",
          password: STORED_SECRET,
        },
        { tenantId: "tenant-1" },
      );

      assert.deepStrictEqual(test.firstCall.args, [
        "https://pareva.example",
        "L1",
        "u",
        "pareva-pass",
      ]);
    });
  });
});
