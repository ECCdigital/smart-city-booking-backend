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
        return done({ message: "Invalid user ID format", status: 400 }, false);
      }

      id = id.toLowerCase();

      const user = await UserManager.getUser(id, true);

      if (user === null) {
        return done({ message: "User not found", status: 404 }, false);
      }

      if (!user.isVerified || user.isSuspended) {
        return done({ 
          message: user.isVerified ? "User is suspended" : "User is not verified", 
          status: 403 
        }, false);
      }

      if (user.authType !== "local") {
        return done({ 
          message: "Invalid authentication type", 
          status: 401 
        }, false);
      }

      if (!user.verifyPassword(password)) {
        return done({ message: "Invalid password", status: 401 }, false);
      }

      done(null, user);
    },
  ),
);
