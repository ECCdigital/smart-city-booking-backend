const PlatformSettings = require("../entities/settings/platformSettings");
const PlatformSettingsManager = require("../data-managers/platform-settings-manager");
const TaxonomyTermManager = require("../data-managers/taxonomy-term-manager");
const AuditLogService = require("./audit-log-service");

const TEXT_FIELDS = [
  "logoUrl",
  "privacyPolicyText",
  "studentTermsText",
  "companyTermsText",
  "consentText",
  "imprintText",
];
const NUMBER_FIELDS = ["maxDocsPerInternship", "maxDocSizeMb"];

class PlatformSettingsService {
  static async getSettings(tenantId) {
    const existing = await PlatformSettingsManager.getByTenant(tenantId);
    if (existing) {
      return existing;
    }
    return PlatformSettings.create({ tenantId });
  }

  static async updateSettings(tenantId, payload) {
    const current = await PlatformSettingsService.getSettings(tenantId);
    const next = { ...current, tenantId };

    if (payload.directPublishVerified !== undefined) {
      next.directPublishVerified =
        payload.directPublishVerified === true ||
        payload.directPublishVerified === "true";
    }
    if (payload.defaultApplicationStatus !== undefined) {
      const statusTerms = await TaxonomyTermManager.getTerms(tenantId, {
        type: "application_status",
      });
      if (
        !statusTerms.some(
          (term) => term.id === payload.defaultApplicationStatus,
        )
      ) {
        throw { message: "Invalid default application status", status: 400 };
      }
      next.defaultApplicationStatus = payload.defaultApplicationStatus;
    }
    for (const key of TEXT_FIELDS) {
      if (payload[key] !== undefined) {
        next[key] = payload[key];
      }
    }
    for (const key of NUMBER_FIELDS) {
      if (payload[key] !== undefined) {
        next[key] = payload[key];
      }
    }

    let entity;
    try {
      entity = PlatformSettings.create(next);
    } catch (err) {
      throw {
        message: err.message,
        status: err.status || err.statusCode || 400,
      };
    }
    const stored = await PlatformSettingsManager.store(entity);
    const changed = [
      "directPublishVerified",
      "defaultApplicationStatus",
      ...TEXT_FIELDS,
      ...NUMBER_FIELDS,
    ].filter((key) => entity[key] !== current[key]);
    await AuditLogService.record(
      tenantId,
      "update",
      changed.length
        ? `Einstellungen aktualisiert: ${changed.join(", ")}`
        : "Einstellungen aktualisiert",
    );
    return stored;
  }
}

module.exports = PlatformSettingsService;
