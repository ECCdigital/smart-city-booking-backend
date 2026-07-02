const BookingManager = require("../data-managers/booking-manager");
const { BookableManager } = require("../data-managers/bookable-manager");
const TenantManager = require("../data-managers/tenant-manager");
const bunyan = require("bunyan");
const cheerio = require("cheerio");
const Handlebars = require("./pdf-handlebars");
const lazyBrowser = require("./LazyBrowser");
const fs = require("fs");
const path = require("path");
const formatters = require("./pdf-formatters");
const { buildSampleData } = require("./pdf-sample-data");

const logger = bunyan.createLogger({
  name: "pdf-service.js",
  level: process.env.LOG_LEVEL,
});

/**
 * Pagination rules injected into every document before rendering. They only
 * affect page breaks (no visual change on single-page documents), so they are
 * safe for legacy tenant templates as well:
 * - table rows are kept on one page,
 * - table headers repeat on every page,
 * - `.page-break` / `.avoid-break` utility classes for template authors.
 * - Compact styling for the built-in item table partials (`table.pdf-items`),
 *   so the partial output looks consistent even in tenant templates that only
 *   render {{{bookingEntries}}} / {{{mainContent}}}. Template authors can
 *   override these rules with more specific selectors, e.g.
 *   `table.pdf-items.booking-detail td { ... }`.
 */
const PRINT_CSS = `
  thead { display: table-header-group; }
  tfoot { display: table-footer-group; }
  tr { page-break-inside: avoid; }
  .page-break { page-break-before: always; }
  .avoid-break { page-break-inside: avoid; }

  table.pdf-items { width: 100%; border-collapse: collapse; }
  table.pdf-items th,
  table.pdf-items td {
    padding: 2px 6px;
    font-size: 9px;
    line-height: 1.4;
    vertical-align: top;
    border: none;
    text-align: left;
  }
  table.pdf-items thead th {
    background: #eee;
    border-bottom: 1px solid #bbb;
    font-weight: bold;
  }
  table.pdf-items tbody tr.item:nth-child(even) td { background: #f5f5f5; }
  table.pdf-items .num { text-align: right; white-space: nowrap; }
  table.pdf-items td.sub {
    color: #555;
    font-size: 8px;
    padding-top: 0;
    padding-bottom: 4px;
  }
  table.pdf-items tr.coupon td { color: #555; }
  table.pdf-items tr.totals-sub td {
    padding-top: 4px;
    border-top: 2px solid #000;
    text-align: right;
    color: #444;
  }
  table.pdf-items tr.brutto td {
    font-weight: bold;
    font-size: 10px;
    border-bottom: 2px solid #000;
    padding-bottom: 4px;
    background: none;
    text-align: right;
  }
  table.pdf-items tr.brutto td:first-child,
  table.pdf-items tr.totals-sub td:first-child { text-align: left; }
`;

const BASE_MARGIN = "10mm";
const HEADER_MARGIN = "30mm";
const FOOTER_MARGIN = "22mm";

const TEMPLATE_REQUIRED_PATTERNS = [
  { pattern: /<!DOCTYPE html>/i, label: "<!DOCTYPE html>" },
  { pattern: /<html[\s>]/i, label: "<html>" },
  { pattern: /<\/html>/i, label: "</html>" },
  { pattern: /<head[\s>]/i, label: "<head>" },
  { pattern: /<\/head>/i, label: "</head>" },
  { pattern: /<body[\s>]/i, label: "<body>" },
  { pattern: /<\/body>/i, label: "</body>" },
];

const DEFAULT_TEMPLATES = {
  receipt: "default-receipt-template.temp.html",
  invoice: "default-invoice-template.temp.html",
  cancellation: "default-cancellation-receipt.temp.html",
};

// Keep in sync with MAX_PDF_TEMPLATE_SIZE_BYTES in the vue app
// (src/components/PDF/pdfTemplateCatalog.js).
const MAX_TEMPLATE_SIZE_BYTES = 200 * 1024;

class PdfService {
  /**
   * Renders a full HTML document to a PDF buffer.
   *
   * Templates may define repeating page headers/footers via
   * `<template data-pdf-header>` and `<template data-pdf-footer>` elements.
   * Their content is extracted and passed to the browser's native PDF
   * header/footer mechanism, so it repeats on every page and supports the
   * special `pageNumber` / `totalPages` / `date` / `title` span classes.
   * Documents without these elements render exactly as before.
   */
  static async convertToPdf(html, filename) {
    const { documentHtml, headerTemplate, footerTemplate } =
      PdfService._prepareDocument(html);

    return await lazyBrowser.execute(async (browser) => {
      const context = await browser.newContext();
      const page = await context.newPage();

      await page.setContent(documentHtml, {
        waitUntil: "load",
        timeout: 10000,
      });

      // Web fonts (e.g. Google Fonts via @import) may finish loading after
      // the load event. Wait for them so text does not render in a fallback
      // font, but never block PDF generation on it.
      await page
        .evaluate(() => (document.fonts ? document.fonts.ready : null))
        .catch(() => {});

      const pdfOptions = {
        format: "A4",
        printBackground: true,
        margin: {
          top: headerTemplate ? HEADER_MARGIN : BASE_MARGIN,
          bottom: footerTemplate ? FOOTER_MARGIN : BASE_MARGIN,
          left: BASE_MARGIN,
          right: BASE_MARGIN,
        },
      };

      if (headerTemplate || footerTemplate) {
        pdfOptions.displayHeaderFooter = true;
        pdfOptions.headerTemplate = headerTemplate || "<span></span>";
        pdfOptions.footerTemplate = footerTemplate || "<span></span>";
      }

      const buffer = await page.pdf(pdfOptions);

      await context.close();
      logger.info(`Generated PDF: ${filename} (${buffer.length} bytes)`);

      return { buffer, name: filename };
    });
  }

  /**
   * Injects the pagination CSS and extracts optional page header/footer
   * templates from the document.
   */
  static _prepareDocument(html) {
    let headerTemplate = null;
    let footerTemplate = null;
    let documentHtml = html;

    try {
      const $ = cheerio.load(html);

      const headerEl = $("template[data-pdf-header]").first();
      if (headerEl.length) {
        headerTemplate = headerEl.html()?.trim() || null;
      }
      const footerEl = $("template[data-pdf-footer]").first();
      if (footerEl.length) {
        footerTemplate = footerEl.html()?.trim() || null;
      }
      $("template[data-pdf-header], template[data-pdf-footer]").remove();

      $("head").append(`<style data-pdf-print-css>${PRINT_CSS}</style>`);
      documentHtml = $.html();
    } catch (err) {
      logger.warn(
        err,
        "Could not post-process PDF document, rendering it unchanged",
      );
    }

    return { documentHtml, headerTemplate, footerTemplate };
  }

  static formatDateTime(value) {
    return formatters.formatDateTime(value);
  }

  static formatDate(value) {
    return formatters.formatDate(value);
  }

  static formatCurrency(value) {
    return formatters.formatCurrency(value);
  }

  static formatNegativeCurrency(value) {
    return formatters.formatNegativeCurrency(value);
  }

  static formatAmount(value) {
    return formatters.formatAmount(value);
  }

  static translatePayMethod(value) {
    return formatters.translatePayMethod(value);
  }

  static async generateSingleReceipt(tenantId, bookingId, receiptNumber) {
    const [tenant, booking, allBookables] = await Promise.all([
      TenantManager.getTenant(tenantId),
      BookingManager.getBooking(bookingId, tenantId),
      BookableManager.getBookables(tenantId),
    ]);

    const items = PdfService._buildItems(booking, allBookables);
    const coupon = PdfService._buildCoupon(booking);
    const totals = PdfService._buildTotals(
      booking.priceEur,
      booking.vatIncludedEur,
    );

    const bookingPeriod =
      booking.timeBegin && booking.timeEnd
        ? `${formatters.formatDateTime(booking.timeBegin)} – ${formatters.formatDateTime(booking.timeEnd)}`
        : "-";
    const payDate =
      booking.timePaid > 0 ? formatters.formatDateTime(booking.timePaid) : "-";
    const paymentMethod = formatters.translatePayMethod(booking.paymentMethod);

    const bookingEntries =
      PdfService._buildBookingMetaHtml({
        id: booking.id,
        period: bookingPeriod,
        paymentDate: payDate,
        paymentMethod,
      }) +
      PdfService._renderPartial("pdfBookingItemsTable", {
        tableClass: "booking-detail",
        items,
        coupon,
        totals,
      });

    const data = {
      isAggregated: false,
      receiptNumber,
      bookingDate: formatters.formatDate(new Date()),
      receiptAddress: PdfService._buildAddressHtml(booking),
      bookingEntries,
      booking: {
        id: booking.id,
        period: bookingPeriod,
        paymentDate: payDate,
        paymentMethod,
      },
      items,
      coupon,
      totals,
    };

    const template = PdfService._loadTemplate(
      tenant.receiptTemplate,
      DEFAULT_TEMPLATES.receipt,
    );

    const renderedHtml = template(data);
    const filename = `Zahlungsbeleg-${receiptNumber}.pdf`;

    return await PdfService.convertToPdf(renderedHtml, filename);
  }

  static async generateAggregatedReceipt(tenantId, bookingIds, receiptNumber) {
    try {
      const [tenant, bookings, allBookables] = await Promise.all([
        TenantManager.getTenant(tenantId),
        BookingManager.getBookings(tenantId, bookingIds),
        BookableManager.getBookables(tenantId),
      ]);

      const { bookingRows, totals } = PdfService._buildAggregatedData(
        bookings,
        allBookables,
      );

      const bookingEntries = PdfService._renderPartial(
        "pdfAggregatedReceiptTable",
        { bookings: bookingRows, totals },
      );

      const data = {
        isAggregated: true,
        receiptNumber,
        bookingDate: formatters.formatDate(bookings[0].timeCreated),
        receiptAddress: PdfService._buildAddressHtml(bookings[0]),
        bookingEntries,
        bookings: bookingRows,
        totals,
      };

      const template = PdfService._loadTemplate(
        tenant.receiptTemplate,
        DEFAULT_TEMPLATES.receipt,
      );
      const renderedHtml = template(data);
      const filename = `Sammelbeleg-${receiptNumber}.pdf`;

      return await PdfService.convertToPdf(renderedHtml, filename);
    } catch (err) {
      logger.error(err);
      throw err;
    }
  }

  static async generateSingleInvoice(tenantId, bookingId, invoiceNumber) {
    const [tenant, invoiceApp, booking, allBookables] = await Promise.all([
      TenantManager.getTenant(tenantId),
      TenantManager.getTenantApp(tenantId, "invoice"),
      BookingManager.getBooking(bookingId, tenantId),
      BookableManager.getBookables(tenantId),
    ]);

    const items = PdfService._buildItems(booking, allBookables);
    const coupon = PdfService._buildCoupon(booking);
    const totals = PdfService._buildTotals(
      booking.priceEur,
      booking.vatIncludedEur,
    );

    const bookingPeriod =
      booking.timeBegin && booking.timeEnd
        ? `${formatters.formatDateTime(booking.timeBegin)} - ${formatters.formatDateTime(booking.timeEnd)}`
        : "-";

    const mainContent = PdfService._renderPartial("pdfBookingItemsTable", {
      tableClass: "booked-items",
      items,
      coupon,
      totals,
    });

    const data = {
      title: "Ihre Rechnung",
      invoiceNumber,
      bookingDate: formatters.formatDate(new Date(booking.timeCreated)),
      daysUntilPaymentDue: invoiceApp.daysUntilPaymentDue,
      purposeOfPayment: `${invoiceNumber} ${tenant.paymentPurposeSuffix}`,
      bank: invoiceApp.bank,
      iban: invoiceApp.iban,
      bic: invoiceApp.bic,
      invoiceAddress: PdfService._buildAddressHtml(booking),
      mainContent,
      location: tenant.location,
      totalAmount: formatters.formatAmount(booking.priceEur),
      invoiceDate: formatters.formatDate(new Date()),
      bookingId: booking.id,
      bookingPeriod,
      items,
      coupon,
      totals,
    };

    const template = PdfService._loadTemplate(
      tenant.invoiceTemplate,
      DEFAULT_TEMPLATES.invoice,
    );
    const renderedHtml = template(data);
    const filename = `Rechnung-${invoiceNumber}.pdf`;

    return await PdfService.convertToPdf(renderedHtml, filename);
  }

  static async generateAggregatedInvoice(
    tenantId,
    bookingIds,
    invoiceNumber,
    options = {},
  ) {
    const { groupBookingId } = options;

    const [tenant, invoiceApp, bookings, allBookables] = await Promise.all([
      TenantManager.getTenant(tenantId),
      TenantManager.getTenantApp(tenantId, "invoice"),
      BookingManager.getBookings(tenantId, bookingIds),
      BookableManager.getBookables(tenantId),
    ]);

    const { bookingRows, totals } = PdfService._buildAggregatedData(
      bookings,
      allBookables,
    );

    const mainContent = PdfService._renderPartial(
      "pdfAggregatedBookingsTable",
      { bookings: bookingRows, totals },
    );

    const data = {
      title: "Ihre Sammelrechnung",
      invoiceNumber,
      invoiceDate: formatters.formatDate(new Date()),
      daysUntilPaymentDue: invoiceApp.daysUntilPaymentDue,
      purposeOfPayment: `${invoiceNumber} ${tenant.paymentPurposeSuffix}`,
      bank: invoiceApp.bank,
      iban: invoiceApp.iban,
      bic: invoiceApp.bic,
      invoiceAddress: PdfService._buildAddressHtml(bookings[0]),
      mainContent,
      location: tenant.location,
      totalAmount: formatters.formatAmount(totals.bruttoEur),
      bookingId: groupBookingId,
      bookings: bookingRows,
      totals,
    };

    const template = PdfService._loadTemplate(
      tenant.invoiceTemplate,
      DEFAULT_TEMPLATES.invoice,
    );
    const renderedHtml = template(data);
    const filename = `Sammelrechnung-${invoiceNumber}.pdf`;

    return await PdfService.convertToPdf(renderedHtml, filename);
  }

  static async generateSingleCancellationReceipt(
    tenantId,
    bookingId,
    cancellationNumber,
    originalInvoiceNumber,
    options = {},
  ) {
    const {
      cancellationReason,
      alreadyPaid = false,
      originalInvoiceDate,
      bankDetails,
    } = options;

    const [tenant, booking, allBookables] = await Promise.all([
      TenantManager.getTenant(tenantId),
      BookingManager.getBooking(bookingId, tenantId),
      BookableManager.getBookables(tenantId),
    ]);

    const items = PdfService._buildItems(booking, allBookables, {
      negative: true,
    });
    const coupon = PdfService._buildCoupon(booking, { negative: true });
    const totals = PdfService._buildTotals(
      booking.priceEur,
      booking.vatIncludedEur,
      { negative: true },
    );

    const mainContent = PdfService._renderPartial("pdfBookingItemsTable", {
      tableClass: "booked-items",
      items,
      coupon,
      totals,
    });

    const data = {
      title: "Stornorechnung",
      cancellationNumber,
      originalInvoiceNumber,
      originalInvoiceDate: originalInvoiceDate
        ? formatters.formatDate(originalInvoiceDate)
        : formatters.formatDate(new Date(booking.timeCreated)),
      cancellationDate: formatters.formatDate(new Date()),
      cancellationReason,
      alreadyPaid,
      refundAmount: formatters.formatCurrency(booking.priceEur),
      customerBankDetails: PdfService._buildCustomerBankDetails(bankDetails),
      invoiceAddress: PdfService._buildAddressHtml(booking),
      mainContent,
      location: tenant.location,
      totalAmount: formatters.formatNegativeCurrency(booking.priceEur),
      bookingId: booking.id,
      items,
      coupon,
      totals,
    };

    const template = PdfService._loadTemplate(
      tenant.cancellationTemplate,
      DEFAULT_TEMPLATES.cancellation,
    );

    const renderedHtml = template(data);
    const filename = `Stornorechnung-${cancellationNumber}.pdf`;

    return await PdfService.convertToPdf(renderedHtml, filename);
  }

  static async generateAggregatedCancellationReceipt(
    tenantId,
    bookingIds,
    cancellationNumber,
    originalInvoiceNumber,
    options = {},
  ) {
    const {
      cancellationReason,
      alreadyPaid = false,
      originalInvoiceDate,
      bankDetails,
      groupBookingId,
    } = options;

    const [tenant, bookings, allBookables] = await Promise.all([
      TenantManager.getTenant(tenantId),
      BookingManager.getBookings(tenantId, bookingIds),
      BookableManager.getBookables(tenantId),
    ]);

    const { bookingRows, totals } = PdfService._buildAggregatedData(
      bookings,
      allBookables,
      { negative: true },
    );

    const mainContent = PdfService._renderPartial(
      "pdfAggregatedBookingsTable",
      { bookings: bookingRows, totals },
    );

    const data = {
      title: "Sammel-Stornorechnung",
      cancellationNumber,
      originalInvoiceNumber,
      originalInvoiceDate: originalInvoiceDate
        ? formatters.formatDate(originalInvoiceDate)
        : formatters.formatDate(new Date(bookings[0].timeCreated)),
      cancellationDate: formatters.formatDate(new Date()),
      cancellationReason,
      alreadyPaid,
      refundAmount: formatters.formatCurrency(totals.bruttoEur),
      customerBankDetails: PdfService._buildCustomerBankDetails(bankDetails),
      invoiceAddress: PdfService._buildAddressHtml(bookings[0]),
      mainContent,
      location: tenant.location,
      totalAmount: formatters.formatNegativeCurrency(totals.bruttoEur),
      bookingId: groupBookingId,
      bookings: bookingRows,
      totals,
    };

    const template = PdfService._loadTemplate(
      tenant.cancellationTemplate,
      DEFAULT_TEMPLATES.cancellation,
    );
    const renderedHtml = template(data);
    const filename = `Sammel-Stornorechnung-${cancellationNumber}.pdf`;

    return await PdfService.convertToPdf(renderedHtml, filename);
  }

  /**
   * Renders a preview PDF for a template with generated sample data. Used by
   * the template editor so authors can verify page breaks and multi-page
   * behavior with realistic amounts of content.
   *
   * @param {string} tenantId
   * @param {string} templateType - "receipt" | "invoice" | "cancellation"
   * @param {string|null} templateOverride - Template to preview. Falls back
   *   to the template stored on the tenant, then to the default template.
   * @returns {Promise<{buffer: Buffer, name: string}>}
   */
  static async generatePreview(tenantId, templateType, templateOverride) {
    if (!DEFAULT_TEMPLATES[templateType]) {
      throw new Error(`Unknown template type: ${templateType}`);
    }

    const tenant = await TenantManager.getTenant(tenantId);
    const tenantTemplates = {
      receipt: tenant.receiptTemplate,
      invoice: tenant.invoiceTemplate,
      cancellation: tenant.cancellationTemplate,
    };

    const template = PdfService._loadTemplate(
      templateOverride || tenantTemplates[templateType],
      DEFAULT_TEMPLATES[templateType],
    );

    const data = buildSampleData(templateType);

    const renderedHtml = template(data);
    return await PdfService.convertToPdf(
      renderedHtml,
      `Vorschau-${templateType}.pdf`,
    );
  }

  /**
   * Validates a PDF template. Returns a list of human-readable problems;
   * an empty list means the template is valid.
   *
   * @param {string} template
   * @returns {string[]}
   */
  static validateTemplate(template) {
    const errors = [];
    const source = String(template || "");

    if (Buffer.byteLength(source, "utf-8") > MAX_TEMPLATE_SIZE_BYTES) {
      errors.push(
        `Template exceeds maximum size of ${MAX_TEMPLATE_SIZE_BYTES / 1024} KB`,
      );
    }

    for (const { pattern, label } of TEMPLATE_REQUIRED_PATTERNS) {
      if (!pattern.test(source)) {
        errors.push(`Missing required element: ${label}`);
      }
    }

    try {
      Handlebars.parse(source);
    } catch (err) {
      errors.push(`Invalid Handlebars syntax: ${err.message}`);
    }

    return errors;
  }

  static isValidTemplate(template) {
    const errors = PdfService.validateTemplate(template);
    if (errors.length) {
      logger.error(`PDF template is invalid: ${errors.join("; ")}`);
    }
    return errors.length === 0;
  }

  static _escape(value) {
    return Handlebars.Utils.escapeExpression(String(value ?? ""));
  }

  static _renderPartial(name, data) {
    return Handlebars.compile(`{{> ${name} }}`)(data);
  }

  /**
   * Builds the recipient address block used by receipts, invoices and
   * cancellation receipts.
   */
  static _buildAddressHtml(booking) {
    const esc = PdfService._escape;
    const lines = [];
    if (booking.company) {
      lines.push(esc(booking.company));
    }
    lines.push(esc(booking.name || ""));
    lines.push(esc(booking.street || ""));
    lines.push(`${esc(booking.zipCode || "")} ${esc(booking.location || "")}`);
    return lines.join("<br/>\n");
  }

  /**
   * Builds the compact one-line booking metadata block that precedes the
   * item table in {{{bookingEntries}}}. Uses inline styles because the HTML
   * is injected into arbitrary tenant templates.
   */
  static _buildBookingMetaHtml({ id, period, paymentDate, paymentMethod }) {
    return (
      '<p style="font-size: 10px; color: #444; margin: 0 0 6px; line-height: 1.5">' +
      `Buchung <strong>${PdfService._escape(id)}</strong> &nbsp;·&nbsp; ` +
      `${PdfService._escape(period)} &nbsp;·&nbsp; ` +
      `bezahlt am ${PdfService._escape(paymentDate)} per ${PdfService._escape(paymentMethod)}` +
      "</p>"
    );
  }

  /**
   * Builds the structured line items of a booking.
   *
   * @param {Object} booking
   * @param {Array} allBookables
   * @param {Object} [options]
   * @param {boolean} [options.negative] - Render prices as negative amounts
   *   (used for cancellation receipts).
   */
  static _buildItems(booking, allBookables, options = {}) {
    const format = options.negative
      ? formatters.formatNegativeCurrency
      : formatters.formatCurrency;

    return (booking.bookableItems || []).map((item) => {
      const bookable =
        item._bookableUsed ||
        allBookables.find((b) => b.id === item.bookableId);
      const totalPriceEur = item.userPriceEur * item.amount;

      return {
        title: bookable?.title || "Unbekannt",
        amount: item.amount,
        unitPriceEur: item.userPriceEur,
        totalPriceEur,
        unitPrice: format(item.userPriceEur),
        totalPrice: format(totalPriceEur),
      };
    });
  }

  static _buildCoupon(booking, options = {}) {
    const coupon = booking._couponUsed;
    if (!coupon || !Object.keys(coupon).length) {
      return null;
    }

    const sign = options.negative ? "+" : "-";
    const unit = coupon.type === "fixed" ? "€" : "%";

    return {
      description: coupon.description,
      discount: coupon.discount,
      type: coupon.type,
      discountLabel: `${sign}${coupon.discount} ${unit}`,
    };
  }

  static _buildTotals(bruttoEur, vatEur, options = {}) {
    const format = options.negative
      ? formatters.formatNegativeCurrency
      : formatters.formatCurrency;
    const nettoEur = bruttoEur - vatEur;

    return {
      nettoEur,
      vatEur,
      bruttoEur,
      netto: format(nettoEur),
      vat: format(vatEur),
      brutto: format(bruttoEur),
    };
  }

  /**
   * Builds the structured rows and totals for aggregated documents
   * (Sammelbeleg, Sammelrechnung, Sammel-Stornorechnung).
   */
  static _buildAggregatedData(bookings, allBookables, options = {}) {
    let bruttoEur = 0;
    let vatEur = 0;

    const bookingRows = bookings.map((booking) => {
      bruttoEur += booking.priceEur;
      vatEur += booking.vatIncludedEur;

      const period =
        booking.timeBegin && booking.timeEnd
          ? `${formatters.formatDateTime(booking.timeBegin)} – ${formatters.formatDateTime(booking.timeEnd)}`
          : "-";
      const paymentDate =
        booking.timePaid > 0
          ? formatters.formatDateTime(booking.timePaid)
          : "-";

      return {
        id: booking.id,
        period,
        paymentDate,
        paymentMethod: formatters.translatePayMethod(booking.paymentMethod),
        nettoEur: booking.priceEur - booking.vatIncludedEur,
        netto: (options.negative
          ? formatters.formatNegativeCurrency
          : formatters.formatCurrency)(
          booking.priceEur - booking.vatIncludedEur,
        ),
        items: PdfService._buildItems(booking, allBookables, options),
      };
    });

    return {
      bookingRows,
      totals: PdfService._buildTotals(bruttoEur, vatEur, options),
    };
  }

  /**
   * Build the customer bank details HTML block for the cancellation receipt
   * template. Returns null when no usable details are provided so the section
   * can be omitted in the rendered PDF.
   *
   * The block is rendered here (and not in the template) to guarantee a
   * consistent look across the default template and tenant-specific overrides.
   *
   * @param {Object|null|undefined} bankDetails - Customer-provided bank details
   * @returns {string|null} HTML block or null when no details are available
   */
  static _buildCustomerBankDetails(bankDetails) {
    if (!bankDetails || typeof bankDetails !== "object") {
      return null;
    }

    const accountHolder = (bankDetails.accountHolder || "").toString().trim();
    const bank = (bankDetails.bankName || bankDetails.bank || "")
      .toString()
      .trim();
    const iban = (bankDetails.iban || "").toString().trim();
    const bic = (bankDetails.bic || "").toString().trim();

    if (!accountHolder && !bank && !iban && !bic) {
      return null;
    }

    const escape = (value) =>
      Handlebars.Utils.escapeExpression(value).replace(/\n/g, "<br />");

    const rows = [
      accountHolder ? `Kontoinhaber: ${escape(accountHolder)}` : null,
      bank ? escape(bank) : null,
      iban ? `IBAN: ${escape(iban)}` : null,
      bic ? `BIC: ${escape(bic)}` : null,
    ].filter(Boolean);

    return `
      <div class="information customer-bank-details">
        <strong>Bankverbindung für die Rückerstattung:</strong><br />
        ${rows.join("<br />\n        ")}
      </div>
    `;
  }

  static _loadTemplate(customTemplate, defaultTemplateName) {
    if (customTemplate) {
      return Handlebars.compile(customTemplate);
    }

    const templatePath = path.join(__dirname, "templates", defaultTemplateName);
    const templateContent = fs.readFileSync(templatePath, "utf-8");
    return Handlebars.compile(templateContent);
  }
}

module.exports = PdfService;
