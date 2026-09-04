/**
 * The media routes on the authorization, end to end over the lifecycle
 * harness (authorize spec §3.1, §3.2, §5, ticket 4): the tenant library
 * follows the `manageMedia` role group, the instance library the instance
 * owner, and the two are told apart by the resource of the rights table
 * (`media` against `instanceMedia`), not by a scope object in the handler.
 * The metadata routes carry the door both populations come through
 * (`media.metadata`); which rule applies - the library's or the receipt rule
 * of a booking document - the handler asks the table for.
 */

const { expect } = require("chai");
const sinon = require("sinon");

const {
  installHarness,
  bookable,
  TENANT,
  ADMIN,
  OWNER,
  ROLE_HOLDER,
  CUSTOMER,
} = require("./helpers/booking-lifecycle-harness");
const { installRouteWorld, FIXTURE_ID } = require("./helpers/route-world");
const MediaManager = require("../src/commons/data-managers/media-manager");
const BookingManager = require("../src/commons/data-managers/booking-manager");
const { Media } = require("../src/commons/entities/media/media");

const FORBIDDEN = {
  error: "ForbiddenError",
  code: "forbidden",
  statusCode: 403,
  params: {},
};

function media(overrides = {}) {
  return new Media({
    id: FIXTURE_ID,
    tenantId: TENANT,
    kind: "image",
    mimeType: "image/png",
    size: 7,
    originalFileName: "bild.png",
    uploadedBy: ROLE_HOLDER,
    visibility: "public",
    storage: { provider: "s3", key: "fx" },
    ...overrides,
  });
}

describe("authorization on the media routes", function () {
  this.timeout(20000);

  let h;

  before(async function () {
    h = await installHarness({
      bookables: {
        [FIXTURE_ID]: bookable({
          id: FIXTURE_ID,
          title: "Fixture",
          ownerUserId: ROLE_HOLDER,
        }),
      },
    });
    installRouteWorld({
      tenantId: TENANT,
      tenant: h.tenant,
      ownerUserId: ROLE_HOLDER,
      bookables: h.bookables,
    });
  });

  after(async function () {
    sinon.restore();
    await h.close();
  });

  /** Puts one medium behind the lookup for the length of a test. */
  function serve(value, booking) {
    MediaManager.getMedia.restore();
    sinon.stub(MediaManager, "getMedia").resolves(value);
    if (booking) {
      BookingManager.getBooking.restore();
      sinon.stub(BookingManager, "getBooking").resolves(booking);
    }
  }

  afterEach(function () {
    serve(media(), null);
  });

  const call = (method, path, userId) => {
    let req = h.api()[method](path);
    if (userId) req = req.set(h.as(userId));
    return req.send();
  };
  const get = (path, userId) => call("get", path, userId);

  const tenantMedia = (suffix = "") =>
    `/api/v2/${TENANT}/media/${FIXTURE_ID}${suffix}`;
  const instanceMedia = (suffix = "") =>
    `/api/v2/instance/media/${FIXTURE_ID}${suffix}`;

  it("gives the tenant library to the media role and refuses the rest in the one form", async function () {
    expect((await get(`/api/v2/${TENANT}/media/`)).status).to.equal(401);

    const customer = await get(`/api/v2/${TENANT}/media/`, CUSTOMER);
    expect(customer.status).to.equal(403);
    expect(customer.body).to.deep.equal(FORBIDDEN);

    expect(
      (await get(`/api/v2/${TENANT}/media/`, ROLE_HOLDER)).status,
    ).to.equal(200);
    expect((await get(tenantMedia(), ROLE_HOLDER)).status).to.equal(200);
    expect((await get(tenantMedia("/usage"), ROLE_HOLDER)).status).to.equal(
      200,
    );
  });

  it("refuses a medium the reach does not cover, behind the door of the metadata routes", async function () {
    // The door is signed in (`media.metadata`); the rule that refuses is
    // `media.read`, asked in the handler.
    const customer = await get(tenantMedia(), CUSTOMER);
    expect(customer.status).to.equal(403);
    expect(customer.body).to.deep.equal(FORBIDDEN);
  });

  it("lets the owner of a booking read the document of their booking", async function () {
    const document = media({
      kind: "document",
      mimeType: "application/pdf",
      visibility: "intern",
      uploadedBy: null,
      bookingIds: ["booking-fx"],
    });
    serve(document, {
      id: "booking-fx",
      tenantId: TENANT,
      assignedUserId: CUSTOMER,
    });

    // The receipt rule, not the library's: no media role anywhere.
    expect((await get(tenantMedia(), CUSTOMER)).status).to.equal(200);
    expect((await get(tenantMedia("/file"), CUSTOMER)).status).to.equal(200);

    // Someone else's booking document stays theirs.
    expect((await get(tenantMedia(), "max@example.test")).status).to.equal(403);
    expect((await get(tenantMedia("/file"))).status).to.equal(401);
  });

  it("keeps the instance library the instance owner's", async function () {
    expect((await get("/api/v2/instance/media/")).status).to.equal(401);

    const owner = await get("/api/v2/instance/media/", OWNER);
    expect(owner.status).to.equal(403);
    expect(owner.body).to.deep.equal(FORBIDDEN);

    expect((await get("/api/v2/instance/media/", ROLE_HOLDER)).status).to.equal(
      403,
    );
    expect((await get("/api/v2/instance/media/", ADMIN)).status).to.equal(200);
    expect((await get(instanceMedia(), ADMIN)).status).to.equal(200);
  });

  it("serves a public file anonymously in both libraries", async function () {
    serve(media());

    expect((await get(tenantMedia("/file"))).status).to.equal(200);
    expect((await get(instanceMedia("/file"))).status).to.equal(200);
  });
});
