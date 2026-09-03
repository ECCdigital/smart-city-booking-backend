const PaymentService = require("./payment-service");
const BookingManager = require("../../../data-managers/booking-manager");
const TenantManager = require("../../../data-managers/tenant-manager");
const issuance = require("../../documents/document-issuance");
const mailService = require("../../../mail-service");
const bunyan = require("bunyan");

const logger = bunyan.createLogger({
  name: "invoice-payment-service",
  level: process.env.LOG_LEVEL,
});

/**
 * Payment by invoice. The payment request (glossary "Zahlungsaufforderung")
 * is the invoice this service issues, answered as a file for the booking
 * lifecycle to send, or - where the administration creates the invoice by
 * hand (`manualCreation`) - the announcement of one to follow. The
 * checkout's own invoice payment (`createPayment`) issues and mails the
 * invoice itself, outside the lifecycle. The invoices come from the
 * issuance (`document-issuance.js`).
 */
class InvoicePaymentService extends PaymentService {
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

  /** The payment request as a value (mail-stack spec, section 4). */
  async paymentRequest() {
    if (await this._isManualCreation()) {
      return { form: "pending" };
    }
    const { file } = await this._issueInvoice(
      this.bookingIds,
      await this._groupBookingId(),
    );
    return { form: "invoice", files: [file] };
  }

  /**
   * The checkout's invoice payment: one invoice per booking, or one
   * aggregated invoice for the group, issued and mailed; the announcement
   * of an invoice to follow where the administration creates it. Answers
   * what the payment endpoint hands the storefront.
   */
  async createPayment() {
    if (await this._isManualCreation()) {
      await this._notify(
        "BOOKING_CONFIRMED_INVOICE_PENDING",
        this.bookingIds,
        await this._groupBookingId(),
      );
      return { manualCreation: true, bookingIds: this.bookingIds };
    }

    if (this.aggregated) {
      const groupBookingId = await this._groupBookingId();
      const { attachment, file } = await this._issueInvoice(
        this.bookingIds,
        groupBookingId,
      );
      await this._notify("INVOICE", this.bookingIds, groupBookingId, {
        attachments: [file],
      });
      return {
        bookingIds: this.bookingIds,
        name: attachment.name,
        invoiceId: attachment.invoiceId,
        revision: attachment.revision,
      };
    }

    const createdInvoices = [];
    for (const bookingId of this.bookingIds) {
      const { attachment, file } = await this._issueInvoice([bookingId], null);
      await this._notify("INVOICE", [bookingId], null, {
        attachments: [file],
      });
      createdInvoices.push({
        bookingId,
        name: attachment.name,
        invoiceId: attachment.invoiceId,
        revision: attachment.revision,
      });
    }
    return createdInvoices;
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

  /** The group of an aggregated payment, looked up where it was not named. */
  async _groupBookingId() {
    if (!this.aggregated) {
      return null;
    }
    return issuance.groupBookingIdOf({
      tenantId: this.tenantId,
      bookingIds: this.bookingIds,
      groupBookingId: this.groupBookingId,
    });
  }

  async _issueInvoice(bookingIds, groupBookingId) {
    const bookings = await BookingManager.getBookings(
      this.tenantId,
      bookingIds,
    );
    return issuance.issue({
      tenantId: this.tenantId,
      bookingIds,
      type: "invoice",
      groupBookingId,
      bookings,
    });
  }

  /**
   * Sends a notice of the checkout's invoice payment; a mail that fails is
   * logged, the invoice stands.
   */
  async _notify(type, bookingIds, groupBookingId, specific = {}) {
    try {
      const mails = await mailService.compose(type, {
        tenantId: this.tenantId,
        bookingIds,
        groupBookingId,
        ...specific,
      });
      for (const mail of mails) {
        await mailService.send(mail);
      }
    } catch (err) {
      logger.error(
        `${this.tenantId} -- ${type} for ${bookingIds.join(", ")} failed: ${err.message}`,
      );
    }
  }
}

module.exports = InvoicePaymentService;
