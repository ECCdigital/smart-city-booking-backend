const { v4: uuidv4 } = require("uuid");
const { bookingHookSchemaDefinition } = require("../../schemas/bookingSchema");
const SchemaUtils = require("../../utilities/schemaUtils");

const BOOKING_HOOK_TYPES = Object.freeze({
  REJECT: "REJECT",
});

class BookingHook {
  constructor(params = {}) {
    const defaults = SchemaUtils.createDefaults(bookingHookSchemaDefinition);
    Object.assign(this, defaults, params);

    // Generate ID if not provided
    if (!this.id) {
      this.id = uuidv4();
    }
  }

  validate() {
    SchemaUtils.validate(this, bookingHookSchemaDefinition);

    if (!Object.values(BOOKING_HOOK_TYPES).includes(this.type)) {
      throw new Error(`Invalid hook type: ${this.type}`);
    }

    return true;
  }

  static create(params) {
    const hook = new BookingHook(params);
    hook.validate();
    return hook;
  }
}

module.exports = {
  BookingHook,
  BOOKING_HOOK_TYPES,
};
