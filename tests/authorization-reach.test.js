/**
 * The reach as a query condition (ADR 0002): the manager names the
 * resource it reads, `ownCondition` looks the owner key up in the table
 * and answers what to add to the query - and refuses to read without a
 * reach. The domain reads under `DOMAIN`.
 */

const { expect } = require("chai");

const {
  DOMAIN,
  PUBLIC,
  ownCondition,
  withinReach,
  readsRecords,
} = require("../src/commons/services/authorization/reach");

describe("authorization reach: the own condition of a manager", function () {
  it("adds nothing under any, and nothing for the domain", function () {
    expect(
      ownCondition("bookable", { reach: "any", userId: "u1" }),
    ).to.deep.equal({});
    expect(ownCondition("bookable", DOMAIN)).to.deep.equal({});
    expect(DOMAIN).to.deep.equal({ reach: "domain", userId: null });
    expect(Object.isFrozen(DOMAIN)).to.equal(true);
  });

  it("refuses a caller without a reach: a manager never reads everything by omission", function () {
    expect(() => ownCondition("bookable")).to.throw(/without a reach/);
    expect(() => ownCondition("bookable", {})).to.throw(/without a reach/);
    expect(() => ownCondition("bookable")).to.throw(/without a reach/);
  });

  it("names the owner key of the resource under own", function () {
    expect(
      ownCondition("booking", { reach: "own", userId: "u1" }),
    ).to.deep.equal({ assignedUserId: "u1" });
    expect(ownCondition("event", { reach: "own", userId: "u1" })).to.deep.equal(
      { ownerUserId: "u1" },
    );
    expect(ownCondition("media", { reach: "own", userId: "u1" })).to.deep.equal(
      { uploadedBy: "u1" },
    );
  });

  it("names the tenant set of the scope for a resource owned on the instance level", function () {
    expect(
      ownCondition("tenant", {
        reach: "own",
        userId: "u1",
        tenantIds: ["t1", "t2"],
      }),
    ).to.deep.equal({ id: { $in: ["t1", "t2"] } });
    expect(() =>
      ownCondition("tenant", { reach: "own", userId: "u1" }),
    ).to.throw(/without the tenant set/);
  });

  it("refuses a resource without a shared owner key", function () {
    expect(() => ownCondition("ical", { reach: "own", userId: "u1" })).to.throw(
      /no owner key for resource ical/,
    );
    expect(() =>
      ownCondition("workflow", { reach: "own", userId: "u1" }),
    ).to.throw(/no owner key for resource workflow/);
  });

  it("refuses own without a user: the condition would match nobody's records", function () {
    expect(() => ownCondition("bookable", { reach: "own" })).to.throw(
      /without a user/,
    );
    expect(() =>
      ownCondition("bookable", { reach: "own", userId: null }),
    ).to.throw(/without a user/);
  });

  it("refuses public: what the public sees is the manager's own answer", function () {
    expect(() =>
      ownCondition("bookable", { reach: "public", userId: "u1" }),
    ).to.throw(/reach public/);
  });

  it("refuses self: the principal themselves is no record (ADR 0001)", function () {
    expect(() =>
      ownCondition("bookable", { reach: "self", userId: "u1" }),
    ).to.throw(/reach self/);
    expect(
      withinReach({ ownerUserId: "u1" }, "ownerUserId", {
        reach: "self",
        userId: "u1",
      }),
    ).to.equal(false);
    expect(readsRecords({ reach: "self" })).to.equal(false);
    expect(readsRecords({ reach: "own" })).to.equal(true);
  });

  it("holds every record within the domain's reach", function () {
    expect(withinReach({ ownerUserId: "u2" }, "ownerUserId", DOMAIN)).to.equal(
      true,
    );
    expect(readsRecords(DOMAIN)).to.equal(true);
    expect(readsRecords()).to.equal(false);
  });

  it("names the public's view, and refuses a record condition under it and under self", function () {
    expect(PUBLIC).to.deep.equal({ reach: "public", userId: null });
    expect(() => ownCondition("bookable", PUBLIC)).to.throw(/reach public/);
    expect(() => ownCondition("bookable", { reach: "self" })).to.throw(
      /reach self/,
    );
  });
});
