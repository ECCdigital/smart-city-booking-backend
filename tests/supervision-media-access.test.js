const { expect } = require("chai");
const sinon = require("sinon");

const BookingManager = require("../src/commons/data-managers/booking-manager");
const MembershipManager = require("../src/commons/data-managers/membership-manager");
const TenantManager = require("../src/commons/data-managers/tenant-manager");
const {
  BookableManager,
} = require("../src/commons/data-managers/bookable-manager");
const {
  MediaUsageService,
} = require("../src/commons/services/media/media-usage");
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

describe("supervision: the file of a medium under a pending tenant", function () {
  let getTenant;

  beforeEach(function () {
    getTenant = sinon
      .stub(TenantManager, "getTenant")
      .resolves({ id: TENANT, supervisionLevel: "pending" });
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

  it("serves a public medium of a tenant at a public level", async function () {
    getTenant.resolves({ id: TENANT, supervisionLevel: "free" });

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

  it("answers the same 404 under a declined tenant", async function () {
    getTenant.resolves({ id: TENANT, supervisionLevel: "declined" });

    expect(await outcome(medium(), { file: anonymous })).to.equal(
      "404 media_not_found",
    );
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

describe("supervision: a public medium under a supervised tenant", function () {
  const holder = (review, isPublic = false) => ({
    id: "b1",
    tenantId: TENANT,
    isPublic,
    review: { status: review },
  });

  function world({ usage, bookable }) {
    sinon
      .stub(TenantManager, "getTenant")
      .resolves({ id: TENANT, supervisionLevel: "supervised" });
    sinon
      .stub(MembershipManager, "getMembershipByTenantAndUserID")
      .resolves(null);
    sinon.stub(MediaUsageService, "findUsage").resolves(usage);
    sinon.stub(BookableManager, "getBookable").resolves(bookable);
  }

  afterEach(function () {
    sinon.restore();
  });

  const served = (scopes) =>
    assertMediaFileAccess(medium(), scopes).then(
      () => true,
      (err) => `${err.statusCode} ${err.code}`,
    );

  const bookableSite = [{ type: "bookable", id: "b1", title: "Hall" }];

  it("hides a medium that only an unapproved offer holds", async function () {
    world({ usage: bookableSite, bookable: holder("pending", true) });

    expect(await served({ file: anonymous })).to.equal("404 media_not_found");
  });

  it("serves it with an approved offer, publication wish or not", async function () {
    world({ usage: bookableSite, bookable: holder("approved", false) });

    expect(await served({ file: anonymous })).to.equal(true);
  });

  it("serves a medium that something besides offers holds, or nothing", async function () {
    world({
      usage: [...bookableSite, { type: "tenant", id: TENANT, title: "T" }],
      bookable: holder(null),
    });
    expect(await served({ file: anonymous })).to.equal(true);

    sinon.restore();
    world({ usage: [], bookable: null });
    expect(await served({ file: anonymous })).to.equal(true);
  });
});
