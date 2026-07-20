const applicationSchemaDefinition = require("../../schemas/applicationSchema");
const SchemaUtils = require("../../utilities/schemaUtils");

class Application {
  constructor(params = {}) {
    Object.assign(
      this,
      SchemaUtils.createDefaults(applicationSchemaDefinition),
    );

    Object.keys(applicationSchemaDefinition).forEach((key) => {
      if (params[key] !== undefined) {
        this[key] = params[key];
      }
    });
  }

  validate() {
    return SchemaUtils.validate(this, applicationSchemaDefinition);
  }

  static create(params) {
    const application = new Application(params);
    application.validate();
    return application;
  }
}

module.exports = Application;
