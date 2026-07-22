const taxonomyTermSchemaDefinition = require("../../schemas/taxonomyTermSchema");
const SchemaUtils = require("../../utilities/schemaUtils");

class TaxonomyTerm {
  constructor(params = {}) {
    Object.assign(
      this,
      SchemaUtils.createDefaults(taxonomyTermSchemaDefinition),
    );

    Object.keys(taxonomyTermSchemaDefinition).forEach((key) => {
      if (params[key] !== undefined) {
        this[key] = params[key];
      }
    });
  }

  validate() {
    return SchemaUtils.validate(this, taxonomyTermSchemaDefinition);
  }

  static create(params) {
    const taxonomyTerm = new TaxonomyTerm(params);
    taxonomyTerm.validate();
    return taxonomyTerm;
  }
}

module.exports = TaxonomyTerm;
