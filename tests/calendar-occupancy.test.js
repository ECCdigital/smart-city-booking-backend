const assert = require("assert");
const sinon = require("sinon");
const {
  BookableManager,
} = require("../src/commons/data-managers/bookable-manager");
const BookingManager = require("../src/commons/data-managers/booking-manager");
const CalendarOccupancyService = require("../src/commons/services/calendar-occupancy-service");

describe("CalendarOccupancyService", () => {
  afterEach(() => {
    sinon.restore();
  });

  it("loads bookables and bookings in batch and scopes occupancies to each family", async () => {
    sinon.stub(BookableManager, "getBookables").resolves([
      {
        id: "room-a",
        title: "Room A",
        relatedBookableIds: ["room-b"],
      },
      {
        id: "room-b",
        title: "Room B",
        relatedBookableIds: [],
      },
      {
        id: "room-c",
        title: "Room C",
        relatedBookableIds: [],
      },
    ]);

    const sharedBooking = {
      id: "booking-1",
      timeBegin: 1000,
      timeEnd: 2000,
      isRejected: false,
      bookableItems: [{ bookableId: "room-b" }],
    };
    const unrelatedBooking = {
      id: "booking-2",
      timeBegin: 3000,
      timeEnd: 4000,
      isRejected: false,
      bookableItems: [{ bookableId: "room-c" }],
    };

    const batchStub = sinon
      .stub(BookingManager, "getRelatedBookingsBatch")
      .resolves([sharedBooking, unrelatedBooking]);

    const occupancies = await CalendarOccupancyService.getOccupancies("tenant-1");

    assert.strictEqual(batchStub.callCount, 1);
    assert.deepStrictEqual(new Set(batchStub.firstCall.args[1]), new Set([
      "room-a",
      "room-b",
      "room-c",
    ]));

    assert.deepStrictEqual(occupancies, [
      {
        bookableId: "room-a",
        title: "Room A",
        timeBegin: 1000,
        timeEnd: 2000,
      },
      {
        bookableId: "room-b",
        title: "Room B",
        timeBegin: 1000,
        timeEnd: 2000,
      },
      {
        bookableId: "room-c",
        title: "Room C",
        timeBegin: 3000,
        timeEnd: 4000,
      },
    ]);
  });

  it("uses time-scoped family bookings when a range is provided", async () => {
    sinon.stub(BookableManager, "getBookables").resolves([
      {
        id: "room-a",
        title: "Room A",
        relatedBookableIds: [],
      },
    ]);

    const familyStub = sinon
      .stub(BookingManager, "getBookingsForBookableFamily")
      .resolves([
        {
          id: "booking-1",
          timeBegin: 1000,
          timeEnd: 2000,
          isRejected: false,
          bookableItems: [{ bookableId: "room-a" }],
        },
      ]);

    const occupancies = await CalendarOccupancyService.getOccupancies("tenant-1", {
      timeBegin: 500,
      timeEnd: 2500,
    });

    assert.strictEqual(familyStub.callCount, 1);
    assert.deepStrictEqual(familyStub.firstCall.args, [
      "tenant-1",
      ["room-a"],
      500,
      2500,
    ]);
    assert.strictEqual(occupancies.length, 1);
  });
});
