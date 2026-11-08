const invitationSchemaDefinition = require("../../schemas/invitationSchema");
const SchemaUtils = require("../../utilities/schemaUtils");

class Invitation {
  constructor(params = {}) {
    const defaults = SchemaUtils.createDefaults(invitationSchemaDefinition);
    Object.assign(this, defaults);

    Object.keys(invitationSchemaDefinition).forEach((key) => {
      if (params[key] !== undefined) {
        if (key === "intendedUserId" && typeof params[key] === "string") {
          this[key] = params[key].trim().toLowerCase();
        } else {
          this[key] = params[key];
        }
      }
    });
  }

  validate() {
    return SchemaUtils.validate(this, invitationSchemaDefinition);
  }

  /**
   * Whether the invitation is active, not expired and not used up. Expiry
   * never updates `status`, so an expired invitation still reads "active".
   */
  static isUsable(invitation, now = Date.now()) {
    return (
      invitation.status === "active" &&
      (!invitation.expiresAt || now <= invitation.expiresAt) &&
      (invitation.type === "multi"
        ? invitation.maxUses == null ||
          invitation.usedCount < invitation.maxUses
        : invitation.usedCount < 1)
    );
  }

  static create(params) {
    const invitation = new Invitation(params);
    invitation.validate();
    return invitation;
  }
}

module.exports = Invitation;
