const { expect } = require("chai");

process.env.CRYPTO_SECRET =
  process.env.CRYPTO_SECRET || "0123456789abcdef0123456789abcdef";

const {
  SaltoKsAccessApplication,
} = require("../src/commons/entities/application/accessApplication");
const SecurityUtils = require("../src/commons/utilities/security-utils");

function saltoApp(params = {}) {
  return new SaltoKsAccessApplication({
    id: "salto-ks",
    clientId: "client-id",
    ...params,
  });
}

describe("SaltoKsAccessApplication.iqActivations", () => {
  it("defaults to no activations", () => {
    expect(saltoApp().iqActivations).to.deep.equal([]);
  });

  it("declares iqActivations in the schema", () => {
    expect(SaltoKsAccessApplication.Schema.iqActivations).to.exist;
  });

  it("encrypts plaintext secret and pin of an activation", () => {
    const app = saltoApp({
      iqActivations: [
        {
          iqId: "iq-1",
          secret: "ABCDEFGHIJKLMNOP",
          pin: "1234",
          state: "activated",
        },
      ],
    });

    app.encrypt();

    const entry = app.iqActivations[0];
    expect(entry.secret).to.have.keys(["iv", "data"]);
    expect(entry.pin).to.have.keys(["iv", "data"]);
    expect(SecurityUtils.decrypt(entry.secret)).to.equal("ABCDEFGHIJKLMNOP");
    expect(SecurityUtils.decrypt(entry.pin)).to.equal("1234");
  });

  it("leaves already-encrypted activation values untouched", () => {
    const secret = SecurityUtils.encrypt("ABCDEFGHIJKLMNOP");
    const app = saltoApp({
      iqActivations: [
        { iqId: "iq-1", secret, pin: null, state: "pending_pin" },
      ],
    });

    app.encrypt();

    expect(app.iqActivations[0].secret).to.deep.equal(secret);
    expect(app.iqActivations[0].pin).to.equal(null);
  });

  it("keeps activation values encrypted through decrypt()", () => {
    // The secret and pin never leave the backend: unlike clientSecret and
    // password they are not decrypted when the application is read - only the
    // activation service decrypts them at the moment of use.
    const secret = SecurityUtils.encrypt("ABCDEFGHIJKLMNOP");
    const pin = SecurityUtils.encrypt("1234");
    const app = saltoApp({
      clientSecret: SecurityUtils.encrypt("top-secret"),
      iqActivations: [{ iqId: "iq-1", secret, pin, state: "activated" }],
    });

    app.decrypt();

    expect(app.clientSecret).to.equal("top-secret");
    expect(app.iqActivations[0].secret).to.deep.equal(secret);
    expect(app.iqActivations[0].pin).to.deep.equal(pin);
  });
});
