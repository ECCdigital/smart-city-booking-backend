const { expect } = require("chai");
const sinon = require("sinon");

const {
  SaltoKsApiClient,
} = require("../src/commons/services/access/clients/salto-ks-api-client");

describe("SaltoKsApiClient.openLock", () => {
  let sandbox;
  let client;

  beforeEach(() => {
    sandbox = sinon.createSandbox();
    client = new SaltoKsApiClient(
      "client-id",
      "client-secret",
      "site-id",
      "https://example.test",
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
