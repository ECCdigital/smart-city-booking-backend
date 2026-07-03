const PDF_BOOKING_LAYOUTS = ["summary", "compact", "detailed"];

const DEFAULT_PDF_BOOKING_LAYOUT = "detailed";

/**
 * Resolves the booking table layout for a tenant. An explicit layout on a
 * partial call or render helper overrides the tenant setting.
 */
function resolveBookingLayout(tenant, layoutOverride) {
  const layout =
    layoutOverride || tenant?.pdfBookingLayout || DEFAULT_PDF_BOOKING_LAYOUT;
  return PDF_BOOKING_LAYOUTS.includes(layout)
    ? layout
    : DEFAULT_PDF_BOOKING_LAYOUT;
}

function isValidBookingLayout(layout) {
  return PDF_BOOKING_LAYOUTS.includes(layout);
}

module.exports = {
  PDF_BOOKING_LAYOUTS,
  DEFAULT_PDF_BOOKING_LAYOUT,
  resolveBookingLayout,
  isValidBookingLayout,
};
