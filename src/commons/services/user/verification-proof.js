const { ForbiddenError } = require("../../../errors/BaseError");

/**
 * The verification proof of a user account (glossary „Verifizierungsnachweis“).
 *
 * A local (or card) account is proven once its e-mail is verified: `isVerified`
 * is only set by releasing the verification hook. An SSO account is proven
 * solely by a confirmed claim of its identity provider, persisted as
 * `idpEmailVerifiedAt` — the historic `isVerified = true` an SSO signup set
 * across the board is no proof.
 *
 * Both functions read the stored account (`UserManager.getUser(id)` or the
 * entity), not the slim `req.user` of the auth middleware, which carries no
 * verification fields.
 */

const SSO_AUTH_TYPES = new Set(["keycloak"]);

function isSsoAccount(user) {
  return SSO_AUTH_TYPES.has(user?.authType);
}

/**
 * @param {Object|null} user the stored user entity or its public export
 * @returns {boolean} whether the account's e-mail is proven verified
 */
function hasVerificationProof(user) {
  if (!user) {
    return false;
  }
  if (user.idpEmailVerifiedAt) {
    return true;
  }
  if (isSsoAccount(user)) {
    return false;
  }
  return user.isVerified === true;
}

/**
 * Refuses a self-service action (e.g. the self-creation of a tenant) of an
 * account without verification proof and names the way to get one.
 *
 * @param {Object|null} user the stored user entity or its public export
 * @throws {ForbiddenError} `email_verification_required` with
 *   `params.method` (`email` | `identity_provider`) and `params.provider`
 */
function assertVerifiedForSelfService(user) {
  if (hasVerificationProof(user)) {
    return;
  }
  if (isSsoAccount(user)) {
    throw new ForbiddenError("email_verification_required", {
      method: "identity_provider",
      provider: user.authType,
    });
  }
  throw new ForbiddenError("email_verification_required", {
    method: "email",
    provider: null,
  });
}

module.exports = { hasVerificationProof, assertVerifiedForSelfService };
