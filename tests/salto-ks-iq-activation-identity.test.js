const { expect } = require("chai");
const sinon = require("sinon");

process.env.CRYPTO_SECRET =
  process.env.CRYPTO_SECRET || "0123456789abcdef0123456789abcdef";

const TenantManager = require("../src/commons/data-managers/tenant-manager");
const TenantModel = require("../src/commons/data-managers/models/tenantModel");
const clientRegistry = require("../src/commons/services/access/clients/access-client-registry");
const {
  forgetSaltoKsClients,
} = require("../src/commons/services/access/clients/salto-ks-clients");
const SecurityUtils = require("../src/commons/utilities/security-utils");
const SaltoKsIqActivationService = require("../src/commons/services/access/salto-ks-iq-activation-service");
const SaltoKsAccessProvider = require("../src/commons/services/access/providers/salto-ks-access-provider");
const { AccessOpenError } = require("../src/errors/AccessOpenError");
const {
  AccessPointMode,
} = require("../src/commons/entities/access/access-point");
const {
  fakeSaltoKsConnectApi,
  FAKE_SITE,
  FAKE_SITE_ID,
} = require("./helpers/fake-salto-ks-api-client");
const { createFakeMongoose } = require("./helpers/fake-mongoose");

const TENANT_ID = "tenant-1";
const IQ_ID = "5dfdc54e-8335-11f0-a2ed-6045bd92d38f";
const LOCK_ID = "4d77312f-4a87-41db-a97b-f9d948dcc908";
const SYSTEM_USER = "system-user@example.test";
const OTHER_SYSTEM_USER = "other-system-user@example.test";
const OTHER_SITE_ID = "0c1d2e3f-4a5b-4c6d-8e7f-9a0b1c2d3e4f";

/** The identity the tenant's Salto application acts as by default. */
const IDENTITY = Object.freeze({
  siteId: FAKE_SITE_ID,
  username: SYSTEM_USER,
  environment: "accept",
});

function saltoApp(overrides = {}) {
  return {
    type: "access",
    id: "salto-ks",
    active: true,
    clientId: "client-id",
    clientSecret: "client-secret",
    username: SYSTEM_USER,
    password: "password",
    siteId: FAKE_SITE_ID,
    environment: "accept",
    iqActivations: [],
    ...overrides,
  };
}

/** A working activation of the IQ, under the given identity. */
function activatedEntry(identity = IDENTITY, overrides = {}) {
  return {
    iqId: IQ_ID,
    ...identity,
    secret: SecurityUtils.encrypt("ABCDEFGHIJKLMNOP"),
    pin: SecurityUtils.encrypt("1234"),
    state: "activated",
    activatedAt: new Date("2026-10-01T08:00:00Z"),
    failureCount: 0,
    blockedUntil: null,
    lastError: null,
    ...overrides,
  };
}

function saltoLock() {
  return {
    id: LOCK_ID,
    customer_reference: "Labortür",
    lock_type: "escutcheon",
    online: true,
    iq: { id: IQ_ID, otp_enabled: true },
  };
}

function saltoIq() {
  return {
    id: IQ_ID,
    customer_reference: "IQ 01",
    otp_enabled: true,
    online: true,
    restore_required: false,
  };
}

describe("Salto KS IQ activations belong to their identity", () => {
  let api;
  let tenants;

  /**
   * Stores the tenant with the given Salto application behind the fake
   * Connect API: reads answer a copy of what is stored at that moment, writes
   * go through the update operators.
   */
  function storeTenant(app) {
    tenants = createFakeMongoose({
      Tenant: [{ id: TENANT_ID, applications: [app] }],
    }).model("Tenant");
    sinon.stub(TenantManager, "getTenant").callsFake(async (id) => {
      const tenant = tenants.documents.find((candidate) => candidate.id === id);
      return tenant ? structuredClone(tenant) : null;
    });
    sinon
      .stub(TenantModel, "updateOne")
      .callsFake((filter, update, options) =>
        tenants.updateOne(filter, update, options),
      );
  }

  /** The admin edits the stored Salto application. */
  function editApp(changes) {
    Object.assign(tenants.documents[0].applications[0], changes);
  }

  function stored() {
    return tenants.documents[0].applications[0].iqActivations;
  }

  async function iqState() {
    const [iq] = await SaltoKsIqActivationService.listIqs(TENANT_ID);
    return iq.state;
  }

  /** Whether an open at the IQ gets an OTP, or the class of its refusal. */
  async function otpForOpen() {
    try {
      const { otp } = await SaltoKsIqActivationService.resolveOtpForOpen(
        TENANT_ID,
        { id: IQ_ID, otp_enabled: true },
      );
      return otp ? "otp" : null;
    } catch (err) {
      expect(err).to.be.instanceOf(AccessOpenError);
      return err.failureClass;
    }
  }

  async function supportedModes() {
    return new SaltoKsAccessProvider().getSupportedModes(
      { externalId: LOCK_ID },
      TENANT_ID,
    );
  }

  beforeEach(() => {
    sinon.useFakeTimers({
      now: Date.UTC(2026, 9, 15, 10, 0, 0),
      toFake: ["Date"],
    });
    forgetSaltoKsClients();
    api = fakeSaltoKsConnectApi({ locks: [saltoLock()], iqs: [saltoIq()] });
    sinon.stub(clientRegistry, "createClient").callsFake(api.clientFor);
  });

  afterEach(() => {
    sinon.restore();
    forgetSaltoKsClients();
  });

  describe("a new activation", () => {
    it("carries the resolved site, the system user and the environment, no secret of the credentials", async () => {
      storeTenant(saltoApp({ siteId: FAKE_SITE.site_uid }));

      await SaltoKsIqActivationService.startActivation(TENANT_ID, IQ_ID);

      const [entry] = stored();
      expect(entry).to.include({
        iqId: IQ_ID,
        siteId: FAKE_SITE_ID,
        username: SYSTEM_USER,
        environment: "accept",
        state: "pending_pin",
      });
      expect(entry).to.not.have.any.keys(
        "clientId",
        "clientSecret",
        "password",
      );
    });
  });

  describe("opening under another identity", () => {
    it("counts as not activated, without otp_invalid, degraded or a block", async () => {
      const foreign = activatedEntry({
        ...IDENTITY,
        username: OTHER_SYSTEM_USER,
      });
      storeTenant(saltoApp({ iqActivations: [foreign] }));

      let failure;
      try {
        await new SaltoKsAccessProvider().open(
          { externalId: LOCK_ID, provider: "salto-ks" },
          { tenant: TENANT_ID },
        );
      } catch (err) {
        failure = err;
      }

      expect(failure).to.be.instanceOf(AccessOpenError);
      expect(failure.failureClass).to.equal("configuration");
      expect(failure.message).to.include("not activated");
      expect(api.clients.flatMap((client) => client.openings)).to.deep.equal(
        [],
      );
      expect(stored()).to.deep.equal([foreign]);
    });

    it("opens with the entry of the current identity next to a resting one", async () => {
      storeTenant(
        saltoApp({
          iqActivations: [
            activatedEntry(
              { ...IDENTITY, username: OTHER_SYSTEM_USER },
              { failureCount: 2 },
            ),
            activatedEntry(),
          ],
        }),
      );

      await new SaltoKsAccessProvider().open(
        { externalId: LOCK_ID, provider: "salto-ks" },
        { tenant: TENANT_ID },
      );

      expect(api.clients.flatMap((client) => client.openings)).to.have.length(
        1,
      );
      expect(stored().map((entry) => entry.failureCount)).to.deep.equal([2, 0]);
    });
  });

  describe("a change of the identity", () => {
    it("lets the activations rest after a change of the site, and makes them good again on the way back", async () => {
      storeTenant(saltoApp({ iqActivations: [activatedEntry()] }));
      expect(await otpForOpen()).to.equal("otp");

      editApp({ siteId: OTHER_SITE_ID });
      expect(await otpForOpen()).to.equal("configuration");
      expect(stored()).to.have.length(1);

      editApp({ siteId: FAKE_SITE_ID });
      expect(await otpForOpen()).to.equal("otp");
    });

    for (const [change, switched, back] of [
      [
        "system user",
        { username: OTHER_SYSTEM_USER, password: "other-password" },
        { username: SYSTEM_USER, password: "password" },
      ],
      ["environment", { environment: "production" }, { environment: "accept" }],
    ]) {
      it(`lets the activations rest after a change of the ${change}, and makes them good again on the way back`, async () => {
        storeTenant(saltoApp({ iqActivations: [activatedEntry()] }));
        expect(await iqState()).to.equal("activated");
        expect(await supportedModes()).to.deep.equal([AccessPointMode.REMOTE]);

        editApp(switched);
        expect(await iqState()).to.equal("not_activated");
        expect(await supportedModes()).to.deep.equal([]);
        expect(await otpForOpen()).to.equal("configuration");
        expect(stored()).to.have.length(1);

        editApp(back);
        expect(await iqState()).to.equal("activated");
        expect(await supportedModes()).to.deep.equal([AccessPointMode.REMOTE]);
        expect(await otpForOpen()).to.equal("otp");
      });
    }

    it("keeps the activations good when client ID, client secret and password are rotated", async () => {
      storeTenant(saltoApp({ iqActivations: [activatedEntry()] }));

      editApp({
        clientId: "rotated-client-id",
        clientSecret: "rotated-client-secret",
        password: "rotated-password",
      });

      expect(await iqState()).to.equal("activated");
      expect(await supportedModes()).to.deep.equal([AccessPointMode.REMOTE]);
      expect(await otpForOpen()).to.equal("otp");
    });

    for (const [spelling, siteId] of [
      ["site_uid", FAKE_SITE.site_uid],
      ["customer_reference", FAKE_SITE.customer_reference],
    ]) {
      it(`keeps the activations good when the same site is named by its ${spelling}`, async () => {
        storeTenant(saltoApp({ iqActivations: [activatedEntry()] }));

        editApp({ siteId });

        expect(await iqState()).to.equal("activated");
        expect(await supportedModes()).to.deep.equal([AccessPointMode.REMOTE]);
        expect(await otpForOpen()).to.equal("otp");
      });
    }
  });

  describe("keeping and discarding", () => {
    const restingEntry = activatedEntry({
      ...IDENTITY,
      username: OTHER_SYSTEM_USER,
    });
    const resting = () => restingEntry;

    it("keeps every entry, resting ones included, when the tenant is saved", () => {
      const entries = [resting(), activatedEntry()];
      const previousTenant = {
        id: TENANT_ID,
        applications: [saltoApp({ iqActivations: entries })],
      };
      const nextTenant = {
        id: TENANT_ID,
        applications: [
          saltoApp({ username: OTHER_SYSTEM_USER, iqActivations: [] }),
        ],
      };

      SaltoKsIqActivationService.preserveActivations(
        previousTenant,
        nextTenant,
      );

      expect(nextTenant.applications[0].iqActivations).to.deep.equal(entries);
    });

    it("discards only the entry of the current identity", async () => {
      storeTenant(saltoApp({ iqActivations: [resting(), activatedEntry()] }));

      await SaltoKsIqActivationService.discardActivation(TENANT_ID, IQ_ID);

      expect(stored()).to.deep.equal([restingEntry]);
    });

    it("leaves a resting entry alone when there is nothing to discard under the current identity", async () => {
      storeTenant(saltoApp({ iqActivations: [resting()] }));

      await SaltoKsIqActivationService.discardActivation(TENANT_ID, IQ_ID);

      expect(stored()).to.have.length(1);
    });

    it("activates the IQ anew for another system user next to the resting entry", async () => {
      storeTenant(
        saltoApp({
          username: OTHER_SYSTEM_USER,
          iqActivations: [activatedEntry()],
        }),
      );

      await SaltoKsIqActivationService.startActivation(TENANT_ID, IQ_ID);
      await SaltoKsIqActivationService.completeActivation(
        TENANT_ID,
        IQ_ID,
        "4321",
      );

      expect(
        stored().map((entry) => [entry.username, entry.state]),
      ).to.deep.equal([
        [SYSTEM_USER, "activated"],
        [OTHER_SYSTEM_USER, "activated"],
      ]);
      expect(SecurityUtils.decrypt(stored()[1].pin)).to.equal("4321");
      expect(SecurityUtils.decrypt(stored()[0].pin)).to.equal("1234");
    });
  });

  describe("the bookkeeping of an open", () => {
    it("books on the entry of the current identity only", async () => {
      storeTenant(
        saltoApp({
          iqActivations: [
            activatedEntry({ ...IDENTITY, username: OTHER_SYSTEM_USER }),
            activatedEntry(),
          ],
        }),
      );

      await SaltoKsIqActivationService.recordOtpInvalid(
        TENANT_ID,
        IQ_ID,
        "otp_invalid",
      );
      await SaltoKsIqActivationService.recordOtpBlocked(
        TENANT_ID,
        IQ_ID,
        "otp_blocked",
      );

      const [restingEntry, current] = stored();
      expect([
        restingEntry.failureCount,
        restingEntry.blockedUntil,
      ]).to.deep.equal([0, null]);
      expect(current.failureCount).to.equal(1);
      expect(current.blockedUntil).to.equal("2026-10-15T10:25:00.000Z");
    });

    it("marks only the entry of the current identity as reactivation_required", async () => {
      storeTenant(
        saltoApp({
          iqActivations: [
            activatedEntry({ ...IDENTITY, environment: "production" }),
            activatedEntry(),
          ],
        }),
      );

      await SaltoKsIqActivationService.markReactivationRequired(
        TENANT_ID,
        IQ_ID,
        "restore_required",
      );

      expect(stored().map((entry) => entry.state)).to.deep.equal([
        "activated",
        "reactivation_required",
      ]);
    });
  });
});
