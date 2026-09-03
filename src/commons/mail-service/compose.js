/**
 * `compose(type, ctx)` of the mail module (mail-stack spec, section 2):
 * loads once, resolves the recipients, gathers the attachments, renders,
 * and answers the mail values (glossary "Mitteilung") - none to many. The
 * caller names the type and what the notice is about, never a recipient,
 * a template or an attachment order.
 *
 * The context of a booking notice has the form of the issuance's `issue`:
 *
 *   compose(type, { tenantId, bookingIds, groupBookingId = null, ...specific })
 *
 * `groupBookingId` set is the aggregated notice of a group (glossary
 * "Sammelmitteilung"); otherwise exactly one booking - more than one
 * without a group is a programming error, not a fan-out (spec 5.7). The
 * type-specific part: `attachments` (issued files `{ name, buffer }`),
 * `reason`, `hookId`, `refundPreview`, `paymentUrl`, `accessPoints`, `to`.
 *
 * Attachments go in the order issued files → `mailAttach` documents (only
 * `mergeMailAttach`) → iCal (only `attachICal`) → QR code (only
 * `includeQRCode`), section 2.6.
 *
 * A tenant notice names the tenant and the address (`{ tenantId, to,
 * ... }`), an instance notice the address or the user (`{ to, ... }`,
 * `{ userId }`); both go out in the shell template of the tenant or the
 * instance, without attachments.
 */

const bunyan = require("bunyan");
const TenantManager = require("../data-managers/tenant-manager");
const InstanceManager = require("../data-managers/instance-manager");
const UserManager = require("../data-managers/user-manager");
const BookingManager = require("../data-managers/booking-manager");
const { BookableManager } = require("../data-managers/bookable-manager");
const EventManager = require("../data-managers/event-manager");
const ICalService = require("../services/ical-service");
const { embedMediaImages } = require("../services/media/mail-media");
const {
  mailAttachments: issuedFileAttachments,
} = require("../services/documents/document-issuance");
const { BadRequestError, NotFoundError } = require("../../errors/BaseError");
const { MailType } = require("./mail-types");
const { resolveRecipients } = require("./recipients");
const { prepareMailAttachments } = require("./mail-attachments");
const { render, renderShellNotice } = require("./render");

const logger = bunyan.createLogger({
  name: "mail-compose.js",
  level: process.env.LOG_LEVEL,
});

function unique(values) {
  return [...new Set(values.filter((value) => value != null))];
}

async function loadTenant(tenantId) {
  const tenant = await TenantManager.getTenant(tenantId);
  if (!tenant) {
    throw new NotFoundError("tenant_not_found", { tenantId });
  }
  return tenant;
}

/**
 * The tenant, the bookings in the order of their ids, the bookables of
 * every position and the events of the tickets - each read once.
 */
async function load({ tenantId, bookingIds }) {
  const tenant = await loadTenant(tenantId);

  const found = await BookingManager.getBookings(tenantId, bookingIds);
  const bookings = bookingIds.map((id) =>
    found.find((booking) => booking.id === id),
  );
  const missing = bookingIds.filter((id, index) => !bookings[index]);
  if (missing.length > 0) {
    throw new NotFoundError("booking_not_found", { bookingIds: missing });
  }

  const bookables = await BookableManager.getBookablesByIds(
    tenantId,
    unique(
      bookings.flatMap((booking) =>
        (booking.bookableItems || []).map((item) => item.bookableId),
      ),
    ),
  );
  const eventIds = unique(
    bookables
      .filter((bookable) => bookable.type === "ticket")
      .map((bookable) => bookable.eventId),
  );
  const events = new Map(
    await Promise.all(
      eventIds.map(async (id) => [
        id,
        await EventManager.getEvent(id, tenantId),
      ]),
    ),
  );

  return { tenantId, tenant, bookings, bookables, events };
}

/**
 * The calendar file of the loaded bookings, built off what the loader
 * read; none where it cannot be built.
 */
async function icalAttachment(loaded) {
  const { tenantId, bookings } = loaded;
  try {
    const single = bookings.length === 1;
    const cal = await ICalService.bookingsCal(loaded);
    return [
      {
        filename: single ? `buchung-${bookings[0].id}.ics` : "buchungen.ics",
        content: Buffer.from(cal.toString(), "utf-8"),
        contentType: "text/calendar; charset=UTF-8; method=PUBLISH",
      },
    ];
  } catch (err) {
    logger.warn(
      `${tenantId} -- no calendar file for ${bookings.map((b) => b.id).join(", ")}: ${err.message}`,
    );
    return [];
  }
}

/**
 * What a tenant or instance notice is rendered over: the tenant, or the
 * instance and the user the context names - each read once.
 */
async function loadShell(family, ctx) {
  if (family === "tenant") {
    const tenant = await loadTenant(ctx.tenantId);
    return { tenantId: ctx.tenantId, tenant, instance: null, user: null };
  }
  const instance = await InstanceManager.getInstance(false);
  const user = ctx.userId ? await UserManager.getUser(ctx.userId) : null;
  if (ctx.userId && !user) {
    throw new NotFoundError("user_not_found", { userId: ctx.userId });
  }
  return { tenantId: null, tenant: null, instance, user };
}

/**
 * Composes a notice.
 *
 * @param {string} type A key of the registry (`mail-types.js`)
 * @param {Object} ctx Of a booking notice: `tenantId`, `bookingIds`,
 *   `groupBookingId` (the group of an aggregated notice), `attachments`
 *   (issued files `{ name, buffer }`) and the type's own fields. Of a
 *   tenant notice: `tenantId`, `to` and the type's own fields. Of an
 *   instance notice: `to` or `userId` and the type's own fields.
 * @returns {Promise<Object[]>} The mail values (spec 2.1), one per recipient;
 *   none where the circle is empty
 * @throws {BadRequestError} For several bookings without a group
 * @throws {NotFoundError} For a tenant, a booking or a user the store does
 *   not know
 */
async function compose(type, ctx) {
  const mailType = MailType[type];
  if (!mailType) {
    throw new Error(`mail-service: unknown notice type ${type}`);
  }
  return mailType.family === "booking"
    ? composeBookingNotice(type, mailType, ctx)
    : composeShellNotice(type, mailType, ctx);
}

async function composeShellNotice(type, mailType, ctx) {
  const loaded = await loadShell(mailType.family, ctx);
  const recipients = await resolveRecipients(mailType, { ...loaded, ctx });
  if (recipients.length === 0) {
    logger.info(
      `${loaded.tenantId ?? "instance"} -- ${type}: nobody to tell, no mail`,
    );
    return [];
  }

  const mails = await renderShellNotice(type, {
    mailType,
    ...loaded,
    recipients,
    templateData: mailType.templateData
      ? mailType.templateData(ctx, loaded)
      : {},
  });

  const html = await embedMediaImages(mails[0].html, loaded.tenantId);
  return mails.map((mail) => ({ ...mail, html }));
}

async function composeBookingNotice(type, mailType, ctx) {
  const {
    tenantId,
    bookingIds,
    groupBookingId = null,
    attachments: files = [],
    ...specific
  } = ctx;
  if (!Array.isArray(bookingIds) || bookingIds.length === 0) {
    throw new BadRequestError("mail_without_booking", { type });
  }
  if (bookingIds.length > 1 && !groupBookingId) {
    throw new BadRequestError("mail_bookings_without_group", {
      type,
      bookingIds,
    });
  }

  const loaded = await load({ tenantId, bookingIds });
  const recipients = await resolveRecipients(mailType, {
    ...loaded,
    ctx: specific,
  });
  if (recipients.length === 0) {
    logger.info(`${tenantId} -- ${type}: nobody to tell, no mail`);
    return [];
  }

  const attachments = [
    ...files.flatMap((file) => issuedFileAttachments(file)),
    ...(mailType.mergeMailAttach
      ? await prepareMailAttachments(
          loaded.bookings.flatMap((booking) => booking.attachments || []),
          tenantId,
        )
      : []),
    ...(mailType.attachICal ? await icalAttachment(loaded) : []),
  ];

  const mails = await render(type, {
    mailType,
    ...loaded,
    aggregated: Boolean(groupBookingId),
    recipients,
    attachments,
    templateData: mailType.templateData
      ? mailType.templateData(specific, loaded)
      : {},
  });

  // One body for every recipient: embedded once, on the finished html.
  const html = await embedMediaImages(mails[0].html, tenantId);
  return mails.map((mail) => ({ ...mail, html }));
}

module.exports = { compose };
