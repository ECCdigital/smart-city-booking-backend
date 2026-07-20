const offerBookmarkSchemaDefinition = require("../../schemas/offerBookmarkSchema");
const SchemaUtils = require("../../utilities/schemaUtils");

class OfferBookmark {
  constructor(params = {}) {
    Object.assign(
      this,
      SchemaUtils.createDefaults(offerBookmarkSchemaDefinition),
    );

    Object.keys(offerBookmarkSchemaDefinition).forEach((key) => {
      if (params[key] !== undefined) {
        this[key] = params[key];
      }
    });
  }

  validate() {
    return SchemaUtils.validate(this, offerBookmarkSchemaDefinition);
  }

  static create(params) {
    const bookmark = new OfferBookmark(params);
    bookmark.validate();
    return bookmark;
  }
}

module.exports = OfferBookmark;
