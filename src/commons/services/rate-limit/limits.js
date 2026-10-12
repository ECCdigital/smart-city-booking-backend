/**
 * The rate limits of the public entry points (spec §6.3) and of the geo
 * services (map ECCdigital/tickets#372), with their
 * defaults and the environment variables that override them. Each limit is
 * read at call time, so a changed environment counts at once. Every limit
 * has its own key even when two of them guard the same subject: the limiter
 * inserts one row per limit, so a shared key would count an attempt twice.
 *
 * `<NAME>` sets the number of attempts, `<NAME>_WINDOW_SECONDS` the sliding
 * window; a value that is not a positive integer falls back to the default.
 */

function positiveInt(name, fallback) {
  const value = Number(process.env[name]);
  return Number.isInteger(value) && value > 0 ? value : fallback;
}

function limitFrom(envName, defaultLimit, defaultWindowSeconds) {
  return {
    limit: positiveInt(envName, defaultLimit),
    windowMs:
      positiveInt(`${envName}_WINDOW_SECONDS`, defaultWindowSeconds) * 1000,
  };
}

/** An address or user id as one key: trimmed, lower case. */
const normalizeSubject = (id) => String(id).trim().toLowerCase();

/** Public signup attempts per IP: 10 per hour. */
function signupPerIp(ip) {
  return {
    key: `signup:ip:${ip}`,
    ...limitFrom("RATE_LIMIT_SIGNUP_PER_IP", 10, 3600),
  };
}

/** Verification mails per account: 1 per minute and 5 per hour, both at once. */
function verificationMailPerAccount(mail) {
  return [
    {
      key: `verification-mail:account:short:${normalizeSubject(mail)}`,
      ...limitFrom("RATE_LIMIT_VERIFICATION_MAIL_PER_ACCOUNT_SHORT", 1, 60),
    },
    {
      key: `verification-mail:account:long:${normalizeSubject(mail)}`,
      ...limitFrom("RATE_LIMIT_VERIFICATION_MAIL_PER_ACCOUNT_LONG", 5, 3600),
    },
  ];
}

/** Verification mails per IP: 30 per hour, on top of the account limits. */
function verificationMailPerIp(ip) {
  return {
    key: `verification-mail:ip:${ip}`,
    ...limitFrom("RATE_LIMIT_VERIFICATION_MAIL_PER_IP", 30, 3600),
  };
}

/** Successful tenant self-creations per user: 3 per rolling 24 hours. */
function tenantSelfCreationPerUser(userId) {
  return {
    key: `tenant-self-creation:user:${normalizeSubject(userId)}`,
    ...limitFrom("RATE_LIMIT_TENANT_SELF_CREATION_PER_USER", 3, 86400),
  };
}

/**
 * Search and reverse search per person: 60 per minute, cache hits counted
 * (map ECCdigital/tickets#372).
 */
function geoPerUser(userId) {
  return {
    key: `geo:user:${normalizeSubject(userId)}`,
    ...limitFrom("RATE_LIMIT_GEO_PER_USER", 60, 60),
  };
}

/**
 * Calls of the instance to the search provider: 300 per minute, only the
 * misses of the cache count.
 */
function geoOutbound() {
  return {
    key: "geo:outbound",
    ...limitFrom("RATE_LIMIT_GEO_OUTBOUND", 300, 60),
  };
}

/**
 * Calls of the instance to the tile server: 600 per minute, only the misses
 * of the tile cache count. No limit per person: one map view loads dozens
 * of tiles.
 */
function geoTilesOutbound() {
  return {
    key: "geo:tiles:outbound",
    ...limitFrom("RATE_LIMIT_GEO_TILES_OUTBOUND", 600, 60),
  };
}

module.exports = {
  signupPerIp,
  verificationMailPerAccount,
  verificationMailPerIp,
  tenantSelfCreationPerUser,
  geoPerUser,
  geoOutbound,
  geoTilesOutbound,
};
