const express = require("express");
const router = express.Router({ mergeParams: true });
const passport = require("passport");
require("./auth-initialization");

const AuthenticationController = require("./controllers/authentication-controller");
const { requireAuth } = require("../../middleware/auth-middleware");

// Öffentliche Auth-Endpoints
router.post("/signup", AuthenticationController.signup);
router.post("/refresh", AuthenticationController.refreshToken);
router.post("/resetpassword", AuthenticationController.resetPassword);
router.post("/check-email", AuthenticationController.checkEmail);

// SSO Endpoints
router.post("/sso/signin", AuthenticationController.ssoLogin);
router.post("/sso/signup", AuthenticationController.ssoSignup);
router.post("/sso/verify", AuthenticationController.ssoVerify);

// Hooks
router.get("/verify/:hookId", AuthenticationController.releaseHook);
router.get("/reset/:hookId", AuthenticationController.releaseHook);

router.post("/verify-email", AuthenticationController.verifyEmail);

// Protected Auth-Endpoints
router.post("/signin", (req, res, next) => {
  passport.authenticate(
    "local-signin",
    { session: false },
    (err, user, info) => {
      if (err) {
        return res.status(err.status || 500).json({ message: err.message });
      }
      if (!user) {
        return res.status(403).json({ message: "Authentication failed" });
      }

      req.user = user;
      return AuthenticationController.signin(req, res, next);
    },
  )(req, res, next);
});

router.post("/signout", requireAuth, AuthenticationController.signout);
router.get("/me", requireAuth, AuthenticationController.me);

module.exports = router;
