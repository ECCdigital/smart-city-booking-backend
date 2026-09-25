/**
 * The Express adapter of the authorization (glossary "Berechtigung"): the
 * three markers a route carries, exactly one each.
 *
 *   authorize(resource, action)   signed in, decided; 401 anonymous, 403
 *                                 without reach, else `req.reach`. A route
 *                                 with a second question (the obsolete
 *                                 upsert PUT that may create, the user
 *                                 removal that may hit an owner) names it
 *                                 on the marker, `{ also: ["create"] }`,
 *                                 and reads the answer off `req.reaches`
 *                                 (ADR 0001): the main action alone
 *                                 refuses, the others may be `null`.
 *   public(resource?, action?)    decided for anonymous principals too; the
 *                                 entry must be public, the handler gets
 *                                 `public | self | own | any`, never 403.
 *                                 Without arguments: a plainly public route.
 *                                 Second questions go on the marker as at
 *                                 `authorize` (`{ also: ["intern"] }`).
 *
 * `reachesOf(req)` packs what a marker decided into the bundle the media
 * rights take (`services/media/media-rights.js`): the main entry and the
 * `also` entries by action, and the `userId`.
 *   tokenAuthorized()             declares a route authorized by a secret
 *                                 in URL or body (hooks, webhooks); the
 *                                 handler keeps checking it as today.
 *
 * The JWT verification stays in `src/middleware/auth-middleware.js` and is
 * called from here: `authorize` runs `requireAuth`, `public` runs
 * `optionalAuth`. The principal is loaded once per request and memoised
 * on `req.principal`; the tenant is `req.params.tenant`, or what the
 * option `tenantOf(req)` names for a route that carries its tenant
 * elsewhere (`PUT /api/tenants` names it in the body).
 *
 * A declined tenant (glossary "Abweisung") is no gate here: the membership
 * in it rests in the principal already (`principal.js`), so `authorize`
 * decides as for anyone else, and `public` and every second decision
 * (`also`) meet the same principal. What `authorize` adds is the
 * answer: a refused principal whose membership rests is told why -
 * `403 tenant_declined` with the tenant's supervision - where anyone else
 * gets a plain `403`.
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
const { loadPrincipal, tenantsOf } = require("./principal");
const { decide, entryOf, REACH } = require("./policy");
const { ownerKeyOf } = require("./table");

const MARKER = Object.freeze({
  AUTHORIZE: "authorize",
  PUBLIC: "public",
  TOKEN: "tokenAuthorized",
});

/** The tenant of a request as the routers name it: `/:tenant`. */
const tenantParam = (req) => req.params?.tenant;

/**
 * Where a route names its tenant, when not in `:tenant` (`PUT /api/tenants`
 * names it in the body). An option of `authorize` alone: a `public` route
 * with a tenant elsewhere has not turned up.
 *
 * @callback TenantOf
 * @param {import("express").Request} req
 * @returns {string|undefined}
 */

/**
 * The principal of a request, loaded once.
 *
 * @param {import("express").Request} req
 * @param {TenantOf} [tenantOf]
 * @returns {Promise<Object>}
 */
async function principalOf(req, tenantOf = tenantParam) {
  if (!req.principal) {
    req.principal = await loadPrincipal(req.user?.id, tenantOf(req));
  }
  return req.principal;
}

/**
 * The refusal of `authorize`: the declination for a principal whose
 * membership in the tenant rests, a plain 403 for anyone else.
 *
 * @param {Object} principal
 * @returns {ForbiddenError}
 */
function refusalOf(principal) {
  if (!principal.restingMembership) {
    return new ForbiddenError();
  }
  return new ForbiddenError("tenant_declined", {
    tenantId: principal.tenantId,
    ...principal.restingMembership,
  });
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
 * A second entry a route names on its marker: `"<action>"` of the same
 * resource, or `"<resource>.<action>"` of another. Checked when the
 * router loads, like the main entry.
 *
 * @param {string} resource - The resource of the main action.
 * @param {string} name
 * @returns {{name: string, resource: string, action: string}}
 */
function secondEntry(resource, name) {
  const dot = name.indexOf(".");
  const entry =
    dot === -1
      ? { resource, action: name }
      : { resource: name.slice(0, dot), action: name.slice(dot + 1) };
  entryOf(entry.resource, entry.action);
  return { name, ...entry };
}

/**
 * @param {string} resource
 * @param {string} action
 * @param {Object} [options]
 * @param {TenantOf} [options.tenantOf] Where the route names its tenant,
 *   when not in `:tenant`.
 * @param {string[]} [options.also] The second decisions of the route, as
 *   `req.reaches[name]`: `"create"` of the same resource, or
 *   `"instanceCatalog.store"` of another.
 * @returns {import("express").RequestHandler}
 */
function authorize(
  resource,
  action,
  { tenantOf = tenantParam, also = [] } = {},
) {
  if (entryOf(resource, action).public === true) {
    throw new Error(
      `authorization: ${resource}.${action} is public, use public()`,
    );
  }
  const others = also.map((name) => secondEntry(resource, name));

  const handler = (req, res, next) =>
    afterAuth(requireAuth, req, res, next, async () => {
      const principal = await principalOf(req, tenantOf);
      const reach = decide(principal, resource, action);
      if (!reach) {
        return next(refusalOf(principal));
      }
      req.reach = reach;
      req.entry = { resource, action };
      req.tenantIds = tenantIdsOf(principal, resource, action, reach);
      if (others.length) {
        req.reaches = secondDecisions(principal, others);
      }
      next();
    });

  return mark(handler, { marker: MARKER.AUTHORIZE, resource, action });
}

/**
 * The answers to the second questions of a route, by the name the marker
 * gives them.
 *
 * @param {Object} principal
 * @param {{name: string, resource: string, action: string}[]} others
 * @returns {Object<string, string|null>}
 */
function secondDecisions(principal, others) {
  return Object.fromEntries(
    others.map((other) => [
      other.name,
      decide(principal, other.resource, other.action),
    ]),
  );
}

/**
 * Exported as `public` (the spec's name) and as `publicRoute`: `public` is
 * a reserved word in strict mode, so a destructuring caller needs the
 * second name.
 *
 * @param {string} [resource]
 * @param {string} [action]
 * @param {Object} [options]
 * @param {string[]} [options.also] The second decisions of the route, as
 *   `req.reaches[name]` - never a refusal, like the main one.
 * @returns {import("express").RequestHandler}
 */
function publicRoute(resource, action, { also = [] } = {}) {
  const decided = resource !== undefined || action !== undefined;
  if (decided && entryOf(resource, action).public !== true) {
    throw new Error(
      `authorization: ${resource}.${action} is not public, use authorize()`,
    );
  }
  if (also.length && !decided) {
    throw new Error("authorization: a second decision needs a public entry");
  }
  const others = also.map((name) => secondEntry(resource, name));

  const handler = (req, res, next) =>
    afterAuth(optionalAuth, req, res, next, async () => {
      if (decided) {
        const principal = await principalOf(req);
        req.reach = decide(principal, resource, action);
        req.entry = { resource, action };
        req.tenantIds = tenantIdsOf(principal, resource, action, req.reach);
        if (others.length) {
          req.reaches = secondDecisions(principal, others);
        }
      } else {
        req.reach = REACH.PUBLIC;
      }
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
 * The tenant set of a decision on the instance level (ADR 0002): under
 * `own` at an entry whose owner key names a tenant set of the principal
 * (`OWNER_KEY`, `tenantsOf`), the tenants that set holds; nothing
 * otherwise.
 *
 * @param {Object} principal
 * @param {string} resource
 * @param {string} action
 * @param {string|null} reach
 * @returns {string[]|undefined}
 */
function tenantIdsOf(principal, resource, action, reach) {
  if (reach !== REACH.OWN) {
    return undefined;
  }
  const key = ownerKeyOf(resource, action);
  return key.tenantsOf ? tenantsOf(principal, key) : undefined;
}

/**
 * The reach of a request as the managers take it (glossary "Reichweite"): what a
 * handler hands on, never reads. On the instance level the scope carries
 * the tenant set `own` means there (`tenantIds`, ADR 0002); never the
 * reach `domain`.
 *
 * @param {import("express").Request} req
 * @returns {{reach: string|undefined, userId: string|null, tenantIds?: string[]}}
 */
function scopeOf(req) {
  return {
    reach: req.reach,
    userId: req.principal?.userId ?? null,
    ...(req.tenantIds !== undefined && { tenantIds: req.tenantIds }),
  };
}

/**
 * The decided reaches of a request as one bundle, by action: the main
 * entry of the marker, its `also` entries, and the `userId`. What the
 * media rights take (`services/media/media-rights.js`) - the domain gets
 * the answers, never the principal. Only the entries a marker named are
 * in it; an entry it did not name is no reach.
 *
 * @param {import("express").Request} req
 * @returns {Object<string, string|null>}
 */
function reachesOf(req) {
  return Object.freeze({
    ...(req.entry && { [req.entry.action]: req.reach ?? null }),
    ...req.reaches,
    userId: req.principal?.userId ?? null,
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
  scopeOf,
  reachesOf,
  MARKER,
};
