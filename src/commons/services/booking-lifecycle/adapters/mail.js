/**
 * The mail adapter of the booking lifecycle seam: the nine intents the
 * lifecycle knows, each `(bookings, options)`, over `MailController` (spec
 * part 2, section 10). The lifecycle names bookings and the documents it
 * issued; templates, recipients and the compose/send split are the mail
 * stack's, behind this adapter.
 *
 * The three confirmations add the `mailAttach` documents of the bookings
 * (the house rules of a room, say) after the issued documents - joined,
 * not replaced.
 */

const bunyan = require("bunyan");
const { isEmail } = require("validator");
const MailController = require("../../../mail-service/mail-controller");
const EventManager = require("../../../data-managers/event-manager");
const TenantManager = require("../../../data-managers/tenant-manager");
const SupervisorNotificationService = require("../../supervisor-notification-service");
const {
  mailAttachments: fileAttachment,
} = require("../../documents/document-issuance");
const mailAttachments = require("../mail-attachments");
const { SKIPPED } = require("../pipeline");

const logger = bunyan.createLogger({
  name: "booking-lifecycle-mail.js",
  level: process.env.LOG_LEVEL,
});

/** The booking id, or the list of ids of an aggregated mail. */
function idsOf(bookings, aggregated) {
  return aggregated ? bookings.map((booking) => booking.id) : bookings[0].id;
}

/**
 * The issued documents as the mail stack takes them, followed by the
 * `mailAttach` documents of the bookings.
 */
async function withMailAttach(bookings, files) {
  const issued = files.flatMap((file) => fileAttachment(file));
  const prepared = await mailAttachments.prepareMailAttachments(
    bookings.flatMap((booking) => booking.attachments || []),
    bookings[0].tenantId,
  );
  return [...issued, ...prepared];
}

/**
 * Tells the organizers of the events the given ticket positions belong to
 * of a booking. Never throws: a mail to an organizer that fails is logged.
 *
 * @param {string} tenantId
 * @param {Object} booking
 * @param {string[]} eventIds
 */
async function notifyOrganizers(tenantId, booking, eventIds) {
  try {
    const uniqueEventIds = [...new Set(eventIds)];

    const events = await Promise.all(
      uniqueEventIds.map((eventId) => EventManager.getEvent(eventId, tenantId)),
    );

    const organizerMails = events
      .map((event) => event?.eventOrganizer?.contactPersonEmailAddress)
      .filter((email) => isEmail(email));
    const uniqueOrganizerMails = [...new Set(organizerMails)];

    if (uniqueOrganizerMails.length === 0) {
      logger.warn(`No organizer found for booking: ${booking.id}`);
      return;
    }

    await Promise.all(
      uniqueOrganizerMails.map(async (organizerMail) => {
        try {
          await MailController.sendNewBooking(
            organizerMail,
            booking.id,
            booking.tenantId,
          );
          logger.info(
            `Successfully send mail to organizer ${organizerMail} for booking ${booking.id}.`,
          );
        } catch (err) {
          logger.error(
            `Error while sending mail to organizer ${organizerMail} for booking ${booking.id}: ${err.message}`,
          );
        }
      }),
    );
  } catch (err) {
    logger.error(
      `Error when retrieving events or sending mails: ${err.message}`,
    );
  }
}

/** The event ids of the ticket positions of a booking. */
function ticketEventIds(booking) {
  return (booking.bookableItems || [])
    .map((item) => item?._bookableUsed)
    .filter((bookable) => bookable?.type === "ticket")
    .map((bookable) => bookable.eventId)
    .filter((id) => id !== null && id !== undefined);
}

const mail = {
  /** The receipt of a request (`requested`). */
  async sendRequestConfirmation(
    bookings,
    { attachments = [], aggregated = false } = {},
  ) {
    await MailController.sendBookingRequestConfirmation(
      bookings[0].mail,
      idsOf(bookings, aggregated),
      bookings[0].tenantId,
      aggregated,
      await withMailAttach(bookings, attachments),
    );
  },

  /** The confirmation of a paid booking, with its receipt. */
  async sendBookingConfirmation(
    bookings,
    { attachments = [], aggregated = false } = {},
  ) {
    await MailController.sendBookingConfirmation(
      bookings[0].mail,
      idsOf(bookings, aggregated),
      bookings[0].tenantId,
      await withMailAttach(bookings, attachments),
      aggregated,
    );
  },

  /** The confirmation of a free booking. */
  async sendFreeBookingConfirmation(
    bookings,
    { attachments = [], aggregated = false } = {},
  ) {
    await MailController.sendFreeBookingConfirmation(
      bookings[0].mail,
      idsOf(bookings, aggregated),
      bookings[0].tenantId,
      await withMailAttach(bookings, attachments),
      aggregated,
    );
  },

  /** The cancellation of a confirmed booking, with its cancellation document. */
  async sendBookingCancel(
    bookings,
    { attachments = [], aggregated = false, reason = "" } = {},
  ) {
    await MailController.sendBookingCancel(
      bookings[0].mail,
      idsOf(bookings, aggregated),
      bookings[0].tenantId,
      reason,
      attachments.flatMap((file) => fileAttachment(file)),
      aggregated,
    );
  },

  /** The rejection of a request. */
  async sendBookingRejection(
    bookings,
    { attachments = [], aggregated = false, reason = "" } = {},
  ) {
    await MailController.sendBookingRejection(
      bookings[0].mail,
      idsOf(bookings, aggregated),
      bookings[0].tenantId,
      reason,
      attachments.flatMap((file) => fileAttachment(file)),
      aggregated,
    );
  },

  /** The verification of a cancellation request, with the refund preview. */
  async sendVerifyBookingRejection(
    bookings,
    { hookId, reason = "", attachments = [], refundPreview = null } = {},
  ) {
    await MailController.sendVerifyBookingRejection(
      bookings[0].mail,
      bookings[0].id,
      bookings[0].tenantId,
      hookId,
      reason,
      attachments.flatMap((file) => fileAttachment(file)),
      refundPreview,
    );
  },

  /** The organizers of the events the ticket positions belong to. */
  async sendEmailToOrganizer(bookings) {
    for (const booking of bookings) {
      const eventIds = ticketEventIds(booking);
      if (eventIds.length > 0) {
        await notifyOrganizers(booking.tenantId, booking, eventIds);
      }
    }
  },

  /** The tenant's notice of a new booking, where the tenant wants one. */
  async sendTenantMail(bookings, { aggregated = false } = {}) {
    const tenant = await TenantManager.getTenant(bookings[0].tenantId);
    if (!tenant?.notifyOnNewBooking) {
      return SKIPPED;
    }
    await MailController.sendIncomingBooking(
      tenant.mail,
      idsOf(bookings, aggregated),
      bookings[0].tenantId,
      aggregated,
    );
  },

  /** The supervisors' notice of a new booking. */
  async sendSupervisorMail(bookings, { aggregated = false } = {}) {
    await SupervisorNotificationService.notifySupervisorsOnBookingCreated({
      tenantId: bookings[0].tenantId,
      userId: bookings[0].assignedUserId,
      bookingIds: idsOf(bookings, aggregated),
      aggregated,
    });
  },
};

module.exports = mail;
module.exports.notifyOrganizers = notifyOrganizers;
