const { BaseError } = require("../errors/BaseError");
const bunyan = require("bunyan");

const logger = bunyan.createLogger({
  name: "error-handler",
  level: process.env.LOG_LEVEL,
});

function errorHandler(err, req, res, next) {
  if (err instanceof BaseError) {
    logger.warn({ err: err.toJSON() }, `${err.name}: ${err.code}`);
    return res.status(err.statusCode).json(err.toJSON());
  }

  if (err?.cause?.code && typeof err.cause.code === "number") {
    logger.warn(err, `Legacy error: ${err.message}`);
    return res.status(err.cause.code).json({
      error: "LegacyError",
      code: "legacy_error",
      statusCode: err.cause.code,
      params: { message: err.message },
    });
  }

  logger.error(err, "Unhandled error");
  return res.status(500).json({
    error: "InternalError",
    code: "internal_error",
    statusCode: 500,
  });
}

module.exports = { errorHandler };
