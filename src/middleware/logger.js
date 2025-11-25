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
 * Request logging middleware that logs all incoming requests in development mode.
 * Logs method, URL, query parameters, body, and headers.
 */
function requestLogger(req, res, next) {
  // Only log in development mode
  const isDevelopment =
    process.env.NODE_ENV === "development" ||
    process.env.NODE_ENV === "dev" ||
    !process.env.NODE_ENV;

  if (isDevelopment) {
    const requestLogger = baseLogger.child({ component: "RequestLogger" });

    const logData = {
      method: req.method,
      url: req.url,
      path: req.path,
      baseUrl: req.baseUrl,
      originalUrl: req.originalUrl,
      query: req.query,
      params: req.params,
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

    requestLogger.info(logData, `${req.method} ${req.originalUrl}`);
  }

  next();
}

module.exports = createComponentLogger;
module.exports.requestLogger = requestLogger;
