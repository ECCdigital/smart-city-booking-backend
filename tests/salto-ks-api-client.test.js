const { expect } = require("chai");
const sinon = require("sinon");

const {
  SaltoKsApiClient,
  resolveSaltoEnvironment,
} = require("../src/commons/services/access/clients/salto-ks-api-client");
const {
  SaltoKsAccessApplication,
} = require("../src/commons/entities/application/accessApplication");

describe("SaltoKsApiClient.openLock", () => {
  let sandbox;
  let client;

  beforeEach(() => {
    sandbox = sinon.createSandbox();
    client = new SaltoKsApiClient(
      "client-id",
      "client-secret",
      "site-id",
      "accept",
      { username: "user@example.test", password: "password" },
    );
    sandbox.stub(client, "_resolveSiteId").resolves("resolved-site-id");
    sandbox.stub(client, "_request").resolves({ success: true });
  });

  afterEach(() => {
    sandbox.restore();
  });

  it("sends the optional OTP in the locking payload", async () => {
    await client.openLock("lock-id", { otp: "123456" });

    expect(client._request.calledOnce).to.be.true;
    expect(client._request.firstCall.args).to.deep.equal([
      "patch",
      "/v1.2/sites/resolved-site-id/locks/lock-id/locking",
      { locked_state: "unlocked", otp: "123456" },
    ]);
  });

  it("keeps the locking payload unchanged when no OTP is provided", async () => {
    await client.openLock("lock-id");

    expect(client._request.calledOnce).to.be.true;
    expect(client._request.firstCall.args).to.deep.equal([
      "patch",
      "/v1.2/sites/resolved-site-id/locks/lock-id/locking",
      { locked_state: "unlocked" },
    ]);
  });
});

describe("SaltoKsApiClient IQ endpoints", () => {
  let sandbox;
  let client;

  beforeEach(() => {
    sandbox = sinon.createSandbox();
    client = new SaltoKsApiClient(
      "client-id",
      "client-secret",
      "site-id",
      "accept",
      { username: "user@example.test", password: "password" },
    );
    sandbox.stub(client, "_resolveSiteId").resolves("resolved-site-id");
    sandbox.stub(client, "_request").resolves({});
  });

  afterEach(() => {
    sandbox.restore();
  });

  it("lists the IQs of the site", async () => {
    await client.getIqs();

    expect(client._request.firstCall.args).to.deep.equal([
      "get",
      "/v1.2/sites/resolved-site-id/iqs",
    ]);
  });

  it("fetches the first secret of an IQ without an OTP", async () => {
    client._request.resolves({ secret: "ABCDEFGHIJKLMNOP" });

    const secret = await client.getIqFirstSecret("iq-id");

    expect(client._request.firstCall.args).to.deep.equal([
      "get",
      "/v1.2/sites/resolved-site-id/iqs/iq-id/secret",
    ]);
    expect(secret).to.equal("ABCDEFGHIJKLMNOP");
  });

  it("asks Salto to mail the IQ-PIN to the system user", async () => {
    await client.sendIqPinEmail("iq-id");

    expect(client._request.firstCall.args).to.deep.equal([
      "get",
      "/v1.2/sites/resolved-site-id/iqs/iq-id/pin?send_email=true",
    ]);
  });

  it("activates the IQ with the OTP and an unchanged pin", async () => {
    await client.putIqPin("iq-id", { otp: "28a5a", delta: "0000" });

    expect(client._request.firstCall.args).to.deep.equal([
      "put",
      "/v1.2/sites/resolved-site-id/iqs/iq-id/pin",
      { otp: "28a5a", delta: "0000" },
    ]);
  });

  it("reads the site user the client acts as", async () => {
    client._request.resolves({ remote_access: true });

    const me = await client.getSiteMe();

    expect(client._request.firstCall.args).to.deep.equal([
      "get",
      "/v1.2/sites/resolved-site-id/me",
    ]);
    expect(me).to.deep.equal({ remote_access: true });
  });
});

describe("SaltoKsApiClient without guests", () => {
  // Every PIN in Salto KS hangs on a user, and the platform creates none there:
  // the client has no way to create users or give them access.
  const GUEST_METHODS = [
    "createUser",
    "assignAccess",
    "revokeAccess",
    "deleteUser",
  ];

  it("neither has nor declares a method for users or their access", () => {
    for (const method of GUEST_METHODS) {
      expect(SaltoKsApiClient.prototype[method], method).to.equal(undefined);
      expect(SaltoKsApiClient.capabilities).not.to.include(method);
    }
  });
});

describe("Salto KS environments", () => {
  it("maps accept to the accept Connect API and identity server", () => {
    const client = new SaltoKsApiClient("id", "secret", null, "accept");

    expect(client.environment).to.equal("accept");
    expect(client.baseUrl).to.equal("https://clp-accept-user.my-clay.com");
    expect(client.identityUrl).to.equal("https://identity-acc.eu.my-clay.com");
  });

  it("maps production to the production Connect API and identity server", () => {
    const client = new SaltoKsApiClient("id", "secret", null, "production");

    expect(client.environment).to.equal("production");
    expect(client.baseUrl).to.equal("https://connect.my-clay.com");
    expect(client.identityUrl).to.equal("https://identity.eu.my-clay.com");
  });

  it("defaults to accept when no environment is given", () => {
    const client = new SaltoKsApiClient("id", "secret", null);

    expect(client.environment).to.equal("accept");
  });

  it("refuses an environment Salto does not have", () => {
    expect(() => resolveSaltoEnvironment("staging")).to.throw(
      /Unknown Salto KS environment 'staging'/,
    );
  });
});

describe("SaltoKsAccessApplication.resolveEnvironment", () => {
  it("takes an explicit environment", () => {
    expect(
      SaltoKsAccessApplication.resolveEnvironment({
        environment: "production",
        apiBaseUrl: "https://clp-accept-user.my-clay.com",
      }),
    ).to.equal("production");
  });

  it("reads accept from a legacy accept apiBaseUrl", () => {
    expect(
      SaltoKsAccessApplication.resolveEnvironment({
        apiBaseUrl: "https://clp-accept-user.saltoks.com",
      }),
    ).to.equal("accept");
  });

  it("reads production from a legacy non-accept apiBaseUrl", () => {
    expect(
      SaltoKsAccessApplication.resolveEnvironment({
        apiBaseUrl: "https://connect.my-clay.com",
      }),
    ).to.equal("production");
  });

  it("falls back to accept for nothing or nonsense", () => {
    expect(SaltoKsAccessApplication.resolveEnvironment({})).to.equal("accept");
    expect(
      SaltoKsAccessApplication.resolveEnvironment({ environment: "staging" }),
    ).to.equal("accept");
  });

  it("stores the environment on the application", () => {
    const app = new SaltoKsAccessApplication({
      id: "salto-ks",
      apiBaseUrl: "https://clp-accept-user.saltoks.com",
    });

    expect(app.environment).to.equal("accept");
  });
});
