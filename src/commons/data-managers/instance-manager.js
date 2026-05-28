const Instance = require("../entities/instance/instance");
const InstanceModel = require("./models/instanceModel");
const {
  CustomFieldCache,
} = require("../services/custom-field/custom-field-cache");
const { InstanceCache } = require("../services/instance/instance-cache");

const DEFAULT_BRANDING = Object.freeze({
  active: false,
  theme: {
    colors: { primary: "", secondary: "" },
  },
  logoUrl: "",
  faviconUrl: "",
});

const DEFAULT_PORTAL = Object.freeze({
  publicOffersEnabled: false,
  portalUrl: "",
});

class InstanceManager {
  static async getInstance() {
    const rawInstance = await InstanceModel.findOne();
    if (!rawInstance) {
      return null;
    }

    return rawInstance.toEntity();
  }

  static async updateInstance(instance) {
    const instanceEntity =
      instance instanceof Instance ? instance : new Instance(instance);

    // Übergangslogik: alte und neue Felder spiegeln, damit Konsumenten beider
    // Versionen während des Rollouts konsistente Werte sehen.
    InstanceManager._syncLegacyFields(instanceEntity);

    instanceEntity.validate();

    const rawInstance = await InstanceModel.findOne();
    if (!rawInstance) {
      return null;
    }
    const updated = await InstanceModel.findOneAndUpdate(
      {},
      { $set: instanceEntity },
      { new: true },
    );

    CustomFieldCache.invalidateInstance();
    InstanceCache.invalidate();

    return updated.toEntity();
  }

  static async getBookableCustomFields() {
    const rawInstance = await InstanceModel.findOne();
    if (!rawInstance) {
      return [];
    }
    return rawInstance.bookableCustomFields || [];
  }

  /**
   * Liefert das Instanz-Branding (Theme + Logo). Wird bei jedem Aufruf von
   * `/catalog/themes`, `/catalog/mode` und `/catalog/bundle` benötigt und ist
   * daher in-memory gecached (TTL 5 min, Invalidation in `updateInstance`).
   */
  static async getBranding() {
    const cached = InstanceCache.getBranding();
    if (cached) return cached;

    const raw = await InstanceModel.findOne({}, { branding: 1 }).lean();
    const branding = {
      ...DEFAULT_BRANDING,
      ...(raw?.branding ?? {}),
    };

    InstanceCache.setBranding(branding);
    return branding;
  }

  /**
   * Liefert die Portal-Konfiguration (Aktivierungsstatus der Buchungsangebote
   * + Portal-URL). Ebenfalls gecached, da auf jeden Catalog-Request gelesen.
   */
  static async getPortalConfig() {
    const cached = InstanceCache.getPortal();
    if (cached) return cached;

    const raw = await InstanceModel.findOne(
      {},
      { publicOffersEnabled: 1, portalUrl: 1, enableCatalog: 1, catalogUrl: 1 },
    ).lean();

    // Fallback auf Legacy-Felder, falls noch nicht migriert.
    const portal = {
      publicOffersEnabled:
        raw?.publicOffersEnabled ??
        raw?.enableCatalog ??
        DEFAULT_PORTAL.publicOffersEnabled,
      portalUrl: raw?.portalUrl || raw?.catalogUrl || DEFAULT_PORTAL.portalUrl,
    };

    InstanceCache.setPortal(portal);
    return portal;
  }

  /**
   * Hält Legacy-Felder (`enableCatalog`, `catalogUrl`) und neue Felder
   * (`publicOffersEnabled`, `portalUrl`) bidirektional synchron, solange beide
   * Felder parallel existieren.
   */
  static _syncLegacyFields(instance) {
    if (!instance) return;

    if (instance.publicOffersEnabled !== undefined) {
      instance.enableCatalog = instance.publicOffersEnabled;
    } else if (instance.enableCatalog !== undefined) {
      instance.publicOffersEnabled = instance.enableCatalog;
    }

    if (instance.portalUrl !== undefined && instance.portalUrl !== "") {
      instance.catalogUrl = instance.portalUrl;
    } else if (
      instance.catalogUrl !== undefined &&
      instance.catalogUrl !== ""
    ) {
      instance.portalUrl = instance.catalogUrl;
    }
  }
}

module.exports = InstanceManager;
