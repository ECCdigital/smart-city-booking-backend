/**
 * The inventory of the routes of an express app or router: every
 * `METHOD /path` with its mount prefix, and the authorization markers the
 * route's stack carries (`authorize`, `public`, `tokenAuthorized` of
 * `src/commons/services/authorization/middleware.js`). Walks the express
 * 4 layer stack; a mounted router's prefix is read back from its regexp
 * and keys, the way `express-list-endpoints` does it.
 */

const {
  markerOf,
} = require("../../src/commons/services/authorization/middleware");

const PARAM = /\(\?:\(\[\^\\\/\]\+\?\)\)/g;

/** The mount path of a `use()` layer, e.g. `/api/:tenant`. */
function mountOf(layer) {
  if (layer.regexp.fast_slash) {
    return "";
  }
  let index = 0;
  return layer.regexp.source
    .replace(/^\^/, "")
    .replace(/\\\/\?\(\?=\\\/\|\$\)$/, "")
    .replace(PARAM, () => `:${layer.keys[index++].name}`)
    .replace(/\\\//g, "/");
}

/**
 * @param {Object[]} stack - `app._router.stack` or `router.stack`
 * @param {string} [prefix]
 * @returns {{method: string, path: string, markers: Object[]}[]}
 */
function listRoutes(stack, prefix = "") {
  const routes = [];
  for (const layer of stack) {
    if (layer.route) {
      const markers = layer.route.stack
        .map((entry) => markerOf(entry.handle))
        .filter(Boolean);
      for (const path of [].concat(layer.route.path)) {
        for (const method of Object.keys(layer.route.methods)) {
          routes.push({
            method: method.toUpperCase(),
            path: prefix + path,
            markers,
          });
        }
      }
    } else if (layer.handle?.stack) {
      routes.push(...listRoutes(layer.handle.stack, prefix + mountOf(layer)));
    }
  }
  return routes;
}

/**
 * The routes of an express app.
 *
 * @param {import("express").Express} app
 */
function routesOf(app) {
  return listRoutes((app._router ?? app.router).stack);
}

module.exports = { listRoutes, routesOf, mountOf };
