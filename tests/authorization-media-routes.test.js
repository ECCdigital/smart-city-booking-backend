/**
 * The media routes on the authorization, end to end over the lifecycle
 * harness: the tenant library
 * follows the `manageMedia` role group, the instance library the instance
 * owner, and the two are told apart by the resource of the rights table
 * (`media` against `instanceMedia`), not by a scope object in the handler.
 * The metadata routes carry the door both populations come through
 * (`media.metadata`) and name both questions on the marker; which rule
 * applies - the library's or the receipt rule of a booking document - the
 * media rights pick from the medium. A medium out of reach is not there
 * (404, ticket 04).
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
  READ_OWN_HOLDER,
  CUSTOMER,
} = require("./helpers/booking-lifecycle-harness");
const { installRouteWorld, FIXTURE_ID } = require("./helpers/route-world");
const MediaManager = require("../src/commons/data-managers/media-manager");
const BookingManager = require("../src/commons/data-managers/booking-manager");
const { Media } = require("../src/commons/entities/media/media");
const MediaReferenceGuard = require("../src/commons/services/media/media-reference-guard");
const TenantCreationService = require("../src/commons/services/tenant/tenant-creation-service");

const FORBIDDEN = {
  error: "ForbiddenError",
  code: "forbidden",
  statusCode: 403,
  params: {},
};

const NOT_FOUND = {
  error: "NotFoundError",
  code: "media_not_found",
  statusCode: 404,
  params: { mediaId: FIXTURE_ID },
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

  /**
   * Teaches the world's two lookups what this test is about. The stubs are
   * the route world's and stand for the whole suite; a test only says what
   * they answer, so nothing of it leaks into the next one - `beforeEach`
   * puts both back.
   */
  function serve(value, booking = null) {
    MediaManager.getMedia.resolves(value);
    BookingManager.getBooking.resolves(booking);
  }

  beforeEach(function () {
    serve(media());
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

  it("hides a medium the reach does not cover, behind the door of the metadata routes", async function () {
    // The door is signed in (`media.metadata`); the rule is `media.read`,
    // named on the marker - out of its reach the medium is not there.
    const customer = await get(tenantMedia(), CUSTOMER);
    expect(customer.status).to.equal(404);
    expect(customer.body).to.deep.equal(NOT_FOUND);
    expect((await get(tenantMedia("/usage"), CUSTOMER)).status).to.equal(404);
    expect((await call("patch", tenantMedia(), CUSTOMER)).body).to.deep.equal(
      NOT_FOUND,
    );
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

    // Someone else's booking document stays theirs: not there behind the
    // metadata door, refused as a file.
    expect((await get(tenantMedia(), "max@example.test")).status).to.equal(404);
    expect(
      (await get(tenantMedia("/file"), "max@example.test")).status,
    ).to.equal(403);
    expect((await get(tenantMedia("/file"))).status).to.equal(401);

    // Nobody deletes it by hand: out of reach not there, within it refused.
    expect(
      (await call("delete", tenantMedia(), READ_OWN_HOLDER)).status,
    ).to.equal(404);
    const staff = await call("delete", tenantMedia(), ROLE_HOLDER);
    expect(staff.status).to.equal(403);
    expect(staff.body.code).to.equal("booking_document_not_deletable");
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
    expect((await get(tenantMedia("/file"))).status).to.equal(200);
    expect((await get(instanceMedia("/file"))).status).to.equal(200);
  });

  describe("the savers of media references", function () {
    /**
     * Stops a store route at the guard and answers the bundle it was
     * handed: the picker right comes from the route's marker (ticket 17),
     * so a store route that forgot to name it would refuse every medium.
     */
    async function bundleAt(check, method, path, userId, body) {
      const guard = sinon
        .stub(MediaReferenceGuard, check)
        .rejects(new Error("stopped at the guard"));
      try {
        await h.api()[method](path).set(h.as(userId)).send(body);
        expect(guard.calledOnce, `${method} ${path}`).to.equal(true);
        return guard.firstCall.args.at(-1);
      } finally {
        guard.restore();
      }
    }

    it("hand the guard the picker right their marker names", async function () {
      for (const [method, path, body] of [
        ["put", `/api/${TENANT}/bookables`, { id: FIXTURE_ID }],
        ["put", `/api/${TENANT}/bookables`, { title: "Neu" }],
        ["put", `/api/${TENANT}/events`, { title: "Neu" }],
      ]) {
        const check = path.endsWith("bookables")
          ? "assertBookableStorable"
          : "assertEventStorable";
        const reaches = await bundleAt(check, method, path, OWNER, body);
        expect(reaches, `${method} ${path}`).to.include({
          "media.read": "any",
          userId: OWNER,
        });
      }
    });

    it("hand it on when a tenant is saved or opened", async function () {
      const update = await bundleAt(
        "assertTenantStorable",
        "put",
        "/api/tenants",
        OWNER,
        { id: TENANT },
      );
      expect(update).to.include({ "media.read": "any", userId: OWNER });

      const create = sinon
        .stub(TenantCreationService, "create")
        .rejects(new Error("stopped at the creation"));
      try {
        await h
          .api()
          .post("/api/tenants")
          .set(h.as(ADMIN))
          .send({ name: "Neu" });
        expect(create.calledOnce).to.equal(true);
        expect(create.firstCall.args[0].reaches).to.include({
          "media.read": "any",
          userId: ADMIN,
        });
      } finally {
        create.restore();
      }
    });

    it("hand the picker right of the instance library on the instance", async function () {
      const reaches = await bundleAt(
        "assertInstanceStorable",
        "put",
        "/api/instances",
        ADMIN,
        {},
      );
      expect(reaches).to.include({
        "instanceMedia.read": "any",
        userId: ADMIN,
      });
    });
  });
});
