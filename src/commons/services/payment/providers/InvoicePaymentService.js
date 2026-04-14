const PaymentService = require("./payment-service");
const BookingManager = require("../../../data-managers/booking-manager");
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
  async createPayment() {
    if (this.aggregated) {
      return this.createAggregatedInvoice();
    } else {
      return this.createSeparateInvoices();
    }
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
      await InvoiceService.createAggregatedInvoice(this.tenantId, bookings);

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