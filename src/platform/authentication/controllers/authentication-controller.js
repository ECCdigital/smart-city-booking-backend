const UserManager = require("../../../commons/data-managers/user-manager");
const { User } = require("../../../commons/entities/user/user");
const bunyan = require("bunyan");
const SsoService = require("../../../commons/services/sso/sso-service");
const UserService = require("../../../commons/services/user-service");

const JwtHelper = require("../../../commons/utilities/jwt-helper");

const logger = bunyan.createLogger({
  name: "authentication-controller.js",
  level: process.env.LOG_LEVEL,
});

/**
 * Controller for user authentication.
 *
 * @author Lennard Scheffler, lennard.scheffler@e-c-crew.de
 */
class AuthenticationController {
  static isSignedIn = require("../../../middleware/jwt-auth");

  static async signin(request, response) {
    const user = request.user;
    try {
      const permissions = await UserManager.getUserPermissions(user.id);
      const requestedUser = await UserManager.getUser(user.id, false);

      const context = {
        ip: request.ip || request.connection?.remoteAddress,
        userAgent: request.headers["user-agent"],
      };

      const accessToken = await JwtHelper.generateToken(requestedUser, context);
      const refreshToken = await JwtHelper.generateRefreshToken(
        requestedUser,
        context,
      );

      logger.info(`User ${user.id} signed in.`);
      response.status(200).json({
        user: requestedUser,
        permissions,
        accessToken,
        refreshToken,
      });
    } catch (error) {
      logger.error(`could not sign in ${user?.id}`, error);
      response.sendStatus(500);
    }
  }

  static async ssoLogin(request, response) {
    try {
      const { token } = request.body;

      if (!token) {
        return response.status(400).json({
          success: false,
          message: "Keycloak token required",
        });
      }

      // Token gegen Keycloak verifizieren
      const KeycloakVerifier =
        require("../../../commons/utilities/keycloak-verifier");
      const decoded = await KeycloakVerifier.verifyToken(token);

      const userId = decoded.email || decoded.preferred_username;

      // User in lokaler DB suchen
      let user = await UserManager.getUser(userId, false);

      if (!user) {
        return response.status(404).json({
          success: false,
          message: "User not found. Registration required.",
        });
      }

      if (user.isSuspended) {
        return response.status(403).json({
          success: false,
          message: "User account is suspended",
        });
      }

      const permissions = await UserManager.getUserPermissions(userId);

      logger.info(`SSO login for user ${userId} (Keycloak token direct)`);

      // Kein eigenes Token mehr generieren!
      // Das Frontend nutzt das Keycloak-Token direkt.
      response.status(200).json({
        success: true,
        user,
        permissions,
        authType: "keycloak",
      });
    } catch (error) {
      logger.error("SSO login failed:", error);
      response.status(error.status || 401).json({
        success: false,
        message: error.message || "SSO authentication failed",
      });
    }
  }

  static async ssoVerify(request, response) {
    try {
      const { token } = request.body;

      if (!token) {
        return response.status(400).json({
          success: false,
          message: "Token required",
        });
      }

      const KeycloakVerifier =
        require("../../../commons/utilities/keycloak-verifier");
      const decoded = await KeycloakVerifier.verifyToken(token);

      const userId = decoded.email || decoded.preferred_username;
      const user = await UserManager.getUser(userId, false);

      if (!user) {
        return response.status(404).json({
          success: false,
          message: "User not found",
          keycloakEmail: decoded.email,
        });
      }

      if (user.isSuspended) {
        return response.status(403).json({
          success: false,
          message: "User account is suspended",
        });
      }

      const permissions = await UserManager.getUserPermissions(userId);

      response.status(200).json({
        success: true,
        user,
        permissions,
        authType: "keycloak",
      });
    } catch (error) {
      logger.error("SSO verify failed:", error.message);
      response.status(401).json({
        success: false,
        message: "Token verification failed",
      });
    }
  }

  static async refreshToken(request, response) {
    try {
      const { refreshToken } = request.body;
      if (!refreshToken) {
        return response.status(401).json({
          success: false,
          message: "Refresh token required",
        });
      }

      const decoded = await JwtHelper.verifyRefreshToken(refreshToken);

      const user = await UserManager.getUser(decoded.sub || decoded.id);

      if (!user) {
        return response.status(401).json({
          success: false,
          message: "User not found",
        });
      }

      if (user.isSuspended) {
        return response.status(403).json({
          success: false,
          message: "User account is suspended",
        });
      }

      const context = {
        ip: request.ip || request.connection?.remoteAddress,
        userAgent: request.headers["user-agent"],
      };

      const newAccessToken = await JwtHelper.generateToken(user, context);
      const newRefreshToken = await JwtHelper.generateRefreshToken(
        user,
        context,
      );

      if (decoded.jti) {
        await JwtHelper.revokeToken(refreshToken, "token_rotation");
      }

      logger.info(`Tokens refreshed for user ${user.id}`);

      response.json({
        success: true,
        accessToken: newAccessToken,
        refreshToken: newRefreshToken,
      });
    } catch (error) {
      logger.error("Token refresh failed:", error);
      response.status(401).json({
        success: false,
        message: "Invalid refresh token",
      });
    }
  }

  static async signup(request, response) {
    try {
      const {
        id: userID,
        password,
        firstName,
        lastName,
        company,
        nextUrl,
        verifyUrl,
      } = request.body;

      const existingUser = await UserManager.getUser(userID);

      if (existingUser) {
        return response.sendStatus(409);
      }

      const user = new User({
        id: userID,
        secret: undefined,
        firstName: firstName,
        lastName: lastName,
        company: company,
      });
      user.setPassword(password);

      await UserService.singUpUser(user, nextUrl, verifyUrl);

      return response.sendStatus(201);
    } catch (error) {
      logger.error("Could not sign up user", error);
      return response.status(error.status || 500).send(error.message);
    }
  }

  static async ssoSignup(request, response) {
    try {
      const {
        body: { token },
      } = request;
      await SsoService.handleSignup(token);
      response.sendStatus(201);
    } catch (error) {
      response.status(error.status).send(error.message);
    }
  }

  static async signout(request, response) {
    try {
      const authHeader = request.headers.authorization;
      const token = JwtHelper.extractToken(authHeader);

      if (token) {
        await JwtHelper.revokeToken(token, "logout");

        // Optional: Auch Refresh-Token revoken wenn mitgeschickt
        const { refreshToken } = request.body;
        if (refreshToken) {
          await JwtHelper.revokeToken(refreshToken, "logout");
        }

        logger.info(`User ${request.user?.id} signed out, tokens revoked`);
      }

      response.status(200).json({
        success: true,
        message: "Logged out successfully",
      });
    } catch (error) {
      logger.error("Signout error:", error);
      response.status(500).json({
        success: false,
        message: "Logout failed",
      });
    }
  }

  static async me(request, response) {
    try {
      const user = request.user;
      if (!user) {
        response.status(401);
        return;
      }

      const permissions = await UserManager.getUserPermissions(user.id);
      const requestedUser = await UserManager.getUser(user.id, false);

      response.status(200).send({ user: requestedUser, permissions });
    } catch {
      response.sendStatus(500);
    }
  }

  static async releaseHook(request, response) {
    const hookID = request.params.hookId;

    try {
      const additionalUrl = await UserService.releaseHook(hookID);

      logger.info(`Hook ${hookID} released.`);

      response.redirect(`${process.env.FRONTEND_URL}${additionalUrl}`);
    } catch (err) {
      logger.error(err);
      response.redirect(`${process.env.FRONTEND_URL}/login`);
    }
  }

  static resetPassword(request, response) {
    const id = request.body.id;
    const password = request.body.password;

    if (id && password) {
      UserManager.getUser(id, true)
        .then((user) => {
          if (user) {
            UserManager.resetPassword(user, password)
              .then(() => {
                logger.info(`Password reset for user ${user.id}.`);
                response.sendStatus(200);
              })
              .catch((err) => {
                logger.error(err);
                response.status(500).send("could not reset password");
              });
          } else {
            logger.warn(`Could not reset password. User ${id} not found.`);
            response.sendStatus(404);
          }
        })
        .catch((err) => {
          logger.error(err);
          response.sendStatus(500);
        });
    } else {
      response.sendStatus(400);
    }
  }

  static async checkEmail(request, response) {
    if (process.env.DISABLE_EMAIL_CHECK === "true") {
      return response.status(200).send("Email check is disabled");
    }

    const { email } = request.body;

    if (!email) {
      return response.status(400).send("Email is required");
    }

    try {
      const user = await UserManager.getUser(email);
      if (user) {
        return response.status(409).send("Email already in use");
      }
      return response.status(200).send("Email is available");
    } catch (error) {
      logger.error(error);
      return response.status(500).send("Internal server error");
    }
  }

  static async verifyEmail(request, response) {
    const { token, id } = request.body;

    if (!token || !id) {
      return response.status(400).send("Token and ID are required");
    }

    try {
      const { success } = await UserService.verifyEmail(token, id);
      if (!success) {
        throw new Error("Email verification failed");
      }
      logger.info(`Email verified for user ${id}.`);
      return response.status(200).send("Email verified successfully");
    } catch (error) {
      logger.error(`Email verification failed for user ${id}:`, error);
      return response
        .status(error.status || 500)
        .send(error.message || "Email verification failed");
    }
  }
}

module.exports = AuthenticationController;
