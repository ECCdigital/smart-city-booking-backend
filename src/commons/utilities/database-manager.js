const bunyan = require("bunyan");
const MongoClient = require("mongodb").MongoClient;

var db;
var dbClient;

const logger = bunyan.createLogger({
  name: "database-manager.js",
  level: process.env.LOG_LEVEL,
});

/**
 * The Database Manager handles and manages the database connection.
 *
 * @author Lennard Scheffler, lennard.scheffler@e-c-crew.de
 */
class DatabaseManager {
  /**
   * Connect to the application database.
   *
   * @param {String} dbUrl The Connection URI to the mongodb Database.
   * @param {String} dbName Name of the Database.
   * @returns the Database object.
   */
  static connect(dbUrl, dbName) {
    var dbUrl = dbUrl || process.env.DB_URL;
    var dbName = dbName || process.env.DB_NAME;

    logger.info("Establishing connection to database at " + dbUrl);

    return new Promise((resolve, reject) => {
      MongoClient.connect(dbUrl)
        .then((client) => {
          dbClient = client;
          db = client.db(dbName);
          logger.info("Database connection successfully established.");
          resolve(db);
        })
        .catch((err) => {
          logger.error("Could not establish connection to database.", err);
          reject(err);
        });
    });
  }

  /**
   * Returns the current database object when a connection has been established.
   *
   * @returns Get the current database object.
   */
  static get() {
    return db;
  }

  /**
   * Close the current database connection.
   */
  static close() {
    logger.info("Closing connection to database.");
    dbClient.close();
  }
}

module.exports = DatabaseManager;
