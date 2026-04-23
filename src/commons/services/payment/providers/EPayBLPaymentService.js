const PaymentService = require("./payment-service");
const { getBooking } = require("../../../data-managers/booking-manager");
const { getTenantApp } = require("../../../data-managers/tenant-manager");
const BookingManager = require("../../../data-managers/booking-manager");
const MailController = require("../../../mail-service/mail-controller");
const axios = require("axios");
const crypto = require("crypto");
const { Agent } = require("node:https");
const forge = require("node-forge");
const { createSecureContext } = require("node:tls");
const bunyan = require("bunyan");

const logger = bunyan.createLogger({
  name: "epaybl-payment-service",
  level: process.env.LOG_LEVEL,
});

class EPayBLPaymentService extends PaymentService {
  _createHttpsAgent(paymentApp) {
    if (!paymentApp.clientP12) {
      return undefined;
    }

    let pfxBuffer;
    if (Buffer.isBuffer(paymentApp.clientP12)) {
      pfxBuffer = paymentApp.clientP12;
    } else if (
      paymentApp.clientP12.buffer &&
      Buffer.isBuffer(paymentApp.clientP12.buffer)
    ) {
      pfxBuffer = paymentApp.clientP12.buffer;
    } else if (typeof paymentApp.clientP12 === "string") {
      pfxBuffer = Buffer.from(paymentApp.clientP12, "base64");
    } else if (paymentApp.clientP12 instanceof Uint8Array) {
      pfxBuffer = Buffer.from(paymentApp.clientP12);
    } else {
      throw new Error("Unsupported clientP12 format");
    }

    const passphrase = paymentApp.certPassphrase?.trim() || "";

    if (this._canNativeHandlePfx(pfxBuffer, passphrase)) {
      logger.debug("[ePayBL] Using native PFX (OpenSSL compatible)");
      return new Agent({
        pfx: pfxBuffer,
        passphrase: passphrase || undefined,
        rejectUnauthorized: true,
      });
    }

    logger.debug(
      "[ePayBL] Native PFX not supported, converting via node-forge...",
    );
    return this._createAgentViaForge(pfxBuffer, passphrase);
  }

  _canNativeHandlePfx(pfxBuffer, passphrase) {
    try {
      createSecureContext({
        pfx: pfxBuffer,
        passphrase: passphrase || undefined,
      });
      return true;
    } catch {
      return false;
    }
  }

  _createAgentViaForge(pfxBuffer, passphrase) {
    const p12Der = forge.util.decode64(pfxBuffer.toString("base64"));
    const p12Asn1 = forge.asn1.fromDer(p12Der);
    const p12 = forge.pkcs12.pkcs12FromAsn1(p12Asn1, false, passphrase);

    const shroudedBags = p12.getBags({
      bagType: forge.pki.oids.pkcs8ShroudedKeyBag,
    });
    let privateKey = shroudedBags[forge.pki.oids.pkcs8ShroudedKeyBag]?.[0]?.key;

    if (!privateKey) {
      const keyBags = p12.getBags({
        bagType: forge.pki.oids.keyBag,
      });
      privateKey = keyBags[forge.pki.oids.keyBag]?.[0]?.key;
    }

    if (!privateKey) {
      throw new Error(
        "No private key found in .p12 — check file and passphrase",
      );
    }

    const privateKeyPem = forge.pki.privateKeyToPem(privateKey);

    const certBags = p12.getBags({
      bagType: forge.pki.oids.certBag,
    });
    const certs = certBags[forge.pki.oids.certBag] || [];

    if (certs.length === 0) {
      throw new Error("No certificates found in .p12");
    }

    const certPems = certs.map((bag) => forge.pki.certificateToPem(bag.cert));

    logger.debug(
      `[ePayBL] Forge extracted: ${certs.length} cert(s), ` +
        `subject: ${certs[0].cert.subject.getField("CN")?.value || "unknown"}`,
    );

    const agentOptions = {
      key: privateKeyPem,
      cert: certPems[0],
      rejectUnauthorized: true,
    };

    if (certPems.length > 1) {
      agentOptions.ca = certPems.slice(1);
    }

    return new Agent(agentOptions);
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
    const date = new Date(Date.now());
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

    logger.debug(`Posting to ePayBL at ${url} with payload:`, buchungsliste);

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
        transaktionsnummer: `${bookingId}-${Date.now()}`,
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
        beschreibung: `Buchungsnummer ${bookingId}`,
        kunde: {
          name: booking.name || "Kunde",
          vorname: booking.firstName || null,
          typ: "TEMPORAER",
          kundennummer: `${bookingId}-${Date.now()}`,
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
      transaktionsnummer: `${merchantTxId}-${Date.now()}`,
      zahlverfahrencodes: cfg.zahlverfahren,
      buchungen,
      beschreibung: `Sammelbuchungsnummer ${merchantTxId}`,
      kunde: {
        name: bookings[0].name || "Kunde",
        vorname: bookings[0].firstName || null,
        typ: "TEMPORAER",
        kundennummer: `${merchantTxId}-${Date.now()}`,
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
    logger.info(`[ePayBL] FULL notification body`, JSON.stringify(body));

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

      logger.debug(`[ePayBL] Raw notification body`, {
        bodyKeys: Object.keys(body || {}),
        hasDataProp: !!body?.data,
        notificationDataKeys: Object.keys(notificationData || {}),
      });

      logger.debug(`[ePayBL] Parsed notification fields`, {
        kassenzeichen,
        status,
        zahlverfahren,
        hash: hash ? `${hash.substring(0, 8)}...` : "MISSING",
        mandant,
        bewirtschafter,
        zvgid,
        tan,
        zvp,
        aktivierung,
      });

      if (status === "notify") {
        logger.info(
          `[ePayBL] Skipping 'notify' status for tenant=${this.tenantId}`,
        );
        return true;
      }

      if (!this.bookingIds || !this.tenantId) {
        throw new Error("Missing parameters");
      }

      const paymentApp = await getTenantApp(this.tenantId, "ePayBL");

      let hashValid = false;

      if (paymentApp.notificationSecret) {
        console.log(paymentApp.notificationSecret);
        if (!hash) {
          logger.warn(
            `[ePayBL] Secret configured but no hash in notification — rejecting`,
          );
          throw new Error("Missing hash in notification");
        }

        const hashParts = [
          mandant,
          bewirtschafter,
          zvgid,
          kassenzeichen,
          tan,
          zvp,
          zahlverfahren,
          aktivierung,
          status,
        ];

        // Jeden einzelnen Teil loggen, damit man sieht ob etwas
        // undefined/null/leer ist oder unerwartete Zeichen enthält
        logger.debug(`[ePayBL] Hash input parts (individual)`, {
          mandant: { value: mandant, type: typeof mandant },
          bewirtschafter: {
            value: bewirtschafter,
            type: typeof bewirtschafter,
          },
          zvgid: { value: zvgid, type: typeof zvgid },
          kassenzeichen: { value: kassenzeichen, type: typeof kassenzeichen },
          tan: { value: tan, type: typeof tan },
          zvp: { value: zvp, type: typeof zvp },
          zahlverfahren: { value: zahlverfahren, type: typeof zahlverfahren },
          aktivierung: { value: aktivierung, type: typeof aktivierung },
          status: { value: status, type: typeof status },
        });

        const hashString = hashParts.join("");

        const hashInput = hashString + paymentApp.notificationSecret;

        logger.debug(`[ePayBL] Hash computation details`, {
          // Den zusammengesetzten String OHNE Secret loggen
          hashStringWithoutSecret: hashString,
          hashStringLength: hashString.length,
          // Nur Länge des Secrets loggen (nicht das Secret selbst!)
          secretLength: paymentApp.notificationSecret.length,
          // Gesamtlänge des Hash-Inputs
          totalInputLength: hashInput.length,
          // Zeigt ob undefined-Teile als "undefined" im String landen
          containsUndefined: hashString.includes("undefined"),
          containsNull: hashString.includes("null"),
        });

        const expectedHash = crypto
          .createHash("sha256")
          .update(hashInput)
          .digest("hex");

        logger.debug(`[ePayBL] Hash comparison`, {
          receivedHash: hash,
          expectedHash: expectedHash,
          match: hash === expectedHash,
          receivedLength: hash?.length,
          expectedLength: expectedHash.length,
          // Case-Mismatch erkennen
          caseInsensitiveMatch:
            hash?.toLowerCase() === expectedHash.toLowerCase(),
          // Whitespace-Probleme erkennen
          receivedTrimmed: hash?.trim() === hash,
        });

        if (hash !== expectedHash) {
          logger.warn(`[ePayBL] Hash mismatch for ${this.tenantId}`, {
            receivedHash: hash,
            expectedHash: expectedHash,
            // Ersten Unterschied finden
            firstDiffAt: [...expectedHash].findIndex((c, i) => c !== hash?.[i]),
          });
          throw new Error("Hash mismatch");
        }

        hashValid = true;
        logger.info(`[ePayBL] Hash validation successful for ${this.tenantId}`);
      } else {
        logger.warn(
          `[ePayBL] No notificationSecret configured for ${this.tenantId}` +
            ` — skipping hash validation`,
        );
      }

      let verifiedStatus = null;

      const cfg = this._getEpayblConfig(paymentApp);
      const statusUrl =
        `${cfg.baseUrl}/epayment/fachverfahren/v1_0` +
        `/mandanten/${cfg.mandant}` +
        `/bewirtschafter/${cfg.bewirtschafter}` +
        `/kassenzeichen/${kassenzeichen}`;

      const httpsAgent = this._createHttpsAgent(paymentApp);

      try {
        const statusResponse = await axios.get(statusUrl, {
          headers: {
            Accept: "application/json",
          },
          httpsAgent,
          timeout: 10000,
          maxRedirects: 5,
          maxContentLength: Infinity,
          maxBodyLength: Infinity,
        });

        const zusatzdaten = statusResponse.data?.kassenzeichen?.zusatzdaten;

        verifiedStatus = zusatzdaten?.paypagestatus;

        logger.debug(`[ePayBL] Status API response`, {
          paypagestatus: verifiedStatus,
          bezahlverfahren: zusatzdaten?.bezahlverfahren,
          saldo: zusatzdaten?.saldo,
        });
      } catch (statusErr) {
        logger.warn(`[ePayBL] Status check failed`, {
          httpStatus: statusErr.response?.status,
          responseBody: statusErr.response?.data,
          responseHeaders: statusErr.response?.headers,
          requestUrl: statusUrl,
          errorCode: statusErr.code,
          message: statusErr.message,
        });
      }

      const apiConfirmedPaid = verifiedStatus === "INAKTIV";

      if (!hashValid && !apiConfirmedPaid) {
        logger.error(
          `[ePayBL] Cannot verify payment for ${this.tenantId}: ` +
            `no hash secret configured and API status check failed ` +
            `or not paid. Rejecting notification.`,
          {
            hashValid,
            apiConfirmedPaid,
            verifiedStatus,
            hasSecret: !!paymentApp.notificationSecret,
          },
        );
        throw new Error("Payment could not be verified by any means");
      }

      if (apiConfirmedPaid || (hashValid && status === "success")) {
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

        logger.info(`[ePayBL] Payment verified for ${this.tenantId}`, {
          verifiedBy: apiConfirmedPaid ? "API" : "HASH",
          bookingIds: this.bookingIds,
          paymentMethod: resolvedMethod,
        });

        await this.handleSuccessfulPayment({
          bookingIds: this.bookingIds,
          tenantId: this.tenantId,
          paymentMethod: resolvedMethod,
        });

        return true;
      } else {
        logger.warn(
          `${this.tenantId} -- ePayBL payment not successful: ` +
            `API=${verifiedStatus}, notification=${status}`,
        );
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

module.exports = EPayBLPaymentService;
