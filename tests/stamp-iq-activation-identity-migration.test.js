process.env.CRYPTO_SECRET =
  process.env.CRYPTO_SECRET || "0123456789abcdef0123456789abcdef";

const { expect } = require("chai");
const sinon = require("sinon");

const migration = require("../migrations/scripts/15-10-2026-stamp-iq-activation-identity");
const clientRegistry = require("../src/commons/services/access/clients/access-client-registry");
const {
  SaltoKsApiClient,
} = require("../src/commons/services/access/clients/salto-ks-api-client");
const SecurityUtils = require("../src/commons/utilities/security-utils");
const {
  installFakeSaltoKsConnectApi,
  FAKE_SITE,
  FAKE_SITE_ID,
} = require("./helpers/fake-salto-ks-api-client");
const { createFakeMongoose } = require("./helpers/fake-mongoose");

const IQ_ID = "5dfdc54e-8335-11f0-a2ed-6045bd92d38f";
const OTHER_IQ_ID = "7a1c3e5f-8335-11f0-a2ed-6045bd92d38f";
const SYSTEM_USER = "system-user@example.test";

/** The Salto application as the database holds it, secrets encrypted. */
function storedSaltoApp(overrides = {}) {
  return {
    type: "access",
    id: "salto-ks",
    active: true,
    clientId: "client-id",
    clientSecret: SecurityUtils.encrypt("client-secret"),
    username: SYSTEM_USER,
    password: SecurityUtils.encrypt("password"),
    siteId: FAKE_SITE_ID,
    environment: "accept",
    iqActivations: [],
    ...overrides,
  };
}

/** An activation entry from before 4.4.0: no identity. */
function legacyEntry(iqId = IQ_ID) {
  return {
    iqId,
    secret: { iv: "00ff", data: "abcd" },
    pin: { iv: "00ff", data: "ef01" },
    state: "activated",
    activatedAt: "2026-09-01T08:00:00.000Z",
    failureCount: 0,
    blockedUntil: null,
    lastError: null,
  };
}

function storedTenant(id, app) {
  return { _id: `_${id}`, id, applications: [app] };
}

describe("15-10-2026-stamp-iq-activation-identity migration", () => {
  /** Every sign-in at the fake Salto KS. */
  let logins;

  beforeEach(() => {
    sinon.spy(clientRegistry, "createClient");
    ({ logins } = installFakeSaltoKsConnectApi(sinon, {
      accounts: [
        {
          environment: "accept",
          clientId: "client-id",
          clientSecret: "client-secret",
          username: SYSTEM_USER,
          password: "password",
        },
      ],
    }));
  });

  afterEach(() => {
    sinon.restore();
  });

  function world(tenants) {
    const mongoose = createFakeMongoose({ Tenant: tenants });
    return {
      mongoose,
      activationsOf: (id) =>
        mongoose
          .model("Tenant")
          .documents.find((tenant) => tenant.id === id)
          .applications.find((app) => app.id === "salto-ks").iqActivations,
    };
  }

  it("stamps every entry with the site, the system user and the environment of its tenant", async () => {
    const { mongoose, activationsOf } = world([
      storedTenant(
        "tenant-1",
        storedSaltoApp({
          iqActivations: [legacyEntry(), legacyEntry(OTHER_IQ_ID)],
        }),
      ),
    ]);

    await migration.up(mongoose);

    expect(activationsOf("tenant-1")).to.deep.equal([
      {
        ...legacyEntry(),
        siteId: FAKE_SITE_ID,
        username: SYSTEM_USER,
        environment: "accept",
      },
      {
        ...legacyEntry(OTHER_IQ_ID),
        siteId: FAKE_SITE_ID,
        username: SYSTEM_USER,
        environment: "accept",
      },
    ]);
    // A site named by its UUID needs no call at Salto.
    expect(logins).to.deep.equal([]);
  });

  it("resolves a site named by reference through the list of sites", async () => {
    const { mongoose, activationsOf } = world([
      storedTenant(
        "tenant-1",
        storedSaltoApp({
          siteId: FAKE_SITE.customer_reference,
          iqActivations: [legacyEntry()],
        }),
      ),
    ]);

    await migration.up(mongoose);

    // Signed in with the decrypted secrets: the fake knows only those.
    expect(activationsOf("tenant-1")[0].siteId).to.equal(FAKE_SITE_ID);
    expect(logins).to.have.length(1);
  });

  it("stamps a site named by its UUID in capitals as the UUID Salto lists", async () => {
    const { mongoose, activationsOf } = world([
      storedTenant(
        "tenant-1",
        storedSaltoApp({
          siteId: FAKE_SITE_ID.toUpperCase(),
          iqActivations: [legacyEntry()],
        }),
      ),
    ]);

    await migration.up(mongoose);

    expect(activationsOf("tenant-1")[0].siteId).to.equal(FAKE_SITE_ID);
    expect(logins).to.deep.equal([]);
  });

  it("stamps a configuration without environment as accept, the environment it is read as", async () => {
    const app = storedSaltoApp({ iqActivations: [legacyEntry()] });
    delete app.environment;
    const { mongoose, activationsOf } = world([storedTenant("tenant-1", app)]);

    await migration.up(mongoose);

    expect(activationsOf("tenant-1")[0].environment).to.equal("accept");
  });

  it("stamps the entries of each tenant with that tenant's identity", async () => {
    const { mongoose, activationsOf } = world([
      storedTenant(
        "tenant-1",
        storedSaltoApp({ iqActivations: [legacyEntry()] }),
      ),
      storedTenant(
        "tenant-2",
        storedSaltoApp({
          username: "other-system-user@example.test",
          environment: "production",
          iqActivations: [legacyEntry()],
        }),
      ),
    ]);

    await migration.up(mongoose);

    expect(activationsOf("tenant-2")[0]).to.include({
      username: "other-system-user@example.test",
      environment: "production",
    });
    expect(activationsOf("tenant-1")[0]).to.include({
      username: SYSTEM_USER,
      environment: "accept",
    });
  });

  it("writes the stamps of every tenant in one batch", async () => {
    const { mongoose } = world([
      storedTenant(
        "tenant-1",
        storedSaltoApp({ iqActivations: [legacyEntry()] }),
      ),
      storedTenant(
        "tenant-2",
        storedSaltoApp({ iqActivations: [legacyEntry()] }),
      ),
    ]);
    const { collection } = mongoose.model("Tenant");
    sinon.spy(collection, "bulkWrite");
    sinon.spy(collection, "updateOne");

    await migration.up(mongoose);

    expect(collection.bulkWrite.calledOnce).to.be.true;
    expect(collection.bulkWrite.firstCall.args[0]).to.have.length(2);
    expect(collection.updateOne.called).to.be.false;
  });

  it("leaves stamped entries as they are and can run again", async () => {
    const resting = {
      ...legacyEntry(OTHER_IQ_ID),
      siteId: FAKE_SITE_ID,
      username: "former-system-user@example.test",
      environment: "accept",
    };
    const { mongoose } = world([
      storedTenant(
        "tenant-1",
        storedSaltoApp({ iqActivations: [resting, legacyEntry()] }),
      ),
    ]);

    await migration.up(mongoose);
    const once = mongoose.snapshot();
    await migration.up(mongoose);

    expect(mongoose.snapshot()).to.deep.equal(once);
    expect(
      once.Tenant.documents[0].applications[0].iqActivations[0],
    ).to.deep.equal(resting);
  });

  it("leaves tenants without a Salto application or without activations alone", async () => {
    const tenants = [
      {
        _id: "_tenant-1",
        id: "tenant-1",
        applications: [{ type: "access", id: "nuki", apiToken: null }],
      },
      storedTenant("tenant-2", storedSaltoApp({ siteId: "Labor" })),
      { _id: "_tenant-3", id: "tenant-3" },
    ];
    const { mongoose } = world(tenants);
    const before = mongoose.snapshot();

    await migration.up(mongoose);

    expect(mongoose.snapshot()).to.deep.equal(before);
    expect(clientRegistry.createClient.called).to.be.false;
  });

  it("stops with a clear message when Salto cannot be reached to resolve a site, and writes nothing", async () => {
    SaltoKsApiClient.prototype._send.rejects(new Error("connect ETIMEDOUT"));
    const { mongoose } = world([
      storedTenant(
        "tenant-0",
        storedSaltoApp({ iqActivations: [legacyEntry()] }),
      ),
      storedTenant(
        "tenant-1",
        storedSaltoApp({
          siteId: FAKE_SITE.site_uid,
          iqActivations: [legacyEntry()],
        }),
      ),
    ]);
    const before = mongoose.snapshot();

    let failure;
    try {
      await migration.up(mongoose);
    } catch (err) {
      failure = err;
    }

    expect(failure, "the migration should fail").to.be.instanceOf(Error);
    expect(failure.message).to.include("tenant-1");
    expect(failure.message).to.include(`'${FAKE_SITE.site_uid}'`);
    expect(failure.message).to.include("connect ETIMEDOUT");
    expect(failure.message).to.include("Salto KS must be reachable");
    expect(mongoose.snapshot()).to.deep.equal(before);
  });
});
