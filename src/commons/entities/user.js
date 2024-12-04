const passwordHash = require("password-hash");
const { v4: uuidv4 } = require("uuid");

const HookTypes = Object.freeze({
  VERIFY: "verify",
  RESET_PASSWORD: "reset-password",
});

class User {
  constructor(
    id,
    secret,
    tenant,
    firstName,
    lastName,
    phone,
    address,
    zipCode,
    city,
    hooks,
    isVerified,
    created,
    roles,
    company,
  ) {
    this.id = id;
    this.secret = secret;
    this.tenant = tenant;
    this.firstName = firstName;
    this.lastName = lastName;
    this.phone = phone;
    this.address = address;
    this.zipCode = zipCode;
    this.city = city;
    this.hooks = hooks || [];
    this.isVerified = isVerified || false;
    this.created = created || Date.now();
    this.roles = roles || [];
    this.company = company;
  }

  verifyPassword(password) {
    return passwordHash.verify(password, this.secret);
  }

  setPassword(password) {
    this.secret = passwordHash.generate(password);
  }

  addHook(type, payload) {
    const hook = {
      id: uuidv4(),
      type: type,
      payload: payload,
    };
    this.hooks.push(hook);

    return hook;
  }

  addPasswordResetHook(password) {
    return this.addHook(HookTypes.RESET_PASSWORD, {
      secret: passwordHash.generate(password),
    });
  }

  releaseHook(id) {
    const hook = this.hooks.find((h) => h.id === id);

    if (!hook) return false;

    if (hook.type === HookTypes.VERIFY) {
      this.isVerified = true;
    } else if (hook.type === HookTypes.RESET_PASSWORD) {
      this.secret = hook.payload.secret;
    }

    this.hooks = this.hooks.filter((h) => h.id !== id);
    return true;
  }

  addRole(role) {
    this.roles.push(role);
  }

  removeRole(role) {
    this.roles = this.roles.filter((r) => r !== role);
  }

  exportPublic() {
    return {
      id: this.id,
      firstName: this.firstName,
      lastName: this.lastName,
      company: this.company,
      phone: this.phone,
      address: this.address,
      zipCode: this.zipCode,
      city: this.city,
      tenant: this.tenant,
      created: this.created,
      isVerified: this.isVerified,
    };
  }
}

module.exports = {
  User: User,
  HookTypes: HookTypes,
};
