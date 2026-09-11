const MediaManager = require("../../data-managers/media-manager");
const { withinReach } = require("../authorization/reach");
const {
  BadRequestError,
  ForbiddenError,
} = require("../../../errors/BaseError");
const { collectMediaIds } = require("./media-reference");
const {
  MEDIA_KIND,
  MEDIA_REFERENCE_SOURCE,
} = require("../../schemas/mediaSchema");
const SchemaUtils = require("../../utilities/schemaUtils");
const { ValidationError } = require("../../../errors/ValidationError");

/**
 * Why a media reference may not carry the Hero. Travels to the admin UI as
 * `params.reason` of an `invalid_custom` detail, so the editor can name the
 * rule that was broken.
 */
const HERO_MEDIA_REFUSAL = Object.freeze({
  EXTERNAL: "external",
  NOT_INSTANCE: "not_instance",
  NOT_PUBLIC: "not_public",
  NOT_IMAGE: "not_image",
});
const {
  instanceBrandingReferences,
  instanceDocumentReferences,
} = require("./instance-media");
const { tenantDocumentReferences } = require("./tenant-media");

/**
 * Guards the way into the reference sites of an entity (§4.3 of the media
 * spec). Saving a reference is not a media operation the media API sees, so
 * the three checks it would have made have to happen here: the medium belongs
 * to the tenant of the entity, the reach of the saver covers it, and a
 * publicly visible entity carries only public media.
 *
 * The guard asks nothing about rights (authorize spec §5): the caller hands
 * in the reach of `media.read` — the picker right, decided a second time in
 * the adapter that saves the entity — and the guard reads it against the
 * medium it loaded.
 */
class MediaReferenceGuard {
  /**
   * Checks every medium an entity references before it is stored. External
   * references pass untouched — the platform makes no claim about foreign
   * addresses.
   *
   * @param {Object} params
   * @param {string} params.tenantId - Tenant of the entity being saved.
   * @param {{reach?: string, userId?: string|null}} params.scope - The reach
   *   of `media.read`, the picker right of whoever is saving.
   * @param {Array<Object|string>} params.references - Stored reference sites.
   * @param {boolean} params.requirePublic - Whether the entity is publicly
   *   visible, in which case only public media may be referenced.
   * @returns {Promise<void>}
   * @throws {BadRequestError} Unknown medium, or an intern medium in a public
   *   context.
   * @throws {ForbiddenError} The reach does not cover the medium.
   */
  static async assertReferencesStorable({
    tenantId,
    scope,
    references,
    requirePublic,
  }) {
    const mediaIds = collectMediaIds(references);

    for (const mediaId of mediaIds) {
      const media = await MediaManager.getMedia(mediaId, tenantId);

      if (!media) {
        throw new BadRequestError("media_reference_unknown", { mediaId });
      }

      // A booking document is reachable through its booking only — it never
      // shows up in the picker and must not be pinned to an entity.
      if (media.isBookingDocument()) {
        throw new BadRequestError("media_reference_unknown", { mediaId });
      }

      if (!withinReach(media, "uploadedBy", scope)) {
        throw new ForbiddenError("forbidden", { mediaId });
      }

      if (requirePublic && !media.isPublic()) {
        throw new BadRequestError("media_reference_not_public", { mediaId });
      }
    }
  }

  /**
   * Every reference site of a bookable: its image list and its attachments.
   *
   * @param {Object} bookable - The bookable being saved.
   * @returns {Array<Object|string>}
   */
  static bookableReferences(bookable) {
    return [
      ...(bookable?.images || []),
      ...(bookable?.attachments || []).map(
        (attachment) => attachment?.reference ?? attachment?.url,
      ),
    ];
  }

  /**
   * Every reference site of an event: teaser image, contact person image, the
   * photo of every speaker, the image list and the attachments (§4.8).
   *
   * @param {Object} event - The event being saved.
   * @returns {Array<Object|string>}
   */
  static eventReferences(event) {
    return [
      event?.information?.teaserImage,
      event?.eventOrganizer?.contactPersonImage,
      ...(event?.eventOrganizer?.speakers || []).map(
        (speaker) => speaker?.image,
      ),
      ...(event?.images || []),
      ...(event?.attachments || []).map(
        (attachment) => attachment?.reference ?? attachment?.url,
      ),
    ];
  }

  /**
   * Checks the reference sites of a bookable before it is stored.
   *
   * @param {Object} bookable - The bookable being saved.
   * @param {{reach?: string, userId?: string|null}} scope - The reach of
   *   `media.read`.
   * @returns {Promise<void>}
   */
  static async assertBookableStorable(bookable, scope) {
    await MediaReferenceGuard.assertReferencesStorable({
      tenantId: bookable.tenantId,
      scope,
      references: MediaReferenceGuard.bookableReferences(bookable),
      requirePublic: Boolean(bookable.isPublic),
    });
  }

  /**
   * Checks the reference sites of an event before it is stored.
   *
   * @param {Object} event - The event being saved.
   * @param {string} tenantId - Tenant of the event.
   * @param {{reach?: string, userId?: string|null}} scope - The reach of
   *   `media.read`.
   * @returns {Promise<void>}
   */
  static async assertEventStorable(event, tenantId, scope) {
    await MediaReferenceGuard.assertReferencesStorable({
      tenantId: event.tenantId || tenantId,
      scope,
      references: MediaReferenceGuard.eventReferences(event),
      requirePublic: Boolean(event.isPublic),
    });
  }

  /**
   * Checks the reference sites of a tenant before it is stored: the legal
   * documents it files. A legal document is meant to be published, so only
   * public media may sit behind it; a medium of another tenant or of the
   * instance is unknown to the tenant-scoped lookup and refused like any other
   * unknown one.
   *
   * The scope comes from the caller, not from the payload: the tenant boundary
   * is worth nothing if the object being checked may declare which tenant it
   * belongs to.
   *
   * @param {Object} tenant - The tenant being saved.
   * @param {string} tenantId - Tenant the caller resolved and checked.
   * @param {{reach?: string, userId?: string|null}} scope - The reach of
   *   `media.read`.
   * @returns {Promise<void>}
   */
  static async assertTenantStorable(tenant, tenantId, scope) {
    await MediaReferenceGuard.assertReferencesStorable({
      tenantId: tenantId || tenant.id,
      scope,
      references: tenantDocumentReferences(tenant),
      requirePublic: true,
    });
  }

  /**
   * Checks every medium the instance references. Instance media are their own
   * scope (§4.9): only the instance owner may pick them, and a tenant medium
   * is refused like an unknown one — strict separation runs in both
   * directions.
   *
   * @param {Object} params
   * @param {{reach?: string, userId?: string|null}} params.scope - The reach
   *   of `instanceMedia.read`; only `any` (the instance owner) picks here.
   * @param {Array<Object|string>} params.references - Stored reference sites.
   * @param {boolean} params.requirePublic - Whether only public media may be
   *   referenced here.
   * @returns {Promise<void>}
   * @throws {BadRequestError} Unknown medium, or an intern medium in a public
   *   context.
   * @throws {ForbiddenError} The reach does not cover the instance library.
   */
  static async assertInstanceReferencesStorable({
    scope,
    references,
    requirePublic,
  }) {
    const mediaIds = collectMediaIds(references);

    if (mediaIds.length === 0) {
      return;
    }

    if (scope?.reach !== "any") {
      throw new ForbiddenError("forbidden");
    }

    for (const mediaId of mediaIds) {
      const media = await MediaManager.getMedia(mediaId, null);

      if (!media) {
        throw new BadRequestError("media_reference_unknown", { mediaId });
      }

      if (requirePublic && !media.isPublic()) {
        throw new BadRequestError("media_reference_not_public", { mediaId });
      }
    }
  }

  /**
   * Checks the reference sites of the instance before it is stored: branding
   * is served to anonymous visitors and therefore takes public media only,
   * legal documents may be internal.
   *
   * @param {Object} instance - The instance being saved.
   * @param {{reach?: string, userId?: string|null}} scope - The reach of
   *   `instanceMedia.read`.
   * @returns {Promise<void>}
   */
  static async assertInstanceStorable(instance, scope) {
    await MediaReferenceGuard.assertInstanceReferencesStorable({
      scope,
      references: instanceBrandingReferences(instance),
      requirePublic: true,
    });

    await MediaReferenceGuard.assertInstanceReferencesStorable({
      scope,
      references: instanceDocumentReferences(instance),
      requirePublic: false,
    });
  }

  /**
   * Why a media reference may not carry the Hero: it has to point at a public
   * image of the instance library, never at a foreign address, a tenant
   * medium, an internal one or a document. The Hero is painted for anonymous
   * visitors, and the instance library is the only scope the instance catalog
   * reaches.
   *
   * An id the instance scope cannot find reads as `not_instance`: a tenant
   * medium and one that does not exist look the same from here, and both are
   * equally out of reach.
   *
   * @param {Object} reference - The stored reference, `{ source, mediaId }`.
   * @returns {Promise<?string>} The reason it is refused, or null when it may
   *   be stored.
   */
  static async heroLayoutRefusal(reference) {
    if (reference?.source !== MEDIA_REFERENCE_SOURCE.MEDIA) {
      return HERO_MEDIA_REFUSAL.EXTERNAL;
    }

    const media = await MediaManager.getMedia(reference.mediaId, null);

    if (!media) {
      return HERO_MEDIA_REFUSAL.NOT_INSTANCE;
    }

    if (!media.isPublic()) {
      return HERO_MEDIA_REFUSAL.NOT_PUBLIC;
    }

    if (media.kind !== MEDIA_KIND.IMAGE) {
      return HERO_MEDIA_REFUSAL.NOT_IMAGE;
    }

    return null;
  }

  /**
   * Checks every image a Hero Layout or a Background points at. Unlike the
   * other reference sites this answers a `ValidationError`, not a
   * `BadRequestError`: the Hero editor puts the message at the field that
   * carries the fault, so every refusal needs the JSON path it happened at.
   *
   * @param {Array<{field: string, reference: Object}>} references - Each
   *   reference with its JSON path in the request body.
   * @returns {Promise<void>}
   * @throws {ValidationError} One `invalid_custom` detail per refused
   *   reference, `params.reason` naming which rule it broke.
   */
  static async assertHeroLayoutStorable(references) {
    const details = [];

    for (const { field, reference } of references) {
      const reason = await MediaReferenceGuard.heroLayoutRefusal(reference);

      if (reason) {
        details.push({
          field,
          code: SchemaUtils.ERROR_CODES.validate,
          params: { reason },
        });
      }
    }

    if (details.length > 0) {
      throw new ValidationError(details);
    }
  }
}

MediaReferenceGuard.HERO_MEDIA_REFUSAL = HERO_MEDIA_REFUSAL;

module.exports = MediaReferenceGuard;
