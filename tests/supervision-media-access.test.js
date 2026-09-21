const { expect } = require("chai");
const sinon = require("sinon");

const BookingManager = require("../src/commons/data-managers/booking-manager");
const MembershipManager = require("../src/commons/data-managers/membership-manager");
const TenantManager = require("../src/commons/data-managers/tenant-manager");
const {
  assertMediaFileAccess,
} = require("../src/commons/services/media/media-access");

const TENANT = "tenant-1";

/** A medium as the access rule reads it. */
function medium({ isPublic = true, bookingIds = [] } = {}) {
  return {
    id: "m1",
    tenantId: TENANT,
    uploadedBy: "uploader@example.com",
    bookingIds,
    isPublic: () => isPublic,
    isBookingDocument: () => bookingIds.length > 0,
  };
}

const anonymous = { reach: "public", userId: null };
const signedIn = (userId) => ({ reach: "own", userId });

describe("supervision: the file of a medium under a blocked tenant", function () {
  let getTenant;

  beforeEach(function () {
    getTenant = sinon
      .stub(TenantManager, "getTenant")
      .resolves({ id: TENANT, supervisionLevel: "blocked" });
    sinon
      .stub(MembershipManager, "getMembershipByTenantAndUserID")
      .resolves(null);
  });

  afterEach(function () {
    sinon.restore();
  });

  async function outcome(media, scopes) {
    try {
      await assertMediaFileAccess(media, scopes);
      return "served";
    } catch (err) {
      return `${err.statusCode} ${err.code}`;
    }
  }

  it("serves a public medium of a tenant that is not blocked", async function () {
    getTenant.resolves({ id: TENANT, supervisionLevel: "supervised" });

    expect(await outcome(medium(), { file: anonymous })).to.equal("served");
  });

  it("answers 404 without a reason for a public medium, anonymous or signed in", async function () {
    expect(await outcome(medium(), { file: anonymous })).to.equal(
      "404 media_not_found",
    );
    expect(
      await outcome(medium(), { file: signedIn("customer@example.com") }),
    ).to.equal("404 media_not_found");
  });

  it("keeps a public medium readable for the one who uploaded it", async function () {
    expect(
      await outcome(medium(), { file: signedIn("uploader@example.com") }),
    ).to.equal("served");
  });

  it("keeps the document of an existing booking readable for its owner", async function () {
    sinon
      .stub(BookingManager, "getBooking")
      .resolves({ id: "b1", tenantId: TENANT, assignedUserId: "c@x.de" });
    const document = medium({ isPublic: false, bookingIds: ["b1"] });

    const result = await outcome(document, {
      file: signedIn("c@x.de"),
      document: signedIn("c@x.de"),
    });

    expect(result).to.equal("served");
    expect(getTenant.called).to.equal(false);
  });
});
