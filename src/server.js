require("dotenv").config();

const express = require("express");
const expressSession = require("express-session");
const MongoStore = require("connect-mongo");
const cookieParser = require("cookie-parser");
const helmet = require("helmet");
const fileUpload = require("express-fileupload");
const passport = require("passport");
const LocalStrategy = require("passport-local");
const bunyan = require("bunyan");

const dbm = require("./commons/utilities/database-manager.js");
const UserManager = require("./commons/data-managers/user-manager");

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
  res.header("Access-Control-Allow-Methods", "GET,PUT,POST,DELETE");
  res.header(
    "Access-Control-Allow-Headers",
    "X-Requested-With, X-HTTP-Method-Override, Content-Type, Accept",
  );
  if ("OPTIONS" === req.method) {
    res.send(200);
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
    store: MongoStore.create({
      client: dbm.getClient(),
      dbName: process.env.DB_NAME,
    }),
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

passport.use(
  new LocalStrategy(
    {
      usernameField: "id",
      passwordField: "password",
      passReqToCallback: true,
    },
    (request, id, password, done) => {
      var tenant = request.params.tenant;

      UserManager.getUser(id, tenant).then((user) => {
        if (
          user !== undefined &&
          user.isVerified &&
          user.verifyPassword(password)
        ) {
          done(null, user);
        } else {
          done(null, false);
        }
      });
    },
  ),
);

passport.serializeUser(function (user, done) {
  done(null, user);
});

passport.deserializeUser(function (user, done) {
  done(null, user);
});

app.use(passport.initialize());
app.use(passport.session());

const userManagementRouter = require("./platform/authentication/authentication-router");
app.use("/auth/:tenant", userManagementRouter);

const apiRouter = require("./platform/api/api-router");
app.use("/api", apiRouter);

const apiRouterTenantRelated = require("./platform/api/api-router-tenant-related");
app.use("/api/:tenant", apiRouterTenantRelated);

const htmlRouterTenantRelated = require("./platform/html-engine/html-router-tenant-related");
app.use("/html/:tenant", htmlRouterTenantRelated);

const exportersRouterTenantRelated = require("./platform/exporters/exporters-router-tenant-related");
app.use("/csv/:tenant", exportersRouterTenantRelated);

dbm.connect().then(() => {
  const port = process.env.PORT;
  app.listen(port, () => {
    logger.info(`App listening at ${port}`);
    app.emit("app_started");
  });
});

module.exports = app;
