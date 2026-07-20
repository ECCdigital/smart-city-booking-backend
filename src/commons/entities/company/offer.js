const offerSchemaDefinition = require("../../schemas/offerSchema");
const SchemaUtils = require("../../utilities/schemaUtils");

class Offer {
  constructor(params = {}) {
    Object.assign(this, SchemaUtils.createDefaults(offerSchemaDefinition));

    Object.keys(offerSchemaDefinition).forEach((key) => {
      if (params[key] !== undefined) {
        this[key] = params[key];
      }
    });
  }

  validate() {
    return SchemaUtils.validate(this, offerSchemaDefinition);
  }

  static create(params) {
    const offer = new Offer(params);
    offer.validate();
    return offer;
  }
}

module.exports = Offer;
