const UserManager = require("../../../commons/data-managers/user-manager");
var { User, HookTypes } = require("../../../commons/entities/user");
const bunyan = require("bunyan");
const TenantManager = require("../../../commons/data-managers/tenant-manager");
const MailController = require("../../../commons/mail-service/mail-controller");
const { RoleManager } = require("../../../commons/data-managers/role-manager");

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
    try {
      const user = request.user;
      const permissions = await UserManager.getUserPermissions(user.id);
      logger.info(`User ${user.id} signed in.`);
      response.status(200).send({ user, permissions });
    } catch (error) {
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
            const user = new User({
              id: request.body.id,
              secret: undefined,
              tenant: request.params.tenant,
              firstName: request.body.firstName,
              lastName: request.body.lastName,
              company: request.body.company,
            });
            user.setPassword(request.body.password);

            UserManager.signupUser(user)
              .then(async () => {
                logger.info(`User ${user.id} signed up.`);

                const tenant = await TenantManager.getTenant(user.tenant);

                await MailController.sendUserCreated(
                  tenant.mail,
                  user.tenant,
                  user.id,
                );

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

  static async me(request, response) {
    try {
      const user = request.user;
      if (!user) {
        response.status(401);
        return;
      }

      const permissions = await UserManager.getUserPermissions(user.id);
      response.status(200).send({ user, permissions });
    } catch (error) {
      response.sendStatus(500);
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
