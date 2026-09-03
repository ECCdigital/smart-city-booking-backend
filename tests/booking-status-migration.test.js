/**
 * The migration that gives every booking its stored state: `status` read
 * off the three flags for every combination of them, `cancelledFrom` for
 * the cancelled ones, idempotent, and `down` puts the documents back as
 * they were.
 */

const { expect } = require("chai");

const migration = require("../migrations/scripts/03-09-2026-add-booking-status");
const { Booking } = require("../src/commons/entities/booking/booking");
const { createFakeMongoose } = require("./helpers/fake-mongoose");

const REFUND = {
  cancelledAt: 1000,
  originalAmountEur: 40,
  suggestedRefundPercentage: 100,
  appliedRefundPercentage: 100,
  refundAmountEur: 40,
  cancellationFeeEur: 0,
  origin: "admin",
  adminOverride: false,
};

/**
 * One booking per flag combination and price, named by what it holds:
 * `c` committed, `p` paid, `r` rejected, then the price.
 */
function fixture() {
  const bookings = [];
  let n = 0;

  for (const priceEur of [40, 0]) {
    for (const isCommitted of [false, true]) {
      for (const isPayed of [false, true]) {
        for (const isRejected of [false, true]) {
          n += 1;
          bookings.push({
            _id: `id-${n}`,
            id: `${isCommitted ? "c" : "-"}${isPayed ? "p" : "-"}${isRejected ? "r" : "-"}@${priceEur}`,
            tenantId: "tenant-1",
            priceEur,
            isCommitted,
            isPayed,
            isRejected,
          });
        }
      }
    }
  }

  // Cancelled bookings that carry a refund audit already.
  bookings.push(
    {
      _id: "id-refund-paid",
      id: "cpr@40+refund",
      tenantId: "tenant-1",
      priceEur: 40,
      isCommitted: true,
      isPayed: true,
      isRejected: true,
      cancellationRefund: { ...REFUND },
    },
    {
      _id: "id-refund-unpaid",
      id: "c-r@40+refund",
      tenantId: "tenant-1",
      priceEur: 40,
      isCommitted: true,
      isPayed: false,
      isRejected: true,
      cancellationRefund: { ...REFUND },
    },
    // A booking migrated by hand already: left alone.
    {
      _id: "id-done",
      id: "done",
      tenantId: "tenant-1",
      priceEur: 40,
      isCommitted: false,
      isPayed: false,
      isRejected: false,
      status: "requested",
    },
  );

  return bookings;
}

describe("03-09-2026-add-booking-status migration", function () {
  let mongoose;
  let before;
  const stored = (id) =>
    mongoose.model("Booking").documents.find((doc) => doc.id === id);

  beforeEach(async function () {
    mongoose = createFakeMongoose({ Booking: fixture() });
    before = mongoose.snapshot();
  });

  describe("up", function () {
    beforeEach(async function () {
      await migration.up(mongoose);
    });

    const EXPECTED = {
      "---@40": "requested",
      "--r@40": "rejected",
      "-p-@40": "confirmed",
      "-pr@40": "rejected",
      "c--@40": "payment_due",
      "c-r@40": "cancelled",
      "cp-@40": "confirmed",
      "cpr@40": "cancelled",
      "---@0": "requested",
      "--r@0": "rejected",
      "-p-@0": "requested",
      "-pr@0": "rejected",
      "c--@0": "confirmed",
      "c-r@0": "cancelled",
      "cp-@0": "confirmed",
      "cpr@0": "cancelled",
    };

    for (const [id, status] of Object.entries(EXPECTED)) {
      it(`reads ${id} as ${status}`, function () {
        expect(stored(id).status).to.equal(status);
      });
    }

    it("records where a cancelled booking was cancelled from, creating the refund audit where there was none", function () {
      expect(stored("cpr@40").cancellationRefund).to.deep.equal({
        cancelledFrom: "confirmed",
      });
      expect(stored("c-r@40").cancellationRefund).to.deep.equal({
        cancelledFrom: "payment_due",
      });
      expect(stored("c-r@0").cancellationRefund).to.deep.equal({
        cancelledFrom: "confirmed",
      });
      expect(stored("cpr@0").cancellationRefund).to.deep.equal({
        cancelledFrom: "confirmed",
      });
    });

    it("adds cancelledFrom to a refund audit that is there", function () {
      expect(stored("cpr@40+refund").cancellationRefund).to.deep.equal({
        ...REFUND,
        cancelledFrom: "confirmed",
      });
      expect(stored("c-r@40+refund").cancellationRefund).to.deep.equal({
        ...REFUND,
        cancelledFrom: "payment_due",
      });
    });

    it("leaves the other bookings without a refund audit", function () {
      for (const id of ["---@40", "--r@40", "cp-@40", "c--@0"]) {
        expect(stored(id)).to.not.have.property("cancellationRefund");
      }
    });

    it("leaves the flags as they were", function () {
      for (const doc of before.Booking.documents) {
        const { isCommitted, isPayed, isRejected } = stored(doc.id);
        expect({ isCommitted, isPayed, isRejected }).to.deep.equal({
          isCommitted: doc.isCommitted,
          isPayed: doc.isPayed,
          isRejected: doc.isRejected,
        });
      }
    });

    it("does not touch a booking that has a status", function () {
      expect(stored("done")).to.deep.equal(
        before.Booking.documents.find((doc) => doc.id === "done"),
      );
    });

    it("is idempotent", async function () {
      const once = mongoose.snapshot();
      await migration.up(mongoose);
      expect(mongoose.snapshot()).to.deep.equal(once);
    });

    it("hydrates as an entity whose derived flags read the same state back", function () {
      for (const doc of mongoose.model("Booking").documents) {
        const entity = new Booking(doc);
        expect(entity.status).to.equal(doc.status);
        expect(new Booking({ ...entity }).status).to.equal(doc.status);
      }
    });
  });

  describe("down", function () {
    it("removes status and cancelledFrom and restores the documents", async function () {
      await migration.up(mongoose);
      await migration.down(mongoose);

      const restored = mongoose.snapshot();
      const expected = JSON.parse(JSON.stringify(before));
      // `down` takes the status off the hand-migrated booking too.
      delete expected.Booking.documents.find((doc) => doc.id === "done").status;
      expect(restored).to.deep.equal(expected);
    });

    it("is idempotent", async function () {
      await migration.up(mongoose);
      await migration.down(mongoose);
      const once = mongoose.snapshot();
      await migration.down(mongoose);
      expect(mongoose.snapshot()).to.deep.equal(once);
    });
  });
});
