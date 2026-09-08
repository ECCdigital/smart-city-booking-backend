/**
 * The v2 booking status (`GET /api/v2/:tenant/bookings/:ids/status`) names
 * the state of a booking as `status`, the one value the storefront reads,
 * next to the flags and the i18n key it carried before.
 */

const { expect } = require("chai");
const sinon = require("sinon");

const BookingStatusController = require("../src/platform/api/v2/controllers/booking-status.controller");
const BookingManager = require("../src/commons/data-managers/booking-manager");
const { Booking } = require("../src/commons/entities/booking/booking");

const TENANT = "tenant-1";

function booking(overrides = {}) {
  return new Booking({
    id: "B-1",
    tenantId: TENANT,
    mail: "erika@example.test",
    priceEur: 40,
    paymentProvider: "giroCockpit",
    timeBegin: 1000,
    timeEnd: 2000,
    bookableItems: [{ bookableId: "room", amount: 1 }],
    ...overrides,
  });
}

async function statusOf(ids, stored) {
  sinon.stub(BookingManager, "getBookings").resolves(stored);
  const response = {
    status: sinon.stub().returnsThis(),
    json: sinon.stub().returnsThis(),
  };

  await BookingStatusController.getBookingStatus(
    { params: { tenant: TENANT, ids } },
    response,
  );

  expect(response.status.firstCall.args).to.deep.equal([200]);
  return response.json.firstCall.args[0];
}

describe("v2 booking status", function () {
  afterEach(function () {
    sinon.restore();
  });

  it("carries the booking's status next to the flags", async function () {
    const body = await statusOf("B-1", [booking({ status: "payment_due" })]);

    expect(body).to.deep.equal({
      success: true,
      data: {
        bookings: [
          {
            bookingId: "B-1",
            success: true,
            status: "payment_due",
            statusKey: "status.payment_expected",
            paymentProvider: "giroCockpit",
            isCommitted: true,
            isPayed: false,
            isRejected: false,
            priceEur: 40,
          },
        ],
      },
    });
  });

  it("names a booking it does not find as before, without a status", async function () {
    const body = await statusOf("B-1,B-9", [booking({ status: "confirmed" })]);

    expect(body.data.bookings[1]).to.deep.equal({
      bookingId: "B-9",
      success: false,
      error: {
        reason: "booking_status.booking_not_found",
        params: { bookingId: "B-9" },
      },
    });
    expect(body.data.bookings[0].status).to.equal("confirmed");
  });
});
