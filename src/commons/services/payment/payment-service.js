const { getBooking } = require("../../data-managers/booking-manager");
const { getTenantApp } = require("../../data-managers/tenant-manager");
const bunyan = require("bunyan");
const axios = require("axios");
const qs = require("qs");
const crypto = require("crypto");
const BookingManager = require("../../data-managers/booking-manager");
const ReceiptService = require("./receipt-service");
const TenantManager = require("../../data-managers/tenant-manager");
const InvoiceService = require("./invoice-service");
const MailController = require("../../mail-service/mail-controller");

const logger = bunyan.createLogger({
  name: "payment-service.js",
  level: process.env.LOG_LEVEL,
});

class PaymentService {
  /**
   * @param {string} tenantId   - ID des Mandanten.
   * @param {string|string[]} bookingIds - Entweder eine einzelne Booking-ID oder ein Array von Booking-IDs.
   * @param {object} [options]  - Zusätzliche Optionen, z.B. { aggregated: true }
   */
  constructor(tenantId, bookingIds, options = {}) {
    this.tenantId = tenantId;
    this.bookingIds = Array.isArray(bookingIds) ? bookingIds : [bookingIds];
    this.aggregated = !!options.aggregated;
  }

  createPayment() {
    throw new Error("createPayment not implemented");
  }

  createSeparateInvoices() {
    throw new Error("createSeparateInvoices not implemented");
  }

  createAggregatedInvoice() {
    throw new Error("createAggregatedInvoice not implemented");
  }

  paymentNotification() {
    throw new Error("paymentNotification not implemented");
  }

  paymentResponse() {
    throw new Error("paymentResponse not implemented");
  }

  paymentRequest() {
    throw new Error("paymentRequest not implemented");
  }

  async handleSuccessfulPayment({ bookingIds, tenantId, paymentMethod }) {
    const bookings = await BookingManager.getBooking(tenantId, bookingIds);
    const processedBookings = [];
    if (this.aggregated) {
      //TODO: handle aggregated payment
    } else {
      for (const booking of bookings) {
        booking.isPayed = true;
        booking.paymentMethod = paymentMethod;
        await BookingManager.setBookingPayedStatus(booking);

        if (booking.isCommitted && booking.isPayed) {
          let attachments = [];
          if (booking.priceEur > 0) {
            const { receipt, name, receiptId, revision, timeCreated } =
              await ReceiptService.createReceipt(tenantId, booking.id);

            booking.attachments.push({
              type: "receipt",
              title: name,
              receiptId: receiptId,
              revision: revision,
              timeCreated,
            });

            await BookingManager.storeBooking(booking);

            attachments = [
              {
                filename: name,
                content: receipt.buffer,
                contentType: "application/pdf",
              },
            ];
          }

          try {
            await MailController.sendBookingConfirmation(
              booking.mail,
              booking.id,
              tenantId,
              attachments,
            );

            const tenant = await TenantManager.getTenant(tenantId);
            await MailController.sendIncomingBooking(
              tenant.mail,
              booking.id,
              tenantId,
            );
          } catch (err) {
            logger.error(err);
          }
        }

        processedBookings.push(booking);
      }
    }

    return processedBookings;
  }
}

class GiroCockpitPaymentService extends PaymentService {
  static GIRO_SUCCESS_CODE = "4000";

  async createPayment() {
    const booking = await getBooking(this.bookingId, this.tenantId);
    const paymentApp = await getTenantApp(this.tenantId, "giroCockpit");

    try {
      const GIRO_CHECKOUT_URL =
        "https://payment.girosolution.de/girocheckout/api/v2/paypage/init";
      const type = "SALE";
      const test = 1;
      const currency = "EUR";

      const merchantTxId = this.bookingId;
      const amount = (booking.priceEur * 100 || 0).toString();
      const purpose = `${this.bookingId} ${
        paymentApp.paymentPurposeSuffix || ""
      }`;

      const MERCHANT_ID = paymentApp.paymentMerchantId;
      const PROJECT_ID = paymentApp.paymentProjectId;
      const PROJECT_SECRET = paymentApp.paymentSecret;

      const notifyUrl = `${process.env.BACKEND_URL}/api/${this.tenantId}/payments/notify?id=${this.bookingId}`;
      const successUrl = `${process.env.BACKEND_URL}/api/${this.tenantId}/payments/response?id=${merchantTxId}&tenant=${this.tenantId}&status=success&paymentMethod=${paymentApp.id}`;
      const failUrl = `${process.env.BACKEND_URL}/api/${this.tenantId}/payments/response?id=${merchantTxId}&tenant=${this.tenantId}&status=fail&paymentMethod=${paymentApp.id}`;
      const backUrl = `${process.env.BACKEND_URL}/api/${this.tenantId}/payments/response?id=${merchantTxId}&tenant=${this.tenantId}&status=back&paymentMethod=${paymentApp.id}`;
      const hash = crypto
        .createHmac("md5", PROJECT_SECRET)
        .update(
          `${MERCHANT_ID}${PROJECT_ID}${merchantTxId}${amount}${currency}${purpose}${type}${test}${successUrl}${backUrl}${failUrl}${notifyUrl}`,
        )
        .digest("hex");

      const data = qs.stringify({
        merchantId: MERCHANT_ID,
        projectId: PROJECT_ID,
        merchantTxId: merchantTxId,
        amount: amount,
        currency: currency,
        purpose: purpose,
        type: type,
        test: test,
        successUrl: successUrl,
        backUrl: backUrl,
        failUrl: failUrl,
        notifyUrl: notifyUrl,
        hash: hash,
      });

      const config = {
        method: "post",
        url: GIRO_CHECKOUT_URL,
        headers: {
          "Content-Type": "application/x-www-form-urlencoded",
        },
        data: data,
      };

      const response = await axios(config);

      if (response.data?.url) {
        logger.info(
          `Payment URL requested for booking ${merchantTxId}: ${response.data?.url}`,
        );
        return response.data?.url;
      } else {
        logger.warn("could not get payment url.", response.data);
        throw new Error("could not get payment url.");
      }
    } catch (error) {
      throw error;
    }
  }

  async paymentNotification(query) {
    const {
      gcMerchantTxId,
      gcResultPayment,
      gcPaymethod,
      gcType,
      gcProjectId,
      gcReference,
      gcBackendTxId,
      gcAmount,
      gcCurrency,
      gcHash,
    } = query;

    try {
      if (!this.bookingId || !this.tenantId) {
        logger.warn(
          `${this.tenantId} -- could not validate payment notification. Missing parameters. For Booking ${this.bookingId}`,
        );
        throw new Error("Missing parameters");
      }
      const paymentApp = await getTenantApp(this.tenantId, "giroCockpit");
      const PROJECT_SECRET = paymentApp.paymentSecret;

      const hashString =
        gcPaymethod +
        gcType +
        gcProjectId +
        gcReference +
        gcMerchantTxId +
        gcBackendTxId +
        gcAmount +
        gcCurrency +
        gcResultPayment;

      const hash = crypto
        .createHmac("md5", PROJECT_SECRET)
        .update(hashString)
        .digest("hex");

      if (gcHash !== hash) {
        logger.warn(
          `${this.tenantId} -- payment notification hash mismatch. For Booking ${this.bookingId}`,
        );
        throw new Error("Hash mismatch");
      }

      if (gcResultPayment === GiroCockpitPaymentService.GIRO_SUCCESS_CODE) {
        logger.info(
          `${this.tenantId} -- GiroCockpit responds with status ${GiroCockpitPaymentService.GIRO_SUCCESS_CODE} / successfully payed for booking ${this.bookingId} .`,
        );

        const paymentMapping = {
          1: "GIROPAY",
          17: "GIROPAY",
          18: "GIROPAY",
          2: "EPS",
          12: "IDEAL",
          11: "CREDIT_CARD",
          6: "TRANSFER",
          7: "TRANSFER",
          26: "BLUECODE",
          33: "MAESTRO",
          14: "PAYPAL",
          23: "PAYDIRECT",
          27: "SOFORT",
        };

        await this.handleSuccessfulPayment({
          bookingId: this.bookingId,
          tenantId: this.tenantId,
          paymentMethod: paymentMapping[gcPaymethod] || "OTHER",
        });

        logger.info(
          `${this.tenantId} -- booking ${this.bookingId} successfully payed and updated.`,
        );

        return true;
      } else {
        // TODO: remove booking?
        logger.warn(
          `${this.tenantId} -- booking ${this.bookingId} could not be payed.`,
        );
        return true;
      }
    } catch (error) {
      throw error;
    }
  }

  paymentResponse() {
    return `${process.env.FRONTEND_URL}/checkout/status?id=${this.bookingId}&tenant=${this.tenantId}`;
  }

  async paymentRequest() {
    const booking = await BookingManager.getBooking(
      this.bookingId,
      this.tenantId,
    );

    await MailController.sendPaymentLinkAfterBookingApproval(
      booking.mail,
      this.bookingId,
      this.tenantId,
    );
  }

  async handleSuccessfulPayment({ bookingId, tenantId, paymentMethod }) {
    await super.handleSuccessfulPayment({ bookingId, tenantId, paymentMethod });
  }
}

class PmPaymentService extends PaymentService {
  static PM_SUCCESS_CODE = 1;

  async createPayment() {
    if (this.aggregated) {
      return this.aggregatedPaymentUrl();
    } else {
      return this.createSeparatePaymentUrl();
    }
  }

  async createSeparatePaymentUrl() {
    const paymentUrls = [];
    for (const bookingId of this.bookingIds) {
      const booking = await getBooking(bookingId, this.tenantId);
      const paymentApp = await getTenantApp(this.tenantId, "pmPayment");
      let PM_CHECKOUT_URL;
      if (paymentApp.paymentMode === "prod") {
        PM_CHECKOUT_URL = "https://payment.govconnect.de/payment/secure";
      } else {
        PM_CHECKOUT_URL = "https://payment-test.govconnect.de/payment/secure";
      }

      const amount = (booking.priceEur * 100 || 0).toString();
      const desc = `${bookingId} ${paymentApp.paymentPurposeSuffix || ""}`;
      const AGS = paymentApp.paymentMerchantId;
      const PROCEDURE = paymentApp.paymentProjectId;
      const PAYMENT_SALT = paymentApp.paymentSecret;

      const notifyUrl = `${process.env.BACKEND_URL}/api/${this.tenantId}/payments/notify?ids=${bookingId}`;
      const redirectUrl = `${process.env.BACKEND_URL}/api/${this.tenantId}/payments/response?ids=${bookingId}&tenant=${this.tenantId}&paymentMethod=${paymentApp.id}`;

      const hash = crypto
        .createHmac("sha256", PAYMENT_SALT)
        .update(
          `${AGS}|${amount}|${PROCEDURE}|${desc}|${notifyUrl}|${redirectUrl}`,
        )
        .digest("hex");

      const data = qs.stringify({
        ags: AGS,
        amount: amount,
        procedure: PROCEDURE,
        desc: desc,
        notifyURL: notifyUrl,
        redirectURL: redirectUrl,
        hash: hash,
      });

      const config = {
        method: "post",
        url: PM_CHECKOUT_URL,
        headers: {
          "Content-Type": "application/x-www-form-urlencoded",
        },
        data: data,
      };

      const response = await axios(config);

      if (response.data?.url) {
        logger.info(
          `Payment URL requested for booking ${bookingId}: ${response.data?.url}`,
        );
        paymentUrls.push({ bookingId, url: response.data?.url });
      } else {
        logger.warn("could not get payment url.", response.data);
        throw new Error("could not get payment url.");
      }
    }
    return paymentUrls;
  }

  async aggregatedPaymentUrl() {
    const bookings = await BookingManager.getBookings(
      this.tenantId,
      this.bookingIds,
    );

    const paymentApp = await getTenantApp(this.tenantId, "pmPayment");
    let PM_CHECKOUT_URL;
    if (paymentApp.paymentMode === "prod") {
      PM_CHECKOUT_URL = "https://payment.govconnect.de/payment/secure";
    } else {
      PM_CHECKOUT_URL = "https://payment-test.govconnect.de/payment/secure";
    }

    const amount = bookings.reduce((acc, booking) => {
      return acc + booking.priceEur * 100 || 0;
    }, 0);

    const desc = `${this.bookingIds.join(",")} ${
      paymentApp.paymentPurposeSuffix || ""
    }`;
    const AGS = paymentApp.paymentMerchantId;
    const PROCEDURE = paymentApp.paymentProjectId;
    const PAYMENT_SALT = paymentApp.paymentSecret;

    const notifyUrl = `${process.env.BACKEND_URL}/api/${this.tenantId}/payments/notify?ids=${this.bookingIds.join(",")}&aggregated=true`;
    const redirectUrl = `${process.env.BACKEND_URL}/api/${this.tenantId}/payments/response?ids=${this.bookingIds.join(",")}&tenant=${this.tenantId}&paymentMethod=${paymentApp.id}&aggregated=true`;

    const hash = crypto
      .createHmac("sha256", PAYMENT_SALT)
      .update(
        `${AGS}|${amount}|${PROCEDURE}|${desc}|${notifyUrl}|${redirectUrl}`,
      )
      .digest("hex");

    const data = qs.stringify({
      ags: AGS,
      amount: amount,
      procedure: PROCEDURE,
      desc: desc,
      notifyURL: notifyUrl,
      redirectURL: redirectUrl,
      hash: hash,
    });

    const config = {
      method: "post",
      url: PM_CHECKOUT_URL,
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
      },
      data: data,
    };

    const response = await axios(config);

    if (response.data?.url) {
      logger.info(
        `Payment URL requested for booking ${this.bookingIds}: ${response.data?.url}`,
      );
      return [{ bookingIds: this.bookingIds, url: response.data?.url }];
    } else {
      logger.warn("could not get payment url.", response.data);
      throw new Error("could not get payment url.");
    }
  }

  paymentResponse() {
    return `${process.env.FRONTEND_URL}/checkout/status?ids=${this.bookingId}&tenant=${this.tenantId}`;
  }

  async paymentRequest() {
    if (this.aggregated) {
      return this.aggregatedPaymentLink();
    } else {
      return this.separatePaymentLink();
    }
  }

  async separatePaymentLink() {
    try {
      for (const bookingId of this.bookingIds) {
        const booking = await BookingManager.getBooking(
          bookingId,
          this.tenantId,
        );

        await MailController.sendPaymentLinkAfterBookingApproval(
          booking.mail,
          bookingId,
          this.tenantId,
        );
      }
    } catch (error) {
      throw error;
    }
  }

  async aggregatedPaymentLink() {
    const bookings = await BookingManager.getBookings(
      this.tenantId,
      this.bookingIds,
    );

    await MailController.sendPaymentLinkAfterBookingApproval(
      bookings[0].mail,
      this.bookingIds,
      this.tenantId,
      true,
    );
  }

  async paymentNotification(body) {
    const { ags, txid, payment_method: paymentProvider } = body;

    try {
      if (!this.bookingIds || !this.tenantId) {
        logger.warn(
          `${this.tenantId} -- could not validate payment notification. Missing parameters. For Bookings ${this.bookingIds}`,
        );
        throw new Error("Missing parameters");
      }

      const paymentApp = await getTenantApp(this.tenantId, "pmPayment");
      let PM_STATUS_URL;
      if (paymentApp.paymentProvider === "prod") {
        PM_STATUS_URL = "https://payment.govconnect.de/payment/status";
      } else {
        PM_STATUS_URL = "https://payment-test.govconnect.de/payment/status";
      }

      const config = {
        method: "get",
        url: `${PM_STATUS_URL}/${ags}/${txid}`,
        headers: {
          "Content-Type": "application/x-www-form-urlencoded",
        },
      };

      const response = await axios(config);

      if (response.data.status === PmPaymentService.PM_SUCCESS_CODE) {
        logger.info(
          `${this.tenantId} -- pmPayment responds with status ${PmPaymentService.PM_SUCCESS_CODE} / successfully payed for bookings ${this.bookingIds} .`,
        );

        const paymentMapping = {
          giropay: "GIROPAY",
          sepa: "TRANSFER",
          creditCard: "CREDIT_CARD",
          paypal: "PAYPAL",
          applePay: "APPLE_PAY",
          googlePay: "GOOGLE_PAY",
        };

        await this.handleSuccessfulPayment({
          bookingIds: this.bookingIds,
          tenantId: this.tenantId,
          paymentMethod: paymentMapping[paymentProvider] || "OTHER",
        });

        logger.info(
          `${this.tenantId} -- booking ${this.bookingId} successfully payed and updated.`,
        );

        return true;
      } else {
        // TODO: remove booking?
        logger.warn(
          `${this.tenantId} -- booking ${this.bookingId} could not be payed.`,
        );
        return true;
      }
    } catch (error) {
      logger.error(
        `${this.tenantId} -- payment notification error. For Booking ${this.bookingId}`,
      );
      throw error;
    }
  }

  async handleSuccessfulPayment({ bookingIds, tenantId, paymentMethod }) {
    await super.handleSuccessfulPayment({
      bookingIds,
      tenantId,
      paymentMethod,
    });
  }
}

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
  async paymentResponse() {
    console.log("paymentResponse");
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

module.exports = {
  GiroCockpitPaymentService,
  PmPaymentService,
  InvoicePaymentService,
};
