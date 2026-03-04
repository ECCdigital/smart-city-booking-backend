const TenantManager = require("../../data-managers/tenant-manager");
const {
  createClient,
  getCapabilities,
} = require("./clients/locker-client-registry");
require("./clients");
const bunyan = require("bunyan");

const logger = bunyan.createLogger({
  name: "locker-info-service.js",
  level: process.env.LOG_LEVEL,
});

const APP_TYPE = "locker";

class LockerInfoService {
  static async getClient(tenantId, provider) {
    const tenant = await TenantManager.getTenant(tenantId);
    const rawApp = tenant.applications.find(
      (a) => a.type === APP_TYPE && a.id === provider && a.active,
    );


    if (!rawApp) {
      throw new Error(
        `No active locker application '${provider}' found for tenant '${tenantId}'`,
      );
    }

    return createClient(rawApp);
  }

  static async getActiveProviders(tenantId) {
    const tenant = await TenantManager.getTenant(tenantId);

    return tenant.applications
      .filter((a) => a.type === APP_TYPE && a.active)
      .map((a) => ({
        id: a.id,
        title: a.title || a.id,
        capabilities: getCapabilities(a.id),
      }));
  }

  static async getLocations(tenantId, provider) {
    const client = await this.getClient(tenantId, provider);
    return client.getLocations();
  }

  static async getLocationsStat(tenantId, provider) {
    const client = await this.getClient(tenantId, provider);
    return client.getLocationsStat();
  }

  static async getLocationById(tenantId, provider, locationId) {
    const client = await this.getClient(tenantId, provider);
    return client.getLocationById(locationId);
  }

  static async getPrice(tenantId, provider, locationId) {
    const client = await this.getClient(tenantId, provider);
    return client.getPrice(locationId);
  }
}

module.exports = LockerInfoService;