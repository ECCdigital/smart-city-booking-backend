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
const { COUPON_TYPE } = require("../entities/coupon/coupon");
const { buildSampleData } = require("./pdf-sample-data");
const { resolveBookingLayout } = require("./pdf-booking-layout");
const {
  resolveBookingTableMeta,
  buildCompactMetaHtml,
} = require("./pdf-booking-table-meta");

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

  table.pdf-items--summary td {
    padding: 3px 6px;
    font-size: 10px;
    line-height: 1.4;
    vertical-align: top;
    border-bottom: 1px solid #ddd;
  }
  table.pdf-items--summary td.label { width: 40%; color: #333; }
  table.pdf-items--summary td.value { text-align: right; }
  table.pdf-items--summary tr.totals td { font-weight: bold; }
  table.pdf-items--summary tr.objects td.value { line-height: 1.5; }
  table.pdf-items--summary tr.booking-sep td {
    border-top: 2px solid #bbb;
    padding-top: 6px;
    border-bottom: none;
  }

  table.pdf-items--compact th,
  table.pdf-items--compact td {
    padding: 2px 6px;
    font-size: 9px;
    line-height: 1.4;
    vertical-align: top;
    border: none;
    text-align: left;
  }
  table.pdf-items--compact thead th {
    background: #eee;
    border-bottom: 1px solid #bbb;
    font-weight: bold;
  }
  table.pdf-items--compact tbody tr.item:nth-child(even) td { background: #f5f5f5; }
  table.pdf-items--compact .num { text-align: right; white-space: nowrap; }
  table.pdf-items--compact td.sub {
    color: #555;
    font-size: 8px;
    padding-top: 0;
    padding-bottom: 4px;
  }
  table.pdf-items--compact tr.coupon td { color: #555; }
  table.pdf-items--compact tr.gross-subtotal td {
    font-weight: bold;
    text-align: right;
    border-top: 1px solid #bbb;
  }
  table.pdf-items--compact tr.gross-subtotal td:first-child { text-align: left; }
  table.pdf-items--compact tr.totals-sub td {
    padding-top: 4px;
    border-top: 2px solid #000;
    text-align: right;
    color: #444;
  }
  table.pdf-items--compact tr.brutto td {
    font-weight: bold;
    font-size: 10px;
    border-bottom: 2px solid #000;
    padding-bottom: 4px;
    background: none;
    text-align: right;
  }
  table.pdf-items--compact tr.brutto td:first-child,
  table.pdf-items--compact tr.totals-sub td:first-child { text-align: left; }
  table.pdf-items--compact tr.meta td {
    font-size: 10px;
    color: #444;
    background: none;
    border-bottom: 1px solid #ddd;
    padding-bottom: 4px;
  }

  table.pdf-items--detailed th,
  table.pdf-items--detailed td {
    padding: 4px 6px;
    font-size: 10px;
    line-height: 1.4;
    vertical-align: top;
    border: none;
    text-align: left;
  }
  table.pdf-items--detailed thead th {
    background: #eee;
    border-bottom: 1px solid #bbb;
    font-weight: bold;
  }
  table.pdf-items--detailed tbody tr.item:nth-child(even) td { background: #f5f5f5; }
  table.pdf-items--detailed .num { text-align: right; white-space: nowrap; }
  .pdf-booking-meta {
    font-size: 10px;
    color: #666;
    line-height: 1.6;
    margin: 0 0 8px;
  }
  table.pdf-items--detailed td.sub {
    color: #555;
    font-size: 9px;
    padding-top: 0;
    padding-bottom: 6px;
  }
  table.pdf-items--detailed ul.item-list {
    margin: 4px 0 0;
    padding-left: 18px;
  }
  table.pdf-items--detailed tr.coupon td { color: #555; }
  table.pdf-items--detailed tr.gross-subtotal td {
    font-weight: bold;
    text-align: right;
    border-top: 1px solid #bbb;
  }
  table.pdf-items--detailed tr.gross-subtotal td:first-child { text-align: left; }
  table.pdf-items--detailed tr.netto td {
    padding-top: 8px;
    border-top: 2px solid #000;
  }
  table.pdf-items--detailed tr.netto.tax-breakdown td {
    padding-top: 4px;
    border-top: none;
    color: #444;
    font-size: 9px;
  }
  table.pdf-items--detailed tr.netto td,
  table.pdf-items--detailed tr.mwst td,
  table.pdf-items--detailed tr.brutto td { text-align: right; }
  table.pdf-items--detailed tr.netto td:first-child,
  table.pdf-items--detailed tr.mwst td:first-child,
  table.pdf-items--detailed tr.brutto td:first-child { text-align: left; }
  table.pdf-items--detailed tr.brutto td {
    font-weight: bold;
    border-bottom: 2px solid #000;
    padding-bottom: 4px;
  }
`;

const BASE_MARGIN = "10mm";
const HEADER_MARGIN = "30mm";
const FOOTER_MARGIN = "22mm";

/** Matches the default body font in PDF templates. */
const PDF_FONT_FAMILY = '"Helvetica Neue", Helvetica, Arial, sans-serif';
/** Slightly below body text (12px) but above the previous 8px footer size. */
const PDF_HEADER_FOOTER_FONT_SIZE = "10px";

const HEADER_FOOTER_STYLE_BLOCK = `<style>
.pdf-hf {
  width: 100%;
  font-family: ${PDF_FONT_FAMILY};
  font-size: ${PDF_HEADER_FOOTER_FONT_SIZE};
  line-height: 1.4;
  color: #666;
  padding: 0 10mm;
  box-sizing: border-box;
}
.pdf-hf, .pdf-hf * {
  font-family: ${PDF_FONT_FAMILY} !important;
  font-size: ${PDF_HEADER_FOOTER_FONT_SIZE} !important;
}
</style>`;

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

const DEFAULT_TEMPLATE_CACHE = new Map();

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
      try {
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

        logger.info(`Generated PDF: ${filename} (${buffer.length} bytes)`);

        return { buffer, name: filename };
      } finally {
        await context.close().catch(() => {});
      }
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
        headerTemplate = PdfService._styleHeaderFooterTemplate(
          headerEl.html()?.trim() || null,
        );
      }
      const footerEl = $("template[data-pdf-footer]").first();
      if (footerEl.length) {
        footerTemplate = PdfService._styleHeaderFooterTemplate(
          footerEl.html()?.trim() || null,
        );
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

  /**
   * Chromium renders header/footer templates in an isolated context without
   * access to the document's stylesheets. Inject matching typography here so
   * tenant templates inherit the same font as the PDF body.
   */
  static _styleHeaderFooterTemplate(html) {
    if (!html) {
      return html;
    }
    return `${HEADER_FOOTER_STYLE_BLOCK}<div class="pdf-hf">${html}</div>`;
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
    const totals = PdfService._buildTableTotals(booking);

    const bookingContext = PdfService._buildBookingContext(
      booking,
      allBookables,
      {
        includePayment: true,
      },
    );

    const bookingEntries = PdfService._renderBookingItemsTable(tenant, {
      tableClass: "booking-detail",
      items,
      coupon,
      totals,
      booking: bookingContext,
    });

    const data = {
      isAggregated: false,
      receiptNumber,
      bookingDate: formatters.formatDate(new Date()),
      receiptAddress: PdfService._buildAddressHtml(booking),
      bookingEntries,
      booking: bookingContext,
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

      const bookingEntries = PdfService._renderAggregatedReceiptTable(tenant, {
        bookings: bookingRows,
        totals,
      });

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
    const totals = PdfService._buildTableTotals(booking);

    const bookingContext = PdfService._buildBookingContext(
      booking,
      allBookables,
      { includePayment: false },
    );
    const bookingPeriod = bookingContext.period;

    const mainContent = PdfService._renderBookingItemsTable(tenant, {
      tableClass: "booked-items",
      items,
      coupon,
      totals,
      booking: bookingContext,
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
    const { groupBookingId, bookings: providedBookings } = options;

    const bookingsPromise = providedBookings
      ? Promise.resolve(providedBookings)
      : BookingManager.getBookings(tenantId, bookingIds);

    const [tenant, invoiceApp, bookings, allBookables] = await Promise.all([
      TenantManager.getTenant(tenantId),
      TenantManager.getTenantApp(tenantId, "invoice"),
      bookingsPromise,
      BookableManager.getBookables(tenantId),
    ]);

    const { bookingRows, totals } = PdfService._buildAggregatedData(
      bookings,
      allBookables,
    );

    const mainContent = PdfService._renderAggregatedBookingsTable(tenant, {
      bookings: bookingRows,
      totals,
    });

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
    const totals = PdfService._buildTableTotals(booking, { negative: true });

    const bookingContext = PdfService._buildBookingContext(
      booking,
      allBookables,
      {
        includePayment: false,
      },
    );

    const mainContent = PdfService._renderBookingItemsTable(tenant, {
      tableClass: "booked-items",
      items,
      coupon,
      totals,
      booking: bookingContext,
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

    const mainContent = PdfService._renderAggregatedBookingsTable(tenant, {
      bookings: bookingRows,
      totals,
    });

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
   * @param {string|null} [layoutOverride] - Optional layout override for
   *   preview (summary | compact | detailed).
   * @returns {Promise<{buffer: Buffer, name: string}>}
   */
  static async generatePreview(
    tenantId,
    templateType,
    templateOverride,
    layoutOverride = null,
    tableMetaOverride = null,
  ) {
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

    const tableMeta = resolveBookingTableMeta(tenant, tableMetaOverride);
    const data = buildSampleData(
      templateType,
      resolveBookingLayout(tenant, layoutOverride),
      tableMeta,
    );

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
    return Handlebars.renderPartial(name, data);
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

  static _renderBookingItemsTable(tenant, data, layoutOverride, tableMetaOverride) {
    const layout = resolveBookingLayout(tenant, layoutOverride || data.layout);
    const tableMeta = resolveBookingTableMeta(
      tenant,
      tableMetaOverride || data.tableMeta,
    );
    return PdfService._renderPartial("pdfBookingItemsTable", {
      ...data,
      layout,
      tableMeta,
      compactMetaHtml: buildCompactMetaHtml(data.booking, tableMeta),
    });
  }

  static _renderAggregatedReceiptTable(
    tenant,
    data,
    layoutOverride,
    tableMetaOverride,
  ) {
    const layout = resolveBookingLayout(tenant, layoutOverride || data.layout);
    const tableMeta = resolveBookingTableMeta(
      tenant,
      tableMetaOverride || data.tableMeta,
    );
    return PdfService._renderPartial("pdfAggregatedReceiptTable", {
      ...data,
      layout,
      tableMeta,
    });
  }

  static _renderAggregatedBookingsTable(
    tenant,
    data,
    layoutOverride,
    tableMetaOverride,
  ) {
    const layout = resolveBookingLayout(tenant, layoutOverride || data.layout);
    const tableMeta = resolveBookingTableMeta(
      tenant,
      tableMetaOverride || data.tableMeta,
    );
    return PdfService._renderPartial("pdfAggregatedBookingsTable", {
      ...data,
      layout,
      tableMeta,
    });
  }

  /**
   * Builds the booking metadata object passed into the item table partials.
   */
  static _buildBookingContext(booking, allBookables, options = {}) {
    const period =
      options.period ||
      (booking.timeBegin && booking.timeEnd
        ? `${formatters.formatDateTime(booking.timeBegin)} – ${formatters.formatDateTime(booking.timeEnd)}`
        : "-");
    const paymentDate =
      booking.timePaid > 0 ? formatters.formatDateTime(booking.timePaid) : "-";

    return {
      id: booking.id,
      period,
      paymentDate,
      paymentMethod: formatters.translatePayMethod(booking.paymentMethod),
      hasPayment: options.includePayment === true && booking.timePaid > 0,
      summaryItems: PdfService._buildSummaryItems(booking, allBookables),
    };
  }

  static _buildSummaryItems(booking, allBookables) {
    return (booking.bookableItems || []).map((item) => {
      const bookable =
        item._bookableUsed ||
        allBookables.find((b) => b.id === item.bookableId);

      return {
        label: bookable?.title || "Unbekannt",
        amount: item.amount,
      };
    });
  }

  static _bookingVatRate(booking) {
    const nettoEur = booking.priceEur - booking.vatIncludedEur;
    if (!nettoEur) {
      return 0;
    }
    return booking.vatIncludedEur / nettoEur;
  }

  static _resolveUserGrossPriceEur(item, booking) {
    if (item.userGrossPriceEur != null) {
      return item.userGrossPriceEur;
    }
    const vatRate = PdfService._bookingVatRate(booking);
    return Math.round(item.userPriceEur * (1 + vatRate) * 100) / 100;
  }

  static _resolveRegularGrossPriceEur(item, booking) {
    if (item.regularGrossPriceEur != null) {
      return item.regularGrossPriceEur;
    }

    const coupon = booking._couponUsed;
    const userGross = PdfService._resolveUserGrossPriceEur(item, booking);

    if (coupon?.type === COUPON_TYPE.FIXED) {
      return Math.round((userGross + coupon.discount) * 100) / 100;
    }

    if (
      coupon?.type === COUPON_TYPE.PERCENTAGE &&
      coupon.discount > 0 &&
      coupon.discount < 100
    ) {
      return Math.round((userGross / (1 - coupon.discount / 100)) * 100) / 100;
    }

    return userGross;
  }

  static _resolveRegularNetPriceEur(item, booking) {
    if (item.regularPriceEur != null) {
      return item.regularPriceEur;
    }

    if (item.regularGrossPriceEur != null) {
      const vatRate = PdfService._bookingVatRate(booking);
      return Math.round((item.regularGrossPriceEur / (1 + vatRate)) * 100) / 100;
    }

    const coupon = booking._couponUsed;
    if (coupon?.type === COUPON_TYPE.FIXED) {
      const vatRate = PdfService._bookingVatRate(booking);
      const regularGross = PdfService._resolveRegularGrossPriceEur(item, booking);
      return Math.round((regularGross / (1 + vatRate)) * 100) / 100;
    }

    if (
      coupon?.type === COUPON_TYPE.PERCENTAGE &&
      coupon.discount > 0 &&
      coupon.discount < 100
    ) {
      return Math.round(
        (item.userPriceEur / (1 - coupon.discount / 100)) * 100,
      ) / 100;
    }

    return item.userPriceEur;
  }

  static _usesPreDiscountCouponDisplay(coupon) {
    return (
      coupon &&
      Object.keys(coupon).length > 0 &&
      (coupon.type === COUPON_TYPE.FIXED ||
        coupon.type === COUPON_TYPE.PERCENTAGE)
    );
  }

  static _calculatePreDiscountNetTotal(booking) {
    let nettoEur = 0;
    for (const item of booking.bookableItems || []) {
      nettoEur +=
        PdfService._resolveRegularNetPriceEur(item, booking) *
        PdfService._itemAmountMultiplier(item);
    }
    return Math.round(nettoEur * 100) / 100;
  }

  static _itemAmountMultiplier(item) {
    return item.ignoreAmount ? 1 : item.amount;
  }

  static _buildTableTotals(booking, options = {}) {
    const coupon = booking._couponUsed;

    if (!PdfService._usesPreDiscountCouponDisplay(coupon)) {
      return PdfService._buildTotals(
        booking.priceEur,
        booking.vatIncludedEur,
        options,
      );
    }

    const nettoEur = PdfService._calculatePreDiscountNetTotal(booking);
    const vatRate = PdfService._bookingVatRate(booking);
    const vatEur = Math.round(nettoEur * vatRate * 100) / 100;
    const finalTotals = PdfService._buildTotals(
      booking.priceEur,
      booking.vatIncludedEur,
      options,
    );
    const format = options.negative
      ? formatters.formatNegativeCurrency
      : formatters.formatCurrency;

    return {
      ...finalTotals,
      nettoEur,
      vatEur,
      netto: format(nettoEur),
      vat: format(vatEur),
    };
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
    const coupon = booking._couponUsed;
    const showRegularNetPrice =
      PdfService._usesPreDiscountCouponDisplay(coupon);

    return (booking.bookableItems || []).map((item) => {
      const bookable =
        item._bookableUsed ||
        allBookables.find((b) => b.id === item.bookableId);
      const unitPriceEur = showRegularNetPrice
        ? PdfService._resolveRegularNetPriceEur(item, booking)
        : item.userPriceEur;
      const multiplier = PdfService._itemAmountMultiplier(item);
      const totalPriceEur = unitPriceEur * multiplier;

      return {
        title: bookable?.title || "Unbekannt",
        amount: item.amount,
        unitPriceEur,
        totalPriceEur,
        unitPrice: format(unitPriceEur),
        totalPrice: format(totalPriceEur),
      };
    });
  }

  static _formatCouponDescription(coupon) {
    const description = (coupon.description || "").trim();
    const discountText = String(coupon.discount);

    if (coupon.type === COUPON_TYPE.FIXED) {
      if (!description || description === discountText) {
        return "Rabatt";
      }
      return `Rabatt (${description})`;
    }

    if (!description) {
      return "Rabatt";
    }
    return `Rabatt (${description})`;
  }

  static _buildCoupon(booking, options = {}) {
    const coupon = booking._couponUsed;
    if (!coupon || !Object.keys(coupon).length) {
      return null;
    }

    const sign = options.negative ? "+" : "-";
    let discountLabel;

    if (coupon.type === COUPON_TYPE.FIXED) {
      discountLabel = (options.negative
        ? formatters.formatCurrency
        : formatters.formatNegativeCurrency)(coupon.discount);
    } else if (coupon.type === COUPON_TYPE.PERCENTAGE) {
      discountLabel = `${sign}${coupon.discount} %`;
    } else {
      return null;
    }

    return {
      description: PdfService._formatCouponDescription(coupon),
      discount: coupon.discount,
      type: coupon.type,
      discountLabel,
      showAfterVat: true,
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
        summaryItems: PdfService._buildSummaryItems(booking, allBookables),
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

    if (!DEFAULT_TEMPLATE_CACHE.has(defaultTemplateName)) {
      const templatePath = path.join(
        __dirname,
        "templates",
        defaultTemplateName,
      );
      const templateContent = fs.readFileSync(templatePath, "utf-8");
      DEFAULT_TEMPLATE_CACHE.set(
        defaultTemplateName,
        Handlebars.compile(templateContent),
      );
    }

    return DEFAULT_TEMPLATE_CACHE.get(defaultTemplateName);
  }
}

module.exports = PdfService;
