const UserManager = require("../../../commons/data-managers/user-manager");
const TenantManager = require("../../../commons/data-managers/tenant-manager");
var { User, HookTypes } = require("../../../commons/entities/user");
const bunyan = require("bunyan");
const axios = require('axios');

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

  static signin(request, response) {
    const user = request.user;

    UserManager.getUserPermissions(user.id, user.tenant)
      .then((permissions) => {
        user.permissions = permissions;
        logger.info(`User ${user.id} signed in.`);
        response.status(200).send(user);
      })
      .catch((err) => {
        logger.error(err);
        response.sendStatus(500);
      });
  }

  static async checkUserRole(app, userId, jwtToken) {
    try {
      const token = jwtToken;
      const roleUrl = `${app.serverUrl}/realms/${app.realm}/protocol/openid-connect/token/introspect`;


      const roleResponse = await axios.get(roleUrl, {
        headers: {
          Authorization: `Bearer ${token}`,
        },
      });

      console.log(roleResponse.data);

    } catch (error) {
      if (error.response) {
        // Server hat mit einem Statuscode geantwortet, der außerhalb des Bereichs von 2xx liegt
        console.error('Response error:', error.response.data);
      } else if (error.request) {
        // Die Anfrage wurde gesendet, aber keine Antwort erhalten
        console.error('Request error:', error.request);
      } else {
        // Ein Fehler ist aufgetreten, als die Anfrage eingerichtet wurde
        console.error('Setup error:', error.message);
      }
      console.error('Error config:', error.config);
    }
  }

  static async ssoLogin(request, response, next) {
    const {
      body: { token },
      params: { tenant },
    } = request;

    const app = await TenantManager.getTenantApp(tenant, "keycloak");

    const url = `${app.serverUrl}/realms/${app.realm}/protocol/openid-connect/userinfo`;

    const inrourl = `${app.serverUrl}/realms/${app.realm}/protocol/openid-connect/token/introspect`;

    const clientSecret = "O83IjXzvPn68g1ozYMrMJpXPRWdoQ0N1"

    console.log(token);

    try {
      const kcResponse = await axios.get(url, {
        headers: {
          Authorization: `Bearer ${token}`,
        },
      })
      console.log(kcResponse.data);

      const introspectResponse = await axios.post(inrourl, `client_id=${app.clientIdApi}&client_secret=${clientSecret}&token=${token}`, {
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
        },
      });

      console.log(introspectResponse.data);


      const userAccess = introspectResponse.resource_access

      const user = await UserManager.getUser(kcResponse.data.email, tenant);
      if (!user) {
        response.sendStatus(401);
      } else {
        user.permissions = await UserManager.getUserPermissions(
          user.id,
          user.tenant,
        );
        request.login(user, { session: true }, async (err) => {
          if (err) {
            return next(err);
          }
          request.session.save();
          logger.info(`UserController - signin: User signed in: ${kcResponse.data.email}`);
          return response.status(200).send(user);
        });
      }
    } catch (error) {
      logger.error(error);
      response.sendStatus(401);
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
