/**
 * The offer gate (tenant supervision spec §5.1), tenant part: a blocked
 * tenant is neither listed nor reachable, a free one lists what asks to be
 * listed and reaches everything; the review part follows below.
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
    expect(isOfferReachable({ tenant: blocked, offer: { isPublic: true } })).to
      .be.false;
  });

  it("answers the query condition of the visible tenants", function () {
    expect(publicTenantCondition()).to.deep.equal({
      supervisionLevel: { $ne: "blocked" },
    });
  });
});

/**
 * The review part (spec §5.1, rows 3-6): under `supervised` only an
 * approved offer passes, list and direct link alike; `free` ignores the
 * stored status; `blocked` lets nothing out.
 */
describe("supervision offer gate: the review part", function () {
  const offer = (status, isPublic) => ({ isPublic, review: { status } });
  const statuses = [null, "pending", "approved", "rejected"];

  it("free: the review status has no effect, only isPublic decides the list", function () {
    for (const status of statuses) {
      expect(isOfferListable({ tenant: free, offer: offer(status, true) })).to
        .be.true;
      expect(isOfferListable({ tenant: free, offer: offer(status, false) })).to
        .be.false;
      expect(isOfferReachable({ tenant: free, offer: offer(status, false) })).to
        .be.true;
    }
  });

  it("supervised: only an approved offer is reachable, listed only with isPublic", function () {
    expect(
      isOfferReachable({ tenant: supervised, offer: offer("approved", false) }),
    ).to.be.true;
    expect(
      isOfferListable({ tenant: supervised, offer: offer("approved", false) }),
    ).to.be.false;
    expect(
      isOfferListable({ tenant: supervised, offer: offer("approved", true) }),
    ).to.be.true;
    for (const status of [null, "pending", "rejected"]) {
      for (const isPublic of [true, false]) {
        expect(
          isOfferReachable({
            tenant: supervised,
            offer: offer(status, isPublic),
          }),
          `${status}/${isPublic}`,
        ).to.be.false;
        expect(
          isOfferListable({
            tenant: supervised,
            offer: offer(status, isPublic),
          }),
          `${status}/${isPublic}`,
        ).to.be.false;
      }
    }
  });

  it("supervised: an offer without a review object counts as not reviewed", function () {
    expect(isOfferReachable({ tenant: supervised, offer: { isPublic: true } }))
      .to.be.false;
  });

  it("blocked: nothing, whatever the status", function () {
    for (const status of statuses) {
      expect(isOfferReachable({ tenant: blocked, offer: offer(status, true) }))
        .to.be.false;
      expect(isOfferListable({ tenant: blocked, offer: offer(status, true) }))
        .to.be.false;
    }
  });
});
