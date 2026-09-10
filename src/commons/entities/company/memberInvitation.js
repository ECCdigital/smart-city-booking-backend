const memberInvitationSchemaDefinition = require("../../schemas/memberInvitationSchema");
const SchemaUtils = require("../../utilities/schemaUtils");

class MemberInvitation {
  constructor(params = {}) {
    Object.assign(
      this,
      SchemaUtils.createDefaults(memberInvitationSchemaDefinition),
    );

    Object.keys(memberInvitationSchemaDefinition).forEach((key) => {
      if (params[key] !== undefined) {
        this[key] = params[key];
      }
    });
  }

  validate() {
    return SchemaUtils.validate(this, memberInvitationSchemaDefinition);
  }

  static create(params) {
    const memberInvitation = new MemberInvitation(params);
    memberInvitation.validate();
    return memberInvitation;
  }
}

module.exports = MemberInvitation;
