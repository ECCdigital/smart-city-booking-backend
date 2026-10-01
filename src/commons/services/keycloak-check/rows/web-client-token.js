/**
 * The access token of the request, as rows 8 (audience) and 9 (client
 * roles) read it: a token the web client got for the instance owner's SSO
 * sign-in shows what the realm puts into every such token, without a test
 * sign-in of its own. The auth middleware has verified it already
 * (signature, issuer, session); it is only decoded here.
 */

const jwt = require("jsonwebtoken");

const { STATUS, finding } = require("../findings");

/**
 * The claims of the web client's token of the request, or the finding of a
 * row that cannot read one.
 *
 * @param {Object} context The check context (`authType`, `accessToken`,
 *   `publicClient`)
 * @returns {{claims: Object}|{unreadable: Object}} The claims, or the `na`
 *   finding (`sso_login_required`, `token_other_client` with `{ azp }`)
 */
function webClientTokenOf(context) {
  if (context.authType !== "keycloak") {
    return { unreadable: finding(STATUS.NA, "sso_login_required") };
  }
  const claims = jwt.decode(context.accessToken);
  if (claims.azp !== context.publicClient) {
    return {
      unreadable: finding(STATUS.NA, "token_other_client", {
        azp: claims.azp,
      }),
    };
  }
  return { claims };
}

module.exports = { webClientTokenOf };
