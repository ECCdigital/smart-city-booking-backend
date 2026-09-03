const PaymentService = require("./payment-service");
const BookingManager = require("../../../data-managers/booking-manager");
const TenantManager = require("../../../data-managers/tenant-manager");
const MailController = require("../../../mail-service/mail-controller");
const {
  issue: issueDocument,
  groupBookingIdOf,
} = require("../../documents/document-issuance");
const bunyan = require("bunyan");

const logger = bunyan.createLogger({
  name: "invoice-payment-service",
  level: process.env.LOG_LEVEL,
});

/**
 * Payment by invoice: the payment request is an issued invoice, mailed to
 * the customer, or the announcement of an invoice the administration
 * creates later (`manualCreation`). The invoices themselves come from the
 * issuance (`document-issuance.js`); this service only mails them.
 */
class InvoicePaymentService extends PaymentService {
  constructor(tenantId, bookingIds, options = {}) {
    super(tenantId, bookingIds, options);
  }

  /**
   * Checks if the invoice app has manualCreation enabled.
   * @returns {Promise<boolean>}
   */
  async _isManualCreation() {
    const invoiceApp = await TenantManager.getTenantApp(
      this.tenantId,
      "invoice",
    );
    return invoiceApp?.manualCreation === true;
  }

  async createPayment() {
    const isManual = await this._isManualCreation();

    if (isManual) {
      return this._sendInvoicePendingNotification();
    }

    if (this.aggregated) {
      return this.createAggregatedInvoice();
    } else {
      return this.createSeparateInvoices();
    }
  }

  /**
   * Sends an email to the user that the booking is confirmed and
   * the invoice will follow separately (manualCreation mode).
   */
  async _sendInvoicePendingNotification() {
    const bookings = [];
    for (const bookingId of this.bookingIds) {
      const booking = await BookingManager.getBooking(bookingId, this.tenantId);
      bookings.push(booking);
    }

    const address = bookings[0].mail;

    try {
      await MailController.sendBookingConfirmedInvoicePending(
        address,
        this.bookingIds,
        this.tenantId,
        this.aggregated,
      );
    } catch (err) {
      logger.error(
        "Error while sending invoice-pending notification:",
        this.bookingIds,
        err,
      );
    }

    return { manualCreation: true, bookingIds: this.bookingIds };
  }

  async createSeparateInvoices() {
    const createdInvoices = [];
    for (const bookingId of this.bookingIds) {
      const { booking, attachment, mailAttachments } =
        await this._issueSingleInvoice(bookingId);

      try {
        await MailController.sendInvoice(
          booking.mail,
          bookingId,
          this.tenantId,
          mailAttachments,
        );
      } catch (err) {
        logger.error("Error while sending invoice:", bookingId, err);
      }

      createdInvoices.push({
        bookingId,
        name: attachment.name,
        invoiceId: attachment.invoiceId,
        revision: attachment.revision,
      });
    }

    return createdInvoices;
  }

  async createAggregatedInvoice() {
    const { booking, attachment, mailAttachments } =
      await this._issueAggregatedInvoice();

    try {
      await MailController.sendInvoice(
        booking.mail,
        this.bookingIds,
        this.tenantId,
        mailAttachments,
        true,
      );
    } catch (err) {
      logger.error("Fehler beim Versenden der Sammelrechnung:", err);
    }

    return {
      bookingIds: this.bookingIds,
      name: attachment.name,
      invoiceId: attachment.invoiceId,
      revision: attachment.revision,
    };
  }

  /**
   * Invoices are settled outside the platform, so there is no provider
   * notification to process.
   */
  async paymentNotification() {
    logger.debug(
      `${this.tenantId} -- paymentNotification is a no-op for invoice payments`,
    );
  }

  async paymentRequest() {
    const isManual = await this._isManualCreation();

    if (isManual) {
      return this._sendInvoicePendingNotification();
    }

    if (this.aggregated) {
      return this.aggregatedPaymentRequest();
    } else {
      return this.separatePaymentRequest();
    }
  }

  async separatePaymentRequest() {
    for (const bookingId of this.bookingIds) {
      const { booking, mailAttachments } =
        await this._issueSingleInvoice(bookingId);

      await MailController.sendInvoiceAfterBookingApproval(
        booking.mail,
        bookingId,
        this.tenantId,
        mailAttachments,
        false,
      );
    }
  }

  async aggregatedPaymentRequest() {
    const { booking, mailAttachments } = await this._issueAggregatedInvoice();

    await MailController.sendInvoiceAfterBookingApproval(
      booking.mail,
      this.bookingIds,
      this.tenantId,
      mailAttachments,
      true,
    );
  }

  async _issueSingleInvoice(bookingId) {
    const booking = await BookingManager.getBooking(bookingId, this.tenantId);
    const { attachment, file } = await issueDocument({
      tenantId: this.tenantId,
      bookingIds: [bookingId],
      type: "invoice",
    });
    return { booking, attachment, mailAttachments: toMailAttachments(file) };
  }

  async _issueAggregatedInvoice() {
    const booking = await BookingManager.getBooking(
      this.bookingIds[0],
      this.tenantId,
    );
    const { attachment, file } = await issueDocument({
      tenantId: this.tenantId,
      bookingIds: this.bookingIds,
      type: "invoice",
      groupBookingId: await groupBookingIdOf({
        tenantId: this.tenantId,
        bookingIds: this.bookingIds,
        groupBookingId: this.groupBookingId,
      }),
    });
    return { booking, attachment, mailAttachments: toMailAttachments(file) };
  }
}

function toMailAttachments(file) {
  return [
    {
      filename: file.name,
      content: file.buffer,
      contentType: "application/pdf",
    },
  ];
}

module.exports = InvoicePaymentService;
