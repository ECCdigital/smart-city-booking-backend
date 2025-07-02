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

module.exports = createComponentLogger;
