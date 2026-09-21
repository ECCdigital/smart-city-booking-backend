/**
 * The offer gate (tenant supervision spec §5.1), tenant part: a blocked
 * tenant is neither listed nor reachable, a free one lists what asks to be
 * listed and reaches everything. The review part comes with ticket 05.
 */

const { expect } = require("chai");

const {
  isTenantPubliclyVisible,
  isOfferListable,
  isOfferReachable,
  publicTenantCondition,
} = require("../src/commons/services/supervision/offer-gate");
const {
  SUPERVISION_LEVELS,
} = require("../src/commons/services/supervision/supervision-constants");

const free = { id: "t", supervisionLevel: SUPERVISION_LEVELS.FREE };
const blocked = { id: "t", supervisionLevel: SUPERVISION_LEVELS.BLOCKED };
const supervised = { id: "t", supervisionLevel: SUPERVISION_LEVELS.SUPERVISED };
const legacy = { id: "t" };

describe("supervision offer gate: the tenant part", function () {
  it("hides a blocked tenant and shows every other one", function () {
    expect(isTenantPubliclyVisible(blocked)).to.equal(false);
    expect(isTenantPubliclyVisible(free)).to.equal(true);
    expect(isTenantPubliclyVisible(supervised)).to.equal(true);
  });

  it("counts a tenant without a level as free", function () {
    expect(isTenantPubliclyVisible(legacy)).to.equal(true);
    expect(isOfferReachable({ tenant: legacy, offer: { isPublic: false } })).to
      .be.true;
  });

  it("treats an unknown tenant as not visible", function () {
    expect(isTenantPubliclyVisible(null)).to.equal(false);
    expect(isOfferListable({ tenant: null, offer: { isPublic: true } })).to.be
      .false;
    expect(isOfferReachable({ tenant: undefined, offer: {} })).to.be.false;
  });

  it("lists only what asks to be listed, of a tenant that is not blocked", function () {
    expect(isOfferListable({ tenant: free, offer: { isPublic: true } })).to.be
      .true;
    expect(isOfferListable({ tenant: free, offer: { isPublic: false } })).to.be
      .false;
    expect(isOfferListable({ tenant: free, offer: {} })).to.be.false;
    expect(isOfferListable({ tenant: blocked, offer: { isPublic: true } })).to
      .be.false;
  });

  it("reaches a direct link of any tenant that is not blocked", function () {
    expect(isOfferReachable({ tenant: free, offer: { isPublic: false } })).to.be
      .true;
    expect(isOfferReachable({ tenant: supervised, offer: { isPublic: false } }))
      .to.be.true;
    expect(isOfferReachable({ tenant: blocked, offer: { isPublic: true } })).to
      .be.false;
  });

  it("answers the query condition of the visible tenants", function () {
    expect(publicTenantCondition()).to.deep.equal({
      supervisionLevel: { $ne: "blocked" },
    });
  });
});
