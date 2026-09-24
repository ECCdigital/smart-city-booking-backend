/**
 * The offer gate (tenant supervision spec §5.1), tenant part: a pending
 * (glossary "Freigabe ausstehend") or declined (glossary "abgewiesen")
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
const pending = { id: "t", supervisionLevel: SUPERVISION_LEVELS.PENDING };
const declined = { id: "t", supervisionLevel: SUPERVISION_LEVELS.DECLINED };
const supervised = { id: "t", supervisionLevel: SUPERVISION_LEVELS.SUPERVISED };
const legacy = { id: "t" };
const hidden = [pending, declined];

describe("supervision offer gate: the tenant part", function () {
  it("hides a pending and a declined tenant alike and shows free and supervised", function () {
    expect(isTenantPubliclyVisible(pending)).to.equal(false);
    expect(isTenantPubliclyVisible(declined)).to.equal(false);
    expect(isTenantPubliclyVisible(free)).to.equal(true);
    expect(isTenantPubliclyVisible(supervised)).to.equal(true);
  });

  it("hides a tenant at a level it does not know", function () {
    expect(isTenantPubliclyVisible({ id: "t", supervisionLevel: "blocked" })).to
      .be.false;
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

  it("lists only what asks to be listed, of a public tenant", function () {
    expect(isOfferListable({ tenant: free, offer: { isPublic: true } })).to.be
      .true;
    expect(isOfferListable({ tenant: free, offer: { isPublic: false } })).to.be
      .false;
    expect(isOfferListable({ tenant: free, offer: {} })).to.be.false;
    for (const tenant of hidden) {
      expect(isOfferListable({ tenant, offer: { isPublic: true } })).to.be
        .false;
    }
  });

  it("reaches a direct link of a public tenant only", function () {
    expect(isOfferReachable({ tenant: free, offer: { isPublic: false } })).to.be
      .true;
    for (const tenant of hidden) {
      expect(isOfferReachable({ tenant, offer: { isPublic: true } })).to.be
        .false;
    }
  });

  it("answers the query condition of the visible tenants as a positive list, a missing level included", function () {
    expect(publicTenantCondition()).to.deep.equal({
      supervisionLevel: { $in: ["free", "supervised", null] },
    });
  });
});

/**
 * The review part (spec §5.1, rows 3-6): under `supervised` only an
 * approved offer passes, list and direct link alike; `free` ignores the
 * stored status; `pending` and `declined` let nothing out.
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

  it("pending and declined: nothing, whatever the status", function () {
    for (const tenant of hidden) {
      for (const status of statuses) {
        expect(isOfferReachable({ tenant, offer: offer(status, true) })).to.be
          .false;
        expect(isOfferListable({ tenant, offer: offer(status, true) })).to.be
          .false;
      }
    }
  });
});
