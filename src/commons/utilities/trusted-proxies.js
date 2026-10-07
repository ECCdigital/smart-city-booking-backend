/**
 * The proxies the backend believes about the client address (ECCdigital/tickets#279).
 *
 * `TRUSTED_PROXIES` names them, comma-separated, as addresses or networks in
 * CIDR notation (`10.0.0.5, 10.7.234.0/24`); Express also takes the names
 * `loopback`, `linklocal` and `uniquelocal`. `req.ip` is then the first
 * address of `X-Forwarded-For`, read from the right, that none of them stands
 * for, so an entry a client sets itself in front of its proxy's does not
 * count. Without the variable no proxy is trusted and `req.ip` is the direct
 * address of the connection.
 */

const ENV_NAME = "TRUSTED_PROXIES";

/** @returns {string[]} The entries of the variable, empty when it is unset. */
function trustedProxies() {
  return String(process.env[ENV_NAME] ?? "")
    .split(",")
    .map((entry) => entry.trim())
    .filter(Boolean);
}

/**
 * Sets `trust proxy` of the app from `TRUSTED_PROXIES`. Throws, naming the
 * variable, for an entry that is no address, network or Express name.
 *
 * @param {import("express").Express} app
 */
function applyTrustedProxies(app) {
  const proxies = trustedProxies();
  try {
    app.set("trust proxy", proxies.length > 0 ? proxies : false);
  } catch (error) {
    throw new Error(`${ENV_NAME} is invalid: ${error.message}`);
  }
}

module.exports = { applyTrustedProxies };
