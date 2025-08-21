const SchemaUtils = require("../../utilities/schemaUtils");
const { catalogSchemaDefinition } = require("../../schemas/catalogSchema");

class Catalog {
  constructor(params = {}) {
    const defaults = SchemaUtils.createDefaults(catalogSchemaDefinition);
    Object.assign(this, defaults, params);
  }
}

module.exports = { Catalog };