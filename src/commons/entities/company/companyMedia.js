const companyMediaSchemaDefinition = require("../../schemas/companyMediaSchema");
const SchemaUtils = require("../../utilities/schemaUtils");

class CompanyMedia {
  constructor(params = {}) {
    Object.assign(
      this,
      SchemaUtils.createDefaults(companyMediaSchemaDefinition),
    );

    Object.keys(companyMediaSchemaDefinition).forEach((key) => {
      if (params[key] !== undefined) {
        this[key] = params[key];
      }
    });
  }

  validate() {
    return SchemaUtils.validate(this, companyMediaSchemaDefinition);
  }

  static create(params) {
    const companyMedia = new CompanyMedia(params);
    companyMedia.validate();
    return companyMedia;
  }
}

module.exports = CompanyMedia;
