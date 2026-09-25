const assert = require("assert");
const sinon = require("sinon");
const { NotFoundError } = require("../src/errors/BaseError");
const CalendarService = require("../src/commons/services/calendar-service");
const CalendarServiceV2 = require("../src/commons/services/calendar-service-v2");
const {
  BookableManager,
} = require("../src/commons/data-managers/bookable-manager");
const BookingManager = require("../src/commons/data-managers/booking-manager");
const TenantManager = require("../src/commons/data-managers/tenant-manager");
const EventManager = require("../src/commons/data-managers/event-manager");
const {
  AvailabilityContext,
} = require("../src/commons/services/availability/availability-context");
const {
  DOMAIN,
  PUBLIC,
} = require("../src/commons/services/authorization/reach");

describe("availability not-found handling", () => {
  afterEach(() => {
    sinon.restore();
  });

  it("V1 throws NotFoundError when bookable does not exist", async () => {
    sinon.stub(BookableManager, "getBookable").resolves(null);
    sinon.stub(BookableManager, "getAncestorBookables").resolves([]);
    sinon.stub(BookableManager, "getRelatedBookables").resolves([]);

    await assert.rejects(
      () =>
        CalendarService.checkAvailability(
          "tenant-1",
          "missing-bookable",
          "2026-06-17",
          "2026-06-24",
          1,
          null,
          PUBLIC,
        ),
      (error) => {
        assert.ok(error instanceof NotFoundError);
        assert.strictEqual(error.code, "bookable_not_found");
        return true;
      },
    );
    assert.deepStrictEqual(
      BookableManager.getBookable.firstCall.args.slice(0, 3),
      ["missing-bookable", "tenant-1", PUBLIC],
      "V1 reads the bookable of the route with the route's scope",
    );
  });

  it("V2 throws NotFoundError when bookable does not exist", async () => {
    sinon.stub(AvailabilityContext, "create").resolves({
      bookable: null,
      parentBookables: [],
      relatedBookables: [],
      tenant: null,
      metrics: { dbQueryCount: 0, segmentChecks: 0 },
    });

    await assert.rejects(
      () =>
        CalendarServiceV2.checkAvailability(
          "tenant-1",
          "missing-bookable",
          "2026-06-17",
          "2026-06-24",
          1,
          null,
          PUBLIC,
        ),
      (error) => {
        assert.ok(error instanceof NotFoundError);
        assert.strictEqual(error.code, "bookable_not_found");
        return true;
      },
    );
    assert.strictEqual(
      AvailabilityContext.create.firstCall.args[4],
      PUBLIC,
      "V2 hands the route's scope to the availability context",
    );
  });

  it("the availability context reads the bookable with the scope, the rest as the domain", async () => {
    const bookable = { id: "ticket-1", type: "ticket", eventId: "event-1" };
    const getBookable = sinon
      .stub(BookableManager, "getBookable")
      .resolves(bookable);
    sinon.stub(BookableManager, "getAncestorBookables").resolves([]);
    sinon.stub(BookableManager, "getRelatedBookables").resolves([]);
    sinon.stub(TenantManager, "getTenant").resolves({ id: "tenant-1" });
    const getEvent = sinon
      .stub(EventManager, "getEvent")
      .resolves({ id: "event-1" });
    sinon.stub(BookingManager, "getBookingsForBookableFamily").resolves([]);
    sinon.stub(BookingManager, "getRelatedBookingsBatch").resolves([]);
    const getEventBookings = sinon
      .stub(BookingManager, "getEventBookings")
      .resolves([]);

    const context = await AvailabilityContext.create(
      "tenant-1",
      "ticket-1",
      0,
      1000,
      PUBLIC,
    );

    assert.strictEqual(context.bookable, bookable);
    assert.strictEqual(getBookable.firstCall.args[2], PUBLIC);
    assert.strictEqual(getEvent.firstCall.args[2], PUBLIC);
    assert.strictEqual(
      BookableManager.getAncestorBookables.firstCall.args[2],
      DOMAIN,
    );
    assert.strictEqual(
      BookableManager.getRelatedBookables.firstCall.args[2],
      DOMAIN,
    );
    assert.strictEqual(TenantManager.getTenant.firstCall.args[1], DOMAIN);
    assert.strictEqual(getEventBookings.firstCall.args[2], DOMAIN);
    assert.strictEqual(
      BookingManager.getBookingsForBookableFamily.firstCall.args[4],
      DOMAIN,
    );
  });

  it("the availability context throws without a reach, like the managers", async () => {
    sinon.stub(BookableManager, "getCustomFieldDefinitions").resolves([]);
    sinon.stub(BookableManager, "getAncestorBookables").resolves([]);
    sinon.stub(BookableManager, "getRelatedBookables").resolves([]);
    sinon.stub(TenantManager, "getTenant").resolves(null);

    await assert.rejects(
      () => AvailabilityContext.create("tenant-1", "room-a", 0, 1000),
      /bookable read without a reach/,
    );
  });
});
