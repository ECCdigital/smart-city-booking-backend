/**
 * The verification proof of a user account (spec §6.3): a local account is
 * proven by its released verification hook, an SSO account only by a
 * confirmed claim of its identity provider — the historic `isVerified` an
 * SSO signup set across the board is no proof.
 */

const { expect } = require("chai");

const {
  hasVerificationProof,
  assertVerifiedForSelfService,
} = require("../src/commons/services/user/verification-proof");
const { ForbiddenError } = require("../src/errors/BaseError");

function thrownBy(fn) {
  try {
    fn();
  } catch (error) {
    return error;
  }
  return null;
}

describe("verification proof", function () {
  describe("a local account", function () {
    it("is proven once its e-mail is verified", function () {
      const user = {
        id: "erika@example.test",
        authType: "local",
        isVerified: true,
      };

      expect(hasVerificationProof(user)).to.equal(true);
      expect(() => assertVerifiedForSelfService(user)).not.to.throw();
    });

    it("without a verified e-mail is refused and pointed to the e-mail verification", function () {
      const user = {
        id: "erika@example.test",
        authType: "local",
        isVerified: false,
      };

      expect(hasVerificationProof(user)).to.equal(false);
      const error = thrownBy(() => assertVerifiedForSelfService(user));
      expect(error).to.be.instanceOf(ForbiddenError);
      expect(error.code).to.equal("email_verification_required");
      expect(error.params).to.deep.equal({ method: "email", provider: null });
    });

    it("of a card signup is proven the same way, by its e-mail", function () {
      expect(
        hasVerificationProof({ authType: "card", isVerified: true }),
      ).to.equal(true);
      expect(
        hasVerificationProof({ authType: "card", isVerified: false }),
      ).to.equal(false);
    });
  });

  describe("an SSO account", function () {
    it("is proven by a confirmed claim of its identity provider", function () {
      const user = {
        id: "max@example.test",
        authType: "keycloak",
        isVerified: true,
        idpEmailVerifiedAt: new Date("2026-09-20T10:00:00Z"),
        idpEmailVerifiedProvider: "keycloak",
      };

      expect(hasVerificationProof(user)).to.equal(true);
      expect(() => assertVerifiedForSelfService(user)).not.to.throw();
    });

    it("with only the historic isVerified flag has no proof and is pointed to the identity provider", function () {
      const user = {
        id: "max@example.test",
        authType: "keycloak",
        isVerified: true,
      };

      expect(hasVerificationProof(user)).to.equal(false);
      const error = thrownBy(() => assertVerifiedForSelfService(user));
      expect(error).to.be.instanceOf(ForbiddenError);
      expect(error.code).to.equal("email_verification_required");
      expect(error.params).to.deep.equal({
        method: "identity_provider",
        provider: "keycloak",
      });
    });

    it("whose provider did not confirm the e-mail has no proof", function () {
      const user = {
        authType: "keycloak",
        isVerified: true,
        idpEmailVerifiedAt: null,
      };

      expect(hasVerificationProof(user)).to.equal(false);
    });
  });

  it("no account at all has no proof", function () {
    expect(hasVerificationProof(null)).to.equal(false);
    expect(hasVerificationProof(undefined)).to.equal(false);
    const error = thrownBy(() => assertVerifiedForSelfService(null));
    expect(error).to.be.instanceOf(ForbiddenError);
    expect(error.params).to.deep.equal({ method: "email", provider: null });
  });
});
