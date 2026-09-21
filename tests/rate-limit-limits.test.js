const assert = require("assert");

const limits = require("../src/commons/services/rate-limit/limits");

const ENV_KEYS = [
  "RATE_LIMIT_SIGNUP_PER_IP",
  "RATE_LIMIT_SIGNUP_PER_IP_WINDOW_SECONDS",
  "RATE_LIMIT_VERIFICATION_MAIL_PER_ACCOUNT_SHORT",
  "RATE_LIMIT_VERIFICATION_MAIL_PER_ACCOUNT_SHORT_WINDOW_SECONDS",
  "RATE_LIMIT_VERIFICATION_MAIL_PER_ACCOUNT_LONG",
  "RATE_LIMIT_VERIFICATION_MAIL_PER_ACCOUNT_LONG_WINDOW_SECONDS",
  "RATE_LIMIT_VERIFICATION_MAIL_PER_IP",
  "RATE_LIMIT_VERIFICATION_MAIL_PER_IP_WINDOW_SECONDS",
  "RATE_LIMIT_TENANT_SELF_CREATION_PER_USER",
  "RATE_LIMIT_TENANT_SELF_CREATION_PER_USER_WINDOW_SECONDS",
];

describe("rate-limit limits", function () {
  let saved;

  beforeEach(function () {
    saved = Object.fromEntries(ENV_KEYS.map((k) => [k, process.env[k]]));
    for (const key of ENV_KEYS) delete process.env[key];
  });

  afterEach(function () {
    for (const key of ENV_KEYS) {
      if (saved[key] === undefined) delete process.env[key];
      else process.env[key] = saved[key];
    }
  });

  it("carries the spec defaults", function () {
    assert.deepStrictEqual(limits.signupPerIp("203.0.113.7"), {
      key: "signup:ip:203.0.113.7",
      limit: 10,
      windowMs: 3_600_000,
    });
    assert.deepStrictEqual(
      limits.verificationMailPerAccount("Max@Example.test"),
      [
        {
          key: "verification-mail:account:short:max@example.test",
          limit: 1,
          windowMs: 60_000,
        },
        {
          key: "verification-mail:account:long:max@example.test",
          limit: 5,
          windowMs: 3_600_000,
        },
      ],
    );
    assert.deepStrictEqual(limits.verificationMailPerIp("203.0.113.7"), {
      key: "verification-mail:ip:203.0.113.7",
      limit: 30,
      windowMs: 3_600_000,
    });
    assert.deepStrictEqual(
      limits.tenantSelfCreationPerUser("max@example.test"),
      {
        key: "tenant-self-creation:user:max@example.test",
        limit: 3,
        windowMs: 86_400_000,
      },
    );
  });

  it("reads a differing configuration from the environment", function () {
    process.env.RATE_LIMIT_SIGNUP_PER_IP = "2";
    process.env.RATE_LIMIT_SIGNUP_PER_IP_WINDOW_SECONDS = "120";
    process.env.RATE_LIMIT_VERIFICATION_MAIL_PER_ACCOUNT_LONG = "7";

    assert.deepStrictEqual(limits.signupPerIp("1.1.1.1"), {
      key: "signup:ip:1.1.1.1",
      limit: 2,
      windowMs: 120_000,
    });
    assert.strictEqual(limits.verificationMailPerAccount("a@b.c")[1].limit, 7);
  });

  it("falls back to the default on a value that is not a positive integer", function () {
    process.env.RATE_LIMIT_SIGNUP_PER_IP = "lots";
    process.env.RATE_LIMIT_SIGNUP_PER_IP_WINDOW_SECONDS = "0";

    assert.deepStrictEqual(limits.signupPerIp("1.1.1.1"), {
      key: "signup:ip:1.1.1.1",
      limit: 10,
      windowMs: 3_600_000,
    });
  });

  it("gives the short and the long per-account window their own key", function () {
    // One key per limit: `consumeAll` inserts one row per limit, so a shared
    // key would count every mail twice.
    const [short, long] = limits.verificationMailPerAccount("a@b.c");
    assert.notStrictEqual(short.key, long.key);
  });
});
