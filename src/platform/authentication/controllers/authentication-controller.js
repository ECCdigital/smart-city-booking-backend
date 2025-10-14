const UserManager = require("../../../commons/data-managers/user-manager");
const { User } = require("../../../commons/entities/user/user");
const bunyan = require("bunyan");
const SsoService = require("../../../commons/services/sso/sso-service");
const UserService = require("../../../commons/services/user-service");

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
  static isSignedIn(request, response, next) {
    if (request.isAuthenticated()) {
      next();
    } else {
      response.sendStatus(401);
    }
  }

  static async signin(request, response) {
    const user = request.user;
    try {
      const permissions = await UserManager.getUserPermissions(user.id);
      logger.info(`User ${user.id} signed in.`);
      response.status(200).send({ user, permissions });
    } catch (error) {
      logger.error(`could not sign in ${user?.id}`, error);
      response.sendStatus(500);
    }
  }

  static async ssoLogin(request, response, next) {
    try {
      const {
        body: { token },
      } = request;
      const user = await SsoService.handleLogin(token);

      if (user) {
        request.login(user, { session: true }, async (err) => {
          if (err) {
            return next(err);
          }
          request.session.save((err) => {
            if (err) {
              return next(err);
            }
            response.status(200).send(user);
          });
        });
      } else {
        response.sendStatus(401);
      }
    } catch (error) {
      response.status(error.status || 500).send(error.message);
      logger.error(error);
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

      await UserService.singUpUser(user, nextUrl);

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

  static signout(request, response, next) {
    request.logout(function (err) {
      if (err) {
        return next(err);
      }
    });
    response.sendStatus(200);
  }

  static async me(request, response) {
    try {
      const user = request.user;
      if (!user) {
        response.status(401);
        return;
      }

      const permissions = await UserManager.getUserPermissions(user.id);

      response.status(200).send({ user, permissions });
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
    var id = request.body.id;
    var password = request.body.password;

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
}

module.exports = AuthenticationController;
