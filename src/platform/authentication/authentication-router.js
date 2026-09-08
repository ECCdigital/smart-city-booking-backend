const express = require("express");
const router = express.Router({ mergeParams: true });
const passport = require("passport");
require("./auth-initialization");

const AuthenticationController = require("./controllers/authentication-controller");
const {
  authorize,
  public: publicRoute,
} = require("../../commons/services/authorization");

/**
 * The front door of the instance: every endpoint here is reachable without a
 * session, because it is what a session is made of - hence `auth.all`, the
 * one public entry of the rights table for this router. The secrets some of
 * them consume (the hook ids of `/verify/:hookId` and `/reset/:hookId`, the
 * reset and verification tokens in the body) are checked by the handler, as
 * they were: the marker says who may knock, not what the handler makes of a
 * secret in the request.
 *
 * The two exceptions are `/signout` and `/me`, which answer about the holder
 * of a session and therefore need one (`user.readSelf`, authorize spec §3.2).
 */

// Public auth endpoints
router.post(
  "/signup",
  publicRoute("auth", "all"),
  AuthenticationController.signup,
);
router.post(
  "/refresh",
  publicRoute("auth", "all"),
  AuthenticationController.refreshToken,
);
router.post(
  "/resetpassword",
  publicRoute("auth", "all"),
  AuthenticationController.resetPassword,
);
router.post(
  "/check-email",
  publicRoute("auth", "all"),
  AuthenticationController.checkEmail,
);
router.post(
  "/forgot-password",
  publicRoute("auth", "all"),
  AuthenticationController.forgotPassword,
);
router.post(
  "/reset-password",
  publicRoute("auth", "all"),
  AuthenticationController.resetPasswordWithToken,
);

// SSO endpoints
router.post(
  "/sso/signin",
  publicRoute("auth", "all"),
  AuthenticationController.ssoLogin,
);
router.post(
  "/sso/signup",
  publicRoute("auth", "all"),
  AuthenticationController.ssoSignup,
);
router.post(
  "/sso/verify",
  publicRoute("auth", "all"),
  AuthenticationController.ssoVerify,
);

// Card endpoints
router.get(
  "/card-methods",
  publicRoute("auth", "all"),
  AuthenticationController.getCardAuthMethods,
);
router.post(
  "/card/signin",
  publicRoute("auth", "all"),
  AuthenticationController.cardSignin,
);
router.post(
  "/card/signup",
  publicRoute("auth", "all"),
  AuthenticationController.cardSignup,
);
router.get(
  "/auth/card/link",
  publicRoute("auth", "all"),
  AuthenticationController.confirmCardLink,
);
router.post(
  "/card/link",
  publicRoute("auth", "all"),
  AuthenticationController.confirmCardLinkWithToken,
);

// Hooks: the hook id in the path is the secret, and the handler checks it.
router.get(
  "/verify/:hookId",
  publicRoute("auth", "all"),
  AuthenticationController.releaseHook,
);
router.get(
  "/reset/:hookId",
  publicRoute("auth", "all"),
  AuthenticationController.releaseHook,
);

router.post(
  "/verify-email",
  publicRoute("auth", "all"),
  AuthenticationController.verifyEmail,
);

// Sign in: passport establishes the session this router hands out.
router.post("/signin", publicRoute("auth", "all"), (req, res, next) => {
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

// The two endpoints about the holder of a session.
router.post(
  "/signout",
  authorize("user", "readSelf"),
  AuthenticationController.signout,
);
router.get("/me", authorize("user", "readSelf"), AuthenticationController.me);

module.exports = router;
