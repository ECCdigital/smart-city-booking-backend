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

router.post(
  "/signin",
  passport.authenticate("local-signin"),
  AuthenticationController.signin,
);
router.post("/sso/signin", AuthenticationController.ssoLogin);
router.post("/sso/signup", AuthenticationController.ssoSignup);
router.get(
  "/me",
  AuthenticationController.isSignedIn,
  AuthenticationController.me,
);

module.exports = router;
