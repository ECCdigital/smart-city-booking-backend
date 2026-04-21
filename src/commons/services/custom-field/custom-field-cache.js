const NodeCache = require("node-cache");

const cache = new NodeCache({ stdTTL: 300, checkperiod: 60 });

class CustomFieldCache {
  static _key(type, id) {
    return `cf:${type}:${id}`;
  }

  static getInstanceFields(instanceId = "default") {
    return cache.get(this._key("instance", instanceId));
  }

  static setInstanceFields(fields, instanceId = "default") {
    cache.set(this._key("instance", instanceId), fields);
  }

  static getTenantFields(tenantId) {
    return cache.get(this._key("tenant", tenantId));
  }

  static setTenantFields(tenantId, fields) {
    cache.set(this._key("tenant", tenantId), fields);
  }

  static invalidateInstance(instanceId = "default") {
    cache.del(this._key("instance", instanceId));
  }

  static invalidateTenant(tenantId) {
    cache.del(this._key("tenant", tenantId));
  }
}

module.exports = { CustomFieldCache };
