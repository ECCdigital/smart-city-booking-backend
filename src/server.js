require("dotenv").config();

const express = require("express");
const cookieParser = require("cookie-parser");
const helmet = require("helmet");
const fileUpload = require("express-fileupload");
const bunyan = require("bunyan");
const swaggerUi = require("swagger-ui-express");

const DatabaseManager = require("./commons/utilities/database-manager.js");
const { runMigrations } = require("../migrations/migrationsManager");
const seed = require("../seeder/seeder");
const RuleEngine = require("./rule-engine/ruleEngine");
const { requestLogger } = require("./middleware/logger.js");
const lazyBrowser = require("./commons/pdf-service/LazyBrowser");
const { errorHandler } = require("./middleware/error-handler");
const SaltoKsCleanupService = require("./commons/services/access/salto-ks-cleanup-service");
const { assertStorageConfig } = require("./commons/services/storage");
const {
  uploadBackstopBytes,
} = require("./commons/services/media/media-config");
const {
  applySharpConcurrency,
} = require("./commons/services/media/image-variants");
const {
  warnIfImportPending,
} = require("./commons/services/media/media-import-status");

// Fail fast when the explicitly chosen storage provider is misconfigured.
assertStorageConfig();

// Size the libvips thread pool to the container, not to the detected cores.
applySharpConcurrency();

const dbm = DatabaseManager.getInstance();

const logger = bunyan.createLogger({
  name: "server.js",
  level: process.env.LOG_LEVEL,
});

const app = express();

const swaggerSpec = require("./docs/swagger-config");

if (process.env.NODE_ENV !== "production") {
  app.use(
    "/api-docs",
    swaggerUi.serve,
    swaggerUi.setup(swaggerSpec, {
      customSiteTitle: "Access API Docs",
      customCss: ".swagger-ui .topbar { display: none }",
    }),
  );
}

// Global backstop for every upload route. It sits above the largest media
// limit on purpose: media uploads answer with their own 400, this only stops
// requests no route would ever accept.
app.use(
  fileUpload({
    limits: { fileSize: uploadBackstopBytes() },
    abortOnLimit: true,
    responseOnLimit: "File too large.",
  }),
);

app.use(helmet({ crossOriginResourcePolicy: false }));

app.use(function (req, res, next) {
  res.header("Access-Control-Allow-Credentials", true);
  res.header("Access-Control-Allow-Origin", req.headers.origin);
  res.header("Access-Control-Allow-Methods", "GET,PUT,POST,DELETE,OPTIONS");
  res.header(
    "Access-Control-Allow-Headers",
    "X-Requested-With, X-HTTP-Method-Override, Content-Type, Accept, Authorization",
  );
  if ("OPTIONS" === req.method) {
    res.sendStatus(200);
  } else {
    next();
  }
});

app.use(requestLogger);
app.use(cookieParser());
app.enable("trust proxy");
app.use(express.urlencoded({ limit: "1mb", extended: true }));
app.use(express.json({ limit: "1mb" }));

app.get("/healthz/live", (req, res) => {
  res.status(200).json({ status: "ok" });
});

async function pingMongoWithTimeout(client, ms = 800) {
  const timeout = new Promise((_, reject) =>
    setTimeout(() => reject(new Error("mongo ping timeout")), ms),
  );

  const ping = (async () => {
    const mongoClient = dbm.dbClient.connection.getClient();
    await mongoClient.db().admin().ping();
  })();

  return Promise.race([ping, timeout]);
}

app.get("/healthz/ready", async (req, res) => {
  try {
    await pingMongoWithTimeout(dbm.dbClient, 800);

    if (process.env.RULE_ENGINE_ENABLED === "true") {
      if (!RuleEngine.isInitialized?.()) {
        return res.status(503).json({
          status: "degraded",
          details: { ruleEngine: "not-initialized" },
        });
      }
    }

    res.status(200).json({ status: "ok" });
  } catch {
    res.status(503).json({
      status: "unavailable",
    });
  }
});

const userManagementRouter = require("./platform/authentication/authentication-router");
app.use("/auth", userManagementRouter);

const apiRouter = require("./platform/api/api-router");
app.use("/api", apiRouter);

const apiV2Router = require("./platform/api/v2/routes");
app.use("/api/v2", apiV2Router);

const apiRouterTenantRelated = require("./platform/api/api-router-tenant-related");
app.use("/api/:tenant", apiRouterTenantRelated);

const htmlRouterTenantRelated = require("./platform/html-engine/html-router-tenant-related");
app.use("/html/:tenant", htmlRouterTenantRelated);

const jsonRouterTenantRelated = require("./platform/json-engine/json-router-tenant-related");
app.use("/json/:tenant", jsonRouterTenantRelated);

const exportersRouterTenantRelated = require("./platform/exporters/exporters-router-tenant-related");
app.use("/csv/:tenant", exportersRouterTenantRelated);

app.use(errorHandler);

require("./commons/services/checkout/providers/register");
require("./commons/services/access/providers/register-access-providers");

let server;

dbm.connect().then(() => {
  const port = process.env.PORT;
  server = app.listen(port, async () => {
    logger.info(`App listening at ${port}`);
    app.emit("app_started");
    try {
      await seed(dbm.dbClient.connection);
      await runMigrations(dbm.dbClient.connection);
      // Not migrating is not an error: the legacy resolver route keeps serving
      // the old tree until the media CLI has run (§4.10).
      await warnIfImportPending();
      if (process.env.RULE_ENGINE_ENABLED === "true") {
        await RuleEngine.initEngine();
      }
      if (process.env.SALTO_KS_CLEANUP_ENABLED !== "false") {
        SaltoKsCleanupService.start();
      }
    } catch (err) {
      logger.error("Error during application initialization steps", err);
    }
  });
});

async function gracefulShutdown(signal) {
  logger.info(`${signal} received, starting graceful shutdown...`);

  const forceShutdownTimeout = setTimeout(() => {
    logger.error("Forced shutdown after timeout");
    process.exit(1);
  }, 30000);

  try {
    if (server) {
      await new Promise((resolve) => {
        server.close(() => {
          logger.info("HTTP server closed");
          resolve();
        });
      });
    }

    logger.info("Closing browser instance...");
    SaltoKsCleanupService.stop();
    await lazyBrowser.cleanup();
    logger.info("Browser closed successfully");

    if (dbm?.dbClient?.connection) {
      logger.info("Closing database connection...");
      await dbm.dbClient.connection.close();
      logger.info("Database closed successfully");
    }

    clearTimeout(forceShutdownTimeout);
    logger.info("Graceful shutdown completed");

    await new Promise((resolve) => setTimeout(resolve, 100));
    process.exit(0);
  } catch (err) {
    logger.error("Error during graceful shutdown", err);
    clearTimeout(forceShutdownTimeout);
    process.exit(1);
  }
}

process.on("SIGTERM", () => gracefulShutdown("SIGTERM"));
process.on("SIGINT", () => gracefulShutdown("SIGINT"));

process.on("uncaughtException", (err) => {
  logger.error("Uncaught Exception", err);
  gracefulShutdown("uncaughtException");
});

process.on("unhandledRejection", (reason, promise) => {
  logger.error("Unhandled Rejection at:", promise, "reason:", reason);
  gracefulShutdown("unhandledRejection");
});

module.exports = app;
