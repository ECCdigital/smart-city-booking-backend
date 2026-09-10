const postSchemaDefinition = {
  id: { type: String, required: true, unique: true },
  tenantId: { type: String, required: true },
  slug: { type: String, required: true },
  title: { type: String, required: true },
  audience: {
    type: String,
    enum: ["students", "companies", "all"],
    default: "all",
  },
  type: {
    type: String,
    enum: ["article", "template", "link"],
    default: "article",
  },
  tags: { type: [String], default: [] },
  excerpt: { type: String, default: "" },
  contentHtml: { type: String, default: "" },
  url: { type: String, default: "" },
  thumbnailUrl: { type: String, default: "" },
  attachments: { type: Array, default: [] },
  published: { type: Boolean, default: false },
  companyDashboardOnly: { type: Boolean, default: false },
  publishedAt: { type: Number, default: null },
  created: { type: Number, default: () => Date.now() },
  updated: { type: Number, default: () => Date.now() },
};

module.exports = postSchemaDefinition;
