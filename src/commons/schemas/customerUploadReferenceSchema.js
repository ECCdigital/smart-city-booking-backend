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
    // An upload of a group handed in for several of its bookings:
    // every booking and field it was handed in
    // for, this one included, as at the upload. Empty for an upload of this
    // booking alone. The medium's `bookingIds` say which still hold it.
    sharedWith: {
      type: [
        new Schema(
          {
            bookingId: { type: String, required: true },
            fieldId: { type: String, required: true },
            fieldLabel: { type: String, default: "" },
          },
          { _id: false },
        ),
      ],
      default: [],
    },
    review: {
      status: {
        type: String,
        enum: Object.values(CUSTOMER_UPLOAD_REVIEW),
        default: CUSTOMER_UPLOAD_REVIEW.SUBMITTED,
      },
      reason: { type: String, default: "" },
      reviewedAt: { type: Double, default: null },
      reviewedBy: { type: String, default: null },
      // The name of the reviewer at the time of the check, so the note
      // stays readable once the account is gone.
      reviewedByName: { type: String, default: "" },
      // The file was deleted by the deletion deadline, not by a check.
      autoDeleted: { type: Boolean, default: false },
      // When the file was deleted; null while it is stored.
      fileDeletedAt: { type: Double, default: null },
    },
  },
  { _id: false },
);

/**
 * „Erneut anfordern“ of an upload field: the staff
 * opens a checked field again, with a reason. It works like a rejection of
 * the field - the customer hands in a replacement - and takes nothing back:
 * the notes of the checked uploads stay as they are.
 */
const customerUploadRequestSchema = new Schema(
  {
    fieldId: { type: String, required: true },
    fieldLabel: { type: String, default: "" },
    reason: { type: String, required: true },
    requestedAt: { type: Double, required: true },
    requestedBy: { type: String, default: null },
    requestedByName: { type: String, default: "" },
  },
  { _id: false },
);

/** What the job of customer uploads tells. */
const CUSTOMER_UPLOAD_NOTICE = Object.freeze({
  // To the customer, before the deadline of a missing required upload.
  REMINDER: "reminder",
  // To the tenant, once the deadline of a required upload has passed.
  OVERDUE: "overdue",
});

/**
 * A notice the job of customer uploads sent for an upload field of a
 * booking: the booking remembers it, so a second run sends nothing twice.
 */
const customerUploadNoticeSchema = new Schema(
  {
    kind: {
      type: String,
      enum: Object.values(CUSTOMER_UPLOAD_NOTICE),
      required: true,
    },
    fieldId: { type: String, required: true },
    sentAt: { type: Double, required: true },
  },
  { _id: false },
);

module.exports = {
  customerUploadReferenceSchema,
  customerUploadRequestSchema,
  customerUploadNoticeSchema,
  CUSTOMER_UPLOAD_NOTICE,
  CUSTOMER_UPLOAD_REVIEW,
};
