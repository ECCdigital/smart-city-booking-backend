const passport = require("passport");
const bunyan = require("bunyan");
const passwordHash = require("password-hash");
const UserManager = require("../../commons/data-managers/user-manager");
const LocalStrategy = require("passport-local").Strategy;

const logger = bunyan.createLogger({
  name: "auth-initialization.js",
  level: process.env.LOG_LEVEL,
  serializers: { err: bunyan.stdSerializers.err },
});

/**
 * The one refusal of an unknown account, a wrong password and an account
 * that signs in elsewhere (SSO), so the sign-in tells nobody whether an
 * address has an account (ECCdigital/tickets#259).
 */
const INVALID_CREDENTIALS = {
  message: "Invalid email or password",
  status: 401,
};

/**
 * Checked against when there is no local password to check, so the refusal
 * of an unknown or an SSO account costs the time of a wrong password.
 */
const NO_PASSWORD = passwordHash.generate("no account has this password");

/** Whether the password signs in the account; false for every other one. */
function passwordMatches(user, password) {
  if (user === null || user.authType !== "local") {
    passwordHash.verify(password, NO_PASSWORD);
    return false;
  }
  return user.verifyPassword(password);
}

passport.use(
  "local-signin",
  new LocalStrategy(
    {
      usernameField: "id",
      passwordField: "password",
      passReqToCallback: true,
      session: false,
    },
    async (request, id, password, done) => {
      if (typeof id !== "string") {
        return done({ message: "Invalid user ID format", status: 400 }, false);
      }

      try {
        const user = await UserManager.getUser(id, true);
        if (!passwordMatches(user, password)) {
          return done(INVALID_CREDENTIALS, false);
        }

        // Only who knows the password learns the state of the account.
        if (!user.isVerified) {
          return done({ message: "User is not verified", status: 403 }, false);
        }
        if (user.isSuspended) {
          return done({ message: "User is suspended", status: 403 }, false);
        }

        done(null, user);
      } catch (error) {
        logger.error({ err: error }, "sign-in failed");
        done({ message: "Authentication failed", status: 500 }, false);
      }
    },
  ),
);
