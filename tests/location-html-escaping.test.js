/**
 * The location in the HTML output (ECCdigital/tickets#466): the display
 * address and the addition (`meta.additional`) are free text of the admins,
 * as are the name, address, phone, email and room title of an event's
 * location. The HTML pages show them as text, never as markup.
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
const { Event } = require("../src/commons/entities/event/event");

const PAYLOAD = "<b>Halle</b><img src=x onerror=alert(1)>";
const ESCAPED =
  "&lt;b&gt;Halle&lt;/b&gt;&lt;img src&#x3D;x onerror&#x3D;alert(1)&gt;";

function hallBookable(location) {
  return new Bookable({
    id: "hall",
    tenantId: "tenant1",
    type: "room",
    title: "Halle",
    isBookable: true,
    priceCategories: [],
    attachments: [],
    location,
  });
}

function concertEvent({ name, location, ...eventLocation }) {
  return new Event({
    id: "concert",
    tenantId: "tenant1",
    information: {
      name: "Herbstkonzert",
      startDate: "2026-10-05",
      startTime: "19:30",
      endDate: "2026-10-05",
      endTime: "22:00",
      flags: [],
    },
    eventLocation: { name, ...eventLocation },
    location,
  });
}

describe("location in the HTML output", function () {
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

  describe("bookable", function () {
    it("shows the display address as text on the bookable page", async function () {
      const html = await HtmlEngine.bookable(
        hallBookable({ display_address: PAYLOAD }),
      );

      expect(html).to.include(`<p class="location">${ESCAPED}</p>`);
      expect(html).not.to.include("<img src=x");
    });

    it("shows the display address as text in the list of bookables", async function () {
      const html = await HtmlEngine.bookablesToList([
        hallBookable({ display_address: PAYLOAD }),
      ]);

      expect(html).to.include(`<p class="location">${ESCAPED}</p>`);
      expect(html).not.to.include("<img src=x");
    });
  });

  describe("event", function () {
    it("shows the addition as text on the event page", async function () {
      const html = await HtmlEngine.event(
        concertEvent({ location: { meta: { additional: PAYLOAD } } }),
        false,
      );

      expect(html).to.include(`<div class="additional">${ESCAPED}</div>`);
      expect(html).not.to.include("<img src=x");
    });

    it("shows name, street, postcode and city as text on the event page", async function () {
      const html = await HtmlEngine.event(
        concertEvent({
          name: PAYLOAD,
          location: {
            address: {
              street: PAYLOAD,
              house_number: PAYLOAD,
              postcode: PAYLOAD,
              city: PAYLOAD,
            },
          },
        }),
        false,
      );

      expect(html).to.include(`<div class="name">${ESCAPED}</div>`);
      expect(html).to.include(
        `<div class="street">${ESCAPED} ${ESCAPED}</div>`,
      );
      expect(html).to.include(`<div class="zip">${ESCAPED}</div>`);
      expect(html).to.include(`<div class="city">${ESCAPED}</div>`);
      expect(html).not.to.include("<img src=x");
    });

    it("shows phone, email and the room's title as text on the event page", async function () {
      sinon
        .stub(BookableManager, "getBookable")
        .resolves(new Bookable({ id: "hall", title: PAYLOAD }));

      const html = await HtmlEngine.event(
        concertEvent({
          phoneNumber: PAYLOAD,
          emailAddress: PAYLOAD,
          room: "hall",
        }),
        false,
      );

      expect(html).to.include(`<div class="phone-number">${ESCAPED}</div>`);
      expect(html).to.include(`<div class="email-address">${ESCAPED}</div>`);
      expect(html).to.include(`<div class="room">${ESCAPED}</div>`);
      expect(html).not.to.include("<img src=x");
    });
  });

  describe("plain values", function () {
    it("keeps umlauts and shows an ampersand as one", async function () {
      const bookableHtml = await HtmlEngine.bookable(
        hallBookable({ display_address: "Mühlenstraße 3, 24103 Kiel" }),
      );
      const eventHtml = await HtmlEngine.event(
        concertEvent({
          name: "Kultur & Bühne",
          location: {
            address: {
              street: "Mühlenstraße",
              house_number: "3",
              postcode: "24103",
              city: "Kiel",
            },
            meta: { additional: "Halle 2, Hintereingang" },
          },
        }),
        false,
      );

      expect(bookableHtml).to.include(
        '<p class="location">Mühlenstraße 3, 24103 Kiel</p>',
      );
      expect(eventHtml).to.include(
        '<div class="name">Kultur &amp; Bühne</div>',
      );
      expect(eventHtml).to.include('<div class="street">Mühlenstraße 3</div>');
      expect(eventHtml).to.include('<div class="zip">24103</div>');
      expect(eventHtml).to.include('<div class="city">Kiel</div>');
      expect(eventHtml).to.include(
        '<div class="additional">Halle 2, Hintereingang</div>',
      );
    });
  });
});
