const Post = require("../entities/post/post");
const PostModel = require("./models/postModel");
const { escapeRegex } = require("../utilities/regexUtils");

const DEFAULT_PUBLIC_LIMIT = 50;
const MAX_PUBLIC_LIMIT = 100;

// public reads: published, non company-dashboard-only posts
function publicQuery(tenantId) {
  return { tenantId, published: true, companyDashboardOnly: { $ne: true } };
}

class PostManager {
  static async listPublished(
    tenantId,
    { audience, tag, q, limit, offset } = {},
  ) {
    const query = publicQuery(tenantId);
    if (audience) {
      query.audience = { $in: [audience, "all"] };
    }
    if (tag) {
      query.tags = tag;
    }
    if (q) {
      const rx = new RegExp(escapeRegex(q), "i");
      query.$or = [{ title: rx }, { excerpt: rx }];
    }
    const cap = Math.min(
      Math.max(Number(limit) || DEFAULT_PUBLIC_LIMIT, 1),
      MAX_PUBLIC_LIMIT,
    );
    const skip = Math.max(Number(offset) || 0, 0);
    const raw = await PostModel.find(query)
      .sort({ publishedAt: -1, created: -1 })
      .skip(skip)
      .limit(cap);
    return raw.map((doc) => doc.toEntity());
  }

  static async getPublishedBySlug(tenantId, slug) {
    const raw = await PostModel.findOne({ ...publicQuery(tenantId), slug });
    return raw ? raw.toEntity() : null;
  }

  static async publishedTags(tenantId) {
    return PostModel.distinct("tags", publicQuery(tenantId));
  }

  // company-dashboard feed: published company/all posts incl. dashboard-only
  static async listForCompany(tenantId) {
    const raw = await PostModel.find({
      tenantId,
      published: true,
      audience: { $in: ["companies", "all"] },
    }).sort({ publishedAt: -1, created: -1 });
    return raw.map((doc) => doc.toEntity());
  }

  static async listAll(tenantId) {
    const raw = await PostModel.find({ tenantId }).sort({ created: -1 });
    return raw.map((doc) => doc.toEntity());
  }

  static async getById(tenantId, id) {
    const raw = await PostModel.findOne({ tenantId, id });
    return raw ? raw.toEntity() : null;
  }

  static async getBySlug(tenantId, slug) {
    const raw = await PostModel.findOne({ tenantId, slug });
    return raw ? raw.toEntity() : null;
  }

  static async store(post, upsert = true) {
    const entity = post instanceof Post ? post : new Post(post);
    entity.validate();
    await PostModel.updateOne(
      { id: entity.id, tenantId: entity.tenantId },
      { ...entity },
      { upsert, runValidators: true },
    );
    return entity;
  }

  static async remove(tenantId, id) {
    await PostModel.deleteOne({ tenantId, id });
  }
}

module.exports = PostManager;
