const SchemaUtils = require("../../utilities/schemaUtils");
const { catalogSchemaDefinition } = require("../../schemas/catalogSchema");

class Catalog {
  constructor(params = {}) {
    const defaults = SchemaUtils.createDefaults(catalogSchemaDefinition);
    Object.assign(this, defaults, params);
  }


  exportPublic() {
    const publicFields = [
      "name",
      "slug",
      "active",
      "visibility",
      "theme",
      "type",
      "tenantId",
      "tenantIds",
    ];

    return publicFields.reduce((result, field) => {
      if (this[field] !== undefined) {
        result[field] = this[field];
      }
      return result;
    }, {});
  }
}

module.exports = { Catalog };