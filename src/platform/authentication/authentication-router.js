const express = require("express");
const router = express.Router({ mergeParams: true });
const passport = require("passport");
require("./auth-initialization");

const AuthenticationController = require("./controllers/authentication-controller");

router.get("/signout", AuthenticationController.signout);
router.post("/signup", AuthenticationController.signup);
router.get("/verify/:hookId", AuthenticationController.releaseHook);
router.get("/reset/:hookId", AuthenticationController.releaseHook);
router.post("/resetpassword", AuthenticationController.resetPassword);
router.post("/check-email", AuthenticationController.checkEmail);

router.post("/signin", (req, res, next) => {
  passport.authenticate("local-signin", (err, user, info) => {
    if (err) {
      return res.status(err.status).json({ message: err.message });
    }
    if (!user) {
      return res.status(401).json({ message: "Authentication failed" });
    }
    req.login(user, (err) => {
      if (err) {
        return next(err);
      }
      return AuthenticationController.signin(req, res, next);
    });
  })(req, res, next);
});
router.post("/sso/signin", AuthenticationController.ssoLogin);
router.post("/sso/signup", AuthenticationController.ssoSignup);
router.get(
  "/me",
  AuthenticationController.isSignedIn,
  AuthenticationController.me,
);

module.exports = router;
