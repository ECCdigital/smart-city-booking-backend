const challengeSchemaDefinition = require("../../schemas/challengeSchema");
const SchemaUtils = require("../../utilities/schemaUtils");

class Challenge {
  constructor(params = {}) {
    const defaults = SchemaUtils.createDefaults(challengeSchemaDefinition);
    Object.assign(this, defaults);

    Object.keys(challengeSchemaDefinition).forEach((key) => {
      if (params[key] !== undefined) {
        this[key] = params[key];
      }
    });
  }

  validate() {
    return SchemaUtils.validate(this, challengeSchemaDefinition);
  }

  static create(params) {
    const challenge = new Challenge(params);
    challenge.validate();
    return challenge;
  }
}

module.exports = Challenge;
