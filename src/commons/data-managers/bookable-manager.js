const { Bookable } = require("../entities/bookable/bookable");
const BookableModel = require("./models/bookableModel");
const {
  CustomFieldCache,
} = require("../services/custom-field/custom-field-cache");
const {
  CustomFieldService,
} = require("../services/custom-field/custom-field-service");
const InstanceModel = require("./models/instanceModel");
const TenantModel = require("./models/tenantModel");
const { ownCondition, DOMAIN } = require("../services/authorization/reach");
const { REACH } = require("../services/authorization/policy");
const EventManager = require("./event-manager");
const projection = require("../services/supervision/public-projection");
const {
  REVIEW_STATUS,
} = require("../services/supervision/supervision-constants");

/**
 * Data Manager for Bookable objects.
 */
class BookableManager {
  static async getCustomFieldDefinitions(tenantId) {
    let instanceFields = CustomFieldCache.getInstanceFields();
    if (!instanceFields) {
      const instance = await InstanceModel.findOne(
        {},
        { bookableCustomFields: 1 },
      ).lean();
      instanceFields = instance?.bookableCustomFields || [];
      CustomFieldCache.setInstanceFields(instanceFields);
    }

    let tenantFields = CustomFieldCache.getTenantFields(tenantId);
    if (!tenantFields) {
      const tenant = await TenantModel.findOne(
        { id: tenantId },
        { bookableCustomFields: 1 },
      ).lean();
      tenantFields = tenant?.bookableCustomFields || [];
      CustomFieldCache.setTenantFields(tenantId, tenantFields);
    }

    return { instanceFields, tenantFields };
  }

  static _toEntitiesWithCustomFields(docs, customFieldDefs) {
    return docs.map((doc) => doc.toEntity(customFieldDefs));
  }

  static _toEntityWithCustomFields(doc, customFieldDefs) {
    return doc ? doc.toEntity(customFieldDefs) : null;
  }

  /**
   * Remove stored custom field values for the given field IDs.
   * @param {string[]} fieldIds Custom field IDs to remove from bookables
   * @param {{ tenantId?: string, bookableId?: string }} [scope] Optional scope
   * @returns {Promise<void>}
   */
  static async removeCustomFieldValues(fieldIds, scope = {}) {
    if (!Array.isArray(fieldIds) || fieldIds.length === 0) {
      return;
    }

    const filter = {};
    if (scope.tenantId) {
      filter.tenantId = scope.tenantId;
    }
    if (scope.bookableId) {
      filter.id = scope.bookableId;
    }

    await BookableModel.updateMany(filter, {
      $pull: { customFieldValues: { fieldId: { $in: fieldIds } } },
    });
  }

  /**
   * The bookables of a tenant within a reach (ADR 0002, ADR 0003): under
   * `public` the public's list - what the public projection lists of the
   * tenant's bookables (`listed`), which throws `tenant_not_found` for a
   * tenant without one; under every other reach the own condition in the
   * query.
   *
   * @param {string} tenantId
   * @param {{reach: string, userId?: string|null}} scope
   * @param {(condition: Object) => Promise<Object[]>} find The query over
   *   the tenant's bookables, given the condition to add
   * @returns {Promise<Bookable[]>} Entities, projected under `public`
   */
  static async _within(tenantId, scope, find) {
    if (scope?.reach === REACH.PUBLIC) {
      return projection.listed(tenantId, await find({}));
    }
    return find(ownCondition("bookable", scope));
  }

  /** As `_within`, for a method that names ids: the direct-link rule. */
  static async _reachedWithin(tenantId, scope, find) {
    if (scope?.reach === REACH.PUBLIC) {
      return projection.reached(tenantId, await find({}));
    }
    return find(ownCondition("bookable", scope));
  }

  /**
   * Get all bookables for a tenant
   * @param {string} tenantId Tenant ID
   * @param {{reach: string, userId?: string|null}} scope The reach the
   *   caller reads under (ADR 0002): `own` narrows to the user's own,
   *   `public` to the public's list (ADR 0003), the domain says
   *   `DOMAIN`; none is a programming error
   * @param {Object} [options]
   * @param {boolean} [options.populate=false] Carry the event and the
   *   related bookables of each bookable as `_populated`, read by the
   *   domain: a bookable within reach brings its dependents along
   * @returns {Promise<Bookable[]>} List of bookables
   */
  static async getBookables(tenantId, scope, { populate = false } = {}) {
    const defs = await this.getCustomFieldDefinitions(tenantId);
    const bookables = await BookableManager._within(
      tenantId,
      scope,
      async (condition) =>
        this._toEntitiesWithCustomFields(
          await BookableModel.find({ tenantId, ...condition }),
          defs,
        ),
    );
    if (populate) {
      for (const bookable of bookables) {
        await BookableManager._populate(bookable);
      }
    }
    return bookables;
  }

  /**
   * The dependents of a bookable the caller may embed: its event and its
   * related bookables, read by the domain (ADR 0002).
   *
   * @param {Bookable} bookable
   * @returns {Promise<void>}
   */
  static async _populate(bookable) {
    bookable._populated = {
      event: await EventManager.getEvent(
        bookable.eventId,
        bookable.tenantId,
        DOMAIN,
      ),
      relatedBookables: await BookableManager.getRelatedBookables(
        bookable.id,
        bookable.tenantId,
        DOMAIN,
      ),
    };
  }

  /**
   * Get a specific bookable
   * @param {string} id Bookable ID
   * @param {string} tenantId Tenant ID
   * @param {{reach: string, userId?: string|null}} scope The reach the
   *   caller reads under (ADR 0002): `own` narrows to the user's own,
   *   `public` to what the public reaches by a direct link (ADR 0003),
   *   the domain says `DOMAIN`; none is a programming error
   * @param {Object} [options]
   * @param {boolean} [options.populate=false] As of `getBookables`
   * @returns {Promise<Bookable|null>} Bookable or null
   */
  static async getBookable(id, tenantId, scope, { populate = false } = {}) {
    const defs = await this.getCustomFieldDefinitions(tenantId);
    const [bookable = null] = await BookableManager._reachedWithin(
      tenantId,
      scope,
      async (condition) => {
        const raw = await BookableModel.findOne({ id, tenantId, ...condition });
        return raw ? [this._toEntityWithCustomFields(raw, defs)] : [];
      },
    );
    if (bookable && populate) {
      await BookableManager._populate(bookable);
    }
    return bookable;
  }

  /**
   * Get bookables by their IDs - a direct link each (ADR 0003): under
   * `public` what the public reaches of them.
   * @param {string} tenantId - The ID of the tenant.
   * @param {string[]} ids - An array of bookable IDs.
   * @param {{reach: string, userId?: string|null}} scope As of `getBookable`
   * @returns {Promise<Bookable[]>} - A promise that resolves to a list of bookables.
   */
  static async getBookablesByIds(tenantId, ids, scope) {
    if (!ids?.length) return [];

    return BookableManager._reachedWithin(tenantId, scope, async (condition) =>
      (
        await BookableModel.find({
          tenantId: tenantId,
          id: { $in: ids },
          ...condition,
        })
      ).map((doc) => doc.toEntity()),
    );
  }

  /**
   * Batch-load bookables with merged custom field definitions.
   * @param {string} tenantId
   * @param {string[]} ids
   * @returns {Promise<Bookable[]>}
   */
  static async getBookablesByIdsWithCustomFields(tenantId, ids) {
    if (!ids?.length) return [];

    const [rawBookables, defs] = await Promise.all([
      BookableModel.find({
        tenantId: tenantId,
        id: { $in: ids },
      }),
      this.getCustomFieldDefinitions(tenantId),
    ]);

    return this._toEntitiesWithCustomFields(rawBookables, defs);
  }

  /**
   * Get bookables by type - a list (ADR 0003).
   * @param {string} tenantId Tenant ID
   * @param {string} type Bookable type
   * @param {{reach: string, userId?: string|null}} scope As of `getBookables`
   * @returns {Promise<Bookable[]>} List of bookables
   */
  static async getBookablesByType(tenantId, type, scope) {
    return BookableManager._within(tenantId, scope, async (condition) =>
      (await BookableModel.find({ tenantId, type, ...condition })).map((doc) =>
        doc.toEntity(),
      ),
    );
  }

  /**
   * Get bookables by event ID - the tickets of an event, a list (ADR 0003).
   * @param {string} tenantId Tenant ID
   * @param {string} eventId Event ID
   * @param {{reach: string, userId?: string|null}} scope As of `getBookables`
   * @returns {Promise<Bookable[]>} List of bookables
   */
  static async getEventBookables(tenantId, eventId, scope) {
    return BookableManager._within(tenantId, scope, async (condition) =>
      (await BookableModel.find({ tenantId, eventId, ...condition })).map(
        (doc) => doc.toEntity(),
      ),
    );
  }

  /**
   * Get related bookables (recursive lookup) - an embedded list (ADR
   * 0003): under `public` what the public projection lists of them.
   * @param {string} id Bookable ID
   * @param {string} tenantId Tenant ID
   * @param {{reach: string, userId?: string|null}} scope As of `getBookables`
   * @returns {Promise<Bookable[]>} List of related bookables
   */
  static async getRelatedBookables(id, tenantId, scope) {
    return BookableManager._within(tenantId, scope, async (condition) =>
      BookableManager._graph(id, tenantId, condition, {
        startWith: "$relatedBookableIds",
        connectFromField: "relatedBookableIds",
        connectToField: "id",
      }),
    );
  }

  /**
   * The bookables a graph lookup from one bookable reaches, without
   * duplicates and without the bookable itself, as entities.
   *
   * @param {string} id
   * @param {string} tenantId
   * @param {Object} condition The reach's condition on the reached bookables
   * @param {{startWith: string, connectFromField: string, connectToField: string}} lookup
   * @returns {Promise<Bookable[]>}
   */
  static async _graph(id, tenantId, condition, lookup) {
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
          ...lookup,
          as: "reached",
          maxDepth: 100,
          restrictSearchWithMatch: { tenantId: tenantId, ...condition },
        },
      },
    ];

    const results = await BookableModel.aggregate(pipeline).exec();

    if (!results || results.length === 0) {
      return [];
    }

    const uniqueMap = new Map();
    for (const bookable of results[0].reached || []) {
      if (bookable.id !== id) {
        uniqueMap.set(bookable.id, bookable);
      }
    }

    return Array.from(uniqueMap.values())
      .map((obj) => BookableModel.hydrate(obj))
      .map((doc) => doc.toEntity());
  }

  /**
   * Get all bookables of a tenant that have at least one active access point
   * configured. Used as the (small) seed set for resolving which bookings
   * grant an access authorization.
   * @param {string} tenantId Tenant ID
   * @param {{reach: string, userId?: string|null}} scope As of `getBookables`
   * @returns {Promise<Bookable[]>} Bookables with active access points
   */
  static async getBookablesWithAccessPoints(tenantId, scope) {
    const rawBookables = await BookableModel.find({
      tenantId: tenantId,
      "accessPointDetails.active": true,
      "accessPointDetails.accessPointIds.0": { $exists: true },
      ...ownCondition("bookable", scope),
    });
    return rawBookables.map((doc) => doc.toEntity());
  }

  /**
   * Get all bookables of a tenant that expose a specific access point (by id)
   * via their active access point configuration. Several bookables may
   * reference the same access point, e.g. a main entrance shared by rooms.
   * @param {string} tenantId Tenant ID
   * @param {string} accessPointId Access point ID
   * @param {{reach: string, userId?: string|null}} scope As of `getBookables`
   * @returns {Promise<Bookable[]>} Bookables exposing the access point
   */
  static async getBookablesByAccessPointId(tenantId, accessPointId, scope) {
    const rawBookables = await BookableModel.find({
      tenantId: tenantId,
      "accessPointDetails.active": true,
      "accessPointDetails.accessPointIds": accessPointId,
      ...ownCondition("bookable", scope),
    });
    return rawBookables.map((doc) => doc.toEntity());
  }

  /**
   * Remove an access point reference from every bookable of a tenant. Called
   * when the access point itself is deleted, so no bookable is left pointing at
   * an access point that no longer exists.
   * @param {string} tenantId Tenant ID
   * @param {string} accessPointId Access point ID
   * @returns {Promise<void>}
   */
  static async detachAccessPoint(tenantId, accessPointId) {
    await BookableModel.updateMany(
      {
        tenantId: tenantId,
        "accessPointDetails.accessPointIds": accessPointId,
      },
      {
        $pull: { "accessPointDetails.accessPointIds": accessPointId },
      },
    );
  }

  /**
   * Get parent bookables (bookables that reference this one) - an embedded
   * list (ADR 0003).
   * @param {string} id Bookable ID
   * @param {string} tenantId Tenant ID
   * @param {{reach: string, userId?: string|null}} scope As of `getBookables`
   * @returns {Promise<Bookable[]>} List of parent bookables
   */
  static async getParentBookables(id, tenantId, scope) {
    return BookableManager._within(tenantId, scope, async (condition) =>
      (
        await BookableModel.find({
          tenantId: tenantId,
          relatedBookableIds: { $in: [id] },
          ...condition,
        })
      ).map((doc) => doc.toEntity()),
    );
  }

  /**
   * Get all ancestor bookables recursively (parents, grandparents, ...) -
   * an embedded list (ADR 0003).
   * @param {string} id Bookable ID
   * @param {string} tenantId Tenant ID
   * @param {{reach: string, userId?: string|null}} scope As of `getBookables`
   * @returns {Promise<Bookable[]>} List of ancestors without duplicates
   */
  static async getAncestorBookables(id, tenantId, scope) {
    return BookableManager._within(tenantId, scope, async (condition) =>
      BookableManager._graph(id, tenantId, condition, {
        startWith: "$id",
        connectFromField: "id",
        connectToField: "relatedBookableIds",
      }),
    );
  }

  /**
   * Get all parent bookables (recursive lookup).
   * Alias of {@link BookableManager.getAncestorBookables}.
   * @param {string} id Bookable ID
   * @param {string} tenantId Tenant ID
   * @param {{reach: string, userId?: string|null}} scope As of `getBookables`
   * @returns {Promise<Bookable[]>} List of parent bookables
   */
  static async getAllParentBookables(id, tenantId, scope) {
    return BookableManager.getAncestorBookables(id, tenantId, scope);
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

    const existingBookable = await BookableModel.findOne(
      { id: bookableEntity.id, tenantId: bookableEntity.tenantId },
      { customFieldDefinitions: 1 },
    ).lean();

    CustomFieldService.normalizeDefinitions(
      bookableEntity.customFieldDefinitions || [],
    );

    bookableEntity.validate();

    // The review (glossary "Prüfstatus") belongs to `updateReview` alone
    // once the bookable exists: a whole-bookable write carries it on
    // insert only, so an edit or a stale copy never undoes a decision.
    const update = { ...bookableEntity };
    if (existingBookable) {
      delete update.review;
    }

    await BookableModel.updateOne(
      { id: bookableEntity.id, tenantId: bookableEntity.tenantId },
      update,
      { upsert: upsert },
    );

    const removedFieldIds = CustomFieldService.getRemovedFieldIds(
      existingBookable?.customFieldDefinitions || [],
      bookableEntity.customFieldDefinitions || [],
    );
    if (removedFieldIds.length > 0) {
      await BookableManager.removeCustomFieldValues(removedFieldIds, {
        tenantId: bookableEntity.tenantId,
        bookableId: bookableEntity.id,
      });
    }

    return bookableEntity;
  }

  /**
   * Writes the review of a bookable, conditional on the review status it
   * was read at: the write of a review transition (tenant supervision
   * spec §4). Touches no other field.
   *
   * @param {Object} params
   * @param {string} params.tenantId
   * @param {string} params.id Bookable ID
   * @param {string|null} params.expectedStatus The status the transition
   *   starts from; null matches a bookable without a review as well
   * @param {Object} params.review The review to store
   * @returns {Promise<Bookable|null>} The bookable after the write, or
   *   null when no bookable of the tenant is at the expected status
   */
  static async updateReview({ tenantId, id, expectedStatus, review }) {
    const raw = await BookableModel.findOneAndUpdate(
      { id, tenantId, "review.status": expectedStatus ?? null },
      { $set: { review } },
      { new: true },
    );
    return raw ? raw.toEntity() : null;
  }

  /**
   * The bookables of a tenant at one review status (glossary
   * "Prüfstatus"), whatever their publication wish - the offers a level
   * change or the review queue asks for. Longest waiting first.
   *
   * @param {string} tenantId Tenant ID
   * @param {string|null} status One of `REVIEW_STATUS`; null matches a
   *   bookable without a review as well
   * @returns {Promise<Bookable[]>} The bookables, by `review.submittedAt`
   *   ascending, then by id
   */
  static async getOffersByReviewStatus(tenantId, status, scope) {
    const rawBookables = await BookableModel.find({
      tenantId,
      "review.status": status ?? null,
      ...ownCondition("bookable", scope),
    }).sort({ "review.submittedAt": 1, id: 1 });
    return rawBookables.map((doc) => doc.toEntity());
  }

  /**
   * The bookables of a set of tenants that wait for a decision
   * (glossary "Aktive Prüfliste"), across tenants and reduced to what a
   * queue row reads - never the whole bookable.
   *
   * @param {string[]} tenantIds The tenants to read from
   * @param {{reach: string, userId?: string|null}} scope As of `getBookables`
   * @returns {Promise<Array<{id: string, tenantId: string, title: string, type: string, isPublic: boolean, review: Object}>>}
   *   Plain rows, by `review.submittedAt` ascending, then by id
   */
  static async getPendingReviewOffers(tenantIds, scope) {
    return BookableModel.find(
      {
        tenantId: { $in: tenantIds },
        "review.status": REVIEW_STATUS.PENDING,
        ...ownCondition("bookable", scope),
      },
      { _id: 0, id: 1, tenantId: 1, title: 1, type: 1, isPublic: 1, review: 1 },
    )
      .sort({ "review.submittedAt": 1, id: 1 })
      .lean();
  }

  /**
   * How many bookables a tenant has, whatever their publication wish or
   * review status - the offer count of the tenant approval queue.
   *
   * @param {string} tenantId Tenant ID
   * @returns {Promise<number>}
   */
  static async countBookables(tenantId) {
    return BookableModel.countDocuments({ tenantId });
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
   * Find the bookables that reference a medium — its image list or one of its
   * attachments. The usage proof is searched on demand (§4.7 of the media
   * spec); a medium never carries a back reference.
   *
   * @param {string} tenantId Tenant ID
   * @param {string} mediaId ID of the medium
   * @returns {Promise<Array<{id: string, title: string}>>} Usage sites
   */
  static async getMediaUsage(tenantId, mediaId) {
    if (!mediaId) {
      return [];
    }

    const docs = await BookableModel.find(
      {
        tenantId: tenantId,
        $or: [
          { "images.mediaId": mediaId },
          { "attachments.reference.mediaId": mediaId },
        ],
      },
      { id: 1, title: 1 },
    ).lean();

    return docs.map((doc) => ({ id: doc.id, title: doc.title || "" }));
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

  static async reassignOwnerUserId(previousUserId, newUserId, session = null) {
    const options = session ? { session } : {};
    await BookableModel.updateMany(
      { ownerUserId: previousUserId },
      { $set: { ownerUserId: newUserId } },
      options,
    );
  }
}

module.exports = { BookableManager };
