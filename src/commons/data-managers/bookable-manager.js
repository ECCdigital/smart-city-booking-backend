const { Bookable } = require("../entities/bookable");
const BookableModel = require("./models/bookableModel");

/**
 * Data Manager for Bookable objects.
 */
class BookableManager {
  /**
   * Get all bookables related to a tenant
   * @param {string} tenantId Identifier of the tenant
   * @returns List of bookings
   */
  static async getBookables(tenantId) {
    const rawBookables = await BookableModel.find({ tenantId: tenantId });
    return rawBookables.map((rb) => new Bookable(rb));
  }

  /**
   * Get a specific bookable object from the database.
   *
   * @param {string} id Logical identifier of the bookable object
   * @param {string} tenantId Identifier of the tenant
   * @returns A single bookable object
   */
  static async getBookable(id, tenantId) {
    const rawBookable = await BookableModel.findOne({
      id: id,
      tenantId: tenantId,
    });
    if (!rawBookable) {
      return null;
    }
    return new Bookable(rawBookable);
  }

  /**
   * Insert or update a bookable object into the database.
   *
   * @param {Bookable} bookable The bookable object to be stored.
   * @param {boolean} upsert true, if new object should be inserted. Default: true
   * @returns Promise<>
   */
  static async storeBookable(bookable, upsert = true) {
    await BookableModel.updateOne(
      { id: bookable.id, tenantId: bookable.tenantId },
      bookable,
      { upsert: upsert },
    );
  }

  /**
   * Remove a bookable object from the database.
   *
   * @returns Promise<>
   * @param id The id of the bookable to remove
   * @param tenantId The tenant of the bookable to remove
   */
  static async removeBookable(id, tenantId) {
    await BookableModel.deleteOne({ id: id, tenantId: tenantId });
  }

  /**
   * Get all related bookables for a given bookable ID and tenant.
   *
   * @param {string} id - The ID of the bookable.
   * @param {string} tenantId - The tenant identifier.
   * @returns {Promise<Bookable[]>} - A promise that resolves to an array of related bookable objects.
   */
  static async getRelatedBookables(id, tenantId) {
    const pipeline = [
      {
        $match: {
          id: id,
          tenantId: tenantId,
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

    const results = await BookableModel.aggregate(pipeline).exec();

    if (!results || results.length === 0) {
      return [];
    }

    const doc = results[0];

    let combined = [...doc.allRelatedBookables];

    const uniqueMap = new Map();
    for (const b of combined) {
      uniqueMap.set(b.id, b);
    }
    combined = [...uniqueMap.values()];

    return combined.map((b) => new Bookable(b));
  }

  static async getParentBookables(id, tenantId) {
    let pBookables = await getAllParents(id, tenantId, [], 0);
    pBookables = pBookables.flat(Infinity);

    // remove duplicates from related bookables
    pBookables = pBookables.filter((b, i) => {
      return pBookables.findIndex((b2) => b2.id === b.id) === i;
    });

    return pBookables;
  }

  static async checkPublicBookableCount(tenantId) {
    const maxBookables = parseInt(process.env.MAX_BOOKABLES, 10);
    const count = await BookableModel.countDocuments({
      tenantId: tenantId,
      isPublic: true,
    });
    return !(maxBookables && count >= maxBookables);
  }
}

async function getAllParents(id, tenantId, parentBookables, depth) {
  if (depth < 5) {
    const rawBookables = await BookableModel.find({
      relatedBookableIds: { $in: [id] },
      tenantId: tenantId,
    });

    for (const rb of rawBookables) {
      parentBookables.push(new Bookable(rb));
      parentBookables = parentBookables.concat(
        await getAllParents(rb.id, rb.tenantId, parentBookables, depth + 1),
      );
    }

    // remove duplicates from related bookables
    parentBookables = parentBookables.filter((b, i) => {
      return parentBookables.findIndex((b2) => b2.id === b.id) === i;
    });
  }
  return parentBookables;
}

module.exports = { BookableManager, BookableModel };
