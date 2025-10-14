const invitationSchemaDefinition = require("../../schemas/invitationSchema");
const SchemaUtils = require("../../utilities/schemaUtils");

class Invitation {
  constructor(params = {}) {
    const defaults = SchemaUtils.createDefaults(invitationSchemaDefinition);
    Object.assign(this, defaults);

    Object.keys(invitationSchemaDefinition).forEach((key) => {
      if (params[key] !== undefined) {
        this[key] = params[key];
      }
    });
  }

  validate() {
    return SchemaUtils.validate(this, invitationSchemaDefinition);
  }

  static create(params) {
    const invitation = new Invitation(params);
    invitation.validate();
    return invitation;
  }
}

module.exports = Invitation;
