const MongoClient = require( 'mongodb' ).MongoClient;

var db;
var dbClient;


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

        
        return new Promise((resolve, reject) => {
            MongoClient.connect(dbUrl, { useNewUrlParser: true }).then(client => {
                dbClient = client;
                db = client.db(dbName);
                resolve(db);
            }).catch(err => {
                console.error('Could not establish connection to database.', err);
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
        console.log('Closing connection to database.');
        dbClient.close();
    }

}

module.exports = DatabaseManager;