const mongoose = require("mongoose");
const postSchemaDefinition = require("../../schemas/postSchema");

const { Schema } = mongoose;

const PostSchema = new Schema(postSchemaDefinition);

PostSchema.index({ tenantId: 1, slug: 1 }, { unique: true });
PostSchema.index({ tenantId: 1, published: 1 });
PostSchema.index({ tenantId: 1, audience: 1 });

PostSchema.methods.toEntity = function () {
  const Post = require("../../entities/post/post");
  return new Post(this.toObject());
};

module.exports =
  mongoose.models.Post || mongoose.model("Post", PostSchema, "posts");
