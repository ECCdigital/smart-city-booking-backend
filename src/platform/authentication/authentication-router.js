var express = require("express");
var router = express.Router({ mergeParams: true });
const passport = require("passport");
require("./auth-initialization");

const AuthenticationController = require("./controllers/authentication-controller");

router.get("/signout", AuthenticationController.signout);
router.post("/signup", AuthenticationController.signup);
router.get("/verify/:hookId", AuthenticationController.releaseHook);
router.get("/reset/:hookId", AuthenticationController.releaseHook);
router.post("/resetpassword", AuthenticationController.resetPassword);
router.post("/keycloak/callback", () => {
  console.log("keycloak callback");
});

router.post("/signin", passport.authenticate("local-signin"), AuthenticationController.signin);
router.post("/sso", AuthenticationController.ssoLogin);
router.get(
  "/me",
  AuthenticationController.isSignedIn,
  AuthenticationController.me,
);

module.exports = router;
