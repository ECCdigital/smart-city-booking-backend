const postSchemaDefinition = require("../../schemas/postSchema");
const SchemaUtils = require("../../utilities/schemaUtils");

class Post {
  constructor(params = {}) {
    Object.assign(this, SchemaUtils.createDefaults(postSchemaDefinition));

    Object.keys(postSchemaDefinition).forEach((key) => {
      if (params[key] !== undefined) {
        this[key] = params[key];
      }
    });
  }

  validate() {
    return SchemaUtils.validate(this, postSchemaDefinition);
  }

  static create(params) {
    const post = new Post(params);
    post.validate();
    return post;
  }
}

module.exports = Post;
