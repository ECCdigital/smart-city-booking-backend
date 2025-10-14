const membershipSchemaDefinition = require("../../schemas/membershipSchema");
const SchemaUtils = require("../../utilities/schemaUtils");


class Membership {
  constructor(params = {}) {
    const defaults = SchemaUtils.createDefaults(membershipSchemaDefinition);
    Object.assign(this, defaults);

    Object.keys(membershipSchemaDefinition).forEach((key) => {
      if (params[key] !== undefined) {
        this[key] = params[key];
      }
    });
  }

  validate() {
    return SchemaUtils.validate(this, membershipSchemaDefinition);
  }

  static create(params) {
    const membership = new Membership(params);
    membership.validate();
    return membership;
  }
}

module.exports = Membership;