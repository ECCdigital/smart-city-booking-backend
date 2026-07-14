const assert = require("assert");
const sinon = require("sinon");
const fs = require("fs");
const path = require("path");
const Handlebars = require("../src/commons/pdf-service/pdf-handlebars");
const PdfService = require("../src/commons/pdf-service/pdf-service");
const formatters = require("../src/commons/pdf-service/pdf-formatters");
const {
  buildSampleData,
} = require("../src/commons/pdf-service/pdf-sample-data");
const TenantManager = require("../src/commons/data-managers/tenant-manager");
const BookingManager = require("../src/commons/data-managers/booking-manager");
const {
  BookableManager,
} = require("../src/commons/data-managers/bookable-manager");

const TEMPLATES_DIR = path.join(
  __dirname,
  "../src/commons/pdf-service/templates",
);

function loadDefaultTemplate(name) {
  return fs.readFileSync(path.join(TEMPLATES_DIR, name), "utf-8");
}

function makeBooking(overrides = {}) {
  return {
    id: "booking-1",
    tenantId: "tenant-1",
    priceEur: 119,
    vatIncludedEur: 19,
    timeBegin: Date.parse("2026-08-01T09:00:00+02:00"),
    timeEnd: Date.parse("2026-08-01T17:00:00+02:00"),
    timePaid: Date.parse("2026-07-15T10:24:00+02:00"),
    timeCreated: Date.parse("2026-07-01T08:00:00+02:00"),
    paymentMethod: "TRANSFER",
    company: "Musterfirma GmbH",
    name: "Max Mustermann",
    street: "Musterstraße 12",
    zipCode: "12345",
    location: "Musterstadt",
    bookableItems: [
      { bookableId: "bookable-1", amount: 2, userPriceEur: 50 },
      { bookableId: "bookable-2", amount: 1, userPriceEur: 19 },
    ],
    attachments: [],
    ...overrides,
  };
}

const BOOKABLES = [
  { id: "bookable-1", title: "Sitzungsraum" },
  { id: "bookable-2", title: "Beamer" },
];

describe("pdf-formatters", () => {
  it("formats zero as currency instead of a dash", () => {
    assert.notStrictEqual(formatters.formatCurrency(0), "-");
    assert.ok(formatters.formatCurrency(0).includes("0,00"));
  });

  it("keeps the dash for missing values", () => {
    assert.strictEqual(formatters.formatCurrency(null), "-");
    assert.strictEqual(formatters.formatCurrency(undefined), "-");
    assert.strictEqual(formatters.formatAmount(null), "-");
    assert.strictEqual(formatters.formatNegativeCurrency(null), "-");
  });

  it("formats negative currency from absolute values", () => {
    assert.ok(formatters.formatNegativeCurrency(10).startsWith("-"));
    assert.ok(formatters.formatNegativeCurrency(-10).startsWith("-"));
    assert.ok(formatters.formatNegativeCurrency(0).includes("0,00"));
    assert.ok(!formatters.formatNegativeCurrency(0).startsWith("-0"));
  });

  it("returns a dash for nullish date values", () => {
    assert.strictEqual(formatters.formatDateTime(null), "-");
    assert.strictEqual(formatters.formatDateTime(undefined), "-");
    assert.strictEqual(formatters.formatDate(null), "-");
    assert.strictEqual(formatters.formatDate(undefined), "-");
  });

  it("translates payment methods", () => {
    assert.strictEqual(formatters.translatePayMethod("CASH"), "Bar");
    assert.strictEqual(formatters.translatePayMethod("NOPE"), "Unbekannt");
  });
});

describe("PdfService.validateTemplate", () => {
  it("accepts all default templates", () => {
    for (const name of [
      "default-receipt-template.temp.html",
      "default-invoice-template.temp.html",
      "default-cancellation-receipt.temp.html",
    ]) {
      const errors = PdfService.validateTemplate(loadDefaultTemplate(name));
      assert.deepStrictEqual(errors, [], `${name}: ${errors.join("; ")}`);
    }
  });

  it("rejects templates without a document structure", () => {
    const errors = PdfService.validateTemplate("<p>hello</p>");
    assert.ok(errors.length > 0);
  });

  it("rejects templates with broken handlebars syntax", () => {
    const template =
      "<!DOCTYPE html><html><head></head><body>{{#if foo}}{{/each}}</body></html>";
    const errors = PdfService.validateTemplate(template);
    assert.ok(errors.some((e) => e.includes("Handlebars")));
  });
});

describe("PdfService._prepareDocument", () => {
  it("injects pagination CSS into the document head", () => {
    const html =
      "<!DOCTYPE html><html><head></head><body><p>x</p></body></html>";
    const { documentHtml } = PdfService._prepareDocument(html);
    assert.ok(documentHtml.includes("data-pdf-print-css"));
    assert.ok(documentHtml.includes("page-break-inside: avoid"));
  });

  it("extracts page footer templates", () => {
    const html =
      "<!DOCTYPE html><html><head></head><body>" +
      '<template data-pdf-footer><span class="pageNumber"></span></template>' +
      "<p>content</p></body></html>";
    const { documentHtml, footerTemplate, headerTemplate } =
      PdfService._prepareDocument(html);
    assert.ok(footerTemplate.includes("pageNumber"));
    assert.ok(footerTemplate.includes("pdf-hf"));
    assert.ok(footerTemplate.includes("Helvetica Neue"));
    assert.ok(footerTemplate.includes("font-size: 10px"));
    assert.strictEqual(headerTemplate, null);
    assert.ok(!documentHtml.includes("data-pdf-footer"));
  });
});

describe("PdfService document generation (rendering only)", () => {
  beforeEach(() => {
    sinon
      .stub(PdfService, "convertToPdf")
      .callsFake(async (html, filename) => ({
        buffer: Buffer.from(html),
        name: filename,
      }));
  });

  afterEach(() => {
    sinon.restore();
  });

  it("renders a single receipt with items, totals and address", async () => {
    sinon.stub(TenantManager, "getTenant").resolves({
      id: "tenant-1",
      receiptTemplate: "",
    });
    sinon.stub(BookingManager, "getBooking").resolves(makeBooking());
    sinon.stub(BookableManager, "getBookables").resolves(BOOKABLES);

    const result = await PdfService.generateSingleReceipt(
      "tenant-1",
      "booking-1",
      "BLG-1-1",
    );

    const html = result.buffer.toString();
    assert.strictEqual(result.name, "Zahlungsbeleg-BLG-1-1.pdf");
    assert.ok(html.includes("Sitzungsraum"));
    assert.ok(html.includes("Beamer"));
    assert.ok(html.includes("Musterfirma GmbH"));
    assert.ok(html.includes("Buchungszeitraum"));
    assert.ok(html.includes("Einzelpreis"));
    assert.ok(html.includes("Gesamt (brutto)"));
    assert.ok(html.includes("100,00"));
    assert.ok(html.includes("119,00"));
  });

  it("renders a single receipt in summary layout", async () => {
    sinon.stub(TenantManager, "getTenant").resolves({
      id: "tenant-1",
      receiptTemplate: "",
      pdfBookingLayout: "summary",
    });
    sinon.stub(BookingManager, "getBooking").resolves(makeBooking());
    sinon.stub(BookableManager, "getBookables").resolves(BOOKABLES);

    const result = await PdfService.generateSingleReceipt(
      "tenant-1",
      "booking-1",
      "BLG-1-1",
    );

    const html = result.buffer.toString();
    assert.ok(html.includes("pdf-items--summary"));
    assert.ok(html.includes("Buchungsobjekt"));
    assert.ok(html.includes("Sitzungsraum, Menge: 2"));
    assert.ok(!html.includes("Einzelpreis"));
  });

  it("renders a single receipt in compact layout", async () => {
    sinon.stub(TenantManager, "getTenant").resolves({
      id: "tenant-1",
      receiptTemplate: "",
      pdfBookingLayout: "compact",
    });
    sinon.stub(BookingManager, "getBooking").resolves(makeBooking());
    sinon.stub(BookableManager, "getBookables").resolves(BOOKABLES);

    const result = await PdfService.generateSingleReceipt(
      "tenant-1",
      "booking-1",
      "BLG-1-1",
    );

    const html = result.buffer.toString();
    assert.ok(html.includes("pdf-items--compact"));
    assert.ok(html.includes("Menge × Einzelpreis"));
    assert.ok(html.includes("bezahlt am"));
  });

  it("renders an aggregated invoice without _bookableUsed (regression)", async () => {
    sinon.stub(TenantManager, "getTenant").resolves({
      id: "tenant-1",
      invoiceTemplate: "",
      paymentPurposeSuffix: "Musterstadt",
      location: "Musterstadt",
    });
    sinon.stub(TenantManager, "getTenantApp").resolves({
      daysUntilPaymentDue: 14,
      bank: "Musterbank",
      iban: "DE00",
      bic: "XXX",
    });
    sinon
      .stub(BookingManager, "getBookings")
      .resolves([makeBooking(), makeBooking({ id: "booking-2" })]);
    sinon.stub(BookableManager, "getBookables").resolves(BOOKABLES);

    const result = await PdfService.generateAggregatedInvoice(
      "tenant-1",
      ["booking-1", "booking-2"],
      "RE-1-1",
      { groupBookingId: "group-1" },
    );

    const html = result.buffer.toString();
    assert.ok(html.includes("booking-1"));
    assert.ok(html.includes("booking-2"));
    assert.ok(html.includes("Sitzungsraum"));
    assert.ok(html.includes("238,00"));
  });

  it("renders a cancellation receipt with negative amounts", async () => {
    sinon.stub(TenantManager, "getTenant").resolves({
      id: "tenant-1",
      cancellationTemplate: "",
      location: "Musterstadt",
    });
    sinon.stub(BookingManager, "getBooking").resolves(makeBooking());
    sinon.stub(BookableManager, "getBookables").resolves(BOOKABLES);

    const result = await PdfService.generateSingleCancellationReceipt(
      "tenant-1",
      "booking-1",
      "ST-1-1",
      "RE-1-1",
      { cancellationReason: "Absage", alreadyPaid: true },
    );

    const html = result.buffer.toString();
    assert.ok(html.includes("Stornorechnung"));
    assert.ok(html.includes("Absage"));
    assert.ok(html.includes("-119,00"));
  });

  it("legacy templates using only bookingEntries still render", async () => {
    sinon.stub(TenantManager, "getTenant").resolves({
      id: "tenant-1",
      receiptTemplate:
        "<!DOCTYPE html><html><head></head><body>" +
        "<p>{{{receiptAddress}}}</p>{{{bookingEntries}}}</body></html>",
    });
    sinon.stub(BookingManager, "getBooking").resolves(makeBooking());
    sinon.stub(BookableManager, "getBookables").resolves(BOOKABLES);

    const result = await PdfService.generateSingleReceipt(
      "tenant-1",
      "booking-1",
      "BLG-1-1",
    );

    const html = result.buffer.toString();
    assert.ok(html.includes("Sitzungsraum"));
    assert.ok(html.includes("booking-detail"));
  });

  it("escapes HTML in booking data", async () => {
    sinon.stub(TenantManager, "getTenant").resolves({
      id: "tenant-1",
      receiptTemplate: "",
    });
    sinon
      .stub(BookingManager, "getBooking")
      .resolves(makeBooking({ name: "<script>alert(1)</script>" }));
    sinon.stub(BookableManager, "getBookables").resolves(BOOKABLES);

    const result = await PdfService.generateSingleReceipt(
      "tenant-1",
      "booking-1",
      "BLG-1-1",
    );

    const html = result.buffer.toString();
    assert.ok(!html.includes("<script>alert(1)</script>"));
  });
});

describe("PdfService.generatePreview", () => {
  afterEach(() => {
    sinon.restore();
  });

  it("renders previews for all template types with sample data", async () => {
    sinon.stub(PdfService, "convertToPdf").callsFake(async (html, name) => ({
      buffer: Buffer.from(html),
      name,
    }));
    sinon.stub(TenantManager, "getTenant").resolves({
      id: "tenant-1",
      receiptTemplate: "",
      invoiceTemplate: "",
      cancellationTemplate: "",
    });

    for (const type of ["receipt", "invoice", "cancellation"]) {
      const result = await PdfService.generatePreview("tenant-1", type, null);
      const html = result.buffer.toString();
      assert.ok(html.includes("Position 30"), `${type} preview has items`);
      assert.ok(html.includes("Musterstadt"), `${type} preview has address`);
    }
  });

  it("rejects unknown template types", async () => {
    await assert.rejects(
      () => PdfService.generatePreview("tenant-1", "unknown", null),
      /Unknown template type/,
    );
  });
});

describe("pdf booking table meta", () => {
  const {
    resolveBookingTableMeta,
    validatePdfBookingTableMeta,
    DEFAULT_PDF_BOOKING_TABLE_META,
  } = require("../src/commons/pdf-service/pdf-booking-table-meta");

  it("defaults all table meta flags to true", () => {
    assert.deepStrictEqual(resolveBookingTableMeta({}), {
      ...DEFAULT_PDF_BOOKING_TABLE_META,
      showPaymentInTable: true,
      showSingleBookingHeader: true,
      aggregatedMetaColumnCount: 4,
      aggregatedReceiptColumnCount: 5,
      aggregatedInvoiceColumnCount: 3,
      aggregatedReceiptLabelColspan: 4,
      aggregatedInvoiceLabelColspan: 2,
      showAggregatedPaymentColumn: true,
    });
  });

  it("merges tenant and override flags", () => {
    const meta = resolveBookingTableMeta(
      {
        pdfBookingTableMeta: {
          showBookingId: false,
          showPaymentDate: false,
        },
      },
      { showBookingPeriod: false },
    );
    assert.strictEqual(meta.showBookingId, false);
    assert.strictEqual(meta.showBookingPeriod, false);
    assert.strictEqual(meta.showPaymentDate, false);
    assert.strictEqual(meta.showPaymentMethod, true);
    assert.strictEqual(meta.showSingleBookingHeader, true);
  });

  it("validates pdfBookingTableMeta objects", () => {
    assert.strictEqual(validatePdfBookingTableMeta(null), null);
    assert.ok(validatePdfBookingTableMeta({ unknown: true }));
    assert.ok(validatePdfBookingTableMeta({ showBookingId: "yes" }));
    assert.strictEqual(
      validatePdfBookingTableMeta({ showBookingId: false }),
      null,
    );
  });

  it("hides booking metadata in detailed receipt tables when disabled", () => {
    const tableMeta = resolveBookingTableMeta({
      pdfBookingTableMeta: {
        showBookingId: false,
        showBookingPeriod: false,
        showPaymentDate: false,
        showPaymentMethod: false,
      },
    });
    const html = Handlebars.renderPartial("pdfBookingItemsTable", {
      layout: "detailed",
      tableClass: "booking-detail",
      items: [
        {
          title: "Sitzungsraum",
          amount: 2,
          unitPrice: "50,00 €",
          totalPrice: "100,00 €",
        },
      ],
      coupon: null,
      totals: {
        netto: "100,00 €",
        vat: "19,00 €",
        brutto: "119,00 €",
      },
      booking: {
        id: "booking-1",
        period: "01.08.2026, 09:00 – 01.08.2026, 17:00",
        paymentDate: "15.07.2026, 10:24",
        paymentMethod: "Überweisung",
        hasPayment: true,
      },
      tableMeta,
      compactMetaHtml: null,
    });

    assert.ok(!html.includes("pdf-booking-meta"));
    assert.ok(!html.includes("Buchungsnummer:"));
    assert.ok(!html.includes("Buchungszeitraum:"));
    assert.ok(!html.includes("Zahlungsdatum:"));
    assert.ok(!html.includes("Zahlungsmethode:"));
    assert.ok(html.includes("Sitzungsraum"));
  });

  it("keeps booking variables available when table meta is hidden", () => {
    const data = buildSampleData("receipt", "detailed", {
      showBookingId: false,
      showBookingPeriod: false,
      showPaymentDate: false,
      showPaymentMethod: false,
    });
    const template = Handlebars.compile(
      "<p>Ref: {{booking.id}} · {{booking.period}} · {{booking.paymentDate}} · {{booking.paymentMethod}}</p>{{{bookingEntries}}}",
    );
    const html = template(data);

    assert.ok(html.includes("Ref: BK-2026-0042"));
    assert.ok(html.includes("01.08.2026"));
    assert.ok(html.includes("Überweisung"));
    assert.ok(!html.includes("pdf-booking-meta"));
  });
});

describe("PdfService fixed coupon display", () => {
  const bookables = [{ id: "week-room", title: "Week" }];

  function makeFixedCouponBooking(overrides = {}) {
    return makeBooking({
      priceEur: 109,
      vatIncludedEur: 17.4,
      _couponUsed: {
        description: "Sommeraktion",
        type: "fixed",
        discount: 10,
      },
      bookableItems: [
        {
          bookableId: "week-room",
          amount: 1,
          regularPriceEur: 100,
          regularGrossPriceEur: 119,
          userPriceEur: 91.6,
          userGrossPriceEur: 109,
        },
      ],
      ...overrides,
    });
  }

  it("shows regular net prices on line items", () => {
    const items = PdfService._buildItems(
      makeFixedCouponBooking(),
      bookables,
    );

    assert.strictEqual(items[0].unitPriceEur, 100);
    assert.strictEqual(items[0].totalPriceEur, 100);
  });

  it("labels fixed coupons explicitly as Rabatt", () => {
    const coupon = PdfService._buildCoupon(makeFixedCouponBooking());

    assert.strictEqual(coupon.description, "Rabatt (Sommeraktion)");
  });

  it("uses Rabatt without suffix when the description equals the discount amount", () => {
    const coupon = PdfService._buildCoupon(
      makeFixedCouponBooking({
        _couponUsed: {
          description: "10",
          type: "fixed",
          discount: 10,
        },
      }),
    );

    assert.strictEqual(coupon.description, "Rabatt");
  });

  it("shows the fixed coupon after VAT with a euro discount", () => {
    const coupon = PdfService._buildCoupon(makeFixedCouponBooking());

    assert.ok(coupon.discountLabel.includes("-10,00"));
    assert.strictEqual(coupon.showAfterVat, true);
  });

  it("shows pre-discount net and VAT totals before the coupon", () => {
    const totals = PdfService._buildTableTotals(makeFixedCouponBooking());

    assert.strictEqual(totals.nettoEur, 100);
    assert.strictEqual(totals.vatEur, 19);
    assert.strictEqual(totals.bruttoEur, 109);
  });

  it("renders a detailed invoice table with net items and coupon after VAT", () => {
    const booking = makeFixedCouponBooking();
    const html = Handlebars.renderPartial("pdfBookingItemsTable", {
      layout: "detailed",
      tableClass: "booked-items",
      items: PdfService._buildItems(booking, bookables),
      coupon: PdfService._buildCoupon(booking),
      totals: PdfService._buildTableTotals(booking),
      booking: null,
      tableMeta: {},
      compactMetaHtml: null,
    });

    const nettoIndex = html.indexOf("Gesamt (netto)");
    const mwstIndex = html.indexOf("zzgl. MwSt.");
    const couponIndex = html.indexOf("Rabatt (Sommeraktion)");
    const bruttoIndex = html.lastIndexOf("Gesamt (brutto)");

    assert.ok(/100,00/.test(html));
    assert.ok(/-10,00/.test(html));
    assert.ok(/109,00/.test(html));
    assert.ok(nettoIndex < mwstIndex);
    assert.ok(mwstIndex < couponIndex);
    assert.ok(couponIndex < bruttoIndex);
  });

  it("derives the regular net price for legacy bookings without stored values", () => {
    const booking = makeFixedCouponBooking({
      bookableItems: [
        {
          bookableId: "week-room",
          amount: 1,
          userPriceEur: 91.6,
          userGrossPriceEur: 109,
        },
      ],
    });

    const items = PdfService._buildItems(booking, bookables);

    assert.strictEqual(items[0].unitPriceEur, 100);
  });
});

describe("PdfService percentage coupon display", () => {
  const bookables = [{ id: "week-room", title: "Week" }];

  function makePercentageCouponBooking(overrides = {}) {
    return makeBooking({
      priceEur: 107.1,
      vatIncludedEur: 17.1,
      _couponUsed: {
        description: "Prozent",
        type: "percentage",
        discount: 10,
      },
      bookableItems: [
        {
          bookableId: "week-room",
          amount: 1,
          regularPriceEur: 100,
          userPriceEur: 90,
          userGrossPriceEur: 107.1,
        },
      ],
      ...overrides,
    });
  }

  it("shows regular net prices on line items", () => {
    const items = PdfService._buildItems(
      makePercentageCouponBooking(),
      bookables,
    );

    assert.strictEqual(items[0].unitPriceEur, 100);
  });

  it("shows the percentage coupon after VAT", () => {
    const coupon = PdfService._buildCoupon(makePercentageCouponBooking());

    assert.strictEqual(coupon.description, "Rabatt (Prozent)");
    assert.strictEqual(coupon.discountLabel, "-10 %");
    assert.strictEqual(coupon.showAfterVat, true);
  });

  it("shows pre-discount net and VAT totals before the coupon", () => {
    const totals = PdfService._buildTableTotals(makePercentageCouponBooking());

    assert.strictEqual(totals.nettoEur, 100);
    assert.strictEqual(totals.vatEur, 19);
    assert.strictEqual(totals.bruttoEur, 107.1);
  });
});

describe("pdf booking layout", () => {
  it("defaults to detailed when tenant has no layout configured", () => {
    const {
      resolveBookingLayout,
    } = require("../src/commons/pdf-service/pdf-booking-layout");
    assert.strictEqual(resolveBookingLayout({}), "detailed");
    assert.strictEqual(resolveBookingLayout({}, "summary"), "summary");
    assert.strictEqual(
      resolveBookingLayout({ pdfBookingLayout: "compact" }),
      "compact",
    );
    assert.strictEqual(
      resolveBookingLayout({ pdfBookingLayout: "invalid" }),
      "detailed",
    );
  });
});

describe("pdf sample data", () => {
  it("contains enough items to span multiple pages", () => {
    const data = buildSampleData("receipt", "detailed");
    assert.ok(data.items.length >= 25);
    assert.ok(data.bookingEntries.includes("Position 1"));
    assert.ok(data.bookingEntries.includes("pdf-items--detailed"));
  });

  it("renders summary sample data without item price columns", () => {
    const data = buildSampleData("receipt", "summary");
    assert.ok(data.bookingEntries.includes("Buchungsobjekt"));
    assert.ok(!data.bookingEntries.includes("Einzelpreis"));
  });

  it("hides configured booking metadata in sample tables", () => {
    const data = buildSampleData("receipt", "detailed", {
      showBookingId: false,
      showBookingPeriod: false,
      showPaymentDate: false,
      showPaymentMethod: false,
    });
    assert.ok(!data.bookingEntries.includes("pdf-booking-meta"));
    assert.ok(!data.bookingEntries.includes("Buchungsnummer:"));
    assert.strictEqual(data.booking.id, "BK-2026-0042");
    assert.ok(data.booking.paymentDate);
  });

  it("default templates render with sample data without errors", () => {
    const templates = {
      receipt: "default-receipt-template.temp.html",
      invoice: "default-invoice-template.temp.html",
      cancellation: "default-cancellation-receipt.temp.html",
    };
    for (const [type, file] of Object.entries(templates)) {
      const template = Handlebars.compile(loadDefaultTemplate(file));
      const html = template(buildSampleData(type));
      assert.ok(html.includes("Position 1"), `${type} renders items`);
    }
  });
});
