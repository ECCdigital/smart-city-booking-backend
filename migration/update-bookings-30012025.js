require("dotenv").config();

const MongoClient = require("mongodb").MongoClient;


const [,, dbURI, dbName] = process.argv;

/**
 * Migrates the bookings collection by updating the paymentProvider field
 * and setting the paymentMethod field to null for bookings with specific payment methods.
 *
 * @async
 * @function migrate
 * @returns {Promise<number>} - A promise that resolves when the migration is complete.
 */
async function migrate(dbURI, dbName) {
  const uri = dbURI || process.env.DB_URL;
  const name = dbName || process.env.MONGODB_DB_NAME;

  const dbClient = await MongoClient.connect(uri);
  const db = dbClient.db(name);

  try {
    let count = 0;

    const bookings = db.collection("bookings");

    const cursor1 = bookings.find({
      paymentMethod: { $in: ["giroCockpit", "invoice"] },
    });
    while (await cursor1.hasNext()) {
      count++;
      const booking = await cursor1.next();
      await bookings.updateOne(
        { _id: booking._id },
        {
          $set: { paymentProvider: booking.paymentMethod, paymentMethod: null },
        },
      );
    }
    return count;
  } catch (err) {
    throw err;
  } finally {
    await dbClient.close();
  }
}

migrate(dbURI, dbName)
  .then((count) => {
    console.log(`Migration completed. ${count} bookings updated.`);
  })
  .catch((err) => {
    console.error("Migration failed:", err);
  });