/**
 * The Express adapter of the authorization (glossary "Berechtigung"): the
 * three markers a route carries, exactly one each.
 *
 *   authorize(resource, action)   signed in, decided; 401 anonymous, 403
 *                                 without reach, else `req.reach`
 *   public(resource?, action?)    decided for anonymous principals too; the
 *                                 entry must be public, the handler gets
 *                                 `public | own | any`, never 403. Without
 *                                 arguments: a plainly public route.
 *   tokenAuthorized()             declares a route authorized by a secret
 *                                 in URL or body (hooks, webhooks); the
 *                                 handler keeps checking it as today.
 *
 * The JWT verification stays in `src/middleware/auth-middleware.js` and is
 * called from here: `authorize` runs `requireAuth`, `public` runs
 * `optionalAuth`. The principal is loaded once per request and memoised
 * on `req.principal`; the tenant is `req.params.tenant`.
 *
 * Every marker carries an `authorization` descriptor on the middleware
 * function, which the route inventory reads (`tests/helpers/route-inventory.js`)
 * to hold the invariant "every route carries one marker". The handlers are
 * plain functions on purpose: `asyncRouter` wraps async functions in a new
 * one, and the descriptor would not survive the wrapping.
 */

const {
  requireAuth,
  optionalAuth,
} = require("../../../middleware/auth-middleware");
const { ForbiddenError } = require("../../../errors/BaseError");
const { loadPrincipal } = require("./principal");
const { decide, entryOf } = require("./policy");

const MARKER = Object.freeze({
  AUTHORIZE: "authorize",
  PUBLIC: "public",
  TOKEN: "tokenAuthorized",
});

/**
 * The principal of a request, loaded once.
 *
 * @param {import("express").Request} req
 * @returns {Promise<Object>}
 */
async function principalOf(req) {
  if (!req.principal) {
    req.principal = await loadPrincipal(req.user?.id, req.params?.tenant);
  }
  return req.principal;
}

/**
 * Puts the marker descriptor on a middleware function.
 *
 * @param {import("express").RequestHandler} handler
 * @param {{marker: string, resource: string|null, action: string|null}} descriptor
 * @returns {import("express").RequestHandler} The same function, marked.
 */
function mark(handler, descriptor) {
  handler.authorization = Object.freeze(descriptor);
  return handler;
}

/**
 * Runs an auth middleware and continues with `then` when it lets the
 * request through; a response it sent itself (401, 403) ends the chain.
 *
 * @param {import("express").RequestHandler} auth - `requireAuth` or `optionalAuth`
 * @param {import("express").Request} req
 * @param {import("express").Response} res
 * @param {import("express").NextFunction} next
 * @param {() => Promise<void>} then - What runs once the request is through.
 * @returns {void}
 */
function afterAuth(auth, req, res, next, then) {
  auth(req, res, (err) => {
    if (err) {
      return next(err);
    }
    then().catch(next);
  });
}

/**
 * @param {string} resource
 * @param {string} action
 * @returns {import("express").RequestHandler}
 */
function authorize(resource, action) {
  if (entryOf(resource, action).public === true) {
    throw new Error(
      `authorization: ${resource}.${action} is public, use public()`,
    );
  }

  const handler = (req, res, next) =>
    afterAuth(requireAuth, req, res, next, async () => {
      const reach = decide(await principalOf(req), resource, action);
      if (!reach) {
        return next(new ForbiddenError());
      }
      req.reach = reach;
      next();
    });

  return mark(handler, { marker: MARKER.AUTHORIZE, resource, action });
}

/**
 * Exported as `public` (the spec's name) and as `publicRoute`: `public` is
 * a reserved word in strict mode, so a destructuring caller needs the
 * second name.
 *
 * @param {string} [resource]
 * @param {string} [action]
 * @returns {import("express").RequestHandler}
 */
function publicRoute(resource, action) {
  const decided = resource !== undefined || action !== undefined;
  if (decided && entryOf(resource, action).public !== true) {
    throw new Error(
      `authorization: ${resource}.${action} is not public, use authorize()`,
    );
  }

  const handler = (req, res, next) =>
    afterAuth(optionalAuth, req, res, next, async () => {
      req.reach = decided
        ? decide(await principalOf(req), resource, action)
        : "public";
      next();
    });

  return mark(handler, {
    marker: MARKER.PUBLIC,
    resource: resource ?? null,
    action: action ?? null,
  });
}

/**
 * @returns {import("express").RequestHandler}
 */
function tokenAuthorized() {
  return mark((req, res, next) => next(), {
    marker: MARKER.TOKEN,
    resource: null,
    action: null,
  });
}

/**
 * The marker a middleware carries, if any.
 *
 * @param {Function} handler
 * @returns {{marker: string, resource: string|null, action: string|null}|null}
 */
function markerOf(handler) {
  return handler?.authorization ?? null;
}

module.exports = {
  authorize,
  public: publicRoute,
  publicRoute,
  tokenAuthorized,
  markerOf,
  principalOf,
  MARKER,
};
