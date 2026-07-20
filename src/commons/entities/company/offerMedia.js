const offerMediaSchemaDefinition = require("../../schemas/offerMediaSchema");
const SchemaUtils = require("../../utilities/schemaUtils");

class OfferMedia {
  constructor(params = {}) {
    Object.assign(this, SchemaUtils.createDefaults(offerMediaSchemaDefinition));

    Object.keys(offerMediaSchemaDefinition).forEach((key) => {
      if (params[key] !== undefined) {
        this[key] = params[key];
      }
    });
  }

  validate() {
    return SchemaUtils.validate(this, offerMediaSchemaDefinition);
  }

  static create(params) {
    const offerMedia = new OfferMedia(params);
    offerMedia.validate();
    return offerMedia;
  }
}

module.exports = OfferMedia;
