const UserManager = require("../../../commons/data-managers/user-manager");
var { User, HookTypes } = require("../../../commons/entities/user");
const bunyan = require("bunyan");
const passport = require("passport");

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

  static signin(request, response, next) {
    try {
      passport.authenticate(
        "keycloak-signin",
        { session: false },
        async (err, user, info) => {
          console.log("user", user);
          if (err) {
            return next(err);
          }
          if (!user) {
            logger.info(
              `UserController - signin: ${info.message} User: ${id} ${info.attempts || ""}`,
            );
            return response.sendStatus(401);
          }

          request.login(user, { session: true }, async (err) => {
            if (err) {
              return next(err);
            }
            request.session.save();
            logger.info(`UserController - signin: User signed in: ${user.id}`);
            return response.status(200).send(user);
          });
        },
      )(request, response, next);
    } catch (err) {
      logger.error("AuthController - signin: ", err);
      response.sendStatus(500);
    }
  }

  static signup(request, response) {
    if (
      request.body.id &&
      request.body.password &&
      request.body.firstName &&
      request.body.lastName
    ) {
      UserManager.getUser(request.body.id, request.params.tenant).then(
        (user) => {
          if (user) {
            response.sendStatus(409);
          } else {
            const user = new User(
              request.body.id,
              undefined,
              request.params.tenant,
              request.body.firstName,
              request.body.lastName,
            );
            user.setPassword(request.body.password);

            UserManager.signupUser(user)
              .then(() => {
                logger.info(`User ${user.id} signed up.`);
                response.status(201).send({ tenantId: request.params.tenant });
              })
              .catch((err) => {
                logger.error(err);
                response.status(500).send("could not signup user");
              });
          }
        },
      );
    } else {
      response.sendStatus(400);
    }
  }

  static signout(request, response) {
    request.logout(function (err) {
      if (err) {
        return next(err);
      }
    });
    response.sendStatus(200);
  }

  static me(request, response) {
    var user = Object.assign(new User(), request.user);
    var userPublic = user.exportPublic();

    if (request.query.populatePermissions === "1") {
      UserManager.getUserPermissions(user.id, user.tenant).then(
        (permissions) => {
          userPublic.permissions = permissions;
          response.status(200).send(userPublic);
        },
      );
    } else {
      response.status(200).send(userPublic);
    }
  }

  static releaseHook(request, response, next) {
    var hookId = request.params.hookId;

    UserManager.releaseHook(hookId)
      .then((hookType) => {
        let additionalUrl = "";
        if (hookType === HookTypes.VERIFY) {
          additionalUrl = "/email/verify";
        } else if (hookType === HookTypes.RESET_PASSWORD) {
          additionalUrl = "/password/confirmed";
        }

        logger.info(`Hook ${hookId} released.`);

        // redirect to the frontend
        response.redirect(`${process.env.FRONTEND_URL}${additionalUrl}`);
        next();
      })
      .catch((err) => {
        logger.error(err);
        response.status(500).send("could not releasae hook");
      });
  }

  static resetPassword(request, response) {
    var id = request.body.id;
    var password = request.body.password;
    var tenant = request.params.tenant;

    if (id && password) {
      UserManager.getUser(id, tenant)
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
}

module.exports = AuthenticationController;
