/**
 * The pure rendering of a notice (mail-stack spec, section 2.4): from
 * what the loader read to the mail values, without a store. A booking
 * notice (`render`): the snippet with the tenant's override and
 * after-text, the subject with its override, the booking details with
 * their mail visibility, the QR code, the cancellation link, the wrapper
 * of a single or an aggregated notice (glossary "Sammelmitteilung") and
 * the tenant's shell template. A tenant or instance notice
 * (`renderShellNotice`): the snippet with the type's template data in the
 * shell template of the tenant or the instance. Media images are embedded
 * by `compose` afterwards, on the finished body.
 *
 * An internal seam of the mail module, not part of its interface.
 */

const Handlebars = require("handlebars");
const QRCode = require("qrcode");
const MailerService = require("./mail-service");
const { renderSnippet } = require("./templates/template-loader");
const {
  getSnippetOverride,
  getSubjectOverride,
  renderSubjectOverride,
  afterSnippetKey,
} = require("./templates/mail-snippet-overrides");
const {
  CustomFieldService,
} = require("../services/custom-field/custom-field-service");
const Formatters = require("../utilities/formatters");

const overrideDateFormatter = new Intl.DateTimeFormat("de-DE", {
  day: "2-digit",
  month: "2-digit",
  year: "numeric",
});

function resolve(valueOrFn, ctx) {
  return typeof valueOrFn === "function" ? valueOrFn(ctx) : valueOrFn;
}

function escapeHtml(value) {
  if (value === null || value === undefined || value === "") return "";
  return String(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function customerContactHtml(booking) {
  if (!booking) return "";

  const lines = [];
  if (booking.name) {
    lines.push(`<strong>Name:</strong> ${escapeHtml(booking.name)}`);
  }
  if (booking.company) {
    lines.push(`<strong>Firma:</strong> ${escapeHtml(booking.company)}`);
  }
  if (booking.mail) {
    lines.push(`<strong>E-Mail:</strong> ${escapeHtml(booking.mail)}`);
  }
  if (booking.phone) {
    lines.push(`<strong>Telefon:</strong> ${escapeHtml(booking.phone)}`);
  }

  const cityLine = [booking.zipCode, booking.location]
    .filter(Boolean)
    .map(escapeHtml)
    .join(" ");
  const addressParts = [];
  if (booking.street) addressParts.push(escapeHtml(booking.street));
  if (cityLine) addressParts.push(cityLine);
  if (addressParts.length) {
    lines.push(`<strong>Adresse:</strong> ${addressParts.join(", ")}`);
  }

  return lines.join("<br />");
}

/** The variables a tenant's override may use (`OVERRIDE_TEMPLATE_VARIABLES`). */
function overrideVariables({ tenant, booking, extra = {} }) {
  const contact = customerContactHtml(booking);
  return {
    tenantName: tenant?.name ?? "",
    supportEmail: tenant?.mail ?? "",
    customerName: booking?.name ?? "",
    customerContact: contact ? new Handlebars.SafeString(contact) : "",
    currentDate: overrideDateFormatter.format(new Date()),
    ...extra,
  };
}

/**
 * The cancellation link of a booking the customer may cancel, else the
 * tenant's hint on how to cancel.
 */
function cancellationContext(booking, tenantId, addRejectionLink) {
  if (!addRejectionLink || !booking) {
    return { rejectionUrl: null, cancellationContactHint: null };
  }

  if (booking.cancellationPolicy?.userCancellable === true) {
    return {
      rejectionUrl: `${process.env.FRONTEND_URL}/booking/request-reject/${tenantId}?id=${booking.id}`,
      cancellationContactHint: null,
    };
  }

  const contactHint = booking.cancellationPolicy?.contactHint?.trim();
  return { rejectionUrl: null, cancellationContactHint: contactHint || null };
}

function bookingItems(booking, bookables, events) {
  return (booking.bookableItems || []).map((item) => {
    const bookable = bookables.find((b) => b.id === item.bookableId);
    const event =
      bookable?.type === "ticket" && bookable.eventId
        ? events.get(bookable.eventId)
        : null;

    return {
      amount: item.amount,
      isTicket: Boolean(event),
      bookableTitle: bookable?.title,
      bookingNotes: bookable?.bookingNotes,
      event: event
        ? {
            name: event.information.name,
            startDate: event.information.startDate,
            startTime: event.information.startTime,
            endDate: event.information.endDate,
            endTime: event.information.endTime,
            locationName: event.eventLocation.name,
            locationStreet: event.location?.address?.street,
            locationHouseNumber: event.location?.address?.house_number,
            locationZip: event.location?.address?.post_code,
            locationCity: event.location?.address?.city,
          }
        : null,
    };
  });
}

function couponInfo(booking) {
  if (!booking.coupon) return null;
  const { type, description, value } = booking.coupon;
  if (type === "fixed" || type === "percentage") {
    return { description, value, isFixed: type === "fixed" };
  }
  return null;
}

/**
 * The details of one booking, as a single notice prints them: contact,
 * comment, the custom fields flagged for the mail, the period, the
 * positions with their events and notes, the coupon.
 *
 * @param {Object} params
 * @param {Object} params.booking
 * @param {Object} params.tenant
 * @param {Object[]} params.bookables The bookables of the booking's positions
 * @param {Map<string, Object>} [params.events] The events of the tickets, by id
 * @returns {string} HTML
 */
function renderBookingDetails({ booking, tenant, bookables, events }) {
  const bookingPeriod = Formatters.formatBookingPeriod(
    booking.timeBegin,
    booking.timeEnd,
    tenant.mailBookingPeriodFormat,
  );

  // Order follows the merge order of the definitions (instance → tenant →
  // bookable); a null displayValue renders as "nicht angegeben".
  const mailCustomFields = (booking.customFields || [])
    .filter((field) => field.usageOptions?.showInMail === true)
    .map((field) => ({
      caption: field.caption,
      displayValue: CustomFieldService.formatValueForDisplay(
        field,
        field.value,
      ),
    }));

  return renderSnippet("booking-details", {
    booking,
    bookingItems: bookingItems(booking, bookables, events ?? new Map()),
    coupon: couponInfo(booking),
    bookingPeriod,
    mailCustomFields,
  });
}

/** The details of one member of a group, in short form. */
function renderShortBookingDetails({
  booking,
  tenant,
  tenantId,
  bookables,
  addRejectionLink,
}) {
  const items = (booking.bookableItems || []).map((item) => {
    const bookable = bookables.find((b) => b.id === item.bookableId);
    return { amount: item.amount, bookableTitle: bookable?.title };
  });
  const bookingPeriod = Formatters.formatBookingPeriod(
    booking.timeBegin,
    booking.timeEnd,
    tenant.mailBookingPeriodFormat,
  );

  return renderSnippet("short-booking-details", {
    booking,
    bookingItems: items,
    ...cancellationContext(booking, tenantId, addRejectionLink),
    bookingPeriod,
  });
}

/** The QR code of the public status view: its paragraph and its image. */
async function qrCode(booking, tenantId) {
  const qrUrl = `${process.env.FRONTEND_URL}/booking/status/${tenantId}?id=${booking.id}&name=${encodeURIComponent(booking.name)}`;
  return {
    content: renderSnippet("qr-code", { qrUrl }),
    attachment: {
      filename: "qrcode.png",
      content: await QRCode.toBuffer(qrUrl),
      cid: "qrcode_cid",
    },
  };
}

/**
 * Renders a booking notice into its mail values, one per recipient.
 *
 * The shell template is rendered here (`processTemplate`), the media
 * images are embedded by `compose` - the two halves of
 * `MailerService.renderHtml`, split so that this stays store-free.
 *
 * @param {string} type The registry key
 * @param {Object} loaded What `compose` loaded and resolved
 * @param {Object} loaded.mailType The registry entry
 * @param {string} loaded.tenantId
 * @param {Object} loaded.tenant
 * @param {Object[]} loaded.bookings In the order of the context's ids
 * @param {Object[]} loaded.bookables The bookables of every position
 * @param {Map<string, Object>} loaded.events The events of the tickets, by id
 * @param {boolean} loaded.aggregated One notice for a group
 * @param {string[]} loaded.recipients
 * @param {Object[]} loaded.attachments Nodemailer attachments, loaded, before the QR code
 * @param {Object} [loaded.templateData] The type's own template variables
 * @returns {Promise<Object[]>} The mail values (spec 2.1), html without media embedded
 */
async function render(
  type,
  {
    mailType,
    tenantId,
    tenant,
    bookings,
    bookables,
    events,
    aggregated,
    recipients,
    attachments,
    templateData = {},
  },
) {
  if (recipients.length === 0) {
    return [];
  }
  const booking = bookings[0];
  const ctx = { tenant, hasAttachments: attachments.length > 0 };
  const includeQRCode = !aggregated && resolve(mailType.includeQRCode, ctx);
  const sendBCC = resolve(mailType.sendBCC, ctx);
  const addRejectionLink = resolve(mailType.addRejectionLink, ctx);
  // The payment link is the wrapper's, not a variable of the overrides.
  const { paymentUrl = null, ...extra } = templateData;
  const { cancelReason = null, rejectionReason = null } = extra;

  const variables = overrideVariables({ tenant, booking, extra });
  const message = renderSnippet(mailType.templateName, variables, {
    overrideSource: getSnippetOverride(tenant, mailType.templateName),
  });
  const afterOverrideSource = getSnippetOverride(
    tenant,
    afterSnippetKey(mailType.templateName),
  );
  const messageAfter = afterOverrideSource
    ? renderSnippet(afterSnippetKey(mailType.templateName), variables, {
        overrideSource: afterOverrideSource,
      })
    : "";
  const subjectOverrideSource = getSubjectOverride(
    tenant,
    mailType.templateName,
  );
  const subject = subjectOverrideSource
    ? renderSubjectOverride(subjectOverrideSource, variables)
    : resolve(mailType.subject, ctx);

  const shell = {
    message,
    paymentUrl,
    cancelReason,
    rejectionReason,
    showFooter: tenant.mailShowSupportFooter !== false,
    supportEmail: tenant.mail,
    messageAfter,
  };
  let content;
  let allAttachments = attachments;
  if (aggregated) {
    const subBookings = bookings.map((member) =>
      renderShortBookingDetails({
        booking: member,
        tenant,
        tenantId,
        bookables,
        addRejectionLink,
      }),
    );
    content = renderSnippet("aggregated-booking-wrapper", {
      ...shell,
      bookingDetails: renderSnippet("aggregated-booking-details", {
        totalPrice: bookings.reduce((sum, member) => sum + member.priceEur, 0),
        subBookings,
        booking,
      }),
    });
  } else {
    const qr = includeQRCode ? await qrCode(booking, tenantId) : null;
    if (qr) {
      allAttachments = [...attachments, qr.attachment];
    }
    content = renderSnippet("single-booking-wrapper", {
      ...shell,
      bookingDetails: renderBookingDetails({
        booking,
        tenant,
        bookables,
        events,
      }),
      ...cancellationContext(booking, tenantId, addRejectionLink),
      qrContent: qr ? qr.content : "",
    });
  }

  const html = await MailerService.processTemplate(tenant.genericMailTemplate, {
    content,
  });

  return recipients.map((to) => ({
    type,
    tenantId,
    to,
    bcc: sendBCC ? tenant.mail : undefined,
    subject,
    html,
    attachments: allAttachments,
  }));
}

/**
 * Renders a tenant or instance notice - verification, password, user
 * created, card link, invitation, workflow - into its mail values, one per
 * recipient: the
 * snippet with the type's template data, in the shell template of the
 * tenant (`genericMailTemplate`) or the instance (`mailTemplate`), the
 * subject as its title. No override, no booking details, no attachments.
 *
 * @param {string} type The registry key
 * @param {Object} loaded What `compose` loaded and resolved
 * @param {Object} loaded.mailType The registry entry
 * @param {string|null} loaded.tenantId Null for an instance notice
 * @param {Object|null} loaded.tenant
 * @param {Object|null} loaded.instance
 * @param {string[]} loaded.recipients
 * @param {Object} [loaded.templateData] The type's own template variables
 * @returns {Promise<Object[]>} The mail values (spec 2.1), html without media embedded
 */
async function renderShellNotice(
  type,
  { mailType, tenantId, tenant, instance, recipients, templateData = {} },
) {
  const subject = resolve(mailType.subject, { tenant, ...templateData });
  const content = renderSnippet(mailType.templateName, templateData);
  const shellTemplate =
    mailType.family === "tenant"
      ? tenant.genericMailTemplate
      : instance.mailTemplate;
  const html = await MailerService.processTemplate(shellTemplate, {
    title: subject,
    content,
  });

  return recipients.map((to) => ({
    type,
    tenantId,
    to,
    subject,
    html,
    attachments: [],
  }));
}

module.exports = { render, renderShellNotice, renderBookingDetails };
