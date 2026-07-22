const adminInvitationSchemaDefinition = require("../../schemas/adminInvitationSchema");
const SchemaUtils = require("../../utilities/schemaUtils");

class AdminInvitation {
  constructor(params = {}) {
    Object.assign(
      this,
      SchemaUtils.createDefaults(adminInvitationSchemaDefinition),
    );

    Object.keys(adminInvitationSchemaDefinition).forEach((key) => {
      if (params[key] !== undefined) {
        this[key] = params[key];
      }
    });
  }

  validate() {
    return SchemaUtils.validate(this, adminInvitationSchemaDefinition);
  }

  static create(params) {
    const invitation = new AdminInvitation(params);
    invitation.validate();
    return invitation;
  }
}

module.exports = AdminInvitation;
