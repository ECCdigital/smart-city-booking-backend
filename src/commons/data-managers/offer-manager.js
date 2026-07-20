const Offer = require("../entities/company/offer");
const OfferModel = require("./models/offerModel");
const { escapeRegex } = require("../utilities/regexUtils");

const DEFAULT_SEARCH_LIMIT = 50;
// generous cap so the map can render every matching marker (client paginates)
const MAX_SEARCH_LIMIT = 2000;

// sortable moderation fields (stored on the offer; no cross-collection sorts)
const MODERATION_SORT_FIELDS = ["title", "created", "publishedAt", "views"];

function moderationSortSpec(filters) {
  const field = MODERATION_SORT_FIELDS.includes(filters.sort)
    ? filters.sort
    : "created";
  const dir = filters.dir === "asc" ? 1 : -1;
  // secondary key keeps pagination stable when the primary has ties
  return field === "created" ? { created: dir } : { [field]: dir, created: -1 };
}

class OfferManager {
  static async getOffersByCompany(tenantId, companyId) {
    const raw = await OfferModel.find({ tenantId, companyId }).sort({
      created: -1,
    });
    return raw.map((doc) => doc.toEntity());
  }

  static async getOffer(tenantId, id) {
    const raw = await OfferModel.findOne({ tenantId, id });
    if (!raw) {
      return null;
    }
    return raw.toEntity();
  }

  static async getOffersByIds(tenantId, ids) {
    if (!Array.isArray(ids) || ids.length === 0) {
      return [];
    }
    const raw = await OfferModel.find({ tenantId, id: { $in: ids } });
    return raw.map((doc) => doc.toEntity());
  }

  static async storeOffer(offer, upsert = true) {
    const entity = offer instanceof Offer ? offer : new Offer(offer);
    entity.validate();
    // pass a copy: Mongoose mutates the update object with $setOnInsert on upsert
    await OfferModel.updateOne(
      { id: entity.id, tenantId: entity.tenantId },
      { ...entity },
      { upsert, runValidators: true },
    );
    return entity;
  }

  static async removeOffer(tenantId, id) {
    await OfferModel.deleteOne({ tenantId, id });
  }

  static async incrementViews(tenantId, id) {
    await OfferModel.updateOne({ tenantId, id }, { $inc: { views: 1 } });
  }

  static async countByBranch(tenantId, companyId, branchId) {
    return OfferModel.countDocuments({ tenantId, companyId, branchId });
  }

  static async listForModeration(tenantId, filters = {}) {
    const query = {
      tenantId,
      status: { $in: ["In Prüfung", "Online", "Archiv"] },
    };
    if (
      filters.status &&
      ["In Prüfung", "Online", "Archiv"].includes(filters.status)
    ) {
      query.status = filters.status;
    }
    if (filters.industryId) {
      query.industryId = filters.industryId;
    }
    if (filters.q) {
      query.title = { $regex: escapeRegex(filters.q), $options: "i" };
    }
    // opt-in pagination: with `limit` → page + total, else the full list
    if (Number.isFinite(filters.limit) && filters.limit > 0) {
      const total = await OfferModel.countDocuments(query);
      const raw = await OfferModel.find(query)
        .sort(moderationSortSpec(filters))
        .skip(filters.offset || 0)
        .limit(filters.limit);
      return { items: raw.map((doc) => doc.toEntity()), total };
    }
    const raw = await OfferModel.find(query).sort({ created: -1 });
    return raw.map((doc) => doc.toEntity());
  }

  static async searchOnline(tenantId, filters = {}) {
    const query = { tenantId, status: "Online" };

    if (filters.industryId) {
      query.industryId = filters.industryId;
    }
    if (filters.internshipTypeId) {
      query.internshipTypeId = filters.internshipTypeId;
    }
    if (filters.companyId) {
      query.companyId = filters.companyId;
    } else if (Array.isArray(filters.companyIds)) {
      query.companyId = { $in: filters.companyIds };
    }
    if (filters.districtId) {
      query.districtId = filters.districtId;
    }
    if (filters.city) {
      query.city = filters.city;
    }

    const and = [];
    if (filters.q) {
      const term = { $regex: escapeRegex(filters.q), $options: "i" };
      and.push({
        $or: [
          { title: term },
          { requirements: term },
          { additionalInfo: term },
        ],
      });
    }
    if (filters.minAge !== undefined && filters.minAge !== null) {
      and.push({
        $or: [{ minAge: null }, { minAge: { $lte: filters.minAge } }],
      });
    }
    if (
      Array.isArray(filters.excludeCompanyIds) &&
      filters.excludeCompanyIds.length > 0
    ) {
      and.push({ companyId: { $nin: filters.excludeCompanyIds } });
    }
    if (and.length > 0) {
      query.$and = and;
    }

    const hasGeo =
      filters.lat !== undefined &&
      filters.lat !== null &&
      filters.lng !== undefined &&
      filters.lng !== null &&
      filters.radiusMeters;

    const limit = Math.min(
      Math.max(Number(filters.limit) || DEFAULT_SEARCH_LIMIT, 1),
      MAX_SEARCH_LIMIT,
    );
    const skip = Math.max(Number(filters.offset) || 0, 0);

    if (hasGeo) {
      query.location = {
        $near: {
          $geometry: {
            type: "Point",
            coordinates: [filters.lng, filters.lat],
          },
          $maxDistance: filters.radiusMeters,
        },
      };
      // $near already returns nearest-first; no explicit sort
      const raw = await OfferModel.find(query).limit(limit).skip(skip);
      return raw.map((doc) => doc.toEntity());
    }

    const raw = await OfferModel.find(query)
      .sort({
        publishedAt: -1,
        created: -1,
      })
      .limit(limit)
      .skip(skip);
    return raw.map((doc) => doc.toEntity());
  }
  static async countByField(tenantId, field, value) {
    return OfferModel.countDocuments({ tenantId, [field]: value });
  }
}

module.exports = OfferManager;
