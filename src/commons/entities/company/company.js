const companySchemaDefinition = require("../../schemas/companySchema");
const SchemaUtils = require("../../utilities/schemaUtils");

class Company {
  constructor(params = {}) {
    Object.assign(this, SchemaUtils.createDefaults(companySchemaDefinition));

    Object.keys(companySchemaDefinition).forEach((key) => {
      if (params[key] !== undefined) {
        this[key] = params[key];
      }
    });
  }

  validate() {
    return SchemaUtils.validate(this, companySchemaDefinition);
  }

  static create(params) {
    const company = new Company(params);
    company.validate();
    return company;
  }
}

module.exports = Company;
