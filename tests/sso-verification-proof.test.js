/**
 * The SSO signup and login capture the identity provider's e-mail
 * confirmation (Keycloak `email_verified`) as the account's verification
 * proof (spec §6.3). An account signed up before the proof existed carries
 * only the historic `isVerified` and gains the proof at its next login with
 * the claim.
 */

const { expect } = require("chai");
const sinon = require("sinon");
const axios = require("axios");

const SsoService = require("../src/commons/services/sso/sso-service");
const InstanceManager = require("../src/commons/data-managers/instance-manager");
const UserManager = require("../src/commons/data-managers/user-manager");
const {
  hasVerificationProof,
} = require("../src/commons/services/user/verification-proof");

const KEYCLOAK_APP = {
  id: "keycloak",
  serverUrl: "https://idp.example.test",
  realm: "city",
  privateClient: "backend",
  privateClientSecret: "secret",
  roleMapping: { active: false },
};

function claims(overrides = {}) {
  return {
    active: true,
    sub: "kc-sub-1",
    email: "max@example.test",
    given_name: "Max",
    family_name: "Muster",
    resource_access: {},
    ...overrides,
  };
}

describe("SSO verification proof", function () {
  let signedUp;
  let updates;

  beforeEach(function () {
    signedUp = null;
    updates = [];
    sinon
      .stub(InstanceManager, "getInstance")
      .resolves({ applications: [KEYCLOAK_APP] });
    sinon.stub(UserManager, "signupUser").callsFake(async (user) => {
      signedUp = user;
      return user;
    });
    sinon.stub(UserManager, "updateUser").callsFake(async (user) => {
      updates.push(user);
      return user;
    });
    sinon.stub(UserManager, "getUserPermissions").resolves([]);
  });

  afterEach(function () {
    sinon.restore();
  });

  function introspectionAnswers(data) {
    sinon.stub(axios, "post").resolves({ data });
  }

  describe("signup", function () {
    beforeEach(function () {
      sinon
        .stub(UserManager, "resolveKeycloakUser")
        .rejects({ message: "User not found", status: 404 });
    });

    it("with a confirmed e-mail persists the proof and the provider", async function () {
      introspectionAnswers(claims({ email_verified: true }));
      const before = Date.now();

      await SsoService.handleSignup("token", null);

      expect(signedUp.authType).to.equal("keycloak");
      expect(signedUp.idpEmailVerifiedProvider).to.equal("keycloak");
      expect(signedUp.idpEmailVerifiedAt).to.be.instanceOf(Date);
      expect(signedUp.idpEmailVerifiedAt.getTime()).to.be.at.least(before);
      expect(hasVerificationProof(signedUp)).to.equal(true);
    });

    it("without the claim leaves the account without proof, historic flag or not", async function () {
      introspectionAnswers(claims());

      await SsoService.handleSignup("token", null);

      expect(signedUp.isVerified).to.equal(true);
      expect(signedUp.idpEmailVerifiedAt).to.equal(null);
      expect(signedUp.idpEmailVerifiedProvider).to.equal(null);
      expect(hasVerificationProof(signedUp)).to.equal(false);
    });

    it("with the claim denied leaves the account without proof", async function () {
      introspectionAnswers(claims({ email_verified: false }));

      await SsoService.handleSignup("token", null);

      expect(signedUp.idpEmailVerifiedAt).to.equal(null);
      expect(hasVerificationProof(signedUp)).to.equal(false);
    });
  });

  describe("login", function () {
    function existingUser(overrides = {}) {
      return {
        id: "max@example.test",
        authType: "keycloak",
        isVerified: true,
        keycloakId: "kc-sub-1",
        isSuspended: false,
        idpEmailVerifiedAt: null,
        idpEmailVerifiedProvider: null,
        ...overrides,
      };
    }

    it("of a historic account with a confirmed e-mail persists the proof now", async function () {
      const user = existingUser();
      sinon.stub(UserManager, "resolveKeycloakUser").resolves(user);
      introspectionAnswers(claims({ email_verified: true }));

      const signedIn = await SsoService.handleLogin("token");

      expect(signedIn.idpEmailVerifiedAt).to.be.instanceOf(Date);
      expect(signedIn.idpEmailVerifiedProvider).to.equal("keycloak");
      expect(hasVerificationProof(signedIn)).to.equal(true);
      expect(updates).to.have.length(1);
      expect(updates[0]).to.include({
        id: "max@example.test",
        idpEmailVerifiedProvider: "keycloak",
      });
      expect(updates[0].idpEmailVerifiedAt).to.equal(
        signedIn.idpEmailVerifiedAt,
      );
    });

    it("of a historic account without the claim keeps it without proof", async function () {
      const user = existingUser();
      sinon.stub(UserManager, "resolveKeycloakUser").resolves(user);
      introspectionAnswers(claims());

      const signedIn = await SsoService.handleLogin("token");

      expect(signedIn.idpEmailVerifiedAt).to.equal(null);
      expect(hasVerificationProof(signedIn)).to.equal(false);
      expect(updates).to.deep.equal([]);
    });

    it("of a proven account keeps the first proof", async function () {
      const provenAt = new Date("2026-09-01T08:00:00Z");
      const user = existingUser({
        idpEmailVerifiedAt: provenAt,
        idpEmailVerifiedProvider: "keycloak",
      });
      sinon.stub(UserManager, "resolveKeycloakUser").resolves(user);
      introspectionAnswers(claims({ email_verified: true }));

      const signedIn = await SsoService.handleLogin("token");

      expect(signedIn.idpEmailVerifiedAt).to.equal(provenAt);
      expect(updates).to.deep.equal([]);
    });
  });
});
