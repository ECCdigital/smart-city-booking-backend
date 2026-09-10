const accountDeletionSchemaDefinition = require("../../schemas/accountDeletionSchema");
const SchemaUtils = require("../../utilities/schemaUtils");

class AccountDeletion {
  constructor(params = {}) {
    Object.assign(
      this,
      SchemaUtils.createDefaults(accountDeletionSchemaDefinition),
    );

    Object.keys(accountDeletionSchemaDefinition).forEach((key) => {
      if (params[key] !== undefined) {
        this[key] = params[key];
      }
    });
  }

  validate() {
    return SchemaUtils.validate(this, accountDeletionSchemaDefinition);
  }

  static create(params) {
    const entity = new AccountDeletion(params);
    entity.validate();
    return entity;
  }
}

module.exports = AccountDeletion;
