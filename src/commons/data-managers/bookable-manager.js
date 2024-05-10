var validate = require("jsonschema").validate;

const { Bookable } = require("../entities/bookable");
var dbm = require("../utilities/database-manager");

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
    var schema = require("../schemas/bookable.schema.json");
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
          var bookables = rawBookables.map((rb) => {
            var bookable = Object.assign(new Bookable(), rb);
            return bookable;
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
          var bookable = Object.assign(new Bookable(), rawBookable);
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
  static storeBookable(bookable, upsert = true) {
    return new Promise((resolve, reject) => {
      dbm
        .get()
        .collection("bookables")
        .replaceOne({ id: bookable.id, tenant: bookable.tenant }, bookable, {
          upsert: upsert,
        })
        .then(() => resolve())
        .catch((err) => reject(err));
    });
  }

  /**
   * Remove a bookable object from the database.
   *
   * @param {Bookable} bookable The bookable object to be stored.
   * @param {boolean} upsert true, if new object should be inserted. Default: true
   * @returns Promise<>
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

  static async getRelatedBookables(id, tenant, d) {
    let bookable = await BookableManager.getBookable(id, tenant);

    let relatedBookables = await dbm
      .get()
      .collection("bookables")
      .find({ id: { $in: bookable.relatedBookableIds || [] } })
      .toArray();

    if (d < 100) {
      for (const b of relatedBookables) {
        relatedBookables = relatedBookables.concat(
          await BookableManager.getRelatedBookables(
            b.id,
            b.tenant,
            (d || 0) + 1,
          ),
        );
      }
    }
    // remove duplicates from related bookables
    relatedBookables = relatedBookables.filter((b, i) => {
      return relatedBookables.findIndex((b2) => b2.id === b.id) === i;
    });

    // cast bookables to Bookable objects
    relatedBookables = relatedBookables.map((b) => {
      return Object.assign(new Bookable(), b);
    });

    return relatedBookables;
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
