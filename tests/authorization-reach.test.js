/**
 * The reach as a query condition (authorize spec §4.1): the manager names
 * its owner key, `ownCondition` answers what to add to the query.
 */

const { expect } = require("chai");

const { ownCondition } = require("../src/commons/services/authorization/reach");

describe("authorization reach: the own condition of a manager", function () {
  it("adds nothing under any", function () {
    expect(
      ownCondition("ownerUserId", { reach: "any", userId: "u1" }),
    ).to.deep.equal({});
  });

  it("adds nothing for a caller without a reach - the domain reads everything", function () {
    expect(ownCondition("ownerUserId")).to.deep.equal({});
    expect(ownCondition("ownerUserId", {})).to.deep.equal({});
  });

  it("names the owner key under own", function () {
    expect(
      ownCondition("assignedUserId", { reach: "own", userId: "u1" }),
    ).to.deep.equal({ assignedUserId: "u1" });
  });

  it("refuses own without a user: the condition would match nobody's records", function () {
    expect(() => ownCondition("ownerUserId", { reach: "own" })).to.throw(
      /without a user/,
    );
    expect(() =>
      ownCondition("ownerUserId", { reach: "own", userId: null }),
    ).to.throw(/without a user/);
  });

  it("refuses public: what the public sees is the manager's own answer", function () {
    expect(() =>
      ownCondition("ownerUserId", { reach: "public", userId: "u1" }),
    ).to.throw(/reach public/);
  });
});
