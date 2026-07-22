const companyMemberSchemaDefinition = require("../../schemas/companyMemberSchema");
const SchemaUtils = require("../../utilities/schemaUtils");

class CompanyMember {
  constructor(params = {}) {
    Object.assign(
      this,
      SchemaUtils.createDefaults(companyMemberSchemaDefinition),
    );

    Object.keys(companyMemberSchemaDefinition).forEach((key) => {
      if (params[key] !== undefined) {
        this[key] = params[key];
      }
    });
  }

  validate() {
    return SchemaUtils.validate(this, companyMemberSchemaDefinition);
  }

  static create(params) {
    const companyMember = new CompanyMember(params);
    companyMember.validate();
    return companyMember;
  }
}

module.exports = CompanyMember;
