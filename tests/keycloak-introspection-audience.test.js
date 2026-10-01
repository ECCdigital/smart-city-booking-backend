/**
 * Keycloak 26.6.2 and later answer an introspection `active: false` when the
 * asking client is not in the token's `aud` (ECCdigital/tickets#65). Both
 * introspection paths, the SSO sign-in and every API call with a Keycloak
 * token, warn with the fix when the token shows that cause, so an operator
 * does not have to guess behind "User not active".
 */

const { expect } = require("chai");
const sinon = require("sinon");
const axios = require("axios");
const bunyan = require("bunyan");
const jwt = require("jsonwebtoken");

const SsoService = require("../src/commons/services/sso/sso-service");
const KeycloakVerifier = require("../src/commons/utilities/keycloak-verifier");
const InstanceManager = require("../src/commons/data-managers/instance-manager");

const ISSUER = "https://idp.example.test/realms/city";

const KEYCLOAK_APP = {
  id: "keycloak",
  active: true,
  serverUrl: "https://idp.example.test",
  realm: "city",
  publicClient: "booking-client",
  privateClient: "backend",
  privateClientSecret: "secret",
  roleMapping: { active: false },
};

function tokenClaims(aud) {
  return {
    iss: ISSUER,
    sub: "kc-sub-1",
    sid: "kc-session-1",
    azp: "booking-client",
    ...(aud === undefined ? {} : { aud }),
  };
}

function tokenWith(aud) {
  return jwt.sign(tokenClaims(aud), "not-checked-here");
}

describe("Keycloak introspection without the private client in aud", function () {
  let warn;

  beforeEach(function () {
    KeycloakVerifier.clearCache();
    sinon
      .stub(InstanceManager, "getInstance")
      .resolves({ applications: [KEYCLOAK_APP] });
    sinon.stub(axios, "post").resolves({ data: { active: false } });
    warn = sinon.stub(bunyan.prototype, "warn");
  });

  afterEach(function () {
    sinon.restore();
    KeycloakVerifier.clearCache();
  });

  function audienceHints() {
    return warn.args
      .map((args) => args.join(" "))
      .filter((message) => message.includes("Audience mapper"));
  }

  describe("on the SSO sign-in", function () {
    it("refuses and warns that the private client is missing from aud", async function () {
      let refusal;
      try {
        await SsoService.handleLogin(tokenWith("account"));
      } catch (error) {
        refusal = error;
      }

      expect(refusal).to.include({ status: 403 });
      expect(audienceHints()).to.have.length(1);
      expect(audienceHints()[0]).to.include('"backend"');
    });

    it("warns for a token without any aud", async function () {
      await SsoService.handleLogin(tokenWith(undefined)).catch(() => {});

      expect(audienceHints()).to.have.length(1);
    });

    it("gives no hint when aud names the private client", async function () {
      await SsoService.handleLogin(tokenWith(["account", "backend"])).catch(
        () => {},
      );

      expect(audienceHints()).to.deep.equal([]);
    });
  });

  describe("on an API call with a Keycloak token", function () {
    it("finds the session inactive and warns that the private client is missing from aud", async function () {
      const active = await KeycloakVerifier.checkTokenActive(
        tokenWith("account"),
        tokenClaims("account"),
      );

      expect(active).to.equal(false);
      expect(audienceHints()).to.have.length(1);
      expect(audienceHints()[0]).to.include('"backend"');
    });

    it("gives no hint when aud names the private client", async function () {
      const active = await KeycloakVerifier.checkTokenActive(
        tokenWith("backend"),
        tokenClaims("backend"),
      );

      expect(active).to.equal(false);
      expect(audienceHints()).to.deep.equal([]);
    });
  });
});
