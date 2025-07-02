const puppeteer = require("puppeteer");
const BookingManager = require("../data-managers/booking-manager");
const { BookableManager } = require("../data-managers/bookable-manager");
const TenantManager = require("../data-managers/tenant-manager");
const bunyan = require("bunyan");
const Handlebars = require("handlebars");

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

  static async generateSingleReceipt(tenantId, bookingId, receiptNumber) {
    const tenant = await TenantManager.getTenant(tenantId);
    const booking = await BookingManager.getBooking(bookingId, tenantId);
    const bookables = (await BookableManager.getBookables(tenantId)).filter(
      (b) => booking.bookableItems.some((bi) => bi.bookableId === b.id),
    );

    const totalAmount = PdfService.formatCurrency(booking.priceEur);
    const bookingPeriod =
      booking.timeBegin && booking.timeEnd
        ? `${PdfService.formatDateTime(booking.timeBegin)} – ${PdfService.formatDateTime(booking.timeEnd)}`
        : "-";
    const payDate = PdfService.formatDateTime(booking.timeCreated);
    const bookingDate = PdfService.formatDate(new Date());
    const paymentMethod = PdfService.translatePayMethod(booking.paymentMethod);
    const receiptAddress = `
    ${booking.company || ""}${booking.company ? "<br/>" : ""}
    ${booking.name}<br/>
    ${booking.street}<br/>
    ${booking.zipCode} ${booking.location}
  `;

    let bookedItemsHtml = "";
    for (const bi of booking.bookableItems) {
      const b = bookables.find((x) => x.id === bi.bookableId);
      bookedItemsHtml += `<div>${b.title}, Menge: ${bi.amount}</div>`;
      if (b.bookingNotes) bookedItemsHtml += `<div>${b.bookingNotes}</div>`;
    }
    if (booking._couponUsed && Object.keys(booking._couponUsed).length) {
      const c = booking._couponUsed;
      bookedItemsHtml += `<div>Gutschein: ${c.description} (–${c.discount}${c.type === "fixed" ? "€" : "%"})</div>`;
    }

    const bookingEntries = `
    <table class="booking-detail">
      <tr><td>Buchungsnummer</td><td>${booking.id}</td></tr>
      <tr><td>Gesamtbetrag</td><td>${totalAmount}</td></tr>
      <tr><td>Zahlungsdatum</td><td>${payDate}</td></tr>
      <tr><td>Zahlungsmethode</td><td>${paymentMethod}</td></tr>
      <tr><td>Buchungszeitraum</td><td>${bookingPeriod}</td></tr>
      <tr><td>Buchungsobjekt</td><td>${bookedItemsHtml}</td></tr>
    </table>
  `;

    const data = {
      isAggregated: false,
      receiptNumber,
      bookingDate,
      receiptAddress,
      bookingEntries,
    };

    const template = Handlebars.compile(tenant.receiptTemplate);
    const renderedHtml = template(data);

    const browser = await puppeteer.launch({
      headless: true,
      args: ["--no-sandbox"],
    });
    const page = await browser.newPage();
    await page.setContent(renderedHtml, { waitUntil: "domcontentloaded" });
    const buffer = await page.pdf({ format: "A4" });
    await browser.close();

    return { buffer, name: `Zahlungsbeleg-${receiptNumber}.pdf` };
  }

  static async generateAggregatedReceipt(tenantId, bookingIds, receiptNumber) {
    try {
      const tenant = await TenantManager.getTenant(tenantId);
      const bookings = await BookingManager.getBookings(tenantId, bookingIds);
      const allBookables = await BookableManager.getBookables(tenantId);

      let totalBrutto = 0;
      let totalNetto = 0;
      let totalVat = 0;
      let entriesHtml = `
      <table class="booking-detail">
        <thead>
          <tr>
            <th style="text-align:start">ID</th>
            <th>Zeitraum</th>
            <th>Bezahlmethode</th>
            <th style="text-align:right">Betrag</th>
          </tr>
        </thead>
        <tbody>
    `;

      for (const bk of bookings) {
        totalBrutto += bk.priceEur;
        totalNetto += bk.priceEur - bk.vatIncludedEur;
        totalVat += bk.vatIncludedEur;
        const period =
          bk.timeBegin && bk.timeEnd
            ? `${PdfService.formatDateTime(bk.timeBegin)} – ${PdfService.formatDateTime(bk.timeEnd)}`
            : "-";

        let bookablesHtml = `<ul style="margin: 0; padding-left: 20px;">`;
        if (bk.bookableItems && bk.bookableItems.length) {
          for (const item of bk.bookableItems) {
            const used =
              item._bookableUsed ||
              allBookables.find((b) => b.id === item.bookableId);
            const lineTotal = PdfService.formatCurrency(item.userPriceEur);
            bookablesHtml += `
            <li>
              ${used?.title || "Unbekannt"} ×${item.amount} (${lineTotal})
            </li>`;
          }
        } else {
          bookablesHtml += `<li>Keine Artikel</li>`;
        }
        bookablesHtml += `</ul>`;

        const paymentMethod =
          PdfService.translatePayMethod(bk.paymentMethod) || "Unbekannt";

        const netto = bk.priceEur - bk.vatIncludedEur;

        entriesHtml += `
        <tr>
          <td style="text-align:start">${bk.id}</td>
          <td style="text-align:center">${period}</td>
          <td style="text-align:center">${paymentMethod}</td>
          <td style="text-align:right">${PdfService.formatCurrency(netto)}</td>
        </tr>
        <tr>
          <td colspan="4">
            <strong>Details / Artikel:</strong><br/>
            ${bookablesHtml}
          </td>
        </tr>
      `;
      }

      entriesHtml += `
        <tr class="netto" style="border-bottom: 1px solid #eee;">
          <td colSpan="3">Gesamt (netto)</td>
          <td style="text-align:right">${PdfService.formatCurrency(totalNetto)}</td>
        </tr>
        <tr class="mwst" style="border-bottom: 1px solid #eee;">
          <td colSpan="3">zzgl. MwSt.</td>
          <td style="text-align:right">${PdfService.formatCurrency(totalVat)}</td>
        </tr>
        <tr class="brutto" style="font-weight: bold;">
          <td colSpan="3">Gesamt (brutto)</td>
          <td style="text-align:right">${PdfService.formatCurrency(totalBrutto)}</td>
        </tr>
      </tbody>
    </table>
    `;

      const data = {
        isAggregated: true,
        receiptNumber,
        bookingDate: PdfService.formatDate(bookings[0].timeCreated),
        receiptAddress: `
        ${bookings[0].name}<br/>
        ${bookings[0].street}<br/>
        ${bookings[0].zipCode} ${bookings[0].location}
      `,
        bookingEntries: entriesHtml,
      };

      const template = Handlebars.compile(tenant.receiptTemplate);
      const renderedHtml = template(data);

      const browser = await puppeteer.launch({
        headless: true,
        args: ["--no-sandbox"],
      });
      const page = await browser.newPage();
      await page.setContent(renderedHtml, { waitUntil: "domcontentloaded" });
      const buffer = await page.pdf({ format: "A4" });
      await browser.close();

      return { buffer, name: `Sammelbeleg-${receiptNumber}.pdf` };
    } catch (err) {
      logger.error(err);
      throw err;
    }
  }

  static async generateSingleInvoice(tenantId, bookingId, invoiceNumber) {
    try {
      const tenant = await TenantManager.getTenant(tenantId);
      const invoiceApp = await TenantManager.getTenantApp(tenantId, "invoice");

      const booking = await BookingManager.getBooking(bookingId, tenantId);
      const allBookables = await BookableManager.getBookables(tenantId);
      const bookables = allBookables.filter((b) =>
        booking.bookableItems.some((bi) => bi.bookableId === b.id),
      );

      let bookingPeriod = "-";
      if (booking.timeBegin && booking.timeEnd) {
        bookingPeriod =
          PdfService.formatDateTime(booking.timeBegin) +
          " - " +
          PdfService.formatDateTime(booking.timeEnd);
      }

      let mainContent = `
      <p>
        <strong>Buchungsnummer:</strong> ${booking.id}<br>
        <strong>Zeitraum:</strong> ${bookingPeriod}
      </p>
      <table class="booked-items" style="width:100%; border-collapse: collapse;">
        <thead>
          <tr style="background: #eee; border-bottom: 1px solid #ddd;">
            <th class='bi-title'>Beschreibung</th>
            <th class='bi-amount'>Anzahl</th>
            <th class='bi-price-item'>Einzelpreis</th>
            <th class='bi-price-total'>Gesamtpreis</th>
          </tr>
        </thead>
        <tbody>
    `;

      for (const bookableItem of booking.bookableItems) {
        const bookable =
          bookableItem._bookableUsed ||
          bookables.find((b) => b.id === bookableItem.bookableId);

        const totalItemPrice = bookableItem.userPriceEur * bookableItem.amount;
        mainContent += `
        <tr style="border-bottom: 1px solid #eee;">
          <td class="bi-title">${bookable?.title || "Unbekannt"}</td>
          <td class="bi-amount">${bookableItem.amount}</td>
          <td class="bi-price-item">${PdfService.formatCurrency(bookableItem.userPriceEur)}</td>
          <td class="bi-price-total">${PdfService.formatCurrency(totalItemPrice)}</td>
        </tr>
      `;
      }

      if (booking._couponUsed && Object.keys(booking._couponUsed).length) {
        mainContent += `
        <tr class="coupon" style="border-bottom: 1px solid #eee; color: #555;">
          <td colspan="3">${booking._couponUsed.description}</td>
          <td>-${booking._couponUsed.discount} 
            ${booking._couponUsed.type === "fixed" ? "€" : "%"}</td>
        </tr>
      `;
      }

      const netto = booking.priceEur - booking.vatIncludedEur;
      mainContent += `
      <tr class="netto" style="border-bottom: 1px solid #eee;">
        <td colspan="3">Gesamt (netto)</td>
        <td>${PdfService.formatCurrency(netto)}</td>
      </tr>

      <tr class="mwst" style="border-bottom: 1px solid #eee;">
        <td colspan="3">zzgl. MwSt.</td>
        <td>${PdfService.formatCurrency(booking.vatIncludedEur)}</td>
      </tr>

      <tr class="brutto" style="font-weight: bold;">
        <td colspan="3">Gesamt (brutto)</td>
        <td>${PdfService.formatCurrency(booking.priceEur)}</td>
      </tr>
    `;
      mainContent += `
        </tbody>
      </table>
    `;

      const invoiceAddress = `
      ${booking.company || ""} 
      ${booking.company ? "<br />" : ""}
      ${booking.name || ""}<br />
      ${booking.street || ""}<br />
      ${booking.zipCode || ""} ${booking.location || ""}
    `;

      const currentDate = PdfService.formatDate(new Date());
      const data = {
        title: "Ihre Rechnung",
        invoiceNumber: invoiceNumber,
        bookingDate: currentDate,
        daysUntilPaymentDue: invoiceApp.daysUntilPaymentDue,
        purposeOfPayment: `${invoiceNumber} ${tenant.paymentPurposeSuffix}`,
        bank: invoiceApp.bank,
        iban: invoiceApp.iban,
        bic: invoiceApp.bic,
        invoiceAddress,
        mainContent,
        location: tenant.location,
      };

      const template = Handlebars.compile(tenant.invoiceTemplate);
      const renderedHtml = template(data);

      const browser = await puppeteer.launch({
        headless: true,
        args: ["--no-sandbox"],
      });
      const page = await browser.newPage();
      await page.setContent(renderedHtml, { waitUntil: "domcontentloaded" });
      const buffer = await page.pdf({ format: "A4" });
      await browser.close();

      return {
        buffer,
        name: `Rechnung-${invoiceNumber}.pdf`,
      };
    } catch (err) {
      throw err;
    }
  }

  static async generateAggregatedInvoice(tenantId, bookingIds, invoiceNumber) {
    const tenant = await TenantManager.getTenant(tenantId);
    const invoiceApp = await TenantManager.getTenantApp(tenantId, "invoice");
    const bookings = await BookingManager.getBookings(tenantId, bookingIds);

    let totalBrutto = 0;
    let totalNetto = 0;
    let totalVat = 0;

    let mainContent = `<table>
    <thead>
      <tr class="heading">
        <td>Buchungs-ID</td>
        <td>Zeitraum</td>
        <td style="text-align: right;">Gesamt (Netto)</td>
      </tr>
    </thead>
    <tbody>`;

    for (const booking of bookings) {
      const netto = booking.priceEur - booking.vatIncludedEur;

      totalBrutto += booking.priceEur;
      totalNetto += netto;
      totalVat += booking.vatIncludedEur;

      const period =
        PdfService.formatDateTime(booking.timeBegin) +
        " - " +
        PdfService.formatDateTime(booking.timeEnd);

      let bookablesHtml = "<ul style='margin: 0; padding-left: 20px;'>";
      if (booking.bookableItems && booking.bookableItems.length > 0) {
        for (const item of booking.bookableItems) {
          const usedBookable =
            item._bookableUsed ||
            allBookables.find((b) => b.id === item.bookableId);

          const totalItemPrice = item.userPriceEur * item.amount;
          bookablesHtml += `
          <li>
            ${usedBookable?.title || "Unbekannt"} 
            x${item.amount} 
            (${PdfService.formatCurrency(totalItemPrice)})
          </li>`;
        }
      } else {
        bookablesHtml += `<li>Keine Buchungsobjekte vorhanden.</li>`;
      }
      bookablesHtml += "</ul>";
      mainContent += `
      <tr class="item" style="border-bottom: 1px solid #eee;">
        <td style="padding: 5px;">${booking.id}</td>
        <td style="padding: 5px;">${period}</td>
        <td style="padding: 5px; text-align: right;">${PdfService.formatCurrency(booking.priceEur - booking.vatIncludedEur)}</td>
      </tr>
      <tr>
        <td colspan="3" style="padding: 5px;">
          <strong>Details / Artikel:</strong><br>
          ${bookablesHtml}
        </td>
      </tr>
    `;
    }

    mainContent += `</tbody></table>`;

    mainContent += `
    <table>
      <tr>
        <td>Gesamtsumme (Netto):</td>
        <td>${PdfService.formatCurrency(totalNetto)}</td>
      </tr>
      <tr>
        <td>Gesamte MwSt.:</td>
        <td>${PdfService.formatCurrency(totalVat)}</td>
      </tr>
      <tr>
        <td><strong>Gesamtsumme (Brutto):</strong></td>
        <td><strong>${PdfService.formatCurrency(totalBrutto)}</strong></td>
      </tr>
    </table>`;

    const template = Handlebars.compile(tenant.invoiceTemplate);
    const data = {
      title: "Ihre Sammelrechnung",
      invoiceNumber: invoiceNumber,
      invoiceDate: PdfService.formatDate(new Date()),
      daysUntilPaymentDue: invoiceApp.daysUntilPaymentDue,
      purposeOfPayment: `${invoiceNumber} ${tenant.paymentPurposeSuffix}`,
      bank: invoiceApp.bank,
      iban: invoiceApp.iban,
      bic: invoiceApp.bic,
      invoiceAddress: `${bookings[0].name}<br>${bookings[0].street}<br>${bookings[0].zipCode} ${bookings[0].location}`,
      mainContent,
      location: tenant.location,
    };

    const renderedHtml = template(data);

    const browser = await puppeteer.launch({
      headless: true,
      args: ["--no-sandbox"],
    });
    const page = await browser.newPage();
    await page.setContent(renderedHtml, { waitUntil: "domcontentloaded" });
    const buffer = await page.pdf({ format: "A4" });
    await browser.close();

    return {
      buffer,
      name: `Sammelrechnung-${invoiceNumber}.pdf`,
    };
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
