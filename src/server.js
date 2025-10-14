require("dotenv").config();

const express = require("express");
const expressSession = require("express-session");
const MongoStore = require("connect-mongo");
const cookieParser = require("cookie-parser");
const helmet = require("helmet");
const fileUpload = require("express-fileupload");
const bunyan = require("bunyan");

const DatabaseManager = require("./commons/utilities/database-manager.js");
const { runMigrations } = require("../migrations/migrationsManager");
const seed = require("../seeder/seeder");
const RuleEngine = require("./rule-engine/ruleEngine");

const dbm = DatabaseManager.getInstance();

const logger = bunyan.createLogger({
  name: "server.js",
  level: process.env.LOG_LEVEL,
});

const app = express();
app.use(fileUpload());

app.use(helmet({ crossOriginResourcePolicy: false }));

app.use(function (req, res, next) {
  res.header("Access-Control-Allow-Credentials", true);
  res.header("Access-Control-Allow-Origin", req.headers.origin);
  res.header("Access-Control-Allow-Methods", "GET,PUT,POST,DELETE,OPTIONS");
  res.header(
    "Access-Control-Allow-Headers",
    "X-Requested-With, X-HTTP-Method-Override, Content-Type, Accept, Authorization"
  );
  if ("OPTIONS" === req.method) {
    res.sendStatus(200);
  } else {
    next();
  }
});

app.use(cookieParser());

app.enable("trust proxy");
app.use((req, res, next) => {
  const domainPattern = /^.*(\..+\..+|localhost)/i;
  const domain = domainPattern.test(req.hostname)
    ? domainPattern.exec(req.hostname)[1]
    : undefined;

  const sessionMid = expressSession({
    secret: process.env.SESSION_SECRET,
    resave: true,
    saveUninitialized: false,
    rolling: true,
    store: new MongoStore({ client: dbm.dbClient.connection.getClient() }),
    cookie: {
      httpOnly: true,
      maxAge: 1000 * 60 * 60 * 48,
      domain: domain,
    },
  });

  sessionMid(req, res, next);
});

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
  } catch (err) {
    res.status(503).json({
      status: "unavailable",
    });
  }
});

const userManagementRouter = require("./platform/authentication/authentication-router");
app.use("/auth", userManagementRouter);

const apiRouter = require("./platform/api/api-router");
app.use("/api", apiRouter);

const apiRouterTenantRelated = require("./platform/api/api-router-tenant-related");
app.use("/api/:tenant", apiRouterTenantRelated);

const htmlRouterTenantRelated = require("./platform/html-engine/html-router-tenant-related");
app.use("/html/:tenant", htmlRouterTenantRelated);

const jsonRouterTenantRelated = require("./platform/json-engine/json-router-tenant-related");
app.use("/json/:tenant", jsonRouterTenantRelated);

const exportersRouterTenantRelated = require("./platform/exporters/exporters-router-tenant-related");
app.use("/csv/:tenant", exportersRouterTenantRelated);

dbm.connect().then(() => {
  const port = process.env.PORT;
  app.listen(port, async () => {
    logger.info(`App listening at ${port}`);
    app.emit("app_started");
    try {
      await seed(dbm.dbClient.connection);
      await runMigrations(dbm.dbClient.connection);
      if (process.env.RULE_ENGINE_ENABLED === "true") {
        await RuleEngine.initEngine();
      }
    } catch (err) {
      logger.error("Error during application initialization steps", err);
    }
  });
});

module.exports = app;
