/**
 * `planUpdate` turns the flags an admin PUT carries into the list of
 * lifecycle transitions the update needs (BookingLifecycle spec, part 1,
 * section 6): always `amend` first, then the state changes the flags ask
 * for; flags without a way are a 400 `invalid_status_change`. Pure; it is
 * not wired into the PUT yet (ticket 7).
 */

const { expect } = require("chai");

const {
  planUpdate,
} = require("../src/commons/services/booking-lifecycle/update-plan");
const { BadRequestError } = require("../src/errors/BaseError");

const BAD = "invalid_status_change";

function flags(isCommitted, isPayed, isRejected) {
  return { isCommitted, isPayed, isRejected };
}

function plan(currentStatus, requestedFlags, priceEur, context) {
  try {
    return planUpdate(currentStatus, requestedFlags, priceEur, context);
  } catch (error) {
    if (error instanceof BadRequestError && error.code === BAD) {
      return BAD;
    }
    throw error;
  }
}

describe("update-plan: planUpdate", function () {
  describe("a priced booking (40 EUR)", function () {
    const CASES = [
      // [current, [isCommitted, isPayed, isRejected], plan]
      ["requested", [false, false, false], ["amend"]],
      ["requested", [true, false, false], ["amend", "confirm"]],
      ["requested", [true, true, false], ["amend", "confirm", "pay"]],
      ["requested", [false, false, true], ["amend", "cancel"]],
      ["requested", [true, false, true], ["amend", "confirm", "cancel"]],
      ["requested", [true, true, true], ["amend", "confirm", "pay", "cancel"]],
      ["requested", [false, true, false], BAD],
      ["requested", [false, true, true], BAD],

      ["payment_due", [true, false, false], ["amend"]],
      ["payment_due", [true, true, false], ["amend", "pay"]],
      ["payment_due", [true, false, true], ["amend", "cancel"]],
      ["payment_due", [true, true, true], ["amend", "pay", "cancel"]],
      ["payment_due", [false, false, false], BAD],
      ["payment_due", [false, false, true], BAD],
      ["payment_due", [false, true, false], BAD],
      ["payment_due", [false, true, true], BAD],

      ["confirmed", [true, true, false], ["amend"]],
      ["confirmed", [true, true, true], ["amend", "cancel"]],
      ["confirmed", [true, false, false], BAD],
      ["confirmed", [true, false, true], BAD],
      ["confirmed", [false, false, false], BAD],
      ["confirmed", [false, false, true], BAD],
      ["confirmed", [false, true, false], BAD],
      ["confirmed", [false, true, true], BAD],

      ["rejected", [false, false, true], ["amend"]],
      ["rejected", [false, false, false], ["amend", "reinstate"]],
      ["rejected", [true, false, false], BAD],
      ["rejected", [true, true, false], BAD],
      ["rejected", [true, false, true], BAD],
      ["rejected", [true, true, true], BAD],
      ["rejected", [false, true, false], BAD],
      ["rejected", [false, true, true], BAD],
    ];

    for (const [
      current,
      [isCommitted, isPayed, isRejected],
      expected,
    ] of CASES) {
      it(`${current} + committed ${isCommitted}, paid ${isPayed}, rejected ${isRejected} → ${JSON.stringify(expected)}`, function () {
        expect(
          plan(current, flags(isCommitted, isPayed, isRejected), 40),
        ).to.deep.equal(expected);
      });
    }
  });

  describe("a cancelled priced booking", function () {
    const CASES = [
      // [cancelledFrom, [isCommitted, isPayed, isRejected], plan]
      ["confirmed", [true, true, true], ["amend"]],
      ["confirmed", [true, true, false], ["amend", "reinstate"]],
      ["confirmed", [true, false, true], BAD],
      ["confirmed", [true, false, false], BAD],
      ["confirmed", [false, false, false], BAD],
      ["confirmed", [false, false, true], BAD],
      ["payment_due", [true, false, true], ["amend"]],
      ["payment_due", [true, false, false], ["amend", "reinstate"]],
      ["payment_due", [true, true, true], BAD],
      ["payment_due", [true, true, false], BAD],
      ["payment_due", [false, false, false], BAD],
      [undefined, [true, false, true], ["amend"]],
      [undefined, [true, false, false], BAD],
    ];

    for (const [
      cancelledFrom,
      [isCommitted, isPayed, isRejected],
      expected,
    ] of CASES) {
      it(`cancelled from ${cancelledFrom} + committed ${isCommitted}, paid ${isPayed}, rejected ${isRejected} → ${JSON.stringify(expected)}`, function () {
        expect(
          plan("cancelled", flags(isCommitted, isPayed, isRejected), 40, {
            cancelledFrom,
          }),
        ).to.deep.equal(expected);
      });
    }
  });

  describe("a free booking: isPayed says nothing", function () {
    const CASES = [
      ["requested", [false, false, false], ["amend"]],
      ["requested", [false, true, false], ["amend"]],
      ["requested", [true, false, false], ["amend", "confirm"]],
      ["requested", [true, true, false], ["amend", "confirm"]],
      ["requested", [true, true, true], ["amend", "confirm", "cancel"]],
      ["requested", [false, true, true], ["amend", "cancel"]],
      ["confirmed", [true, false, false], ["amend"]],
      ["confirmed", [true, true, false], ["amend"]],
      ["confirmed", [true, true, true], ["amend", "cancel"]],
      ["confirmed", [false, false, false], BAD],
      ["rejected", [false, true, false], ["amend", "reinstate"]],
    ];

    for (const [
      current,
      [isCommitted, isPayed, isRejected],
      expected,
    ] of CASES) {
      it(`${current} + committed ${isCommitted}, paid ${isPayed}, rejected ${isRejected} → ${JSON.stringify(expected)}`, function () {
        expect(
          plan(current, flags(isCommitted, isPayed, isRejected), 0, {
            cancelledFrom: "confirmed",
          }),
        ).to.deep.equal(expected);
      });
    }
  });

  it("reads missing flags as false", function () {
    expect(planUpdate("requested", {}, 40)).to.deep.equal(["amend"]);
    expect(planUpdate("requested", { isCommitted: 1 }, "40")).to.deep.equal([
      "amend",
      "confirm",
    ]);
  });

  it("the 400 names the state and the flags it could not reach", function () {
    let error;
    try {
      planUpdate("confirmed", flags(true, false, false), 40);
    } catch (caught) {
      error = caught;
    }
    expect(error).to.be.instanceOf(BadRequestError);
    expect(error.code).to.equal(BAD);
    expect(error.statusCode).to.equal(400);
    expect(error.params).to.deep.equal({
      status: "confirmed",
      requested: flags(true, false, false),
    });
  });

  it("refuses an unknown current state", function () {
    expect(() => planUpdate("paid", flags(true, true, false), 40)).to.throw(
      /unknown booking status/,
    );
  });
});
