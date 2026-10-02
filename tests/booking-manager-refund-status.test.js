/**
 * The refund state (glossary "Erstattungsstand") at the booking managers:
 * the atomic write that only a booking carrying a refund state matches, the
 * list filter, and the booker's view - under `own` a booking comes without
 * the refund state, alone or as a member of a group.
 */

const assert = require("assert");
const sinon = require("sinon");
const BookingManager = require("../src/commons/data-managers/booking-manager");
const BookingModel = require("../src/commons/data-managers/models/bookingModel");
const GroupBookingManager = require("../src/commons/data-managers/group-booking-manager");
const GroupBookingModel = require("../src/commons/data-managers/models/groupBookingModel");
const { Booking } = require("../src/commons/entities/booking/booking");
const {
  GroupBooking,
} = require("../src/commons/entities/groupBooking/groupBooking");
const BookingService = require("../src/commons/services/checkout/booking-service");
const { DOMAIN } = require("../src/commons/services/authorization/reach");

const ANY = { reach: "any", userId: "admin-1" };
const OWN = { reach: "own", userId: "erika@example.test" };

function cancelledBooking(refund = {}) {
  return {
    id: "B-1",
    tenantId: "t1",
    status: "cancelled",
    priceEur: 40,
    mail: "erika@example.test",
    assignedUserId: "erika@example.test",
    bookableItems: [{ bookableId: "room", amount: 1 }],
    cancellationRefund: {
      cancelledAt: 1,
      refundAmountEur: 40,
      cancelledFrom: "confirmed",
      refundStatus: "completed",
      refundCompletedAt: 2,
      refundCompletedByUserId: "admin-1",
      ...refund,
    },
  };
}

/** A stored document the way the model hands it out. */
const doc = (fields) => ({ toEntity: () => new Booking(fields) });

const refundKeys = (booking) => Object.keys(booking.cancellationRefund).sort();

describe("the refund state at the booking managers", function () {
  beforeEach(function () {
    sinon.stub(BookingManager, "_enrichBookingsWithCustomFields").resolves();
  });

  afterEach(function () {
    sinon.restore();
  });

  describe("BookingManager.setRefundStatus", function () {
    it("completes with one write of the refund state alone, matching only a booking that carries one", async function () {
      const update = sinon
        .stub(BookingModel, "findOneAndUpdate")
        .resolves(doc(cancelledBooking()));

      const booking = await BookingManager.setRefundStatus(
        "t1",
        "B-1",
        {
          refundStatus: "completed",
          completedAt: 2,
          completedByUserId: "admin-1",
        },
        ANY,
      );

      assert.deepStrictEqual(update.firstCall.args, [
        {
          id: "B-1",
          tenantId: "t1",
          "cancellationRefund.refundStatus": { $exists: true },
        },
        {
          $set: {
            "cancellationRefund.refundStatus": "completed",
            "cancellationRefund.refundCompletedAt": 2,
            "cancellationRefund.refundCompletedByUserId": "admin-1",
          },
        },
        { new: true },
      ]);
      assert.strictEqual(booking.cancellationRefund.refundStatus, "completed");
    });

    it("reopens by dropping the moment and the person", async function () {
      const update = sinon
        .stub(BookingModel, "findOneAndUpdate")
        .resolves(doc(cancelledBooking({ refundStatus: "open" })));

      await BookingManager.setRefundStatus(
        "t1",
        "B-1",
        { refundStatus: "open", completedAt: 2, completedByUserId: "admin-1" },
        ANY,
      );

      assert.deepStrictEqual(update.firstCall.args[1], {
        $set: { "cancellationRefund.refundStatus": "open" },
        $unset: {
          "cancellationRefund.refundCompletedAt": "",
          "cancellationRefund.refundCompletedByUserId": "",
        },
      });
    });

    it("answers null where no booking matches, and never writes without a reach", async function () {
      const update = sinon
        .stub(BookingModel, "findOneAndUpdate")
        .resolves(null);

      assert.strictEqual(
        await BookingManager.setRefundStatus(
          "t1",
          "B-1",
          { refundStatus: "completed" },
          ANY,
        ),
        null,
      );
      await assert.rejects(
        () =>
          BookingManager.setRefundStatus("t1", "B-1", {
            refundStatus: "completed",
          }),
        /without a reach/,
      );
      assert.strictEqual(update.callCount, 1);
    });
  });

  describe("BookingManager.getTenantBookings", function () {
    it("narrows the query to a refund state where one is asked for", async function () {
      const find = sinon.stub(BookingModel, "find").resolves([]);

      await BookingManager.getTenantBookings("t1", ANY, {
        refundStatus: "open",
      });
      await BookingManager.getTenantBookings("t1", ANY);

      assert.deepStrictEqual(find.firstCall.args[0], {
        tenantId: "t1",
        "cancellationRefund.refundStatus": "open",
      });
      assert.deepStrictEqual(find.secondCall.args[0], { tenantId: "t1" });
    });
  });

  describe("the booker's view", function () {
    const WITHOUT_STATE = ["cancelledAt", "cancelledFrom", "refundAmountEur"];
    const WITH_STATE = [
      ...WITHOUT_STATE,
      "refundCompletedAt",
      "refundCompletedByUserId",
      "refundStatus",
    ].sort();

    it("under own a booking comes without the refund state; the administration and the domain get it", async function () {
      sinon
        .stub(BookingModel, "findOne")
        .callsFake(async () => doc(cancelledBooking()));
      sinon
        .stub(BookingModel, "find")
        .callsFake(async () => [doc(cancelledBooking())]);

      const own = await BookingManager.getBooking("B-1", "t1", OWN);
      const [listed] = await BookingManager.getTenantBookings("t1", OWN);
      const any = await BookingManager.getBooking("B-1", "t1", ANY);
      const domain = await BookingManager.getBooking("B-1", "t1", DOMAIN);

      assert.deepStrictEqual(refundKeys(own), WITHOUT_STATE);
      assert.deepStrictEqual(refundKeys(listed), WITHOUT_STATE);
      assert.deepStrictEqual(refundKeys(any), WITH_STATE);
      assert.deepStrictEqual(refundKeys(domain), WITH_STATE);
    });

    it('"my bookings" come without the refund state', async function () {
      sinon
        .stub(BookingModel, "find")
        .callsFake(async () => [doc(cancelledBooking())]);

      const [mine] =
        await BookingService.getAssignedBookings("erika@example.test");

      assert.deepStrictEqual(refundKeys(mine), WITHOUT_STATE);
    });

    it("under own the members of a group come without the refund state", async function () {
      const group = () => ({
        toEntity: () =>
          new GroupBooking({
            id: "G-1",
            tenantId: "t1",
            bookingIds: ["B-1"],
            assignedUserId: "erika@example.test",
            bookings: [cancelledBooking()],
          }),
      });
      sinon.stub(GroupBookingModel, "findOne").callsFake(() => ({
        populate() {
          return this;
        },
        exec: async () => group(),
      }));

      const own = await GroupBookingManager.getGroupBooking(
        "t1",
        "G-1",
        true,
        OWN,
      );
      const any = await GroupBookingManager.getGroupBooking(
        "t1",
        "G-1",
        true,
        ANY,
      );

      assert.deepStrictEqual(refundKeys(own.bookings[0]), WITHOUT_STATE);
      assert.deepStrictEqual(refundKeys(any.bookings[0]), WITH_STATE);
    });
  });
});
