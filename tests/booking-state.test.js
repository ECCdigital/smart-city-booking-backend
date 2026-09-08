/**
 * The booking state: five stored values, the transition table of the
 * BookingLifecycle spec (part 1, 4.1) and the three flags as derivations of
 * the state (part 1, 3.2). Every cell of "state × transition" is pinned.
 */

const { expect } = require("chai");

const {
  STATUS,
  STATUSES,
  TRANSITION,
  TRANSITIONS,
  nextState,
  flagsFromStatus,
  cancelledFromFlags,
  statusFromFlags,
  isImpossibleFlagCombination,
} = require("../src/commons/services/booking-lifecycle/booking-state");
const { ConflictError } = require("../src/errors/BaseError");

const INVALID = "invalid_transition";

function paid(overrides = {}) {
  return {
    id: "B1",
    priceEur: 40,
    cancellationPolicy: { userCancellable: true },
    ...overrides,
  };
}

function free(overrides = {}) {
  return paid({ priceEur: 0, ...overrides });
}

function cancelledFrom(status, overrides = {}) {
  return paid({ cancellationRefund: { cancelledFrom: status }, ...overrides });
}

function outcome(status, transition, booking) {
  try {
    return nextState(status, transition, booking);
  } catch (error) {
    if (error instanceof ConflictError && error.code === INVALID) {
      return INVALID;
    }
    throw error;
  }
}

describe("booking-state", function () {
  it("names the five states and the seven transitions", function () {
    expect(STATUSES).to.deep.equal([
      "requested",
      "payment_due",
      "confirmed",
      "rejected",
      "cancelled",
    ]);
    expect(TRANSITIONS).to.deep.equal([
      "admit",
      "confirm",
      "pay",
      "cancel",
      "reinstate",
      "amend",
      "requestCancel",
    ]);
  });

  describe("nextState: every state × every transition, priced, user-cancellable, cancelled from confirmed", function () {
    // Rows are states, columns are transitions in TRANSITIONS order.
    const TABLE = {
      requested: [
        "requested",
        "payment_due",
        INVALID,
        "rejected",
        INVALID,
        "requested",
        "requested",
      ],
      payment_due: [
        "payment_due",
        INVALID,
        "confirmed",
        "cancelled",
        INVALID,
        "payment_due",
        "payment_due",
      ],
      confirmed: [
        "confirmed",
        INVALID,
        INVALID,
        "cancelled",
        INVALID,
        "confirmed",
        "confirmed",
      ],
      rejected: [
        INVALID,
        INVALID,
        INVALID,
        INVALID,
        "requested",
        "rejected",
        INVALID,
      ],
      cancelled: [
        INVALID,
        INVALID,
        INVALID,
        INVALID,
        "confirmed",
        "cancelled",
        INVALID,
      ],
    };

    for (const status of STATUSES) {
      for (const [index, transition] of TRANSITIONS.entries()) {
        const expected = TABLE[status][index];
        it(`${status} × ${transition} → ${expected}`, function () {
          expect(
            outcome(status, transition, cancelledFrom(STATUS.CONFIRMED)),
          ).to.equal(expected);
        });
      }
    }
  });

  describe("nextState: the cells that depend on the booking", function () {
    it("confirm lands a free booking on confirmed", function () {
      expect(nextState(STATUS.REQUESTED, TRANSITION.CONFIRM, free())).to.equal(
        STATUS.CONFIRMED,
      );
    });

    it("confirm lands a priced booking on payment_due", function () {
      expect(nextState(STATUS.REQUESTED, TRANSITION.CONFIRM, paid())).to.equal(
        STATUS.PAYMENT_DUE,
      );
    });

    it("reinstate returns a cancelled booking to the state it was cancelled from", function () {
      expect(
        nextState(
          STATUS.CANCELLED,
          TRANSITION.REINSTATE,
          cancelledFrom(STATUS.PAYMENT_DUE),
        ),
      ).to.equal(STATUS.PAYMENT_DUE);
      expect(
        nextState(
          STATUS.CANCELLED,
          TRANSITION.REINSTATE,
          cancelledFrom(STATUS.CONFIRMED),
        ),
      ).to.equal(STATUS.CONFIRMED);
    });

    it("reinstate of a cancelled booking without a recorded origin is an invalid transition", function () {
      expect(() =>
        nextState(STATUS.CANCELLED, TRANSITION.REINSTATE, paid()),
      ).to.throw(ConflictError);
      expect(
        outcome(
          STATUS.CANCELLED,
          TRANSITION.REINSTATE,
          cancelledFrom(STATUS.REQUESTED),
        ),
      ).to.equal(INVALID);
    });

    it("requestCancel needs a cancellation policy that lets the customer cancel", function () {
      for (const booking of [
        paid({ cancellationPolicy: { userCancellable: false } }),
        paid({ cancellationPolicy: {} }),
        paid({ cancellationPolicy: undefined }),
      ]) {
        for (const status of [
          STATUS.REQUESTED,
          STATUS.PAYMENT_DUE,
          STATUS.CONFIRMED,
        ]) {
          expect(outcome(status, TRANSITION.REQUEST_CANCEL, booking)).to.equal(
            INVALID,
          );
        }
      }
      expect(
        nextState(
          STATUS.CONFIRMED,
          TRANSITION.REQUEST_CANCEL,
          paid({ cancellationPolicy: { userCancellable: true } }),
        ),
      ).to.equal(STATUS.CONFIRMED);
    });

    it("the guard names booking, state and transition", function () {
      let error;
      try {
        nextState(STATUS.CONFIRMED, TRANSITION.PAY, paid());
      } catch (caught) {
        error = caught;
      }
      expect(error).to.be.instanceOf(ConflictError);
      expect(error.code).to.equal(INVALID);
      expect(error.statusCode).to.equal(409);
      expect(error.params).to.deep.equal({
        bookingId: "B1",
        status: "confirmed",
        transition: "pay",
      });
    });

    it("refuses an unknown state or transition as a programming error", function () {
      expect(() => nextState("paid", TRANSITION.PAY, paid())).to.throw(
        ConflictError,
      );
      expect(() => nextState(STATUS.REQUESTED, "commit", paid())).to.throw(
        /unknown transition/,
      );
    });
  });

  describe("flagsFromStatus: the three flags are derived from the state", function () {
    // isPayed reads as "nothing left to pay": a free booking carries it in
    // every state, a priced one once confirmed, the way the checkout sets it.
    const CASES = [
      ["requested", 40, undefined, [false, false, false]],
      ["requested", 0, undefined, [false, true, false]],
      ["payment_due", 40, undefined, [true, false, false]],
      ["confirmed", 40, undefined, [true, true, false]],
      ["confirmed", 0, undefined, [true, true, false]],
      ["rejected", 40, undefined, [false, false, true]],
      ["rejected", 0, undefined, [false, true, true]],
      ["cancelled", 40, "confirmed", [true, true, true]],
      ["cancelled", 40, "payment_due", [true, false, true]],
      ["cancelled", 40, undefined, [true, false, true]],
      ["cancelled", 0, "confirmed", [true, true, true]],
    ];

    for (const [
      status,
      priceEur,
      from,
      [isCommitted, isPayed, isRejected],
    ] of CASES) {
      it(`${status} at ${priceEur} EUR${from ? ` from ${from}` : ""} → committed ${isCommitted}, paid ${isPayed}, rejected ${isRejected}`, function () {
        expect(flagsFromStatus(status, priceEur, from)).to.deep.equal({
          isCommitted,
          isPayed,
          isRejected,
        });
      });
    }

    it("refuses an unknown state", function () {
      expect(() => flagsFromStatus("paid", 40)).to.throw(
        /unknown booking status/,
      );
    });
  });

  describe("cancelledFromFlags: where today's flags say a cancelled booking came from", function () {
    it("confirmed where paid or free, payment_due where priced and unpaid", function () {
      expect(cancelledFromFlags({ isPayed: true }, 40)).to.equal("confirmed");
      expect(cancelledFromFlags({ isPayed: false }, 0)).to.equal("confirmed");
      expect(cancelledFromFlags({}, 40)).to.equal("payment_due");
    });
  });

  describe("statusFromFlags: the migration's reading of today's flags", function () {
    const CASES = [
      // [isCommitted, isPayed, isRejected, priceEur, status, impossible]
      [false, false, false, 40, "requested", false],
      [false, false, false, 0, "requested", false],
      [true, false, false, 40, "payment_due", false],
      [true, false, false, 0, "confirmed", false],
      [true, true, false, 40, "confirmed", false],
      [true, true, false, 0, "confirmed", false],
      [false, false, true, 40, "rejected", false],
      [false, true, true, 40, "rejected", false],
      [true, false, true, 40, "cancelled", false],
      [true, true, true, 40, "cancelled", false],
      [true, true, true, 0, "cancelled", false],
      // Paid but never confirmed: the payment is the stronger statement.
      [false, true, false, 40, "confirmed", true],
      // A free booking carries isPayed from the checkout on; it says nothing.
      [false, true, false, 0, "requested", false],
    ];

    for (const [
      isCommitted,
      isPayed,
      isRejected,
      priceEur,
      status,
      impossible,
    ] of CASES) {
      it(`committed ${isCommitted}, paid ${isPayed}, rejected ${isRejected} at ${priceEur} EUR → ${status}`, function () {
        const flags = { isCommitted, isPayed, isRejected };
        expect(statusFromFlags(flags, priceEur)).to.equal(status);
        expect(isImpossibleFlagCombination(flags, priceEur)).to.equal(
          impossible,
        );
      });
    }

    it("reads missing flags as false and a missing price as free", function () {
      expect(statusFromFlags({}, undefined)).to.equal("requested");
      expect(statusFromFlags({ isCommitted: 1 }, "40")).to.equal("payment_due");
    });

    it("round-trips every state through its flags", function () {
      for (const status of STATUSES) {
        for (const priceEur of [0, 40]) {
          // A free booking is never payment_due: confirm lands it on confirmed.
          if (status === "payment_due" && priceEur === 0) continue;
          const from = status === "cancelled" ? "confirmed" : undefined;
          expect(
            statusFromFlags(flagsFromStatus(status, priceEur, from), priceEur),
          ).to.equal(status);
        }
      }
      expect(
        statusFromFlags(flagsFromStatus("cancelled", 40, "payment_due"), 40),
      ).to.equal("cancelled");
    });
  });
});
