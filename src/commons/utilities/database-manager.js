const mongoose = require("mongoose");

class DatabaseManager {
  static instance = null;

  static getInstance() {
    if (!this.instance) {
      this.instance = new DatabaseManager();
    }
    return this.instance;
  }

  constructor() {
    this.dbClient = null;
  }

  /**
   * Connect to the application database.
   *
   * @returns the Database object.
   */
  async connect(dbName = process.env.DB_NAME) {
    if (this.dbClient) {
      return this.dbClient;
    }

    try {
      if (!process.env.DB_URL) {
        throw new Error("Database connection parameters are missing.");
      }

      const uri = process.env.DB_URL;

      this.dbClient = await mongoose.connect(uri, {
        authSource: "admin",
        dbName: dbName,
      });

      if (process.env.NODE_ENV === "development") {
        mongoose.set("debug", true);
      }

      mongoose.connection.on("connected", () => {});

      mongoose.connection.on("error", () => {});

      mongoose.connection.on("disconnected", () => {});

      return this.dbClient;
    } catch (err) {
      throw err;
    }
  }

  /**
   * Returns the current database object for a specific database.
   *
   * @param {string} dbName - The name of the database.
   * @returns Get the current database object.
   */
  get() {
    if (!this.dbClient) {
      throw new Error("Database connection is not established.");
    }
    return this.dbClient;
  }

  /**
   * Close the current database connection for a specific database.
   *
   * @param {string} dbName - The name of the database to disconnect.
   */
  async close() {
    if (!this.dbClient) {
      return;
    }

    try {
      await mongoose.connection.close();
    } catch (err) {
      throw err;
    } finally {
      this.dbClient = null;
    }
  }

  /**
   * Close all database connections.
   */
  async closeAll() {
    if (this.dbClient) {
      await this.close();
    }
  }
}

module.exports = DatabaseManager;
