const { v4: uuidv4 } = require("uuid");
const PostManager = require("../data-managers/post-manager");
const AuditLogService = require("./audit-log-service");

const AUDIENCES = ["students", "companies", "all"];
const TYPES = ["article", "template", "link"];

function slugify(value) {
  return String(value || "")
    .toLowerCase()
    .replace(/ä/g, "ae")
    .replace(/ö/g, "oe")
    .replace(/ü/g, "ue")
    .replace(/ß/g, "ss")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

function normalizeTags(tags) {
  if (!Array.isArray(tags)) {
    return [];
  }
  const seen = new Set();
  const out = [];
  for (const tag of tags) {
    const value = String(tag || "").trim();
    if (value && !seen.has(value.toLowerCase())) {
      seen.add(value.toLowerCase());
      out.push(value);
    }
  }
  return out;
}

// Public list card: no contentHtml (fetched only on the detail view).
function toListDto(post) {
  return {
    slug: post.slug,
    title: post.title,
    audience: post.audience,
    type: post.type,
    tags: post.tags || [],
    excerpt: post.excerpt,
    thumbnailUrl: post.thumbnailUrl,
    url: post.url,
    publishedAt: post.publishedAt,
    attachmentsCount: (post.attachments || []).length,
  };
}

function toDetailDto(post) {
  return {
    ...toListDto(post),
    contentHtml: post.contentHtml,
    attachments: post.attachments || [],
  };
}

function toAdminDto(post) {
  return {
    id: post.id,
    slug: post.slug,
    title: post.title,
    audience: post.audience,
    type: post.type,
    tags: post.tags || [],
    excerpt: post.excerpt,
    contentHtml: post.contentHtml,
    url: post.url,
    thumbnailUrl: post.thumbnailUrl,
    attachments: post.attachments || [],
    published: post.published === true,
    companyDashboardOnly: post.companyDashboardOnly === true,
    publishedAt: post.publishedAt,
    created: post.created,
    updated: post.updated,
  };
}

class PostService {
  static async listPublic(tenantId, filters = {}) {
    const audience = AUDIENCES.includes(filters.audience)
      ? filters.audience
      : undefined;
    const hasLimit = filters.limit != null && filters.limit !== "";
    const limitValue = Number(filters.limit);
    const limit =
      hasLimit && Number.isFinite(limitValue)
        ? Math.max(1, Math.min(100, limitValue))
        : undefined;
    const offset = filters.offset
      ? Math.max(0, Number(filters.offset) || 0)
      : undefined;
    const posts = await PostManager.listPublished(tenantId, {
      audience,
      tag: filters.tag ? String(filters.tag).trim() : undefined,
      q: filters.q ? String(filters.q).trim() : undefined,
      limit,
      offset,
    });
    return posts.map(toListDto);
  }

  static async getPublicBySlug(tenantId, slug) {
    const post = await PostManager.getPublishedBySlug(tenantId, slug);
    if (!post) {
      throw { message: "Post not found", status: 404 };
    }
    return toDetailDto(post);
  }

  static async publicTags(tenantId) {
    const tags = await PostManager.publishedTags(tenantId);
    return (tags || [])
      .filter(Boolean)
      .sort((a, b) => a.localeCompare(b, "de"));
  }

  static async listForAdmin(tenantId) {
    const posts = await PostManager.listAll(tenantId);
    return posts.map(toAdminDto);
  }

  // company-dashboard feed: full detail, incl. dashboard-only posts
  static async listForCompanyDashboard(tenantId) {
    const posts = await PostManager.listForCompany(tenantId);
    return posts.map(toDetailDto);
  }

  static async _uniqueSlug(tenantId, title, excludeId) {
    const base = slugify(title) || "beitrag";
    for (let n = 1; n <= 100; n += 1) {
      const slug = n === 1 ? base : `${base}-${n}`;
      const existing = await PostManager.getBySlug(tenantId, slug);
      if (!existing || existing.id === excludeId) {
        return slug;
      }
    }
    return `${base}-${uuidv4().slice(0, 8)}`;
  }

  static async create(tenantId, payload = {}) {
    const title = String(payload.title || "").trim();
    if (!title) {
      throw { message: "A title is required", status: 400 };
    }
    const now = Date.now();
    const published = payload.published === true;
    const stored = await PostManager.store({
      id: uuidv4(),
      tenantId,
      slug: await PostService._uniqueSlug(tenantId, title),
      title,
      audience: AUDIENCES.includes(payload.audience) ? payload.audience : "all",
      type: TYPES.includes(payload.type) ? payload.type : "article",
      tags: normalizeTags(payload.tags),
      excerpt: String(payload.excerpt || "").trim(),
      contentHtml: String(payload.contentHtml || ""),
      url: String(payload.url || "").trim(),
      thumbnailUrl: String(payload.thumbnailUrl || "").trim(),
      attachments: Array.isArray(payload.attachments)
        ? payload.attachments
        : [],
      published,
      companyDashboardOnly: payload.companyDashboardOnly === true,
      publishedAt: published ? now : null,
      created: now,
      updated: now,
    });
    await AuditLogService.record(
      tenantId,
      "create",
      `Info-Beitrag „${stored.title}" angelegt`,
    );
    return toAdminDto(stored);
  }

  static async update(tenantId, id, payload = {}) {
    const post = await PostManager.getById(tenantId, id);
    if (!post) {
      throw { message: "Post not found", status: 404 };
    }
    const next = { ...post };
    if (payload.title !== undefined) {
      const title = String(payload.title).trim();
      if (!title) {
        throw { message: "A title is required", status: 400 };
      }
      if (title !== post.title) {
        next.title = title;
        next.slug = await PostService._uniqueSlug(tenantId, title, id);
      }
    }
    if (
      payload.audience !== undefined &&
      AUDIENCES.includes(payload.audience)
    ) {
      next.audience = payload.audience;
    }
    if (payload.type !== undefined && TYPES.includes(payload.type)) {
      next.type = payload.type;
    }
    if (payload.tags !== undefined) {
      next.tags = normalizeTags(payload.tags);
    }
    if (payload.excerpt !== undefined) {
      next.excerpt = String(payload.excerpt).trim();
    }
    if (payload.contentHtml !== undefined) {
      next.contentHtml = String(payload.contentHtml);
    }
    if (payload.url !== undefined) {
      next.url = String(payload.url).trim();
    }
    if (payload.thumbnailUrl !== undefined) {
      next.thumbnailUrl = String(payload.thumbnailUrl).trim();
    }
    if (
      payload.attachments !== undefined &&
      Array.isArray(payload.attachments)
    ) {
      next.attachments = payload.attachments;
    }
    if (payload.companyDashboardOnly !== undefined) {
      next.companyDashboardOnly = payload.companyDashboardOnly === true;
    }
    if (payload.published !== undefined) {
      next.published = payload.published === true;
      if (next.published && !post.publishedAt) {
        next.publishedAt = Date.now();
      }
    }
    next.updated = Date.now();
    const stored = await PostManager.store(next);
    await AuditLogService.record(
      tenantId,
      "update",
      `Info-Beitrag „${stored.title}" bearbeitet`,
    );
    return toAdminDto(stored);
  }

  static async setPublished(tenantId, id, published) {
    const post = await PostManager.getById(tenantId, id);
    if (!post) {
      throw { message: "Post not found", status: 404 };
    }
    const next = {
      ...post,
      published: published === true,
      updated: Date.now(),
    };
    if (next.published && !post.publishedAt) {
      next.publishedAt = Date.now();
    }
    const stored = await PostManager.store(next);
    await AuditLogService.record(
      tenantId,
      "update",
      next.published
        ? `Info-Beitrag „${stored.title}" veröffentlicht`
        : `Info-Beitrag „${stored.title}" zurückgezogen`,
    );
    return toAdminDto(stored);
  }

  static async remove(tenantId, id) {
    const post = await PostManager.getById(tenantId, id);
    if (!post) {
      throw { message: "Post not found", status: 404 };
    }
    await PostManager.remove(tenantId, id);
    await AuditLogService.record(
      tenantId,
      "delete",
      `Info-Beitrag „${post.title}" gelöscht`,
    );
    return { removed: id };
  }

  static async getAdminById(tenantId, id) {
    const post = await PostManager.getById(tenantId, id);
    if (!post) {
      throw { message: "Post not found", status: 404 };
    }
    return toAdminDto(post);
  }

  // persist only the media reference; the controller owns the file I/O
  static async setThumbnail(tenantId, id, thumbnailUrl) {
    const post = await PostManager.getById(tenantId, id);
    if (!post) {
      throw { message: "Post not found", status: 404 };
    }
    const stored = await PostManager.store({
      ...post,
      thumbnailUrl: String(thumbnailUrl || ""),
      updated: Date.now(),
    });
    return toAdminDto(stored);
  }

  static async addAttachment(tenantId, id, attachment) {
    const post = await PostManager.getById(tenantId, id);
    if (!post) {
      throw { message: "Post not found", status: 404 };
    }
    const stored = await PostManager.store({
      ...post,
      attachments: [...(post.attachments || []), attachment],
      updated: Date.now(),
    });
    return toAdminDto(stored);
  }

  static async removeAttachment(tenantId, id, attachmentId) {
    const post = await PostManager.getById(tenantId, id);
    if (!post) {
      throw { message: "Post not found", status: 404 };
    }
    const attachment = (post.attachments || []).find(
      (a) => a && a.id === attachmentId,
    );
    if (!attachment) {
      throw { message: "Attachment not found", status: 404 };
    }
    const stored = await PostManager.store({
      ...post,
      attachments: (post.attachments || []).filter(
        (a) => a && a.id !== attachmentId,
      ),
      updated: Date.now(),
    });
    return { removedUrl: attachment.url, post: toAdminDto(stored) };
  }
}

module.exports = PostService;
