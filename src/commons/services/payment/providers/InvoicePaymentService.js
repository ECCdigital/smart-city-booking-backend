const PaymentService = require("./payment-service");
const BookingManager = require("../../../data-managers/booking-manager");
const TenantManager = require("../../../data-managers/tenant-manager");
const InvoiceService = require("../invoice-service");
const MailController = require("../../../mail-service/mail-controller");
const bunyan = require("bunyan");

const logger = bunyan.createLogger({
  name: "invoice-payment-service",
  level: process.env.LOG_LEVEL,
});

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
      const booking = await BookingManager.getBooking(bookingId, this.tenantId);

      const { invoice, name, invoiceId, revision, timeCreated } =
        await InvoiceService.createSingleInvoice(this.tenantId, bookingId);

      booking.attachments.push({
        type: "invoice",
        name,
        invoiceId,
        revision,
        timeCreated,
      });
      await BookingManager.storeBooking(booking);

      const attachments = [
        {
          filename: name,
          content: invoice.buffer,
          contentType: "application/pdf",
        },
      ];

      try {
        await MailController.sendInvoice(
          booking.mail,
          bookingId,
          this.tenantId,
          attachments,
        );
      } catch (err) {
        logger.error("Error while sending invoice:", bookingId, err);
      }

      createdInvoices.push({
        bookingId,
        name,
        invoiceId,
        revision,
      });
    }

    return createdInvoices;
  }

  async createAggregatedInvoice() {
    const bookings = [];
    for (const bookingId of this.bookingIds) {
      const booking = await BookingManager.getBooking(bookingId, this.tenantId);
      bookings.push(booking);
    }

    const { invoice, name, invoiceId, revision, timeCreated } =
      await InvoiceService.createAggregatedInvoice(
        this.tenantId,
        bookings,
        this.groupBookingId,
      );

    for (const booking of bookings) {
      booking.attachments.push({
        type: "invoice",
        name,
        invoiceId,
        revision,
        timeCreated,
        aggregated: true,
      });
      await BookingManager.storeBooking(booking);
    }

    const attachments = [
      {
        filename: name,
        content: invoice.buffer,
        contentType: "application/pdf",
      },
    ];

    try {
      await MailController.sendInvoice(
        bookings[0].mail,
        this.bookingIds,
        this.tenantId,
        attachments,
        true,
      );
    } catch (err) {
      logger.error("Fehler beim Versenden der Sammelrechnung:", err);
    }
  }

  async paymentNotification() {
    console.log("paymentNotification");
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
    try {
      for (const bookingId of this.bookingIds) {
        const booking = await BookingManager.getBooking(
          bookingId,
          this.tenantId,
        );

        const { invoice, name, invoiceId, revision, timeCreated } =
          await InvoiceService.createSingleInvoice(this.tenantId, bookingId);

        booking.attachments.push({
          type: "invoice",
          name,
          invoiceId,
          revision,
          timeCreated,
        });
        await BookingManager.storeBooking(booking);

        const attachments = [
          {
            filename: name,
            content: invoice.buffer,
            contentType: "application/pdf",
          },
        ];
        await MailController.sendInvoiceAfterBookingApproval(
          booking.mail,
          bookingId,
          this.tenantId,
          attachments,
          false,
        );
      }
    } catch (error) {
      throw error;
    }
  }

  async aggregatedPaymentRequest() {
    const bookings = [];
    for (const bookingId of this.bookingIds) {
      const booking = await BookingManager.getBooking(bookingId, this.tenantId);
      bookings.push(booking);
    }

    const { invoice, name, invoiceId, revision, timeCreated } =
      await InvoiceService.createAggregatedInvoice(
        this.tenantId,
        this.bookingIds,
        this.groupBookingId,
      );

    for (const booking of bookings) {
      booking.attachments.push({
        type: "invoice",
        name,
        invoiceId,
        revision,
        timeCreated,
      });
      await BookingManager.storeBooking(booking);
    }

    const attachments = [
      {
        filename: name,
        content: invoice.buffer,
        contentType: "application/pdf",
      },
    ];
    await MailController.sendInvoiceAfterBookingApproval(
      bookings[0].mail,
      bookings.map((b) => b.id),
      this.tenantId,
      attachments,
      true,
    );
  }
}

module.exports = InvoicePaymentService;
