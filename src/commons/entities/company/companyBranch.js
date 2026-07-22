const companyBranchSchemaDefinition = require("../../schemas/companyBranchSchema");
const SchemaUtils = require("../../utilities/schemaUtils");

class CompanyBranch {
  constructor(params = {}) {
    Object.assign(
      this,
      SchemaUtils.createDefaults(companyBranchSchemaDefinition),
    );

    Object.keys(companyBranchSchemaDefinition).forEach((key) => {
      if (params[key] !== undefined) {
        this[key] = params[key];
      }
    });
  }

  validate() {
    return SchemaUtils.validate(this, companyBranchSchemaDefinition);
  }

  static create(params) {
    const companyBranch = new CompanyBranch(params);
    companyBranch.validate();
    return companyBranch;
  }
}

module.exports = CompanyBranch;
