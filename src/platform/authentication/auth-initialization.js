const passport = require("passport");
const UserManager = require("../../commons/data-managers/user-manager");
const LocalStrategy = require("passport-local").Strategy;

passport.serializeUser(function (user, done) {
  done(null, user);
});

passport.deserializeUser(function (user, done) {
  done(null, user);
});

passport.use(
  "local-signin",
  new LocalStrategy(
    {
      usernameField: "id",
      passwordField: "password",
      passReqToCallback: true,
    },
    async (request, id, password, done) => {
      if (typeof id !== "string") {
        return done(null, false);
      }

      id = id.toLowerCase();

      const user = await UserManager.getUser(id, true);

      if (user === null) {
        return done(null, false);
      }

      if (
        user !== undefined &&
        user.isVerified &&
        !user.isSuspended &&
        user.authType === "local" &&
        user.verifyPassword(password)
      ) {
        done(null, user);
      } else {
        done(null, false);
      }
    },
  ),
);
