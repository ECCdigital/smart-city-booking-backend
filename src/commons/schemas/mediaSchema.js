const { Schema } = require("mongoose");

const MEDIA_KIND = {
  IMAGE: "image",
  DOCUMENT: "document",
};

const MEDIA_VISIBILITY = {
  PUBLIC: "public",
  INTERN: "intern",
};

const STORAGE_PROVIDER = {
  NEXTCLOUD: "nextcloud",
  S3: "s3",
};

const MEDIA_REFERENCE_SOURCE = {
  MEDIA: "media",
  EXTERNAL: "external",
};

/**
 * A media reference is the typed usage of a file at an entity (cover image,
 * image list, attachment): it points either at a medium or at an external
 * link — exactly one of both. Context fields (caption, mailAttach, show, …)
 * stay at the usage site, never at the medium.
 */
const mediaReferenceSchemaDefinition = {
  source: {
    type: String,
    enum: Object.values(MEDIA_REFERENCE_SOURCE),
    required: true,
  },
  mediaId: { type: String, default: null },
  url: { type: String, default: null },
};

/**
 * Ensures a media reference carries exactly the field its source demands.
 *
 * @param {Object} reference - The reference to check.
 * @returns {boolean} True if the reference is well-formed.
 */
function validateMediaReference(reference) {
  if (!reference || typeof reference !== "object") {
    return false;
  }

  if (reference.source === MEDIA_REFERENCE_SOURCE.MEDIA) {
    return Boolean(reference.mediaId) && !reference.url;
  }

  if (reference.source === MEDIA_REFERENCE_SOURCE.EXTERNAL) {
    return Boolean(reference.url) && !reference.mediaId;
  }

  return false;
}

const mediaReferenceSchema = new Schema(mediaReferenceSchemaDefinition, {
  _id: false,
});

mediaReferenceSchema.pre("validate", function (next) {
  if (!validateMediaReference(this.toObject())) {
    return next(
      new Error(
        "A media reference must carry exactly one of mediaId (source: media) or url (source: external).",
      ),
    );
  }
  next();
});

/**
 * Where the bytes of a medium live. Reading always follows the medium's own
 * storage location; the instance configuration only steers new uploads.
 */
const storageLocationSchema = new Schema(
  {
    provider: {
      type: String,
      enum: Object.values(STORAGE_PROVIDER),
      required: true,
    },
    key: { type: String, required: true },
  },
  { _id: false },
);

/**
 * A variant is an actually generated size/format derivative of an image
 * medium — never a path derived by convention.
 */
const mediaVariantSchema = new Schema(
  {
    name: { type: String, required: true },
    format: { type: String, required: true },
    width: { type: Number, default: null },
    height: { type: Number, default: null },
    size: { type: Number, default: null },
    checksum: { type: String, default: "" },
    key: { type: String, required: true },
  },
  { _id: false },
);

const mediaSchemaDefinition = {
  id: { type: String, required: true },
  // null marks an instance medium (no tenant)
  tenantId: { type: String, default: null },
  kind: { type: String, enum: Object.values(MEDIA_KIND), required: true },

  mimeType: { type: String, required: true },
  size: { type: Number, required: true },
  checksum: { type: String, default: "" },
  originalFileName: { type: String, required: true },

  title: { type: String, default: "" },
  altText: { type: String, default: "" },
  tags: { type: [String], default: [] },

  visibility: {
    type: String,
    enum: Object.values(MEDIA_VISIBILITY),
    default: MEDIA_VISIBILITY.PUBLIC,
  },

  // Ownership for the own/any media permissions (B3)
  uploadedBy: { type: String, default: null },
  // The sole marker that turns a medium into a booking document (B3)
  bookingId: { type: String, default: null },
  // Only set by the media import (B7), never on fresh uploads
  legacyPath: { type: String, default: null },

  storage: { type: storageLocationSchema, required: true },
  variants: { type: [mediaVariantSchema], default: [] },
};

module.exports = {
  mediaSchemaDefinition,
  mediaReferenceSchemaDefinition,
  mediaReferenceSchema,
  mediaVariantSchema,
  storageLocationSchema,
  validateMediaReference,
  MEDIA_KIND,
  MEDIA_VISIBILITY,
  MEDIA_REFERENCE_SOURCE,
  STORAGE_PROVIDER,
};
