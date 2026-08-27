const MediaManager = require("../../data-managers/media-manager");
const PermissionService = require("../permission-service");
const { RolePermission } = require("../../entities/role/role");
const {
  BadRequestError,
  ForbiddenError,
} = require("../../../errors/BaseError");
const { collectMediaIds } = require("./media-reference");
const {
  instanceBrandingReferences,
  instanceDocumentReferences,
} = require("./instance-media");

/**
 * Guards the way into the reference sites of an entity (§4.3 of the media
 * spec). Saving a reference is not a media operation the media API sees, so
 * the three checks it would have made have to happen here: the medium belongs
 * to the tenant of the entity, whoever saves may pick it, and a publicly
 * visible entity carries only public media.
 */
class MediaReferenceGuard {
  /**
   * Checks every medium an entity references before it is stored. External
   * references pass untouched — the platform makes no claim about foreign
   * addresses.
   *
   * @param {Object} params
   * @param {string} params.tenantId - Tenant of the entity being saved.
   * @param {string} params.userId - Who is saving.
   * @param {Array<Object|string>} params.references - Stored reference sites.
   * @param {boolean} params.requirePublic - Whether the entity is publicly
   *   visible, in which case only public media may be referenced.
   * @returns {Promise<void>}
   * @throws {BadRequestError} Unknown medium, or an intern medium in a public
   *   context.
   * @throws {ForbiddenError} No picker right on the medium.
   */
  static async assertReferencesStorable({
    tenantId,
    userId,
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

      const mayPick = await PermissionService._allowRead(
        media,
        userId,
        tenantId,
        RolePermission.MANAGE_MEDIA,
      );

      if (!mayPick) {
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
   * @param {string} userId - Who is saving.
   * @returns {Promise<void>}
   */
  static async assertBookableStorable(bookable, userId) {
    await MediaReferenceGuard.assertReferencesStorable({
      tenantId: bookable.tenantId,
      userId,
      references: MediaReferenceGuard.bookableReferences(bookable),
      requirePublic: Boolean(bookable.isPublic),
    });
  }

  /**
   * Checks the reference sites of an event before it is stored.
   *
   * @param {Object} event - The event being saved.
   * @param {string} tenantId - Tenant of the event.
   * @param {string} userId - Who is saving.
   * @returns {Promise<void>}
   */
  static async assertEventStorable(event, tenantId, userId) {
    await MediaReferenceGuard.assertReferencesStorable({
      tenantId: event.tenantId || tenantId,
      userId,
      references: MediaReferenceGuard.eventReferences(event),
      requirePublic: Boolean(event.isPublic),
    });
  }

  /**
   * Checks every medium the instance references. Instance media are their own
   * scope (§4.9): only the instance owner may pick them, and a tenant medium
   * is refused like an unknown one — strict separation runs in both
   * directions.
   *
   * @param {Object} params
   * @param {string} params.userId - Who is saving.
   * @param {Array<Object|string>} params.references - Stored reference sites.
   * @param {boolean} params.requirePublic - Whether only public media may be
   *   referenced here.
   * @returns {Promise<void>}
   * @throws {BadRequestError} Unknown medium, or an intern medium in a public
   *   context.
   * @throws {ForbiddenError} Not the instance owner.
   */
  static async assertInstanceReferencesStorable({
    userId,
    references,
    requirePublic,
  }) {
    const mediaIds = collectMediaIds(references);

    if (mediaIds.length === 0) {
      return;
    }

    if (!(await PermissionService._isInstanceOwner(userId))) {
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
   * @param {string} userId - Who is saving.
   * @returns {Promise<void>}
   */
  static async assertInstanceStorable(instance, userId) {
    await MediaReferenceGuard.assertInstanceReferencesStorable({
      userId,
      references: instanceBrandingReferences(instance),
      requirePublic: true,
    });

    await MediaReferenceGuard.assertInstanceReferencesStorable({
      userId,
      references: instanceDocumentReferences(instance),
      requirePublic: false,
    });
  }
}

module.exports = MediaReferenceGuard;
