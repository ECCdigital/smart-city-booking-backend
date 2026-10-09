/**
 * The postcode of an event's location (ECCdigital/tickets#373): the address
 * keeps it under `address.postcode`, and the iCal and the HTML of the event
 * show it before the city.
 */

const { expect } = require("chai");
const sinon = require("sinon");

const ICalService = require("../src/commons/services/ical-service");
const HtmlEngine = require("../src/platform/html-engine/html-engine");
const {
  BookableManager,
} = require("../src/commons/data-managers/bookable-manager");
const { Event } = require("../src/commons/entities/event/event");

function kielEvent() {
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
    location: {
      address: {
        street: "Rathausplatz",
        house_number: "1",
        postcode: "24103",
        city: "Kiel",
      },
    },
  });
}

describe("postcode of an event's location", function () {
  afterEach(function () {
    sinon.restore();
  });

  it("puts the postcode before the city in the iCal LOCATION", function () {
    const cal = ICalService.generateEventCal(kielEvent(), { name: "Kiel" });

    expect(cal.events()[0].location()).to.deep.include({
      title: "Rathausplatz 1, 24103 Kiel",
    });
  });

  it("shows the postcode before the city in the HTML", async function () {
    sinon.stub(BookableManager, "getEventBookables").resolves([]);

    const html = await HtmlEngine.event(kielEvent(), false);

    expect(html).to.include('<div class="zip">24103</div>');
  });
});
