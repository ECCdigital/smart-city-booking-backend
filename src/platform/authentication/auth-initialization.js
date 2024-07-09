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
    (request, id, password, done) => {
      const tenant = request.params.tenant;

      UserManager.getUser(id, tenant).then((user) => {
        if (
          user !== undefined &&
          user.isVerified &&
          user.authType === "local" &&
          user.verifyPassword(password)
        ) {
          done(null, user);
        } else {
          done(null, false);
        }
      });
    },
  ),
);
