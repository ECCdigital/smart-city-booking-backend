const Instance = require("../entities/instance/instance");
const InstanceModel = require("./models/instanceModel");
const {
  CustomFieldCache,
} = require("../services/custom-field/custom-field-cache");
const {
  CustomFieldService,
} = require("../services/custom-field/custom-field-service");
const { InstanceCache } = require("../services/instance/instance-cache");
const { ThemeExportCache } = require("../services/catalog/theme-export-cache");
const { BookableManager } = require("./bookable-manager");
const { exportInstanceBranding } = require("../services/media/instance-media");
const {
  normalizeBackground,
} = require("../services/hero-layout/hero-layout-schema");
const { NotFoundError } = require("../../errors/BaseError");

const DEFAULT_BRANDING = Object.freeze({
  active: false,
  theme: {
    colors: { primary: "", secondary: "" },
  },
  logo: null,
  favicon: null,
  logoUrl: "",
  faviconUrl: "",
});

const DEFAULT_PORTAL = Object.freeze({
  publicOffersEnabled: false,
  portalUrl: "",
});

// Where the instance holds a media reference (§4.9 of the media spec). The two
// halves are searched together for the usage proof and apart wherever only the
// publicly served sites count.
const BRANDING_MEDIA_PATHS = Object.freeze([
  "branding.logo.mediaId",
  "branding.favicon.mediaId",
]);
const DOCUMENT_MEDIA_PATHS = Object.freeze([
  "dataProtection.reference.mediaId",
  "legalNotice.reference.mediaId",
  "termsAndConditions.reference.mediaId",
]);

/**
 * Mirrors one legacy pair in whichever direction carries a value. Absence, not
 * emptiness, decides: an empty string is a value of its own, so clearing the
 * current field clears its legacy twin instead of being overwritten by it.
 *
 * @param {Object} instance - The payload to sync, mutated in place.
 * @param {string} currentField - The field the platform reads today.
 * @param {string} legacyField - Its legacy twin.
 */
function mirrorLegacyPair(instance, currentField, legacyField) {
  if (instance[currentField] !== undefined) {
    instance[legacyField] = instance[currentField];
  } else if (instance[legacyField] !== undefined) {
    instance[currentField] = instance[legacyField];
  }
}

class InstanceManager {
  static async getInstance() {
    const rawInstance = await InstanceModel.findOne();
    if (!rawInstance) {
      return null;
    }

    return rawInstance.toEntity();
  }

  static async updateInstance(instance) {
    // The mirror reads absence, so it has to see the payload as it arrived: a
    // constructed entity carries the schema default `portalUrl: ""` and would
    // make every deliberate clear look like an omission.
    const synced = InstanceManager._syncLegacyFields(instance);

    const instanceEntity = new Instance(synced);

    CustomFieldService.normalizeDefinitions(
      instanceEntity.bookableCustomFields || [],
    );

    instanceEntity.validate();

    const rawInstance = await InstanceModel.findOne();
    if (!rawInstance) {
      return null;
    }

    await InstanceManager._applyBackground(instanceEntity, rawInstance);

    const previousCustomFields = rawInstance.bookableCustomFields || [];

    const updated = await InstanceModel.findOneAndUpdate(
      {},
      { $set: instanceEntity },
      { new: true },
    );

    await InstanceManager._removeEmptiedLegacyUrl(instanceEntity);

    const removedFieldIds = CustomFieldService.getRemovedFieldIds(
      previousCustomFields,
      instanceEntity.bookableCustomFields || [],
    );
    if (removedFieldIds.length > 0) {
      await BookableManager.removeCustomFieldValues(removedFieldIds);
    }

    CustomFieldCache.invalidateInstance();
    InstanceCache.invalidate();
    // The branding travels in the Theme Bundle, so an instance write can
    // change every exported bundle and its tag.
    ThemeExportCache.invalidateAll();

    return updated.toEntity();
  }

  /**
   * Writes the Background of the branding, and nothing else (hero-layout spec
   * §4). The Hero Editor saves the layout and the Background together, and the
   * Background is one key inside the branding: a round trip through
   * `updateInstance` would rewrite the whole instance to change it. `null` is
   * the reset to the default Background, stored as null and filled in on the
   * way out.
   *
   * The branding is cached, so the cache is dropped here; the theme export
   * cache is the caller's, which writes the Catalog in the same save and
   * flushes once for both.
   *
   * @param {?Object} background - The Background in its stored form, already
   *   normalised, or null.
   * @returns {Promise<void>}
   * @throws {NotFoundError} When there is no instance to write. The Hero is
   *   saved in two writes, and one of them landing silently is the split the
   *   caller cannot heal: it has to be told.
   */
  static async updateBackground(background) {
    const result = await InstanceModel.updateOne(
      {},
      { $set: { "branding.background": background } },
    );

    if (result?.matchedCount === 0) {
      throw new NotFoundError("instance_not_found");
    }

    InstanceCache.invalidate();
  }

  static async reassignOwnerUserId(previousUserId, newUserId, session = null) {
    const options = session ? { session } : {};
    await InstanceModel.updateOne(
      { ownerUserIds: previousUserId },
      { $set: { "ownerUserIds.$[elem]": newUserId } },
      {
        ...options,
        arrayFilters: [{ elem: previousUserId }],
      },
    );
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
    // `logoUrl`/`faviconUrl` are derived from the stored media references
    // (§4.9), so every catalog endpoint keeps reading the fields it always did.
    const branding = exportInstanceBranding({
      ...DEFAULT_BRANDING,
      ...(raw?.branding ?? {}),
    });

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
      // `??`, not `||`: an emptied Portal-URL is an answer, not a gap to fill.
      portalUrl: raw?.portalUrl ?? raw?.catalogUrl ?? DEFAULT_PORTAL.portalUrl,
    };

    InstanceCache.setPortal(portal);
    return portal;
  }

  /**
   * Whether the instance itself references a medium — branding (logo, favicon)
   * or one of the legal documents. The usage proof is searched on demand (§4.7
   * of the media spec); a medium never carries a back reference. The instance
   * is a singleton, so a hit has no id of its own.
   *
   * @param {string} mediaId - Id of the medium.
   * @returns {Promise<Array<{id: null, title: string}>>} Usage sites
   */
  static async getMediaUsage(mediaId) {
    return InstanceManager._findMediaUsage(mediaId, [
      ...BRANDING_MEDIA_PATHS,
      ...DOCUMENT_MEDIA_PATHS,
    ]);
  }

  /**
   * Whether the branding references a medium — the half of the instance sites
   * that is served to anonymous visitors. The legal documents are left out on
   * purpose: they may hold an internal medium, so they are no reason to keep
   * one public.
   *
   * @param {string} mediaId - Id of the medium.
   * @returns {Promise<Array<{id: null, title: string}>>} Usage sites
   */
  static async getBrandingMediaUsage(mediaId) {
    return InstanceManager._findMediaUsage(mediaId, BRANDING_MEDIA_PATHS);
  }

  /**
   * The instance as a usage site of a medium, searched over the given
   * reference paths.
   *
   * @param {string} mediaId - Id of the medium.
   * @param {string[]} paths - Dotted paths of the reference sites to search.
   * @returns {Promise<Array<{id: null, title: string}>>} Usage sites
   */
  static async _findMediaUsage(mediaId, paths) {
    if (!mediaId) {
      return [];
    }

    const found = await InstanceManager._exists({
      $or: paths.map((path) => ({ [path]: mediaId })),
    });

    return found ? [{ id: null, title: "instance" }] : [];
  }

  /**
   * Whether the instance matches a filter, read as narrowly as the question
   * deserves — the instance is a singleton, so a hit is the whole answer.
   *
   * @param {Object} filter - A mongoose filter over the instance.
   * @returns {Promise<boolean>}
   */
  static async _exists(filter) {
    const raw = await InstanceModel.findOne(filter, { _id: 1 }).lean();

    return Boolean(raw);
  }

  /**
   * Whether the Hero Background of the branding is this medium. It reports as
   * a Hero site, not as an instance one (hero-layout spec §6), so the answer
   * is the bare fact and the Hero turns it into the site.
   *
   * @param {string} mediaId - Id of the medium.
   * @returns {Promise<boolean>}
   */
  static async hasBackgroundMedia(mediaId) {
    if (!mediaId) {
      return false;
    }

    return InstanceManager._exists({
      "branding.background.image.mediaId": mediaId,
    });
  }

  /**
   * Settles the Background of the branding being saved (hero-layout spec,
   * Shared contract). The write is a `$set` of the whole branding object, so a
   * save that does not mention the Background would drop it — the stored one is
   * carried along instead. A payload that names it has it normalised, and an
   * explicit `null` stays null: the reset to the default Background, which is
   * filled in on the way out.
   *
   * @param {Object} instanceEntity - The instance about to be written.
   * @param {Object} rawInstance - The instance as it is stored.
   * @returns {Promise<void>}
   * @throws {ValidationError} When the Background does not hold up, with
   *   `branding.background…` as the path of every fault.
   */
  static async _applyBackground(instanceEntity, rawInstance) {
    const branding = instanceEntity.branding;

    if (!branding || typeof branding !== "object") {
      return;
    }

    if (!Object.prototype.hasOwnProperty.call(branding, "background")) {
      const stored = rawInstance.branding?.background;

      if (stored !== undefined) {
        branding.background = stored;
      }

      return;
    }

    branding.background = await normalizeBackground(
      branding.background,
      "branding.background",
    );
  }

  /**
   * Removes the legacy `catalogUrl` once the mirror has emptied it.
   *
   * `catalogUrl` is not a schema path, so mongoose's strict mode drops it from
   * a `$set` and from an `$unset` alike — the model cannot write that key at
   * all. A cleared Portal-URL would therefore leave the stale legacy address
   * in the document, from where it hydrates back into every later payload:
   * the round trip that used to bring an emptied Portal-URL back. The key is
   * dropped on the collection instead, and only when it was cleared, so an
   * unrelated instance write leaves a legacy address alone.
   *
   * @param {Instance} instanceEntity - The instance just written.
   * @returns {Promise<void>}
   */
  static async _removeEmptiedLegacyUrl(instanceEntity) {
    if (instanceEntity.catalogUrl !== "") return;

    await InstanceModel.collection.updateOne(
      {},
      { $unset: { catalogUrl: "" } },
    );
  }

  /**
   * Keeps the legacy fields (`enableCatalog`, `catalogUrl`) and the current
   * ones (`publicOffersEnabled`, `portalUrl`) in sync while both pairs exist
   * side by side. Answers a copy, so the payload it was handed is left as it
   * arrived.
   *
   * @param {Object|Instance} instance - The payload or entity to sync.
   * @returns {Object} The synced payload.
   */
  static _syncLegacyFields(instance) {
    if (!instance) return instance;

    const synced = { ...instance };

    mirrorLegacyPair(synced, "publicOffersEnabled", "enableCatalog");
    mirrorLegacyPair(synced, "portalUrl", "catalogUrl");

    return synced;
  }
}

module.exports = InstanceManager;
