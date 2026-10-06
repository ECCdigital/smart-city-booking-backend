/**
 * The catalog routes on the async router (hero-layout ticket 01): an error
 * thrown below the controller reaches the central error handler and
 * arrives at the client in its one JSON form - a missing catalog as 404,
 * a `ValidationError` as 400 with `details[]`, an unexpected error as the
 * handler's 500 body. Runs the real routers over the lifecycle harness and
 * the fixture world; a case overrides one manager stub and puts it back.
 */

const { expect } = require("chai");
const sinon = require("sinon");

const {
  installHarness,
  bookable,
  TENANT,
  ADMIN,
  OWNER,
} = require("./helpers/booking-lifecycle-harness");
const { installRouteWorld, FIXTURE_ID } = require("./helpers/route-world");
const CatalogManager = require("../src/commons/data-managers/catalog-manager");
const { ValidationError } = require("../src/errors/ValidationError");

describe("catalog routes: errors reach the central error handler", function () {
  this.timeout(20000);

  let h;
  let fixtureCatalog;

  before(async function () {
    h = await installHarness({
      bookables: {
        [FIXTURE_ID]: bookable({
          id: FIXTURE_ID,
          title: "Fixture",
          ownerUserId: OWNER,
        }),
      },
    });
    installRouteWorld({
      tenantId: TENANT,
      tenant: h.tenant,
      ownerUserId: OWNER,
      bookables: h.bookables,
    });
    fixtureCatalog = await CatalogManager.getInstanceCatalog();
  });

  afterEach(function () {
    // Back to the fixture world for the next case.
    for (const name of ["getInstanceCatalog", "getCatalogByTenant"]) {
      CatalogManager[name].callsFake(async () => fixtureCatalog);
    }
    CatalogManager.updateCatalog.callsFake(async () => fixtureCatalog);
  });

  after(async function () {
    sinon.restore();
    await h.close();
  });

  const get = (path, userId) => h.api().get(`/api${path}`).set(h.as(userId));
  const put = (path, userId, body) =>
    h.api().put(`/api${path}`).set(h.as(userId)).send(body);

  it("answers a missing instance catalog with 404 in the one form", async function () {
    CatalogManager.getInstanceCatalog.resolves(null);

    const res = await get("/catalog", ADMIN);

    expect(res.status).to.equal(404);
    expect(res.body).to.deep.equal({
      error: "NotFoundError",
      code: "instance_catalog_not_found",
      statusCode: 404,
      params: {},
    });
  });

  it("answers a missing tenant catalog with 404 naming the tenant", async function () {
    CatalogManager.getCatalogByTenant.resolves(null);

    const res = await get(`/${TENANT}/catalog`, OWNER);

    expect(res.status).to.equal(404);
    expect(res.body).to.deep.equal({
      error: "NotFoundError",
      code: "catalog_not_found",
      statusCode: 404,
      params: { tenantId: TENANT },
    });
  });

  // The body is valid, so the service's own normaliser lets it through and the
  // manager below it is what refuses: this pins the propagation, not the
  // validation. An empty `name` would be refused by the normaliser first and
  // the test would pass without the manager ever being called.
  it("answers a ValidationError from below the controller with 400 and details[]", async function () {
    CatalogManager.updateCatalog.rejects(
      new ValidationError([{ field: "slug", code: "invalid_format" }]),
    );

    const res = await put("/catalog", ADMIN, {
      _id: FIXTURE_ID,
      name: "Stadtportal",
    });

    expect(CatalogManager.updateCatalog.calledOnce).to.equal(true);
    expect(res.status).to.equal(400);
    expect(res.body).to.deep.equal({
      error: "ValidationError",
      message: "validation_failed",
      statusCode: 400,
      details: [{ field: "slug", code: "invalid_format" }],
    });
  });

  it("answers a second instance catalog with 409", async function () {
    const res = await put("/catalog", ADMIN, { name: "Zweiter" });

    expect(res.status).to.equal(409);
    expect(res.body).to.deep.equal({
      error: "ConflictError",
      code: "instance_catalog_exists",
      statusCode: 409,
      params: {},
    });
  });

  it("answers an unexpected error with the handler's 500 body", async function () {
    CatalogManager.getInstanceCatalog.rejects(new Error("boom"));

    const res = await get("/catalog", ADMIN);

    expect(res.status).to.equal(500);
    expect(res.body).to.deep.equal({
      error: "InternalError",
      code: "internal_error",
      statusCode: 500,
    });
  });

  it("keeps the success shapes of the reads and the stores", async function () {
    const read = await get("/catalog", ADMIN);
    expect(read.status).to.equal(200);
    expect(read.body.slug).to.equal("fx-slug");

    const store = await put("/catalog", ADMIN, {
      _id: FIXTURE_ID,
      name: "Katalog",
    });
    expect(store.status).to.equal(200);
    expect(store.body.success).to.equal(true);
    expect(store.body.content.slug).to.equal("fx-slug");
  });
});
