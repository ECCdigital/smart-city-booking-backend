const bunyan = require("bunyan");

const baseLogger = bunyan.createLogger({
  name: "app",
  level: process.env.LOG_LEVEL || "info",
});

/**
 * Creates a logger instance specifically for a given component.
 *
 * @param {string} componentName - The name of the component to associate with the logger.
 * @return {Object} A child logger instance scoped to the specified component.
 */
function createComponentLogger(componentName) {
  return baseLogger.child({ component: componentName });
}

/**
 * The routes whose query names what a person searched for or where (search
 * text, focus, point): never logged (map ECCdigital/tickets#372).
 */
const UNLOGGED_QUERY = /\/geo(\/|$)/;

/**
 * The tiles of the map name in their path where a person looked
 * (`/geo/tiles/:z/:x/:y`): logged as the pattern of the route alone.
 */
const TILE_PATH = /(\/geo\/tiles)(\/[^?]*)?/;

/**
 * Request logging middleware that logs all incoming requests in development mode.
 * Logs method, URL, query parameters, body, and headers; the URL of a geo
 * route without its query, and that of a tile without its coordinates.
 */
function requestLogger(req, res, next) {
  // Only log in development mode
  const isDevelopment =
    process.env.NODE_ENV === "development" ||
    process.env.NODE_ENV === "dev" ||
    !process.env.NODE_ENV;

  if (isDevelopment) {
    const requestLogger = baseLogger.child({ component: "RequestLogger" });
    const withoutQuery = (url) => (url || "").split("?")[0];
    const unlogged = UNLOGGED_QUERY.test(withoutQuery(req.originalUrl));
    const tile = TILE_PATH.test(withoutQuery(req.originalUrl));
    const shown = (url) => {
      if (!unlogged) return url;
      const path = withoutQuery(url);
      return tile ? path.replace(TILE_PATH, "$1/:z/:x/:y") : path;
    };
    const tilePart = (url) => (tile ? "[REDACTED]" : url);

    const logData = {
      method: req.method,
      url: tilePart(shown(req.url)),
      path: tilePart(req.path),
      baseUrl: shown(req.baseUrl),
      originalUrl: shown(req.originalUrl),
      query: unlogged ? "[REDACTED]" : req.query,
      params: tile ? "[REDACTED]" : req.params,
      headers: {
        host: req.headers.host,
        "user-agent": req.headers["user-agent"],
        "content-type": req.headers["content-type"],
        authorization: req.headers.authorization ? "[PRESENT]" : undefined,
      },
      ip: req.ip,
      timestamp: new Date().toISOString(),
    };

    // Log body only for POST, PUT, PATCH requests and if it exists
    if (["POST", "PUT", "PATCH"].includes(req.method) && req.body) {
      // Sanitize sensitive data in body
      const sanitizedBody = { ...req.body };
      if (sanitizedBody.password) sanitizedBody.password = "[REDACTED]";
      if (sanitizedBody.token) sanitizedBody.token = "[REDACTED]";
      logData.body = sanitizedBody;
    }

    requestLogger.info(logData, `${req.method} ${shown(req.originalUrl)}`);
  }

  next();
}

module.exports = createComponentLogger;
module.exports.requestLogger = requestLogger;
