/**
 * The `Booking` entity carries `status` and derives the three flags from it
 * on every read, so every write stores them consistently; assigning a flag
 * is refused (BookingLifecycle spec, part 1, 3.2).
 */

const { expect } = require("chai");

const { Booking } = require("../src/commons/entities/booking/booking");
const {
  resolveBookingStatusKey,
  BOOKING_STATUS_I18N,
} = require("../src/commons/services/booking/booking-status-keys");

function booking(overrides = {}) {
  return new Booking({
    id: "B1",
    tenantId: "tenant-1",
    mail: "customer@example.test",
    priceEur: 40,
    paymentProvider: "invoice",
    timeBegin: 1000,
    timeEnd: 2000,
    bookableItems: [{ bookableId: "room", amount: 1 }],
    ...overrides,
  });
}

describe("Booking entity: status and the derived flags", function () {
  describe("construction", function () {
    it("takes status from the document and derives the flags", function () {
      const b = booking({ status: "payment_due" });
      expect(b.status).to.equal("payment_due");
      expect([b.isCommitted, b.isPayed, b.isRejected]).to.deep.equal([
        true,
        false,
        false,
      ]);
    });

    it("reads a document that still speaks in flags the way the migration does", function () {
      expect(booking({}).status).to.equal("requested");
      expect(booking({ isCommitted: true }).status).to.equal("payment_due");
      expect(booking({ isCommitted: true, priceEur: 0 }).status).to.equal(
        "confirmed",
      );
      expect(booking({ isCommitted: true, isPayed: true }).status).to.equal(
        "confirmed",
      );
      expect(booking({ isRejected: true }).status).to.equal("rejected");
      expect(
        booking({ isCommitted: true, isPayed: true, isRejected: true }).status,
      ).to.equal("cancelled");
      expect(booking({ isPayed: true }).status).to.equal("confirmed");
      expect(booking({ isPayed: true, priceEur: 0 }).status).to.equal(
        "requested",
      );
    });

    it("lets status outrank flags that disagree with it", function () {
      const b = booking({ status: "requested", isCommitted: true });
      expect(b.status).to.equal("requested");
      expect(b.isCommitted).to.equal(false);
    });

    it("refuses a status it does not know", function () {
      expect(() => booking({ status: "paid" })).to.throw(
        /unknown booking status paid/,
      );
    });

    it("survives a copy and a spread", function () {
      const original = booking({ status: "confirmed" });
      const copy = new Booking(original);
      const spread = { ...original };

      expect(copy.status).to.equal("confirmed");
      expect(copy.isPayed).to.equal(true);
      expect(spread).to.include({
        status: "confirmed",
        isCommitted: true,
        isPayed: true,
        isRejected: false,
      });
      expect(new Booking(spread).status).to.equal("confirmed");
    });

    it("goes out as JSON with status and the flags", function () {
      const json = JSON.parse(JSON.stringify(booking({ status: "rejected" })));
      expect(json).to.include({
        status: "rejected",
        isCommitted: false,
        isPayed: false,
        isRejected: true,
      });
      expect(Object.keys(booking({}))).to.include.members([
        "status",
        "isCommitted",
        "isPayed",
        "isRejected",
      ]);
    });
  });

  describe("the flags follow the state", function () {
    it("re-derives the flags when the status changes", function () {
      const b = booking({ status: "requested" });
      b.status = "confirmed";
      expect([b.isCommitted, b.isPayed, b.isRejected]).to.deep.equal([
        true,
        true,
        false,
      ]);
    });

    it("reads isPayed of a cancelled booking from where it was cancelled", function () {
      const b = booking({ status: "cancelled" });
      expect(b.isPayed).to.equal(false);
      b.cancellationRefund = { cancelledFrom: "confirmed" };
      expect(b.isPayed).to.equal(true);
      b.cancellationRefund = { cancelledFrom: "payment_due" };
      expect(b.isPayed).to.equal(false);
    });

    it("says a free booking has nothing left to pay, whatever its state", function () {
      for (const status of [
        "requested",
        "confirmed",
        "rejected",
        "cancelled",
      ]) {
        expect(booking({ status, priceEur: 0 }).isPayed).to.equal(true);
      }
      expect(booking({ status: "requested" }).isPayed).to.equal(false);
    });

    it("keeps where flags that say cancelled were cancelled from", function () {
      const paid = booking({
        isCommitted: true,
        isPayed: true,
        isRejected: true,
      });
      expect(paid.cancellationRefund).to.deep.equal({
        cancelledFrom: "confirmed",
      });
      expect(paid.isPayed).to.equal(true);

      const unpaid = booking({ isCommitted: true, isRejected: true });
      expect(unpaid.cancellationRefund).to.deep.equal({
        cancelledFrom: "payment_due",
      });
      expect(unpaid.isPayed).to.equal(false);

      const audited = booking({
        isCommitted: true,
        isRejected: true,
        cancellationRefund: { origin: "admin", cancelledFrom: "confirmed" },
      });
      expect(audited.cancellationRefund).to.deep.equal({
        origin: "admin",
        cancelledFrom: "confirmed",
      });

      expect(booking({ isRejected: true })).to.not.have.property(
        "cancellationRefund",
      );
      expect(booking({ status: "cancelled" })).to.not.have.property(
        "cancellationRefund",
      );
    });

    it("refuses a write to a flag in a test run and keeps the state", function () {
      const b = booking({ status: "requested" });
      expect(() => {
        b.isCommitted = true;
      }).to.throw(/isCommitted is derived from status/);
      expect(b.status).to.equal("requested");
      expect(b.isCommitted).to.equal(false);
    });

    it("logs and ignores a write to a flag outside a test run", function () {
      const b = booking({ status: "requested" });
      const env = process.env.NODE_ENV;
      process.env.NODE_ENV = "production";
      try {
        b.isPayed = true;
      } finally {
        process.env.NODE_ENV = env;
      }
      expect(b.isPayed).to.equal(false);
      expect(b.status).to.equal("requested");
    });

    it("refuses a status it does not know", function () {
      const b = booking({ status: "requested" });
      expect(() => {
        b.status = "paid";
      }).to.throw(/unknown booking status paid/);
      expect(b.status).to.equal("requested");
    });
  });

  describe("readers of the state", function () {
    it("isBookingValid is true for confirmed only", function () {
      expect(booking({ status: "requested" }).isBookingValid()).to.equal(false);
      expect(booking({ status: "payment_due" }).isBookingValid()).to.equal(
        false,
      );
      expect(booking({ status: "confirmed" }).isBookingValid()).to.equal(true);
      expect(
        booking({ status: "confirmed", priceEur: 0 }).isBookingValid(),
      ).to.equal(true);
      expect(booking({ status: "rejected" }).isBookingValid()).to.equal(false);
      expect(
        booking({
          status: "cancelled",
          cancellationRefund: { cancelledFrom: "confirmed" },
        }).isBookingValid(),
      ).to.equal(false);
    });

    it("validate requires a status and passes with a derived one", function () {
      expect(booking({}).validate()).to.equal(true);
      expect(booking({ status: "cancelled" }).validate()).to.equal(true);
    });

    it("exportStatus and exportPublic carry the status", function () {
      const b = booking({ status: "payment_due" });
      expect(b.exportStatus()).to.include({
        status: "payment_due",
        isCommitted: true,
        isPayed: false,
      });
      expect(b.exportPublic()).to.include({ status: "payment_due" });
    });

    it("resolveBookingStatusKey reads the status", function () {
      const cases = [
        [
          booking({ status: "requested" }),
          BOOKING_STATUS_I18N.AWAITING_APPROVAL,
        ],
        [
          booking({ status: "payment_due" }),
          BOOKING_STATUS_I18N.PAYMENT_EXPECTED,
        ],
        [booking({ status: "confirmed" }), BOOKING_STATUS_I18N.PAID_COMPLETED],
        [
          booking({ status: "confirmed", priceEur: 0 }),
          BOOKING_STATUS_I18N.CONFIRMED_WITHOUT_PAYMENT,
        ],
        [booking({ status: "rejected" }), BOOKING_STATUS_I18N.REJECTED],
        [booking({ status: "cancelled" }), BOOKING_STATUS_I18N.REJECTED],
        // A plain object in flags is read the way the entity reads it.
        [
          { isCommitted: true, isPayed: false, priceEur: 40 },
          BOOKING_STATUS_I18N.PAYMENT_EXPECTED,
        ],
      ];
      for (const [subject, key] of cases) {
        expect(resolveBookingStatusKey(subject)).to.equal(key);
      }
    });
  });
});
