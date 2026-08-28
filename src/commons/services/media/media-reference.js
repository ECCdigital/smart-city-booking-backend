const {
  MEDIA_REFERENCE_SOURCE,
  validateMediaReference,
} = require("../../schemas/mediaSchema");

/**
 * A media reference is the typed usage site of a file at an entity (§4.8 of
 * the media spec). This module is the single place that knows how to read one:
 * how a legacy plain URL looks as a reference, which delivery URL it resolves
 * to, and which media ids an entity holds. Entities keep what is stored — the
 * normalisation here happens on the way out, never on the way back in, so a
 * save never silently rewrites data the media import (B7) still has to convert.
 */

// Instance media have no tenant, so they take this segment where a tenant id
// would stand — the delivery route has the same shape in both scopes (§4.9).
const INSTANCE_MEDIA_SCOPE = "instance";

/**
 * The relative delivery URL of a medium. URLs stay relative so the same
 * response works behind any host (§4.4).
 *
 * @param {string|null} mediaId - Id of the medium.
 * @param {string|null} [tenantId] - Owning tenant, empty for instance media.
 * @returns {string|null} The URL, or null without a medium.
 */
function mediaFileUrl(mediaId, tenantId) {
  if (!mediaId) {
    return null;
  }

  return `/api/v2/${tenantId || INSTANCE_MEDIA_SCOPE}/media/${mediaId}/file`;
}

/**
 * Strips the mongoose wrapping off a stored sub-object, so the export paths
 * work on a plain copy instead of a subdocument that carries more than the
 * fields they care about.
 *
 * @param {Object} value - The stored value.
 * @returns {Object} A plain copy.
 */
function plainObject(value) {
  return typeof value?.toObject === "function"
    ? value.toObject()
    : { ...value };
}

/**
 * Reads a reference site. Anything the media library wrote is already a
 * reference; a bare string is legacy — a plain URL that the media import has
 * not converted yet. It reads as an external reference, which is exactly what
 * it is until the import gives it a medium.
 *
 * @param {Object|string|null} value - The stored value of a reference site.
 * @returns {{source: string, mediaId: ?string, url: ?string}|null} The
 *   reference, or null when the site is empty.
 */
function toMediaReference(value) {
  if (!value) {
    return null;
  }

  if (typeof value === "string") {
    return {
      source: MEDIA_REFERENCE_SOURCE.EXTERNAL,
      mediaId: null,
      url: value,
    };
  }

  if (typeof value !== "object") {
    return null;
  }

  const reference = plainObject(value);

  if (reference.source) {
    return {
      source: reference.source,
      mediaId: reference.mediaId ?? null,
      url: reference.url ?? null,
    };
  }

  // A legacy attachment: context fields plus a raw url.
  return toMediaReference(reference.url);
}

/**
 * The relative delivery URL of a reference. Media resolve to the binary route,
 * external references to their own address; URLs stay relative so the same
 * response works behind any host (§4.4).
 *
 * @param {Object|string|null} value - The stored value of a reference site.
 * @param {string|null} tenantId - Tenant the referencing entity belongs to,
 *   empty for the instance itself.
 * @returns {string|null} The URL, or null when the site is empty.
 */
function mediaReferenceUrl(value, tenantId) {
  const reference = toMediaReference(value);

  if (!reference) {
    return null;
  }

  if (reference.source === MEDIA_REFERENCE_SOURCE.MEDIA) {
    return mediaFileUrl(reference.mediaId, tenantId);
  }

  return reference.url || null;
}

/**
 * The absolute address of a reference, for the places a relative URL is
 * worthless because it leaves the platform: mails and calendar files.
 *
 * @param {Object|string|null} value - The stored value of a reference site.
 * @param {string} tenantId - Tenant the referencing entity belongs to.
 * @returns {string|null} The absolute URL, or null when the site is empty.
 */
function absoluteMediaReferenceUrl(value, tenantId) {
  const url = mediaReferenceUrl(value, tenantId);

  if (!url || !url.startsWith("/")) {
    return url;
  }

  return `${(process.env.BACKEND_URL || "").replace(/\/+$/, "")}${url}`;
}

/**
 * A reference as it goes out to frontends: the reference itself plus the URL
 * it resolves to, so nobody has to assemble media routes by hand.
 *
 * @param {Object|string|null} value - The stored value of a reference site.
 * @param {string} tenantId - Tenant the referencing entity belongs to.
 * @returns {Object|null} The enriched reference, or null when empty.
 */
function enrichMediaReference(value, tenantId) {
  const reference = toMediaReference(value);

  if (!reference) {
    return null;
  }

  return { ...reference, url: mediaReferenceUrl(reference, tenantId) };
}

/**
 * The enriched form of an ordered reference list; empty sites drop out.
 *
 * @param {Array<Object|string>} values - Stored reference sites.
 * @param {string} tenantId - Tenant the referencing entity belongs to.
 * @returns {Array<Object>}
 */
function enrichMediaReferences(values, tenantId) {
  if (!Array.isArray(values)) {
    return [];
  }

  return values
    .map((value) => enrichMediaReference(value, tenantId))
    .filter(Boolean);
}

/**
 * An attachment as it goes out: its context fields unchanged, its reference
 * enriched and the resolved address mirrored into `url` — the field every
 * frontend and the mail path read today.
 *
 * @param {Object} attachment - Stored attachment.
 * @param {string} tenantId - Tenant the referencing entity belongs to.
 * @returns {Object|null}
 */
function enrichAttachment(attachment, tenantId) {
  if (!attachment) {
    return null;
  }

  const plain = plainObject(attachment);

  const reference = enrichMediaReference(
    plain.reference ?? plain.url,
    tenantId,
  );

  return {
    ...plain,
    reference: reference || undefined,
    url: reference?.url ?? plain.url ?? null,
  };
}

/**
 * The ids of every medium in a list of reference sites — the input of both the
 * save-time validation and any bulk media lookup.
 *
 * @param {Array<Object|string>} values - Stored reference sites.
 * @returns {string[]} Media ids, without duplicates.
 */
function collectMediaIds(values) {
  if (!Array.isArray(values)) {
    return [];
  }

  const ids = values
    .map((value) => toMediaReference(value))
    .filter(
      (reference) =>
        reference?.source === MEDIA_REFERENCE_SOURCE.MEDIA && reference.mediaId,
    )
    .map((reference) => reference.mediaId);

  return [...new Set(ids)];
}

module.exports = {
  INSTANCE_MEDIA_SCOPE,
  MEDIA_REFERENCE_SOURCE,
  absoluteMediaReferenceUrl,
  collectMediaIds,
  enrichAttachment,
  enrichMediaReference,
  enrichMediaReferences,
  mediaFileUrl,
  mediaReferenceUrl,
  plainObject,
  toMediaReference,
  validateMediaReference,
};
