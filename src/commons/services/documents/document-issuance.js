const bunyan = require("bunyan");
const BookingManager = require("../../data-managers/booking-manager");
const GroupBookingManager = require("../../data-managers/group-booking-manager");
const TenantManager = require("../../data-managers/tenant-manager");
const IdGenerator = require("../../utilities/id-generator");
const ReceiptService = require("../payment/receipt-service");
const InvoiceService = require("../payment/invoice-service");
const CancellationService = require("../payment/cancellation-service");
const {
  BOOKING_DOCUMENT,
  deleteBookingDocuments,
  isStorageFailure,
  storeBookingDocument,
} = require("../media/booking-documents");
const {
  BadRequestError,
  ConflictError,
  NotFoundError,
} = require("../../../errors/BaseError");

const logger = bunyan.createLogger({
  name: "document-issuance.js",
  level: process.env.LOG_LEVEL,
});

/** Width the counter of a document number is padded to. */
const NUMBER_WIDTH = 4;

/**
 * The three booking documents: how their number is written, which field of
 * the attachment carries the document id, and who renders them.
 *
 * The number formats are the ones the documents have always carried: the
 * receipt always joins the prefix with a dash, invoice and cancellation only
 * where there is one.
 */
const DOCUMENT_TYPES = Object.freeze({
  receipt: {
    idField: "receiptId",
    media: BOOKING_DOCUMENT.RECEIPT,
    number: (tenant, id, revision) =>
      `${tenant.receiptNumberPrefix}-${id}-${revision}`,
    render: (input) => ReceiptService.render(input),
  },
  invoice: {
    idField: "invoiceId",
    media: BOOKING_DOCUMENT.INVOICE,
    number: (tenant, id, revision) =>
      `${tenant.invoiceNumberPrefix ? tenant.invoiceNumberPrefix + "-" : ""}${id}-${revision}`,
    render: (input) => InvoiceService.render(input),
  },
  cancellation: {
    idField: "cancellationId",
    media: BOOKING_DOCUMENT.CANCELLATION,
    number: (tenant, id, revision) => {
      const prefix = (tenant.cancellationNumberPrefix || "").trim();
      return `${prefix ? `${prefix}-` : ""}${id}-${revision}`;
    },
    render: (input) => CancellationService.render(input),
  },
});

/**
 * @typedef {Object} RenderInput What a renderer is given.
 * @property {string} tenantId
 * @property {string[]} bookingIds The bookings the document is about.
 * @property {Object[]} bookings The same bookings, loaded.
 * @property {string} number The full document number, e.g. `RE-2026-0001-1`.
 * @property {string} documentId The number without prefix and revision.
 * @property {number} revision
 * @property {string|null} groupBookingId Set exactly for an aggregated document.
 * @property {Object} options Whatever the caller passed for the document.
 */

/**
 * @typedef {Object} Rendered What a renderer answers.
 * @property {string} name The file name.
 * @property {Buffer} buffer The bytes.
 * @property {Object|function(string): Object} [attachmentFields] Fields the
 *   document adds to its attachment, a function of the booking id where they
 *   differ per booking (the cancellation's refund audit).
 */

/**
 * Issues a booking document (glossary "Ausstellung"): draws the number,
 * renders, stores the bytes and attaches the document to every booking - in
 * that order, so a number exists exactly when its attachment does. A booking
 * that already carries a document of the type gets the same number as a
 * further revision (glossary "Revision"); a reprint is just a second call.
 *
 * The attachment goes to each booking with one atomic push, never as a
 * whole-document write, so it can neither be lost to the state write of a
 * transition nor overwrite a parallel amendment. Where the caller holds the
 * booking entities and passes them as `bookings`, the attachment is appended
 * to them as well, so a later whole-document write of such an entity carries
 * it.
 *
 * Fails after the draw leave the number a gap: rendering or storing that
 * throws is logged with number, type and bookings and rethrown, and no
 * booking is touched. A push that fails part-way through a group is logged
 * with the bookings that got the document and those that did not, and
 * rethrown. Nothing is mailed here - the mail is the transition's or the
 * administration's.
 *
 * @param {Object} params
 * @param {string} params.tenantId
 * @param {string[]} params.bookingIds The bookings the document is about.
 * @param {"receipt"|"invoice"|"cancellation"} params.type
 * @param {string|null} [params.groupBookingId] The group of an aggregated
 *   document: one medium, attached to every booking. Set exactly when the
 *   document is aggregated - never guessed from the number of bookings.
 * @param {Object[]} [params.bookings] The loaded bookings, if the caller
 *   holds them.
 * @param {Object} [params.options] Passed through to the renderer.
 * @returns {Promise<{ attachment: Object, file: { name: string, buffer: Buffer } }>}
 *   The attachment as pushed to the first booking, and the file.
 */
async function issue({
  tenantId,
  bookingIds,
  type,
  groupBookingId = null,
  bookings = null,
  options = {},
}) {
  const spec = DOCUMENT_TYPES[type];
  if (!spec) {
    throw new BadRequestError("unknown_document_type", { type });
  }
  if (!Array.isArray(bookingIds) || bookingIds.length === 0) {
    throw new BadRequestError("missing_booking_ids");
  }
  if (!groupBookingId && bookingIds.length > 1) {
    throw new BadRequestError("aggregated_document_needs_group", {
      bookingIds,
    });
  }

  const tenant = await TenantManager.getTenant(tenantId);
  if (!tenant) {
    throw new NotFoundError("tenant_not_found", { tenantId });
  }
  const loaded =
    bookings || (await BookingManager.getBookings(tenantId, bookingIds));
  const missing = bookingIds.filter(
    (id) => !loaded.some((booking) => booking.id === id),
  );
  if (missing.length > 0) {
    throw new NotFoundError("booking_not_found", { bookingId: missing[0] });
  }

  const { documentId, revision } = await nextNumber(
    tenantId,
    type,
    spec,
    loaded,
  );
  const number = spec.number(tenant, documentId, revision);

  let rendered;
  try {
    rendered = await spec.render({
      tenantId,
      bookingIds,
      bookings: loaded,
      number,
      documentId,
      revision,
      groupBookingId,
      options,
    });
    await storeBookingDocument({
      tenantId,
      bookingIds,
      file: { data: rendered.buffer, name: rendered.name },
      type: spec.media,
    });
  } catch (err) {
    logger.error(
      { tenantId, type, number, bookingIds, err },
      `Document number ${number} is a gap: the ${type} could not be issued`,
    );
    if (isStorageFailure(err)) {
      throw new Error(
        `Failed to save ${type}: Nextcloud service is unavailable. Please try again later.`,
      );
    }
    throw err;
  }

  const timeCreated = Date.now();
  const attachmentFor = (bookingId) => ({
    type,
    name: rendered.name,
    title: rendered.name,
    [spec.idField]: documentId,
    revision,
    timeCreated,
    ...fieldsOf(rendered.attachmentFields, bookingId),
  });

  const attached = [];
  for (const booking of loaded) {
    const attachment = attachmentFor(booking.id);
    try {
      await BookingManager.addAttachment(tenantId, booking.id, attachment);
    } catch (err) {
      // A push that fails leaves the bookings before it with the document
      // and the ones from it on without; the medium references them all.
      // There is no compensation: the log names both sides.
      logger.error(
        {
          tenantId,
          type,
          number,
          attached,
          missing: loaded.slice(attached.length).map((b) => b.id),
          err,
        },
        `Document ${number} could not be attached to every booking`,
      );
      throw err;
    }
    attached.push(booking.id);
    if (bookings) {
      booking.attachments = booking.attachments || [];
      booking.attachments.push(attachment);
    }
  }

  return {
    attachment: attachmentFor(loaded[0].id),
    file: { name: rendered.name, buffer: rendered.buffer },
  };
}

/**
 * Removes the documents of a booking: every document loses the booking's
 * reference, and with its last reference the medium and its bytes go. No
 * number logic - the numbers stay drawn.
 *
 * @param {Object} params
 * @param {string} params.tenantId
 * @param {{ id: string }} params.booking The booking being removed.
 * @returns {Promise<number>} How many documents lost the booking.
 */
async function remove({ tenantId, booking }) {
  return await deleteBookingDocuments({ tenantId, bookingId: booking.id });
}

/**
 * The group an aggregated document belongs to: the id the caller knows, else
 * the group of the first booking - a lookup, never a guess from the number
 * of bookings.
 *
 * @param {Object} params
 * @param {string} params.tenantId
 * @param {string[]} params.bookingIds
 * @param {string|null} [params.groupBookingId]
 * @returns {Promise<string>}
 */
async function groupBookingIdOf({ tenantId, bookingIds, groupBookingId }) {
  if (groupBookingId) {
    return groupBookingId;
  }
  const group = await GroupBookingManager.getGroupBookingByBookingId(
    tenantId,
    bookingIds[0],
  );
  if (!group) {
    throw new NotFoundError("group_booking_not_found", {
      bookingId: bookingIds[0],
    });
  }
  return group.id;
}

/**
 * The number of the document: the one the bookings already carry for the
 * type, as the next revision, else a freshly drawn one. Bookings of one
 * group carrying different numbers of the type cannot share a document.
 */
async function nextNumber(tenantId, type, spec, bookings) {
  const existing = bookings.flatMap((booking) =>
    (booking.attachments || []).filter((att) => att.type === type),
  );
  const ids = new Set(existing.map((att) => att[spec.idField]).filter(Boolean));
  if (ids.size > 1) {
    throw new ConflictError("document_numbers_differ", {
      type,
      bookingIds: bookings.map((booking) => booking.id),
    });
  }

  if (existing.length === 0) {
    return {
      documentId: await IdGenerator.next(tenantId, NUMBER_WIDTH, type),
      revision: 1,
    };
  }

  const highest = Math.max(...existing.map((att) => att.revision || 0));
  return {
    documentId:
      [...ids][0] || (await IdGenerator.next(tenantId, NUMBER_WIDTH, type)),
    revision: highest + 1,
  };
}

/**
 * The file of an issued document as the mail stack takes it.
 *
 * @param {{ name: string, buffer: Buffer }} file
 * @returns {Array<{ filename: string, content: Buffer, contentType: string }>}
 */
function mailAttachments(file) {
  return [
    {
      filename: file.name,
      content: file.buffer,
      contentType: "application/pdf",
    },
  ];
}

function fieldsOf(attachmentFields, bookingId) {
  if (typeof attachmentFields === "function") {
    return attachmentFields(bookingId) || {};
  }
  return attachmentFields || {};
}

module.exports = {
  issue,
  remove,
  groupBookingIdOf,
  mailAttachments,
};
