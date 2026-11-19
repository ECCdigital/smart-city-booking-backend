const assert = require("assert");

process.env.CRYPTO_SECRET =
  process.env.CRYPTO_SECRET || "0123456789abcdef0123456789abcdef";
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
const {
  NukiApiClient,
} = require("../src/commons/services/access/clients/nuki-api-client");
const ApplicationFactory = require("../src/commons/entities/application/applicationFactory");
const { PAYMENT_CLASS_MAP, TYPE_CLASS_MAP } = ApplicationFactory;
const {
  AccessApplication,
  accessAppTypes,
  registerAccessAppType,
} = require("../src/commons/entities/application/accessApplication");
const {
  ACCOUNT_FIELDS,
} = require("../src/commons/entities/application/payment/invoiceApplication");
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
    noreplyHost: "smtp.verein.example",
    noreplyUser: "mail@verein.example",
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

    it("answers an empty secret as empty, also one stored as null", function () {
      const answer = StoredSecretService.mask({
        noreplyPassword: null,
        applications: [{ type: "access", id: "nuki", apiToken: null }],
      });

      assert.strictEqual(answer.noreplyPassword, "");
      assert.strictEqual(appOf(answer, "nuki").apiToken, "");
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

  describe("restore, where the secret would go elsewhere", function () {
    function refusal(fn) {
      try {
        fn();
      } catch (error) {
        return error;
      }
      assert.fail("not refused");
    }

    it("refuses the marker for a server the stored secret was not set for", function () {
      const next = StoredSecretService.mask(storedTenant().exportWithMedia());
      appOf(next, "pareva").serverUrl = "https://evil.example";

      const error = refusal(() =>
        StoredSecretService.restore(storedTenant(), next),
      );

      assert.strictEqual(error.statusCode, 400);
      assert.strictEqual(error.code, "secret_required");
      assert.deepStrictEqual(error.params.missing, [
        {
          type: "access",
          id: "pareva",
          field: "password",
          reason: "server_url_changed",
        },
      ]);
    });

    it("refuses the mail password for another mail server", function () {
      const next = StoredSecretService.mask(storedTenant().exportWithMedia());
      next.noreplyHost = "smtp.evil.example";

      const error = refusal(() =>
        StoredSecretService.restore(storedTenant(), next),
      );

      assert.deepStrictEqual(error.params.missing, [
        { field: "noreplyPassword", reason: "noreply_host_changed" },
      ]);
    });

    it("refuses the mail password for another mail account", function () {
      const next = StoredSecretService.mask(storedTenant().exportWithMedia());
      next.noreplyUser = "other@verein.example";

      const error = refusal(() =>
        StoredSecretService.restore(storedTenant(), next),
      );

      assert.deepStrictEqual(error.params.missing, [
        { field: "noreplyPassword", reason: "noreply_user_changed" },
      ]);
    });

    it("refuses the Keycloak secret for another Keycloak", function () {
      const previous = {
        applications: [
          {
            type: "auth",
            id: "keycloak",
            serverUrl: "https://kc.example",
            realm: "r",
            privateClient: "c",
            privateClientSecret: "kc",
          },
        ],
      };
      const next = {
        applications: [
          {
            ...previous.applications[0],
            serverUrl: "https://evil.example",
            privateClientSecret: STORED_SECRET,
          },
        ],
      };

      const error = refusal(() => StoredSecretService.restore(previous, next));

      assert.strictEqual(error.params.missing[0].reason, "server_url_changed");
    });

    // The Keycloak and SSO code read the realm as it is: "city " is another
    // realm path than "city".
    it("refuses the Keycloak secret for a realm that differs only by spaces", function () {
      const previous = {
        applications: [
          {
            type: "auth",
            id: "keycloak",
            serverUrl: "https://kc.example",
            realm: "city",
            privateClient: "c",
            privateClientSecret: "kc",
          },
        ],
      };
      const next = {
        applications: [
          {
            ...previous.applications[0],
            realm: "city ",
            privateClientSecret: STORED_SECRET,
          },
        ],
      };

      const error = refusal(() => StoredSecretService.restore(previous, next));

      assert.strictEqual(error.params.missing[0].reason, "realm_changed");
    });

    it("refuses the card auth token for another service", function () {
      const previous = {
        applications: [
          {
            type: "card-auth",
            id: "card-1",
            serviceUrl: "https://card.example",
            apiToken: "tok",
          },
        ],
      };
      const next = {
        applications: [
          {
            ...previous.applications[0],
            serviceUrl: "https://evil.example",
            apiToken: STORED_SECRET,
          },
        ],
      };

      const error = refusal(() => StoredSecretService.restore(previous, next));

      assert.strictEqual(error.params.missing[0].reason, "service_url_changed");
    });

    it("takes a new secret typed for the new server", function () {
      const next = StoredSecretService.mask(storedTenant().exportWithMedia());
      appOf(next, "pareva").serverUrl = "https://new.example";
      appOf(next, "pareva").password = "new-pass";

      StoredSecretService.restore(storedTenant(), next);

      assert.strictEqual(appOf(next, "pareva").password, "new-pass");
    });

    it("keeps the secret when only a field it is not bound to changes", function () {
      const next = StoredSecretService.mask(storedTenant().exportWithMedia());
      appOf(next, "pareva").lockerId = "L2";
      next.noreplyPort = 2525;

      StoredSecretService.restore(storedTenant(), next);

      assert.strictEqual(appOf(next, "pareva").password, "pareva-pass");
      assert.strictEqual(next.noreplyPassword, "smtp-pass");
    });

    // Admin A loaded the tenant, admin B changed account and password since:
    // A's marker stands for B's password, which does not belong to A's user.
    it("refuses a marker from a body older than the stored account", function () {
      const stale = StoredSecretService.mask(storedTenant().exportWithMedia());
      const current = storedTenant();
      current.noreplyUser = "b@verein.example";
      current.noreplyPassword = "b-pass";

      const error = refusal(() => StoredSecretService.restore(current, stale));

      assert.deepStrictEqual(error.params.missing, [
        { field: "noreplyPassword", reason: "noreply_user_changed" },
      ]);
    });
  });

  describe("the application classes", function () {
    // Encrypted for storage, but shown to the admin as they are: the payment
    // provider's ids and the tenant's own bank account (ECCdigital/tickets#16).
    const SHOWN_ENCRYPTED = {
      pmPayment: ["paymentMerchantId", "paymentProjectId"],
      giroCockpit: ["paymentMerchantId", "paymentProjectId"],
      invoice: ACCOUNT_FIELDS,
    };

    function encryptedFields(AppClass) {
      const probe = {};
      for (const [field, schema] of Object.entries(AppClass.Schema)) {
        if (schema.type === Object) probe[field] = `probe-${field}`;
      }
      const app = new AppClass(probe);
      const before = { ...app };
      app.encrypt();
      return Object.keys(probe).filter((field) => app[field] !== before[field]);
    }

    const classes = [
      ...Object.entries(PAYMENT_CLASS_MAP),
      ...Object.entries(TYPE_CLASS_MAP),
      ...Object.entries(accessAppTypes),
    ];

    for (const [id, AppClass] of classes) {
      it(`${id}: names every secret it encrypts`, function () {
        const declared = [
          ...Object.keys(AppClass.secrets),
          ...(SHOWN_ENCRYPTED[id] || []),
        ];

        for (const field of encryptedFields(AppClass)) {
          assert.ok(
            declared.includes(field),
            `${id}.${field} is encrypted but not in its secrets`,
          );
        }
      });

      it(`${id}: binds its secrets to fields it has`, function () {
        const fields = Object.keys(AppClass.Schema);
        for (const [secret, boundTo] of Object.entries(AppClass.secrets)) {
          assert.ok(fields.includes(secret), `${id}.${secret} unknown`);
          for (const bound of boundTo) {
            assert.ok(
              fields.includes(bound),
              `${id}.${secret}: ${bound} unknown`,
            );
          }
        }
      });
    }

    it("masks a provider registered later by its class", function () {
      class LaterAccessApplication extends AccessApplication {
        static get secrets() {
          return { apiKey: ["apiBaseUrl"] };
        }
      }
      registerAccessAppType("later", LaterAccessApplication);
      try {
        const answer = StoredSecretService.mask({
          applications: [{ type: "access", id: "later", apiKey: "k" }],
        });

        assert.strictEqual(answer.applications[0].apiKey, STORED_SECRET);
      } finally {
        delete accessAppTypes.later;
      }
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

  describe("a tenant update that leaves a secret out", function () {
    async function update(body) {
      sandbox
        .stub(TenantManager, "getTenant")
        .callsFake(async () => storedTenant());
      sandbox.stub(MediaReferenceGuard, "assertTenantStorable").resolves();
      const storeTenant = sandbox
        .stub(TenantManager, "storeTenant")
        .callsFake(async (value) => value);
      const res = response(sandbox);

      await TenantController.updateTenant(
        { user: { id: "admin-1" }, body: { id: "tenant-1", ...body } },
        res,
      );
      return { storeTenant, res };
    }

    it("refuses another mail server for the stored password", async function () {
      const { storeTenant, res } = await update({
        noreplyHost: "smtp.evil.example",
      });

      assert.ok(storeTenant.notCalled);
      assert.strictEqual(res.status.firstCall.args[0], 400);
      assert.deepStrictEqual(res.send.firstCall.args[0].params.missing, [
        { field: "noreplyPassword", reason: "noreply_host_changed" },
      ]);
    });

    it("keeps the stored password while the mail server stays", async function () {
      const { storeTenant } = await update({ name: "Verein e. V." });

      assert.strictEqual(
        storeTenant.firstCall.args[0].noreplyPassword,
        "smtp-pass",
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

    it("does not send the stored secret to another server", async function () {
      sandbox.stub(TenantManager, "getTenant").resolves(storedTenant());
      const test = sandbox
        .stub(ParevaApiClient, "testConnection")
        .resolves({ success: true });

      const result = await AccessInfoService.testConnection(
        "pareva",
        {
          serverUrl: "https://evil.example",
          lockerId: "L1",
          user: "u",
          password: STORED_SECRET,
        },
        { tenantId: "tenant-1" },
      );

      assert.ok(test.notCalled);
      assert.deepStrictEqual(result, {
        success: false,
        code: "missing_secret",
        message: "Missing secrets: password",
        missing: [{ field: "password", reason: "server_url_changed" }],
      });
    });

    it("does not send the stored Nuki token to another API", async function () {
      const tenant = storedTenant();
      tenant.applications.push(
        ...ApplicationFactory.createAll([
          { type: "access", id: "nuki", apiToken: "nuki-token" },
        ]),
      );
      sandbox.stub(TenantManager, "getTenant").resolves(tenant);
      const test = sandbox
        .stub(NukiApiClient, "testConnection")
        .resolves({ success: true });

      const evil = await AccessInfoService.testConnection(
        "nuki",
        { apiToken: STORED_SECRET, apiBaseUrl: "https://evil.example" },
        { tenantId: "tenant-1" },
      );
      await AccessInfoService.testConnection(
        "nuki",
        { apiToken: STORED_SECRET, apiBaseUrl: "" },
        { tenantId: "tenant-1" },
      );

      assert.strictEqual(evil.code, "missing_secret");
      assert.deepStrictEqual(test.firstCall.args, [
        "nuki-token",
        "https://api.nuki.io",
      ]);
      assert.strictEqual(test.callCount, 1);
    });

    it("names the required fields before a secret it cannot take", async function () {
      sandbox.stub(TenantManager, "getTenant").resolves(storedTenant());

      const result = await AccessInfoService.testConnection(
        "pareva",
        { serverUrl: "https://evil.example", password: STORED_SECRET },
        { tenantId: "tenant-1" },
      );

      assert.deepStrictEqual(result, {
        success: false,
        message: "Missing required fields: lockerId, user",
      });
    });

    it("reads the tenant once", async function () {
      const getTenant = sandbox
        .stub(TenantManager, "getTenant")
        .resolves(storedTenant());
      sandbox
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

      assert.strictEqual(getTenant.callCount, 1);
    });
  });
});
