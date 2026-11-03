/**
 * A flat-rate price in the HTML output of the web integration
 * (ECCdigital/smart-city-booking-issues#39): the storefront marks a price
 * category with `fixedPrice` as „Pauschalpreis“ and shows it without a unit.
 * The pages embedded by booking-manager.js show it the same way.
 */

const { expect } = require("chai");
const sinon = require("sinon");

const HtmlEngine = require("../src/platform/html-engine/html-engine");
const {
  BookableManager,
} = require("../src/commons/data-managers/bookable-manager");
const ExternalPriceService = require("../src/commons/services/external-price-service");
const InstanceManager = require("../src/commons/data-managers/instance-manager");
const TenantManager = require("../src/commons/data-managers/tenant-manager");
const { Bookable } = require("../src/commons/entities/bookable/bookable");

const FLAT_RATE = '<span class="price-category-flat-rate">Pauschalpreis</span>';

function hallBookable(priceCategories) {
  return new Bookable({
    id: "hall",
    tenantId: "tenant1",
    type: "room",
    title: "Halle",
    isBookable: true,
    priceType: "per-hour",
    priceCategories,
    attachments: [],
  });
}

function category(overrides) {
  return {
    priceEur: 50,
    interval: { start: "", end: "" },
    fixedPrice: false,
    holidays: [],
    weekdays: [],
    ...overrides,
  };
}

// The price of one category: the text between its list item tags.
function priceItems(html) {
  return [...html.matchAll(/<li class="price-category-item">(.*?)<\/li>/g)].map(
    (match) => match[1],
  );
}

describe("flat-rate price in the HTML output", function () {
  beforeEach(function () {
    sinon.stub(BookableManager, "getRelatedBookables").resolves([]);
    sinon.stub(BookableManager, "getEventBookables").resolves([]);
    sinon.stub(ExternalPriceService, "resolve").resolves(null);
    sinon.stub(TenantManager, "getTenant").resolves({ id: "tenant1" });
    sinon
      .stub(InstanceManager, "getInstance")
      .resolves({ checkout: { useLegacyCheckout: true } });
  });

  afterEach(function () {
    sinon.restore();
  });

  const flatAndHourly = () =>
    hallBookable([
      category({ interval: { start: 4, end: 24 }, fixedPrice: true }),
      category({ priceEur: 5, interval: { start: 0, end: 4 } }),
    ]);

  it("marks a flat-rate price as Pauschalpreis on the bookable page, without a unit", async function () {
    const [flat, hourly] = priceItems(
      await HtmlEngine.bookable(flatAndHourly()),
    );

    expect(flat).to.include(FLAT_RATE);
    // Intl separates amount and currency with a no-break space.
    expect(flat).to.include("50,00\u00a0€</span>");
    expect(flat).not.to.include("/Stunde");
    expect(hourly).not.to.include("Pauschalpreis");
    expect(hourly).to.include("5,00\u00a0€/Stunde</span>");
  });

  it("marks a flat-rate price as Pauschalpreis in the list of bookables", async function () {
    const [flat, hourly] = priceItems(
      await HtmlEngine.bookablesToList([flatAndHourly()]),
    );

    expect(flat).to.include(FLAT_RATE);
    expect(flat).not.to.include("/Stunde");
    expect(hourly).not.to.include("Pauschalpreis");
  });

  it("keeps the interval of a flat-rate price", async function () {
    const [flat] = priceItems(await HtmlEngine.bookable(flatAndHourly()));

    expect(flat).to.include(
      '<span class="price-category-interval">4 - 24</span>',
    );
  });
});
