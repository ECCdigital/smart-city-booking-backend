const Handlebars = require("./pdf-handlebars");
const formatters = require("./pdf-formatters");
const { DEFAULT_PDF_BOOKING_LAYOUT } = require("./pdf-booking-layout");
const {
  resolveBookingTableMeta,
  buildCompactMetaHtml,
} = require("./pdf-booking-table-meta");

/**
 * Sample data for PDF template previews. Intentionally contains enough line
 * items to span multiple pages, so template authors can verify page breaks,
 * repeating table headers and page footers in the editor.
 */

const SAMPLE_ITEM_COUNT = 60;

function renderPartial(name, data) {
  return Handlebars.renderPartial(name, data);
}

function buildTotals(bruttoEur, vatEur, { negative = false } = {}) {
  const format = negative
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

function buildSampleItems({ negative = false } = {}) {
  const format = negative
    ? formatters.formatNegativeCurrency
    : formatters.formatCurrency;

  const titles = [
    "Sitzungsraum Rathaus",
    "Beamer inkl. Leinwand",
    "Bestuhlung (Reihe)",
    "Sporthalle Feld 1",
    "Werkraum Volkshochschule",
    "Marktstand Wochenmarkt",
  ];

  return Array.from({ length: SAMPLE_ITEM_COUNT }, (_, i) => {
    const unitPriceEur = 12.5 + (i % 5) * 7.25;
    const amount = (i % 3) + 1;
    const totalPriceEur = unitPriceEur * amount;
    return {
      title: `${titles[i % titles.length]} – Position ${i + 1}`,
      amount,
      unitPriceEur,
      totalPriceEur,
      unitPrice: format(unitPriceEur),
      totalPrice: format(totalPriceEur),
    };
  });
}

function buildSampleSummaryItems(items) {
  return items.map((item) => ({
    label: item.title,
    amount: item.amount,
  }));
}

function sumItems(items) {
  return items.reduce((sum, item) => sum + item.totalPriceEur, 0);
}

const SAMPLE_ADDRESS =
  "Musterfirma GmbH<br/>\nMax Mustermann<br/>\nMusterstraße 12<br/>\n12345 Musterstadt";

const SAMPLE_BOOKING = {
  id: "BK-2026-0042",
  period: "01.08.2026, 09:00 – 01.08.2026, 17:00",
  paymentDate: "15.07.2026, 10:24",
  paymentMethod: "Überweisung",
  hasPayment: true,
};

function buildBaseSampleData(
  layout,
  tableMeta,
  { negative = false, tableClass, includePayment = false, bookingOverrides = {} } = {},
) {
  const items = buildSampleItems({ negative });
  const bruttoEur = sumItems(items);
  const vatEur = bruttoEur * 0.19;
  const totals = buildTotals(bruttoEur, vatEur, { negative });
  const coupon = null;
  const booking = {
    id: SAMPLE_BOOKING.id,
    period: SAMPLE_BOOKING.period,
    summaryItems: buildSampleSummaryItems(items),
    ...(includePayment
      ? {
          paymentDate: SAMPLE_BOOKING.paymentDate,
          paymentMethod: SAMPLE_BOOKING.paymentMethod,
          hasPayment: true,
        }
      : { hasPayment: false }),
    ...bookingOverrides,
  };

  const resolvedTableMeta =
    tableMeta && tableMeta.aggregatedReceiptColumnCount != null
      ? tableMeta
      : resolveBookingTableMeta(null, tableMeta);
  const renderedTable = renderPartial("pdfBookingItemsTable", {
    layout,
    tableClass,
    items,
    coupon,
    totals,
    booking,
    tableMeta: resolvedTableMeta,
    compactMetaHtml: buildCompactMetaHtml(booking, resolvedTableMeta),
  });

  return { items, totals, coupon, booking, renderedTable, bruttoEur, tableMeta: resolvedTableMeta };
}

function buildReceiptSampleData(
  layout = DEFAULT_PDF_BOOKING_LAYOUT,
  tableMeta = null,
) {
  const { items, totals, coupon, booking, renderedTable } = buildBaseSampleData(
    layout,
    tableMeta,
    {
      tableClass: "booking-detail",
      includePayment: true,
      bookingOverrides: { ...SAMPLE_BOOKING },
    },
  );

  return {
    isAggregated: false,
    receiptNumber: "BLG-1042-1",
    bookingDate: formatters.formatDate(new Date()),
    receiptAddress: SAMPLE_ADDRESS,
    bookingEntries: renderedTable,
    booking,
    items,
    coupon,
    totals,
  };
}

function buildInvoiceSampleData(
  layout = DEFAULT_PDF_BOOKING_LAYOUT,
  tableMeta = null,
) {
  const { items, totals, coupon, booking, renderedTable, bruttoEur } =
    buildBaseSampleData(layout, tableMeta, {
      tableClass: "booked-items",
    });

  return {
    title: "Ihre Rechnung",
    invoiceNumber: "RE-1042-1",
    bookingDate: formatters.formatDate(new Date()),
    invoiceDate: formatters.formatDate(new Date()),
    daysUntilPaymentDue: 14,
    purposeOfPayment: "RE-1042-1 Musterstadt",
    bank: "Musterbank",
    iban: "DE02 1203 0000 0000 2020 51",
    bic: "BYLADEM1001",
    invoiceAddress: SAMPLE_ADDRESS,
    mainContent: renderedTable,
    location: "Musterstadt",
    totalAmount: formatters.formatAmount(bruttoEur),
    bookingId: SAMPLE_BOOKING.id,
    bookingPeriod: booking.period,
    booking,
    items,
    coupon,
    totals,
  };
}

function buildCancellationSampleData(
  layout = DEFAULT_PDF_BOOKING_LAYOUT,
  tableMeta = null,
) {
  const { items, totals, coupon, booking, renderedTable, bruttoEur } =
    buildBaseSampleData(layout, tableMeta, {
      negative: true,
      tableClass: "booked-items",
    });

  return {
    title: "Stornorechnung",
    cancellationNumber: "ST-1042-1",
    originalInvoiceNumber: "RE-1042-1",
    originalInvoiceDate: formatters.formatDate(new Date()),
    cancellationDate: formatters.formatDate(new Date()),
    cancellationReason: "Veranstaltung wurde abgesagt",
    alreadyPaid: true,
    refundAmount: formatters.formatCurrency(bruttoEur),
    customerBankDetails:
      '<div class="information customer-bank-details">' +
      "<strong>Bankverbindung für die Rückerstattung:</strong><br />" +
      "Kontoinhaber: Max Mustermann<br />Musterbank<br />" +
      "IBAN: DE02 1203 0000 0000 2020 51<br />BIC: BYLADEM1001</div>",
    invoiceAddress: SAMPLE_ADDRESS,
    mainContent: renderedTable,
    location: "Musterstadt",
    totalAmount: formatters.formatNegativeCurrency(bruttoEur),
    bookingId: SAMPLE_BOOKING.id,
    booking,
    items,
    coupon,
    totals,
  };
}

function buildSampleData(
  templateType,
  layout = DEFAULT_PDF_BOOKING_LAYOUT,
  tableMetaOverride = null,
) {
  switch (templateType) {
    case "receipt":
      return buildReceiptSampleData(layout, tableMetaOverride);
    case "invoice":
      return buildInvoiceSampleData(layout, tableMetaOverride);
    case "cancellation":
      return buildCancellationSampleData(layout, tableMetaOverride);
    default:
      throw new Error(`Unknown template type: ${templateType}`);
  }
}

module.exports = { buildSampleData, DEFAULT_PDF_BOOKING_LAYOUT };
