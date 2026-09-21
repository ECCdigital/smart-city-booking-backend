/**
 * The rate limits of the public entry points (spec §6.3), with their
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

const account = (mail) => String(mail).trim().toLowerCase();

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
      key: `verification-mail:account:short:${account(mail)}`,
      ...limitFrom("RATE_LIMIT_VERIFICATION_MAIL_PER_ACCOUNT_SHORT", 1, 60),
    },
    {
      key: `verification-mail:account:long:${account(mail)}`,
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
    key: `tenant-self-creation:user:${account(userId)}`,
    ...limitFrom("RATE_LIMIT_TENANT_SELF_CREATION_PER_USER", 3, 86400),
  };
}

module.exports = {
  signupPerIp,
  verificationMailPerAccount,
  verificationMailPerIp,
  tenantSelfCreationPerUser,
};
