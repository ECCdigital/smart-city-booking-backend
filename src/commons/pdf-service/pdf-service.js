//puppeteer index.js
const puppeteer = require("puppeteer");
const fs = require("fs");
const Mustache = require("mustache");
const BookingManager = require("../data-managers/booking-manager");
const BookableManager = require("../data-managers/bookable-manager");
const TenantManager = require("../data-managers/tenant-manager");
const FileManager = require("../data-managers/file-manager");
const bunyan = require("bunyan");

const logger = bunyan.createLogger({
  name: "mail-service.js",
  level: process.env.LOG_LEVEL,
});

const os = require("os");
const path = require("path");
const IdGenerator = require("../utilities/id-generator");

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
      case "1":
        return "Giropay";
      case "17":
        return "Giropay";
      case "18":
        return "Giropay";
      case "2":
        return "eps";
      case "12":
        return "iDEAL";
      case "11":
        return "Kreditkarte";
      case "6":
        return "Lastschrift";
      case "7":
        return "Lastschrift";
      case "26":
        return "Bluecode";
      case "33":
        return "Maestro";
      case "14":
        return "PayPal";
      case "23":
        return "paydirekt";
      case "27":
        return "Sofortüberweisung";
      default:
        return "Unbekannt";
    }
  }

  static async generateReceipt(
    bookingId,
    tenantId,
    forcedReceiptTemplate,
  ) {
    try {
      const tenant = await TenantManager.getTenant(tenantId);
      const receiptId = await IdGenerator.next(tenantId, 4);
      const receiptNumber = `${tenant.receiptNumberPrefix}-${receiptId}`;
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
        booking.payMethod,
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

      const html = fs.readFileSync(
        `${__dirname}/templates/${
          forcedReceiptTemplate || tenant.receiptTemplate
        }.html`,
        "utf8",
      );

      const data = {
        bookingId: bookingId,
        tenant: tenantId,
        totalAmount: totalAmount,
        bookingPeriod: bookingPeriod,
        bookedItems: bookedItems,
        bookingDate: currentDate,
        receiptNumber: receiptNumber,
        receiptAddress: receiptAddress,
        payMethod: payMethodTranslated,
        payDate: payDate,
      };

      const renderedHtml = Mustache.render(html, data);

      await page.setContent(renderedHtml, { waitUntil: "domcontentloaded" });

      let pdfData = {}
      pdfData.buffer = await page.pdf({ format: "A4" });

      pdfData.name = `Zahlungsbeleg-${receiptNumber}.pdf`;

      await browser.close();

      return pdfData;
    } catch (err) {
      logger.error(err);
      throw err;
    }
  }
}

module.exports = PdfService;
