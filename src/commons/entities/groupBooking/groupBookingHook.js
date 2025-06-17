const { v4: uuidv4 } = require("uuid");
const {
  groupBookingHookSchemaDefinition,
} = require("../../schemas/groupBookingSchema");
const SchemaUtils = require("../../utilities/schemaUtils");

const GROUP_BOOKING_HOOK_TYPES = Object.freeze({
  REJECT: "REJECT",
  CANCEL: "CANCEL",
});

class GroupBookingHook {
  constructor(params = {}) {
    const defaults = SchemaUtils.createDefaults(
      groupBookingHookSchemaDefinition,
    );
    Object.assign(this, defaults, params);

    if (!this.id) {
      this.id = uuidv4();
    }
  }

  validate() {
    SchemaUtils.validate(this, groupBookingHookSchemaDefinition);

    if (!Object.values(GROUP_BOOKING_HOOK_TYPES).includes(this.type)) {
      throw new Error(`Invalid hook type: ${this.type}`);
    }

    return true;
  }

  static create(params) {
    const hook = new GroupBookingHook(params);
    hook.validate();
    return hook;
  }
}

module.exports = {
  GroupBookingHook,
  GROUP_BOOKING_HOOK_TYPES,
};
