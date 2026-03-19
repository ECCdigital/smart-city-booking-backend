const { getBooking } = require("../../data-managers/booking-manager");
const { getTenantApp } = require("../../data-managers/tenant-manager");
const bunyan = require("bunyan");
const axios = require("axios");
const qs = require("qs");
const crypto = require("crypto");
const BookingManager = require("../../data-managers/booking-manager");
const InvoiceService = require("./invoice-service");
const MailController = require("../../mail-service/mail-controller");
const { Agent } = require("node:https");

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
    this.groupBookingId = options.groupBookingId || null;
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
    return `${process.env.FRONTEND_URL}/checkout/status?ids=${this.bookingIds.join(",")}&tenant=${this.tenantId}`;
  }

  paymentRequest() {
    throw new Error("paymentRequest not implemented");
  }

  async handleSuccessfulPayment({ bookingIds, tenantId, paymentMethod }) {
    const BookingService = require("../checkout/booking-service");
    if (this.aggregated) {
      await BookingService.setAggregatedBookingPayed({
        tenantId,
        bookingIds,
        paymentMethod,
      });
    } else {
      for (const bookingId of bookingIds) {
        await BookingService.setBookingPayed({
          tenantId,
          bookingId,
          paymentMethod,
        });
      }
    }
  }

  async testConnection() {
    return { success: true, message: "Connection successful" };
  }
}

class GiroCockpitPaymentService extends PaymentService {
  static GIRO_SUCCESS_CODE = "4000";

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
      const paymentApp = await getTenantApp(this.tenantId, "giroCockpit");
      const GIRO_CHECKOUT_URL =
        "https://payment.girosolution.de/girocheckout/api/v2/paypage/init";
      const type = "SALE";
      const test = 1;
      const currency = "EUR";

      const merchantTxId = booking.id;
      const amount = Math.round(booking.priceEur * 100 || 0).toString();
      const purpose = `${booking.id} ${paymentApp.paymentPurposeSuffix || ""}`;

      const MERCHANT_ID = paymentApp.paymentMerchantId;
      const PROJECT_ID = paymentApp.paymentProjectId;
      const PROJECT_SECRET = paymentApp.paymentSecret;

      const notifyUrl = `${process.env.BACKEND_URL}/api/${this.tenantId}/payments/notify?ids=${merchantTxId}&aggregated=false`;
      const successUrl = `${process.env.BACKEND_URL}/api/${this.tenantId}/payments/response?ids=${merchantTxId}&tenant=${this.tenantId}&status=success&paymentMethod=${paymentApp.id}&aggregated=false`;
      const failUrl = `${process.env.BACKEND_URL}/api/${this.tenantId}/payments/response?ids=${merchantTxId}&tenant=${this.tenantId}&status=fail&paymentMethod=${paymentApp.id}&aggregated=false`;
      const backUrl = `${process.env.BACKEND_URL}/api/${this.tenantId}/payments/response?ids=${merchantTxId}&tenant=${this.tenantId}&status=back&paymentMethod=${paymentApp.id}&aggregated=false`;
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
    const paymentApp = await getTenantApp(this.tenantId, "giroCockpit");
    const GIRO_CHECKOUT_URL =
      "https://payment.girosolution.de/girocheckout/api/v2/paypage/init";
    const type = "SALE";
    const test = 1;
    const currency = "EUR";

    const merchantTxId = this.groupBookingId
      ? `${this.groupBookingId}`
      : `${this.bookingIds.join(",")}`;
    const amount = Math.round(
      bookings.reduce((acc, booking) => acc + booking.priceEur * 100, 0),
    ).toString();

    const purpose = this.groupBookingId
      ? `${this.groupBookingId} ${paymentApp.paymentPurposeSuffix || ""}`
      : `${this.bookingIds.join(",")} ${paymentApp.paymentPurposeSuffix || ""}`;

    const MERCHANT_ID = paymentApp.paymentMerchantId;
    const PROJECT_ID = paymentApp.paymentProjectId;
    const PROJECT_SECRET = paymentApp.paymentSecret;

    const notifyUrl = `${process.env.BACKEND_URL}/api/${this.tenantId}/payments/notify?ids=${merchantTxId}&aggregated=true`;
    const successUrl = `${process.env.BACKEND_URL}/api/${this.tenantId}/payments/response?ids=${merchantTxId}&tenant=${this.tenantId}&status=success&paymentMethod=${paymentApp.id}&aggregated=true`;
    const failUrl = `${process.env.BACKEND_URL}/api/${this.tenantId}/payments/response?ids=${merchantTxId}&tenant=${this.tenantId}&status=fail&paymentMethod=${paymentApp.id}&aggregated=true`;
    const backUrl = `${process.env.BACKEND_URL}/api/${this.tenantId}/payments/response?ids=${merchantTxId}&tenant=${this.tenantId}&status=back&paymentMethod=${paymentApp.id}&aggregated=true`;
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
      return [{ bookingIds: this.bookingIds, url: response.data?.url }];
    } else {
      logger.warn("could not get payment url.", response.data);
      throw new Error("could not get payment url.");
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
      if (!this.bookingIds || !this.tenantId) {
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
          `${this.tenantId} -- payment notification hash mismatch. For Bookings ${this.bookingIds}`,
        );
        throw new Error("Hash mismatch");
      }

      if (gcResultPayment === GiroCockpitPaymentService.GIRO_SUCCESS_CODE) {
        logger.info(
          `${this.tenantId} -- GiroCockpit responds with status ${GiroCockpitPaymentService.GIRO_SUCCESS_CODE} / successfully payed for bookings ${this.bookingIds} .`,
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
          bookingIds: this.bookingIds,
          tenantId: this.tenantId,
          paymentMethod: paymentMapping[gcPaymethod] || "OTHER",
        });

        logger.info(
          `${this.tenantId} -- bookings ${this.bookingIds} successfully payed and updated.`,
        );

        return true;
      } else {
        // TODO: remove booking?
        logger.warn(
          `${this.tenantId} -- bookings ${this.bookingIds} could not be payed.`,
        );
        return true;
      }
    } catch (error) {
      throw error;
    }
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

  async handleSuccessfulPayment({ bookingIds, tenantId, paymentMethod }) {
    await super.handleSuccessfulPayment({
      bookingIds,
      tenantId,
      paymentMethod,
    });
  }

  async testConnection() {
    return { success: false, message: "" };
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

      const amount = Math.round(booking.priceEur * 100 || 0).toString();
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

    const amount = Math.round(
      bookings.reduce((acc, booking) => acc + booking.priceEur * 100, 0),
    );

    const desc = this.groupBookingId
      ? `${this.groupBookingId} ${paymentApp.paymentPurposeSuffix || ""}`
      : `${this.bookingIds.join(",")} ${paymentApp.paymentPurposeSuffix || ""}`;
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
          `${this.tenantId} -- bookings ${this.bookingIds} successfully payed and updated.`,
        );

        return true;
      } else {
        // TODO: remove booking?
        logger.warn(
          `${this.tenantId} -- bookings ${this.bookingIds} could not be payed.`,
        );
        return true;
      }
    } catch (error) {
      logger.error(
        `${this.tenantId} -- payment notification error. For Bookings ${this.bookingIds}`,
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

  async testConnection() {
    return { success: false, message: "" };
  }
}

class EPayBLPaymentService extends PaymentService {
  _createHttpsAgent(paymentApp) {
    if (!paymentApp.clientP12) {
      return undefined;
    }

    let pfx;
    if (Buffer.isBuffer(paymentApp.clientP12)) {
      pfx = paymentApp.clientP12;
    } else if (
      paymentApp.clientP12.buffer &&
      Buffer.isBuffer(paymentApp.clientP12.buffer)
    ) {
      pfx = paymentApp.clientP12.buffer;
    } else if (typeof paymentApp.clientP12 === "string") {
      pfx = Buffer.from(paymentApp.clientP12, "base64");
    } else {
      throw new Error("Unsupported clientP12 format");
    }

    return new Agent({
      pfx,
      passphrase: paymentApp.certPassphrase,
      rejectUnauthorized: true,
    });
  }

  _getEpayblConfig(paymentApp) {
    return {
      baseUrl: paymentApp.baseUrl,
      mandant: paymentApp.merchantId,
      bewirtschafter: paymentApp.managerId,
      haushaltstelle: paymentApp.budgetAccount,
      objektnummer: paymentApp.objectNumber,
      zahlverfahren: paymentApp.paymentMethods,
      mahnkennzeichen: paymentApp.mahnkennzeichen || "11000",
    };
  }

  _buildFaelligkeitsdatum() {
    const date = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000);
    return date
      .toLocaleString("de-DE", {
        day: "2-digit",
        month: "2-digit",
        year: "numeric",
        hour: "2-digit",
        minute: "2-digit",
        second: "2-digit",
      })
      .replace(",", "");
  }

  _buildUrls(idsParam, paymentAppId, aggregated) {
    const base = `${process.env.BACKEND_URL}/api/${this.tenantId}/payments`;
    return {
      notifyUrl: `${base}/notify?ids=${idsParam}&aggregated=${aggregated}`,
      successUrl: `${base}/response?ids=${idsParam}&tenant=${this.tenantId}&status=success&paymentMethod=${paymentAppId}&aggregated=${aggregated}`,
      errorUrl: `${base}/response?ids=${idsParam}&tenant=${this.tenantId}&status=fail&paymentMethod=${paymentAppId}&aggregated=${aggregated}`,
      cancelUrl: `${base}/response?ids=${idsParam}&tenant=${this.tenantId}&status=back&paymentMethod=${paymentAppId}&aggregated=${aggregated}`,
    };
  }

  async _postBuchungsliste(paymentApp, cfg, buchungsliste) {
    const url =
      `${cfg.baseUrl}/epayment/fachverfahren/v1_0` +
      `/mandanten/${cfg.mandant}` +
      `/bewirtschafter/${cfg.bewirtschafter}` +
      `/buchungslisten`;

    const httpsAgent = this._createHttpsAgent(paymentApp);

    const response = await axios.post(url, buchungsliste, {
      headers: { "Content-Type": "application/json" },
      httpsAgent,
    });

    const rc = response.data?.ergebnis?.rc;
    if (rc === "+0000" || (rc && rc.startsWith("+"))) {
      const paypageUrl = response.data?.zahlvorgangsInfo?.rechnungUrls?.PAYPAGE;
      if (paypageUrl) {
        return paypageUrl;
      }
      throw new Error("No Paypage URL in ePayBL response");
    }

    logger.warn("ePayBL error:", response.data?.ergebnis);
    throw new Error(`ePayBL error: ${response.data?.ergebnis?.ergebnistext}`);
  }

  async createPayment() {
    if (this.aggregated) {
      return this.aggregatedPaymentUrl();
    }
    return this.createSeparatePaymentUrl();
  }

  async createSeparatePaymentUrl() {
    const paymentUrls = [];

    for (const bookingId of this.bookingIds) {
      const booking = await getBooking(bookingId, this.tenantId);
      const paymentApp = await getTenantApp(this.tenantId, "ePayBL");
      const cfg = this._getEpayblConfig(paymentApp);

      const amount = Math.round(booking.priceEur * 100 || 0) / 100;

      const urls = this._buildUrls(bookingId, paymentApp.id, false);

      const buchungsliste = {
        kassenzeichennummer: null,
        faelligkeitsdatum: this._buildFaelligkeitsdatum(),
        waehrungskennzeichen: "EUR",
        kennzeichenMahnverfahren: cfg.mahnkennzeichen,
        transaktionsnummer: bookingId,
        zahlverfahrencodes: cfg.zahlverfahren,
        buchungen: [
          {
            bruttobetrag: amount,
            nettobetrag: amount,
            id: null,
            steuerbetrag: 0,
            buchungstext: booking.name || `Buchung ${bookingId}`,
            kontierung: {
              haushaltstelle: cfg.haushaltstelle,
              objektnummer: cfg.objektnummer,
            },
          },
        ],
        beschreibung: `Buchung ${bookingId}`,
        kunde: {
          name: booking.lastName || "Kunde",
          vorname: booking.firstName || null,
          typ: "TEMPORAER",
          kundennummer: bookingId,
          firmenkunde: false,
        },
        buchungslistenparameter: null,
        fachverfahrendaten: urls,
        zahltyp: "PAYPAGE",
        betrag: amount,
      };

      const paypageUrl = await this._postBuchungsliste(
        paymentApp,
        cfg,
        buchungsliste,
      );
      logger.info(`ePayBL Paypage URL for ${bookingId}: ${paypageUrl}`);
      paymentUrls.push({ bookingId, url: paypageUrl });
    }

    return paymentUrls;
  }

  async aggregatedPaymentUrl() {
    const bookings = await BookingManager.getBookings(
      this.tenantId,
      this.bookingIds,
    );
    const paymentApp = await getTenantApp(this.tenantId, "ePayBL");
    const cfg = this._getEpayblConfig(paymentApp);

    const totalAmount =
      Math.round(bookings.reduce((acc, b) => acc + b.priceEur * 100, 0)) / 100;

    const merchantTxId = this.groupBookingId
      ? this.groupBookingId
      : this.bookingIds.join(",");

    const idsParam = this.bookingIds.join(",");
    const urls = this._buildUrls(idsParam, paymentApp.id, true);

    const buchungen = bookings.map((b) => ({
      bruttobetrag: b.priceEur,
      nettobetrag: b.priceEur,
      id: null,
      steuerbetrag: 0,
      buchungstext: b.name || `Buchung ${b.id}`,
      kontierung: {
        haushaltstelle: cfg.haushaltstelle,
        objektnummer: cfg.objektnummer,
      },
    }));

    const buchungsliste = {
      kassenzeichennummer: null,
      faelligkeitsdatum: this._buildFaelligkeitsdatum(),
      waehrungskennzeichen: "EUR",
      kennzeichenMahnverfahren: cfg.mahnkennzeichen,
      transaktionsnummer: merchantTxId,
      zahlverfahrencodes: cfg.zahlverfahren,
      buchungen,
      beschreibung: `Sammelbuchung ${merchantTxId}`,
      kunde: {
        name: bookings[0].lastName || "Kunde",
        vorname: bookings[0].firstName || null,
        typ: "TEMPORAER",
        kundennummer: merchantTxId,
        firmenkunde: false,
      },
      buchungslistenparameter: null,
      fachverfahrendaten: urls,
      zahltyp: "PAYPAGE",
      betrag: totalAmount,
    };

    const paypageUrl = await this._postBuchungsliste(
      paymentApp,
      cfg,
      buchungsliste,
    );
    logger.info(
      `ePayBL aggregated Paypage URL for ${merchantTxId}: ${paypageUrl}`,
    );
    return [{ bookingIds: this.bookingIds, url: paypageUrl }];
  }

  async paymentNotification(body) {
    try {
      const notificationData = body?.data || body;


      const {
        kassenzeichen,
        status,
        zahlverfahren,
        hash,
        mandant,
        bewirtschafter,
        zvgid,
        tan,
        zvp,
        aktivierung,
      } = notificationData;

      logger.debug(
        `[ePayBL] Notification received for tenant=${this.tenantId}`,
        {
          kassenzeichen,
          status,
          zahlverfahren,
          mandant,
          bewirtschafter,
          zvgid,
          aktivierung,
          bookingIds: this.bookingIds,
          hasHash: !!hash,
          hasTan: !!tan,
        }
      );

      if (!this.bookingIds || !this.tenantId) {
        logger.debug(
          `[ePayBL] Missing parameters — bookingIds=${this.bookingIds}, tenantId=${this.tenantId}`
        );
        throw new Error("Missing parameters");
      }

      const paymentApp = await getTenantApp(this.tenantId, "ePayBL");
      logger.debug(`[ePayBL] Tenant app loaded`, {
        hasNotificationSecret: !!paymentApp.notificationSecret,
        appKeys: Object.keys(paymentApp),
      });

      if (hash && paymentApp.notificationSecret) {
        const hashString = [
          mandant,
          bewirtschafter,
          zvgid,
          kassenzeichen,
          tan,
          zvp,
          zahlverfahren,
          aktivierung,
          status,
        ].join("");

        logger.debug(`[ePayBL] Hash validation`, {
          hashInputFields: {
            mandant,
            bewirtschafter,
            zvgid,
            kassenzeichen,
            tan,
            zvp,
            zahlverfahren,
            aktivierung,
            status,
          },
          concatenated: hashString,
          receivedHash: hash,
        });

        const expectedHash = crypto
          .createHash("sha256")
          .update(hashString + paymentApp.notificationSecret)
          .digest("hex");

        logger.debug(`[ePayBL] Hash comparison`, {
          receivedHash: hash,
          expectedHash,
          match: hash === expectedHash,
        });

        if (hash !== expectedHash) {
          logger.warn(`${this.tenantId} -- ePayBL hash mismatch`);
          throw new Error("Hash mismatch");
        }
      }

      const cfg = this._getEpayblConfig(paymentApp);
      const statusUrl =
        `${cfg.baseUrl}/epayment/fachverfahren/v1_0` +
        `/mandanten/${cfg.mandant}` +
        `/bewirtschafter/${cfg.bewirtschafter}` +
        `/kassenzeichen/${kassenzeichen}`;

      logger.debug(`[ePayBL] Fetching payment status`, { statusUrl });

      const httpsAgent = this._createHttpsAgent(paymentApp);
      const statusResponse = await axios.get(statusUrl, {
        headers: { "Content-Type": "application/json" },
        httpsAgent,
      });

      logger.debug(`[ePayBL] Status response`, {
        httpStatus: statusResponse.status,
        zahlvorgangsInfo: statusResponse.data?.zahlvorgangsInfo,
        rawData: statusResponse.data,
      });

      const verifiedStatus = statusResponse.data?.zahlvorgangsInfo?.status;

      if (verifiedStatus === "BEZAHLT" || status === "success") {
        const paymentMapping = {
          KREDITKARTE: "CREDIT_CARD",
          GIROPAY: "GIROPAY",
          PAYPAL: "PAYPAL",
          PAYDIREKT: "PAYDIRECT",
          SEPASDD: "SEPA",
          UEBERWEISUNGVOR: "TRANSFER",
          UEBERWEISUNGNACH: "TRANSFER",
          LASTSCHRIFTOHNE: "DIRECT_DEBIT",
        };

        const resolvedMethod = paymentMapping[zahlverfahren] || "OTHER";
        logger.debug(`[ePayBL] Payment successful — processing`, {
          verifiedStatus,
          notificationStatus: status,
          zahlverfahren,
          resolvedPaymentMethod: resolvedMethod,
          bookingIds: this.bookingIds,
        });

        await this.handleSuccessfulPayment({
          bookingIds: this.bookingIds,
          tenantId: this.tenantId,
          paymentMethod: resolvedMethod,
        });

        logger.debug(`[ePayBL] handleSuccessfulPayment completed`);
        return true;
      } else {
        logger.warn(`${this.tenantId} -- ePayBL: ${verifiedStatus}`);
        logger.debug(`[ePayBL] Payment not successful`, {
          verifiedStatus,
          notificationStatus: status,
          kassenzeichen,
        });
        return true;
      }
    } catch (error) {
      logger.error("ePayBL notification error:", error);
      throw error;
    }
  }

  async paymentRequest() {
    if (this.aggregated) {
      return this.aggregatedPaymentLink();
    }
    return this.separatePaymentLink();
  }

  async separatePaymentLink() {
    for (const bookingId of this.bookingIds) {
      const booking = await BookingManager.getBooking(bookingId, this.tenantId);
      await MailController.sendPaymentLinkAfterBookingApproval(
        booking.mail,
        bookingId,
        this.tenantId,
      );
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

  async testConnection() {
    const results = {
      success: false,
      timestamp: new Date().toISOString(),
      checks: {
        basicConnection: { status: "pending" },
        authentication: { status: "pending" },
        paymentMethods: { status: "pending" },
      },
    };

    let paymentApp;
    let cfg;
    let httpsAgent;

    try {
      paymentApp = await getTenantApp(this.tenantId, "ePayBL");
      cfg = this._getEpayblConfig(paymentApp);

      if (!cfg.baseUrl || !cfg.mandant || !cfg.bewirtschafter) {
        results.checks.basicConnection = {
          status: "error",
          message: "Incomplete configuration",
          missing: {
            baseUrl: !cfg.baseUrl,
            mandant: !cfg.mandant,
            bewirtschafter: !cfg.bewirtschafter,
          },
        };
        return results;
      }
    } catch (err) {
      results.checks.basicConnection = {
        status: "error",
        message: err.message?.includes("PKCS12")
          ? `Invalid certificate: ${err.message}. Ensure the .p12 file is correctly encoded (base64) and the passphrase matches.`
          : `Certificate error: ${err.message}`,
      };
      return results;
    }

    try {
      httpsAgent = this._createHttpsAgent(paymentApp);
      results.checks.authentication = {
        status: "ok",
        hasCertificate: !!paymentApp.clientP12,
      };
    } catch (err) {
      results.checks.authentication = {
        status: "error",
        message: `Certificate error: ${err.message}`,
      };
      return results;
    }

    try {
      const statusUrl =
        `${cfg.baseUrl}/epayment/fachverfahren/v1_0` +
        `/mandanten/${cfg.mandant}` +
        `/bewirtschafter/${cfg.bewirtschafter}` +
        `/status`;

      const agent = new Agent({ keepAlive: false });

      let response;
      try {
        response = await axios.get(statusUrl, {
          headers: {
            Expect: "",
            Connection: "close",
          },
          httpsAgent,
          httpAgent: agent,
          timeout: 10000,
        });
      } catch (err) {
        const message = err.message?.includes("PKCS12")
          ? `Certificate error: ${err.message}. Check that the .p12 file is valid and the passphrase is correct.`
          : this._classifyConnectionError(err);

        results.checks.basicConnection = {
          status: "error",
          message,
        };
        return results;
      }

      const rc = response.data?.ergebnis?.rc;

      if (rc === "+0000") {
        results.checks.basicConnection = {
          status: "ok",
          message: response.data?.ergebnis?.ergebnistext,
          responseTime: response.headers["x-response-time"],
        };
      } else {
        results.checks.basicConnection = {
          status: "error",
          code: rc,
          message: response.data?.ergebnis?.ergebnistext,
        };
        return results;
      }
    } catch (err) {
      results.checks.basicConnection = {
        status: "error",
        message: this._classifyConnectionError(err),
      };
      return results;
    }

    try {
      const zvUrl =
        `${cfg.baseUrl}/epayment/fachverfahren/v1_0` +
        `/mandanten/${cfg.mandant}` +
        `/bewirtschafter/${cfg.bewirtschafter}` +
        `/zahlverfahren`;

      const response = await axios.get(zvUrl, {
        headers: {},
        httpsAgent,
        timeout: 10000,
      });

      const methods = response.data?.zahlverfahren || [];

      results.checks.paymentMethods = {
        status: methods.length > 0 ? "ok" : "warning",
        count: methods.length,
        methods: methods.map((m) => ({
          code: m.zahlverfahrencode,
          min: m.minimalbetrag,
          max: m.maximalbetrag,
          viaProvider: m.zvp,
        })),
      };
    } catch (err) {
      results.checks.paymentMethods = {
        status: "warning",
        message: `Could not fetch methods: ${err.message}`,
      };
    }

    results.success = Object.values(results.checks).every(
      (c) => c.status === "ok" || c.status === "warning",
    );

    return results;
  }

  _classifyConnectionError(err) {
    if (err.code === "ECONNREFUSED") {
      return "Connection refused – check baseUrl";
    }
    if (err.code === "ENOTFOUND") {
      return "Host not found – check baseUrl";
    }
    if (err.code === "ETIMEDOUT") {
      return "Connection timeout – check network/firewall";
    }
    if (
      err.code === "UNABLE_TO_VERIFY_LEAF_SIGNATURE" ||
      err.code === "CERT_HAS_EXPIRED" ||
      err.code === "ERR_TLS_CERT_ALTNAME_INVALID"
    ) {
      return `Certificate error: ${err.code}`;
    }
    if (err.response?.status === 401) {
      return "Authentication failed – check certificate";
    }
    if (err.response?.status === 403) {
      return "Access denied – check mandant/bewirtschafter";
    }
    return err.message;
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
  EPayBLPaymentService,
};
