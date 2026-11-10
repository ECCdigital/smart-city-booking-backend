const { Double } = require("mongodb");
const { Schema } = require("mongoose");
const { mediaReferenceSchemaDefinition } = require("./mediaSchema");

/** Where the check of a customer upload stands (glossary "Prüfung"). */
const CUSTOMER_UPLOAD_REVIEW = Object.freeze({
  // Handed in, the file is stored, nobody has checked it yet.
  SUBMITTED: "submitted",
  ACCEPTED: "accepted",
  REJECTED: "rejected",
});

/**
 * A customer upload as its booking holds it (glossary "Kunden-Upload"): a
 * media reference into the upload field it was handed in for. The booking
 * holds one list of them; the references of one upload field are the
 * entries with its `fieldId`. The label is the field's at the time of the
 * upload, so a renamed or deleted field keeps its references readable. The
 * medium itself names no field.
 */
const customerUploadReferenceSchema = new Schema(
  {
    ...mediaReferenceSchemaDefinition,
    fieldId: { type: String, required: true },
    fieldLabel: { type: String, default: "" },
    originalFileName: { type: String, default: "" },
    mimeType: { type: String, default: "" },
    // Bytes as stored, after an image was encoded anew.
    size: { type: Number, default: 0 },
    uploadedAt: { type: Double, required: true },
    uploadedBy: { type: String, default: null },
    review: {
      status: {
        type: String,
        enum: Object.values(CUSTOMER_UPLOAD_REVIEW),
        default: CUSTOMER_UPLOAD_REVIEW.SUBMITTED,
      },
      reason: { type: String, default: "" },
      reviewedAt: { type: Double, default: null },
      reviewedBy: { type: String, default: null },
    },
  },
  { _id: false },
);

module.exports = {
  customerUploadReferenceSchema,
  CUSTOMER_UPLOAD_REVIEW,
};
