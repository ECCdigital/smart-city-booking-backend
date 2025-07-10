const { v4: uuidv4 } = require("uuid");
const SchemaUtils = require("../../utilities/schemaUtils");
const { userHookSchemaDefinition } = require("../../schemas/userSchema");

const USER_HOOK_TYPES = Object.freeze({
  VERIFY: "verify",
  RESET_PASSWORD: "reset-password",
});

class UserHook {
  constructor(params = {}) {
    const defaults = SchemaUtils.createDefaults(userHookSchemaDefinition);
    Object.assign(this, defaults, params);
  }

  /**
   * Validate the hook
   * @returns {boolean} True if valid
   */
  validate() {
    SchemaUtils.validate(this, userHookSchemaDefinition);
    return true;
  }

  /**
   * Create a new hook
   * @param {Object} params Hook parameters
   * @returns {UserHook} The created hook
   */
  static create(params) {
    const hook = new UserHook({
      id: uuidv4(),
      timeCreated: Date.now(),
      ...params,
    });
    hook.validate();
    return hook;
  }
}

module.exports = {
  UserHook,
  USER_HOOK_TYPES,
};
