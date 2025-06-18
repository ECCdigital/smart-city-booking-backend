const { Bookable } = require("../entities/bookable/bookable");
const BookableModel = require("./models/bookableModel");

/**
 * Data Manager for Bookable objects.
 */
class BookableManager {
  /**
   * Get all bookables for a tenant
   * @param {string} tenantId Tenant ID
   * @returns {Promise<Bookable[]>} List of bookables
   */
  static async getBookables(tenantId) {
    const rawBookables = await BookableModel.find({ tenantId: tenantId });
    return rawBookables.map((doc) => doc.toEntity());
  }

  /**
   * Get a specific bookable
   * @param {string} id Bookable ID
   * @param {string} tenantId Tenant ID
   * @returns {Promise<Bookable|null>} Bookable or null
   */
  static async getBookable(id, tenantId) {
    const rawBookable = await BookableModel.findOne({
      id: id,
      tenantId: tenantId,
    });

    if (!rawBookable) {
      return null;
    }

    return rawBookable.toEntity();
  }

  /**
   * Get public bookables for a tenant
   * @param {string} tenantId Tenant ID
   * @returns {Promise<Bookable[]>} List of public bookables
   */
  static async getPublicBookables(tenantId) {
    const rawBookables = await BookableModel.find({
      tenantId: tenantId,
      isPublic: true,
      isBookable: true,
    });
    return rawBookables.map((doc) => doc.toEntity());
  }

  /**
   * Get bookables by type
   * @param {string} tenantId Tenant ID
   * @param {string} type Bookable type
   * @returns {Promise<Bookable[]>} List of bookables
   */
  static async getBookablesByType(tenantId, type) {
    const rawBookables = await BookableModel.find({
      tenantId: tenantId,
      type: type,
    });
    return rawBookables.map((doc) => doc.toEntity());
  }

  /**
   * Get bookables by event ID
   * @param {string} tenantId Tenant ID
   * @param {string} eventId Event ID
   * @returns {Promise<Bookable[]>} List of bookables
   */
  static async getEventBookables(tenantId, eventId) {
    const rawBookables = await BookableModel.find({
      tenantId: tenantId,
      eventId: eventId,
    });
    return rawBookables.map((doc) => doc.toEntity());
  }

  /**
   * Get bookables by owner
   * @param {string} tenantId Tenant ID
   * @param {string} ownerUserId Owner user ID
   * @returns {Promise<Bookable[]>} List of bookables
   */
  static async getOwnedBookables(tenantId, ownerUserId) {
    const rawBookables = await BookableModel.find({
      tenantId: tenantId,
      ownerUserId: ownerUserId,
    });
    return rawBookables.map((doc) => doc.toEntity());
  }

  /**
   * Get bookables by tags
   * @param {string} tenantId Tenant ID
   * @param {string[]} tags Array of tags
   * @returns {Promise<Bookable[]>} List of bookables
   */
  static async getBookablesByTags(tenantId, tags) {
    const rawBookables = await BookableModel.find({
      tenantId: tenantId,
      tags: { $in: tags },
    });
    return rawBookables.map((doc) => doc.toEntity());
  }

  /**
   * Search bookables by text
   * @param {string} tenantId Tenant ID
   * @param {string} searchText Search text
   * @returns {Promise<Bookable[]>} List of matching bookables
   */
  static async searchBookables(tenantId, searchText) {
    const rawBookables = await BookableModel.find({
      tenantId: tenantId,
      $or: [
        { title: { $regex: searchText, $options: "i" } },
        { description: { $regex: searchText, $options: "i" } },
        { tags: { $in: [new RegExp(searchText, "i")] } },
      ],
    });
    return rawBookables.map((doc) => doc.toEntity());
  }

  /**
   * Get related bookables (recursive lookup)
   * @param {string} id Bookable ID
   * @param {string} tenantId Tenant ID
   * @returns {Promise<Bookable[]>} List of related bookables
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
    ];

    const results = await BookableModel.aggregate(pipeline).exec();

    if (!results || results.length === 0) {
      return [];
    }

    const relatedBookables = results[0].allRelatedBookables || [];

    const uniqueMap = new Map();
    for (const bookable of relatedBookables) {
      uniqueMap.set(bookable.id, bookable);
    }

    return Array.from(uniqueMap.values())
      .map((obj) => BookableModel.hydrate(obj))
      .map((doc) => doc.toEntity());
  }

  /**
   * Get parent bookables (bookables that reference this one)
   * @param {string} id Bookable ID
   * @param {string} tenantId Tenant ID
   * @returns {Promise<Bookable[]>} List of parent bookables
   */
  static async getParentBookables(id, tenantId) {
    const rawBookables = await BookableModel.find({
      tenantId: tenantId,
      relatedBookableIds: { $in: [id] },
    });
    return rawBookables.map((doc) => doc.toEntity());
  }

  /**
   * Store a bookable (create or update)
   * @param {Bookable|Object} bookable Bookable to store
   * @param {boolean} upsert Whether to create if not exists
   * @returns {Promise<Bookable>} The stored bookable
   */
  static async storeBookable(bookable, upsert = true) {
    const bookableEntity =
      bookable instanceof Bookable ? bookable : new Bookable(bookable);

    bookableEntity.validate();

    await BookableModel.updateOne(
      { id: bookableEntity.id, tenantId: bookableEntity.tenantId },
      bookableEntity,
      { upsert: upsert },
    );

    return bookableEntity;
  }

  /**
   * Remove a bookable
   * @param {string} id Bookable ID
   * @param {string} tenantId Tenant ID
   * @returns {Promise<void>}
   */
  static async removeBookable(id, tenantId) {
    await BookableModel.deleteOne({ id: id, tenantId: tenantId });
  }

  /**
   * Check public bookable count limit
   * @param {string} tenantId Tenant ID
   * @returns {Promise<boolean>} True if under limit
   */
  static async checkPublicBookableCount(tenantId) {
    const maxBookables = parseInt(process.env.MAX_BOOKABLES, 10);
    if (!maxBookables) return true;

    const count = await BookableModel.countDocuments({
      tenantId: tenantId,
      isPublic: true,
    });

    return count < maxBookables;
  }

  /**
   * Get bookables with custom filter
   * @param {string} tenantId Tenant ID
   * @param {Object} filter MongoDB filter object
   * @returns {Promise<Bookable[]>} Filtered bookables
   */
  static async getBookablesCustomFilter(tenantId, filter) {
    const rawBookables = await BookableModel.find({
      tenantId: tenantId,
      ...filter,
    });
    return rawBookables.map((doc) => doc.toEntity());
  }

  /**
   * Get bookable statistics
   * @param {string} tenantId Tenant ID
   * @returns {Promise<Object>} Statistics object
   */
  static async getBookableStats(tenantId) {
    const pipeline = [
      { $match: { tenantId: tenantId } },
      {
        $group: {
          _id: null,
          total: { $sum: 1 },
          public: { $sum: { $cond: ["$isPublic", 1, 0] } },
          bookable: { $sum: { $cond: ["$isBookable", 1, 0] } },
          byType: { $push: "$type" },
        },
      },
    ];

    const results = await BookableModel.aggregate(pipeline).exec();

    if (!results || results.length === 0) {
      return { total: 0, public: 0, bookable: 0, byType: {} };
    }

    const stats = results[0];

    const typeCount = {};
    stats.byType.forEach((type) => {
      typeCount[type] = (typeCount[type] || 0) + 1;
    });

    return {
      total: stats.total,
      public: stats.public,
      bookable: stats.bookable,
      byType: typeCount,
    };
  }
}

module.exports = { BookableManager };
