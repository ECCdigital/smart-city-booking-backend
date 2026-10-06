/**
 * The vocabulary of the supervision level (glossary "Aufsichtsstufe"): four
 * levels, of which three are initial levels (glossary "Startstufe") and two
 * are public. The one check of a level from outside names what it allows.
 */

const { expect } = require("chai");

const {
  SUPERVISION_LEVELS,
  SUPERVISION_LEVEL_VALUES,
  INITIAL_SUPERVISION_LEVELS,
  PUBLIC_SUPERVISION_LEVELS,
  assertSupervisionLevel,
} = require("../src/commons/services/supervision/supervision-constants");
const { BadRequestError } = require("../src/errors/BaseError");

describe("supervision constants: the levels", function () {
  it("names the four levels, and no blocked one", function () {
    expect(SUPERVISION_LEVELS).to.deep.equal({
      FREE: "free",
      SUPERVISED: "supervised",
      PENDING: "pending",
      DECLINED: "declined",
    });
    expect(SUPERVISION_LEVEL_VALUES).to.deep.equal([
      "free",
      "supervised",
      "pending",
      "declined",
    ]);
  });

  it("names the initial levels without declined", function () {
    expect(INITIAL_SUPERVISION_LEVELS).to.deep.equal([
      "free",
      "supervised",
      "pending",
    ]);
  });

  it("names the public levels: free and supervised alone", function () {
    expect(PUBLIC_SUPERVISION_LEVELS).to.deep.equal(["free", "supervised"]);
  });
});

describe("supervision constants: assertSupervisionLevel", function () {
  function refused(level, params) {
    try {
      assertSupervisionLevel(level, params);
    } catch (error) {
      return error;
    }
    throw new Error(`expected ${JSON.stringify(level)} to be refused`);
  }

  it("accepts every level and returns it", function () {
    for (const level of SUPERVISION_LEVEL_VALUES) {
      expect(assertSupervisionLevel(level)).to.equal(level);
    }
  });

  it("refuses blocked, naming the four allowed levels", function () {
    const error = refused("blocked");

    expect(error).to.be.instanceOf(BadRequestError);
    expect(error.toJSON().code).to.equal("invalid_supervision_level");
    expect(error.toJSON().params).to.deep.equal({
      level: "blocked",
      allowed: ["free", "supervised", "pending", "declined"],
    });
  });

  it("checks against the allowed list it is given and names that list", function () {
    expect(
      assertSupervisionLevel("pending", {
        allowed: INITIAL_SUPERVISION_LEVELS,
      }),
    ).to.equal("pending");

    const error = refused("declined", {
      field: "tenantInitialSupervisionLevel",
      allowed: INITIAL_SUPERVISION_LEVELS,
    });

    expect(error.toJSON().code).to.equal("invalid_supervision_level");
    expect(error.toJSON().params).to.deep.equal({
      field: "tenantInitialSupervisionLevel",
      level: "declined",
      allowed: ["free", "supervised", "pending"],
    });
  });
});
