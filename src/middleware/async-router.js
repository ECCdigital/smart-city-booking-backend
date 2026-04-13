const express = require("express");

function asyncRouter() {
  const router = express.Router({ mergeParams: true });

  for (const method of ["get", "post", "put", "patch", "delete"]) {
    const original = router[method].bind(router);

    router[method] = (path, ...handlers) => {
      const wrapped = handlers.map((fn) =>
        typeof fn === "function" && fn.constructor.name === "AsyncFunction"
          ? (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next)
          : fn,
      );
      return original(path, ...wrapped);
    };
  }

  return router;
}

module.exports = { asyncRouter };
