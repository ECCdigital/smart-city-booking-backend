const passwordHash = require("password-hash");
const { userSchemaDefinition } = require("../../schemas/userSchema");
const SchemaUtils = require("../../utilities/schemaUtils");
const { UserHook, USER_HOOK_TYPES } = require("./userHook");

/** The one origin of a suspension; a blacklist entry follows. */
const SUSPENSION_ORIGINS = Object.freeze({ MANUAL: "manual" });

class User {
  constructor(params = {}) {
    const defaults = SchemaUtils.createDefaults(userSchemaDefinition);

    Object.assign(this, defaults);

    Object.keys(userSchemaDefinition).forEach((key) => {
      if (params[key] !== undefined) {
        // Convert id to lowercase
        if (key === "id" && typeof params[key] === "string") {
          this[key] = params[key].toLowerCase();
        } else {
          this[key] = params[key];
        }
      }
    });

    // Convert hooks to UserHook entities
    if (this.hooks && Array.isArray(this.hooks)) {
      this.hooks = this.hooks.map((hook) =>
        hook instanceof UserHook ? hook : new UserHook(hook),
      );
    }
  }

  /**
   * Verify password
   * @param {string} password Password to verify
   * @returns {boolean} True if password matches
   */
  verifyPassword(password) {
    return passwordHash.verify(password, this.secret);
  }

  /**
   * Set password
   * @param {string} password New password
   */
  setPassword(password) {
    this.secret = passwordHash.generate(password);
  }

  /**
   * Add a hook to the user
   * @param {string} type Hook type
   * @param {Object} payload Hook payload
   * @returns {UserHook} The created hook
   */
  addHook(type, payload) {
    const hook = UserHook.create({ type, payload });
    this.hooks.push(hook);
    return hook;
  }

  /**
   * Add a password reset hook
   * @param {string} password New password
   * @returns {UserHook} The created hook
   */
  addPasswordResetHook(password) {
    return this.addHook(USER_HOOK_TYPES.RESET_PASSWORD, {
      secret: passwordHash.generate(password),
    });
  }

  /**
   * Add a forgot-password hook (token-only, password set after email link)
   * @param {string} [resetUrl] Optional frontend URL for the reset page
   * @returns {UserHook} The created hook
   */
  addForgotPasswordHook(resetUrl) {
    const payload = resetUrl ? { resetUrl } : {};
    return this.addHook(USER_HOOK_TYPES.FORGOT_PASSWORD, payload);
  }

  /**
   * Revoke every active hook of a type, so only the link issued next works
   * @param {string} type Hook type
   */
  revokeActiveHooks(type) {
    for (const hook of this.hooks) {
      if (hook.type === type && hook.status === "active") {
        hook.status = "revoked";
      }
    }
  }

  /**
   * Release a hook
   * @param {string} hookId Hook ID to release
   * @returns {boolean} True if hook was released
   */
  releaseHook(hookId) {
    const hook = this.hooks.find((hook) => hook.id === hookId);

    if (!hook) return false;

    if (hook.status !== "active") {
      throw { message: "Hook already used or expired", status: 410 };
    }

    if (hook.type === USER_HOOK_TYPES.VERIFY) {
      this.isVerified = true;
    } else if (hook.type === USER_HOOK_TYPES.RESET_PASSWORD) {
      this.secret = hook.payload.secret;
    }

    hook.status = "released";

    return true;
  }

  /**
   * Export public user information (without sensitive data)
   * @returns {Object} Public user data
   */
  exportPublic() {
    return {
      id: this.id,
      firstName: this.firstName,
      lastName: this.lastName,
      company: this.company,
      vatId: this.vatId,
      phone: this.phone,
      address: this.address,
      zipCode: this.zipCode,
      city: this.city,
      created: this.created,
      isVerified: this.isVerified,
      isSuspended: this.isSuspended,
      suspension: this.suspensionRecord(),
      authType: this.authType,
      idpEmailVerifiedAt: this.idpEmailVerifiedAt,
      idpEmailVerifiedProvider: this.idpEmailVerifiedProvider,
    };
  }

  /**
   * The record of the suspension, `null` for a user not suspended. A
   * suspension stored before the record (ECCdigital/tickets#624) reads as
   * one by hand without reason, time and person.
   * @returns {Object|null}
   */
  suspensionRecord() {
    if (!this.isSuspended) return null;
    return (
      this.suspension ?? {
        reason: null,
        suspendedAt: null,
        suspendedBy: null,
        origin: SUSPENSION_ORIGINS.MANUAL,
      }
    );
  }

  /**
   * Validate the user
   * @returns {boolean} True if valid
   */
  validate() {
    SchemaUtils.validate(this, userSchemaDefinition);
    return true;
  }

  /**
   * Create a new user
   * @param {Object} params User parameters
   * @returns {User} The created user
   */
  static create(params) {
    const user = new User(params);
    user.validate();
    return user;
  }
}

module.exports = {
  User,
  SUSPENSION_ORIGINS,
  USER_HOOK_TYPES,
};
