const UserManager = require("../../../commons/data-managers/user-manager");
const RoleManager = require("../../../commons/data-managers/role-manager");
var { User, HookTypes } = require("../../../commons/entities/user");
var { Role } = require("../../../commons/entities/role");

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
        response.status(200).send(user);
      })
      .catch((err) => {
        console.error(err);
        response.sendStatus(500);
      });
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
              request.body.lastName
            );
            user.setPassword(request.body.password);

            UserManager.signupUser(user)
              .then(() => {
                //UserUtilities.linkGuestBookingsToUser(user.id, user.tenant);
                response.sendStatus(200);
              })
              .catch((err) => response.sendStatus(500));
          }
        }
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
        }
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
        // redirect to the frontend
        response.redirect(`${process.env.FRONTEND_URL}${additionalUrl}`);
        next();
      })
      .catch((err) => response.sendStatus(500));
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
                response.sendStatus(200);
              })
              .catch((err) => response.sendStatus(500));
          } else {
            response.sendStatus(404);
          }
        })
        .catch((err) => response.sendStatus(500));
    } else {
      response.sendStatus(400);
    }
  }
}

module.exports = AuthenticationController;
