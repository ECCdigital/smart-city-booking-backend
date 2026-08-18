const { expect } = require("chai");
const sinon = require("sinon");

const axios = require("axios");

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

describe("SaltoKsApiClient.testConnection", () => {
  let sandbox;

  beforeEach(() => {
    sandbox = sinon.createSandbox();
  });

  afterEach(() => {
    sandbox.restore();
  });

  function rejectWith(status, data) {
    const err = new Error(`Request failed with status code ${status}`);
    err.response = { status, data };
    sandbox.stub(axios, "request").rejects(err);
  }

  it("passes the identity server's error through", async () => {
    rejectWith(400, {
      error: "invalid_client",
      error_description: "Client authentication failed",
    });

    const result = await SaltoKsApiClient.testConnection(
      "id",
      "secret",
      null,
      "accept",
      { username: "user@example.test", password: "password" },
    );

    expect(result).to.deep.equal({
      success: false,
      message: "invalid_client: Client authentication failed",
    });
  });

  it("passes a bare identity error through without description", async () => {
    rejectWith(400, { error: "invalid_grant" });

    const result = await SaltoKsApiClient.testConnection(
      "id",
      "secret",
      null,
      "accept",
      { username: "user@example.test", password: "password" },
    );

    expect(result.message).to.equal("invalid_grant");
  });

  it("falls back to the shared status mapping when there is no body", async () => {
    rejectWith(401, "");

    const result = await SaltoKsApiClient.testConnection(
      "id",
      "secret",
      null,
      "accept",
      { username: "user@example.test", password: "password" },
    );

    expect(result).to.deep.equal({
      success: false,
      message: "Invalid credentials",
    });
  });

  it("names the environment on success", async () => {
    sandbox
      .stub(axios, "request")
      .resolves({ data: { access_token: "t", expires_in: 3600 } });

    const result = await SaltoKsApiClient.testConnection(
      "id",
      "secret",
      null,
      "production",
      { username: "user@example.test", password: "password" },
    );

    expect(result).to.deep.equal({
      success: true,
      message: "Connection successful (production)",
    });
    expect(axios.request.firstCall.args[0].url).to.equal(
      "https://identity.eu.my-clay.com/connect/token",
    );
  });

  it("reports an unknown environment instead of throwing", async () => {
    const result = await SaltoKsApiClient.testConnection(
      "id",
      "secret",
      null,
      "staging",
      { username: "user@example.test", password: "password" },
    );

    expect(result.success).to.equal(false);
    expect(result.message).to.match(/Unknown Salto KS environment/);
  });
});
