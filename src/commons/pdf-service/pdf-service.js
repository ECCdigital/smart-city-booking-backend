const puppeteer = require("puppeteer");
const Mustache = require("mustache");
const BookingManager = require("../data-managers/booking-manager");
const BookableManager = require("../data-managers/bookable-manager");
const TenantManager = require("../data-managers/tenant-manager");
const bunyan = require("bunyan");

const logger = bunyan.createLogger({
  name: "mail-service.js",
  level: process.env.LOG_LEVEL,
});

class PdfService {
  static formatDateTime(value) {
    const formatter = new Intl.DateTimeFormat("de-DE", {
      day: "2-digit",
      month: "2-digit",
      year: "numeric",
      hour: "2-digit",
      minute: "2-digit",
      timeZone: "Europe/Berlin",
    });
    return formatter.format(new Date(value));
  }

  static formatDate(value) {
    const formatter = new Intl.DateTimeFormat("de-DE", {
      day: "2-digit",
      month: "2-digit",
      year: "numeric",
    });
    return formatter.format(new Date(value));
  }

  static formatCurrency(value) {
    if (!value) return "-";
    const formatter = new Intl.NumberFormat("de-DE", {
      style: "currency",
      currency: "EUR",
    });
    return formatter.format(value);
  }

  static translatePayMethod(value) {
    switch (value) {
      case "CASH":
        return "Bar";
      case "TRANSFER":
        return "Überweisung";
      case "CREDIT_CARD":
        return "Kreditkarte";
      case "DEBIT_CARD":
        return "EC-Karte";
      case "PAYPAL":
        return "PayPal";
      case "OTHER":
        return "Sonstiges";
      case "GIROPAY":
        return "Giropay";
      case "APPLE_PAY":
        return "Apple Pay";
      case "GOOGLE_PAY":
        return "Google Pay";
      case "EPS":
        return "EPS";
      case "IDEAL":
        return "iDEAL";
      case "MAESTRO":
        return "Maestro";
      case "PAYDIRECT":
        return "paydirekt";
      case "SOFORT":
        return "SOFORT-Überweisung";
      case "BLUECODE":
        return "Bluecode";
      default:
        return "Unbekannt";
    }
  }

  static async generateReceipt(bookingId, tenantId, receiptNumber) {
    try {
      const tenant = await TenantManager.getTenant(tenantId);

      let booking = await BookingManager.getBooking(bookingId, tenantId);
      let bookables = (await BookableManager.getBookables(tenantId)).filter(
        (b) => booking.bookableItems.some((bi) => bi.bookableId === b.id),
      );

      const totalAmount = PdfService.formatCurrency(booking.priceEur);

      let bookingPeriod = "-";
      if (booking.timeBegin && booking.timeEnd) {
        bookingPeriod =
          PdfService.formatDateTime(booking.timeBegin) +
          " - " +
          PdfService.formatDateTime(booking.timeEnd);
      }
      let bookedItems = "";

      for (const bookableItem of booking.bookableItems) {
        const bookable = bookables.find(
          (b) => b.id === bookableItem.bookableId,
        );
        bookedItems += `<div>${bookable.title}, Anzahl: ${bookableItem.amount}</div>`;
        if (bookable.bookingNotes.length > 0) {
          bookedItems += `<div>${bookable.bookingNotes}</div>`;
        }
      }

      if (booking._couponUsed) {
        if (booking._couponUsed.type === "fixed") {
          bookedItems += `<div>
                    Gutschein: ${booking._couponUsed.description} (-${booking._couponUsed.discount}€)<br>
                </div>`;
        } else if (booking._couponUsed.type === "percentage") {
          bookedItems += `<div>
                    Gutschein: ${booking._couponUsed.description} (-${booking._couponUsed.discount}%)<br>
                </div>`;
        }
      }

      const payMethodTranslated = PdfService.translatePayMethod(
        booking.paymentMethod,
      );

      const payDate = PdfService.formatDateTime(booking.timeCreated);

      const receiptAddress = `${booking.company || ""} 
            ${booking.company ? "<br />" : ""}
            ${booking.name}<br />
            ${booking.street}<br />
            ${booking.zipCode} ${booking.location}`;

      const currentDate = PdfService.formatDate(new Date());

      const browser = await puppeteer.launch({
        headless: true,
        args: ["--no-sandbox"],
      });

      const page = await browser.newPage();

      const html = tenant.receiptTemplate;

      if (!PdfService.isValidTemplate(html)) {
        throw new Error("Invalid receipt template");
      }

      const data = {
        bookingId: bookingId,
        tenant: tenantId,
        totalAmount: totalAmount,
        bookingPeriod: bookingPeriod,
        bookedItems: bookedItems,
        bookingDate: currentDate,
        receiptNumber: receiptNumber,
        receiptAddress: receiptAddress,
        paymentMethod: payMethodTranslated,
        payDate: payDate,
      };

      const renderedHtml = Mustache.render(html, data);

      await page.setContent(renderedHtml, { waitUntil: "domcontentloaded" });

      let pdfData = {};
      pdfData.buffer = await page.pdf({ format: "A4" });

      pdfData.name = `Zahlungsbeleg-${receiptNumber}.pdf`;

      await browser.close();

      return pdfData;
    } catch (err) {
      logger.error(err);
      throw err;
    }
  }

  static async generateInvoice(tenantId, bookingId, invoiceNumber) {
    try {
      const tenant = await TenantManager.getTenant(tenantId);
      const invoiceApp = await TenantManager.getTenantApp(tenantId, "invoice");

      let booking = await BookingManager.getBooking(bookingId, tenantId);
      let bookables = (await BookableManager.getBookables(tenantId)).filter(
        (b) => booking.bookableItems.some((bi) => bi.bookableId === b.id),
      );

      const totalAmount = PdfService.formatCurrency(booking.priceEur);

      let bookingPeriod = "-";
      if (booking.timeBegin && booking.timeEnd) {
        bookingPeriod =
          PdfService.formatDateTime(booking.timeBegin) +
          " - " +
          PdfService.formatDateTime(booking.timeEnd);
      }

      let bookedItems = '<table class="booked-items">';
      bookedItems +=
        "<thead><tr>" +
        "<th class='bi-title'>Beschreibung</th>" +
        "<th class='bi-amount'>Anzahl</th>" +
        "<th class='bi-price-item'>Einzelpreis</th>" +
        "<th class='bi-price-total'>Gesamtpreis</th>" +
        "</tr></thead>";

      for (const bookableItem of booking.bookableItems) {
        const bookable = bookableItem._bookableUsed;

        bookedItems += "<tr>";
        bookedItems += `<td class="bi-title">${bookable.title}</td>`;
        bookedItems += `<td class="bi-amount">${bookableItem.amount}</td>`;
        bookedItems += `<td class="bi-price-item">${PdfService.formatCurrency(bookableItem.userPriceEur)}</td>`;
        bookedItems += `<td class="bi-price-total">${PdfService.formatCurrency(bookableItem.userPriceEur * bookableItem.amount)}</td>`;
        bookedItems += "</tr>";
      }

      if (booking._couponUsed) {
        bookedItems += '<tr class="coupon">';
        bookedItems += `<td class="bi-title" colspan="3">${booking._couponUsed.description}</td>`;
        bookedItems += `<td class="bi-coupon-value">-${booking._couponUsed.discount} ${booking._couponUsed.type === "fixed" ? "€" : "%"}</td>`;
        bookedItems += "</tr>";
      }

      bookedItems += '<tr class="netto">';
      bookedItems += `<td class="bi-title" colspan="3">Gesamt (netto)</td>`;
      bookedItems += `<td class="bi-price-total-netto">${PdfService.formatCurrency(booking.priceEur - booking.vatIncludedEur)}</td>`;
      bookedItems += "</tr>";

      bookedItems += '<tr class="mwst">';
      bookedItems += `<td class="bi-title" colspan="3">zzgl. MwSt.</td>`;
      bookedItems += `<td class="bi-mwst">${PdfService.formatCurrency(booking.vatIncludedEur)}</td>`;
      bookedItems += "</tr>";

      bookedItems += '<tr class="brutto">';
      bookedItems += `<td class="bi-title" colspan="3"><strong>Gesamt (brutto)</strong></td>`;
      bookedItems += `<td class="bi-price-total-brutto"><strong>${PdfService.formatCurrency(booking.priceEur)}</strong></td>`;
      bookedItems += "</tr>";

      bookedItems += "</table>";

      const invoiceAddress = `${booking.company || ""} 
            ${booking.company ? "<br />" : ""}
            ${booking.name || ""}<br />
            ${booking.street || ""}<br />
            ${booking.zipCode || ""} ${booking.location || ""}`;

      const currentDate = PdfService.formatDate(new Date());

      const browser = await puppeteer.launch({
        headless: true,
        args: ["--no-sandbox"],
      });

      const page = await browser.newPage();

      const html = tenant.invoiceTemplate;

      if (!PdfService.isValidTemplate(html)) {
        throw new Error("Invalid receipt template");
      }

      const data = {
        bookingId: bookingId,
        tenant: tenantId,
        totalAmount: totalAmount,
        bookingPeriod: bookingPeriod,
        bookedItems: bookedItems,
        bookingDate: currentDate,
        invoiceNumber: invoiceNumber,
        invoiceAddress: invoiceAddress,
        bank: invoiceApp.bank,
        iban: invoiceApp.iban,
        bic: invoiceApp.bic,
        daysUntilPaymentDue: invoiceApp.daysUntilPaymentDue,
        purposeOfPayment: `${invoiceNumber} ${tenant.paymentPurposeSuffix}`,
      };

      const renderedHtml = Mustache.render(html, data);

      await page.setContent(renderedHtml, { waitUntil: "domcontentloaded" });

      let pdfData = {};
      pdfData.buffer = await page.pdf({ format: "A4" });

      pdfData.name = `Rechnung-${invoiceNumber}.pdf`;

      await browser.close();

      return pdfData;
    } catch (err) {
      throw err;
    }
  }

  static isValidTemplate(template) {
    const patterns = [
      /<!DOCTYPE html>/,
      /<html.*?>/,
      /<\/html>/,
      /<head>/,
      /<\/head>/,
      /<body>/,
      /<\/body>/,
    ];

    const missingElement = patterns.find((pattern) => !pattern.test(template));

    if (missingElement !== undefined) {
      logger.error(
        `PDF template is missing required pattern: ${missingElement}`,
      );
    }

    return !missingElement;
  }
}

module.exports = PdfService;
