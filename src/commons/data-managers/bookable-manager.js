const validate = require("jsonschema").validate;

const { Bookable } = require("../entities/bookable");
const dbm = require("../utilities/database-manager");

/**
 * Data Manager for Bookable objects.
 */
class BookableManager {
  /**
   * Check if an object is a valid Bookable.
   *
   * @param {object} bookable A bookable object
   * @returns true, if the object is a valid bookable object
   */
  static validateBookable(bookable) {
    const schema = require("../schemas/bookable.schema.json");
    return validate(bookable, schema).errors.length === 0;
  }

  /**
   * Get all bookables related to a tenant
   * @param {string} tenant Identifier of the tenant
   * @returns List of bookings
   */
  static getBookables(tenant) {
    return new Promise((resolve, reject) => {
      dbm
        .get()
        .collection("bookables")
        .find({ tenant: tenant })
        .toArray()
        .then((rawBookables) => {
          const bookables = rawBookables.map((rb) => {
            return Object.assign(new Bookable(), rb);
          });
          resolve(bookables);
        })
        .catch((err) => reject(err));
    });
  }

  /**
   * Get a specific bookable object from the database.
   *
   * @param {string} id Logical identifier of the bookable object
   * @param {string} tenant Identifier of the tenant
   * @returns A single bookable object
   */
  static getBookable(id, tenant) {
    return new Promise((resolve, reject) => {
      dbm
        .get()
        .collection("bookables")
        .findOne({ id: id, tenant: tenant })
        .then((rawBookable) => {
          const bookable = Object.assign(new Bookable(), rawBookable);
          resolve(bookable);
        })
        .catch((err) => reject(err));
    });
  }

  /**
   * Insert or update a bookable object into the database.
   *
   * @param {Bookable} bookable The bookable object to be stored.
   * @param {boolean} upsert true, if new object should be inserted. Default: true
   * @returns Promise<>
   */
  static async storeBookable(bookable, upsert = true) {
    try {
      const bookablesCollection = dbm.get().collection("bookables");

      await bookablesCollection.replaceOne(
        { id: bookable.id, tenant: bookable.tenant },
        bookable,
        { upsert: upsert },
      );
    } catch (err) {
      throw new Error(`Error storing bookable: ${err.message}`);
    }
  }

  /**
   * Remove a bookable object from the database.
   *
   * @returns Promise<>
   * @param id The id of the bookable to remove
   * @param tenant The tenant of the bookable to remove
   */
  static removeBookable(id, tenant) {
    return new Promise((resolve, reject) => {
      dbm
        .get()
        .collection("bookables")
        .deleteOne({ id: id, tenant: tenant })
        .then(() => resolve())
        .catch((err) => reject(err));
    });
  }

  /**
   * Get all related bookables for a given bookable ID and tenant.
   *
   * @param {string} id - The ID of the bookable.
   * @param {string} tenant - The tenant identifier.
   * @returns {Promise<Bookable[]>} - A promise that resolves to an array of related bookable objects.
   */
  static async getRelatedBookables(id, tenant) {
    const pipeline = [
      {
        $match: {
          id: id,
          tenant: tenant,
        },
      },
      {
        $graphLookup: {
          from: "bookables",
          startWith: "$relatedBookableIds",
          connectFromField: "relatedBookableIds",
          connectToField: "id",
          as: "allRelatedBookables",
          maxDepth: 100,
        },
      },
      {
        $project: {
          rootBookable: "$$ROOT",
          allRelatedBookables: 1,
          _id: 0,
        },
      },
    ];

    const results = await dbm
      .get()
      .collection("bookables")
      .aggregate(pipeline)
      .toArray();

    if (!results || results.length === 0) {
      return [];
    }

    const doc = results[0];

    let combined = [doc.rootBookable, ...doc.allRelatedBookables];

    const uniqueMap = new Map();
    for (const b of combined) {
      uniqueMap.set(b.id, b);
    }
    combined = [...uniqueMap.values()];

    return combined.map((b) => Object.assign(new Bookable(), b));
  }

  static async getParentBookables(id, tenant) {
    let pBookables = await getAllParents(id, tenant, [], 0);
    pBookables = pBookables.flat(Infinity);

    // remove duplicates from related bookables
    pBookables = pBookables.filter((b, i) => {
      return pBookables.findIndex((b2) => b2.id === b.id) === i;
    });

    return pBookables;
  }

  static async checkPublicBookableCount(tenant) {
    const maxBookables = parseInt(process.env.MAX_BOOKABLES, 10);
    const count = await dbm
      .get()
      .collection("bookables")
      .countDocuments({ tenant: tenant, isPublic: true });
    return !(maxBookables && count >= maxBookables);
  }
}

async function getAllParents(id, tenant, parentBookables, depth) {
  if (depth < 5) {
    let bookables = await dbm
      .get()
      .collection("bookables")
      .find({ relatedBookableIds: { $in: [id] }, tenant: tenant })
      .toArray();

    for (const b of bookables) {
      parentBookables.push(Object.assign(new Bookable(), b));
      parentBookables = parentBookables.concat(
        await getAllParents(b.id, b.tenant, parentBookables, depth + 1),
      );
    }

    // remove duplicates from related bookables
    parentBookables = parentBookables.filter((b, i) => {
      return parentBookables.findIndex((b2) => b2.id === b.id) === i;
    });
  }
  return parentBookables;
}

module.exports = BookableManager;
