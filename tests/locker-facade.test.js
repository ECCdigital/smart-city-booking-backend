/**
 * The `/locker/:provider/...` routes stay one release as a facade for the
 * admin UI: the locations and sizes come from `AccessInfoService`
 * (`listAccessPoints`), the price from the checkout price provider, the
 * connection test from the access test registry. Who may read is the routes'
 * (`locker.read`, `locker.test`) and is pinned in
 * `authorization-access-routes.test.js`, not here.
 */

const { expect } = require("chai");
const sinon = require("sinon");

const { lockerFacade } = require("../src/platform/api/routes/locker.routes");
const AccessInfoService = require("../src/commons/services/access/access-info-service");
const ExternalPriceService = require("../src/commons/services/external-price-service");

const TENANT = "tenant-1";

const LOCATION_7 = {
  id: "7",
  type: "locker",
  provider: "ifbs",
  externalId: "7",
  locationId: "7",
  label: "Bahnhof",
  capabilities: ["remote"],
  supportedModes: ["remote"],
  metadata: { LocationID: "7", Name: "Bahnhof" },
};

const LOCATION_8 = { ...LOCATION_7, id: "8", externalId: "8", label: "Markt" };

describe("/locker facade", () => {
  let request;
  let response;

  beforeEach(() => {
    request = {
      params: { tenant: TENANT, provider: "ifbs" },
      body: {},
      user: { id: "user-1" },
    };
    response = {
      status: sinon.stub().returnsThis(),
      send: sinon.stub(),
      sendStatus: sinon.stub(),
    };
    sinon
      .stub(AccessInfoService, "getAccessPoints")
      .resolves([LOCATION_7, LOCATION_8]);
  });

  afterEach(() => sinon.restore());

  it("lists the provider's access points as the locations", async () => {
    await lockerFacade.listLocations(request, response);

    expect(AccessInfoService.getAccessPoints.firstCall.args).to.deep.equal([
      TENANT,
      "ifbs",
    ]);
    expect(response.status.firstCall.args).to.deep.equal([200]);
    expect(response.send.firstCall.args[0]).to.deep.equal([
      LOCATION_7,
      LOCATION_8,
    ]);
  });

  it("answers one location by its id, and 404 for one the provider does not list", async () => {
    request.params.locationId = "8";
    await lockerFacade.getLocation(request, response);
    expect(response.send.firstCall.args[0]).to.deep.equal(LOCATION_8);

    request.params.locationId = "9";
    await lockerFacade.getLocation(request, response);
    expect(response.status.secondCall.args).to.deep.equal([404]);
  });

  it("answers the status of a location as what the provider lists for it", async () => {
    request.params.locationId = "7";

    await lockerFacade.getLocationStatus(request, response);

    expect(response.status.firstCall.args).to.deep.equal([200]);
    expect(response.send.firstCall.args[0]).to.deep.equal(LOCATION_7);
  });

  it("answers the price of a location as the checkout price provider's categories", async () => {
    const categories = [{ priceEur: 1.5, unit: "hour", external: true }];
    const categoriesOf = sinon
      .stub(ExternalPriceService, "categoriesOf")
      .resolves(categories);
    request.params.locationId = "7";

    await lockerFacade.getLocationPrice(request, response);

    expect(categoriesOf.firstCall.args).to.deep.equal([
      TENANT,
      "ifbs",
      { locationId: "7" },
    ]);
    expect(response.send.firstCall.args[0]).to.deep.equal(categories);
  });

  it("answers 400 for a price of a provider that prices nothing through the checkout", async () => {
    sinon.stub(ExternalPriceService, "categoriesOf").resolves(null);
    request.params.provider = "nuki";
    request.params.locationId = "7";

    await lockerFacade.getLocationPrice(request, response);

    expect(response.status.firstCall.args).to.deep.equal([400]);
  });

  it("tests a connection with the given configuration", async () => {
    const result = { success: true, message: "Connection successful" };
    const testConnection = sinon
      .stub(AccessInfoService, "testConnection")
      .resolves(result);
    request.body = { serverUrl: "https://ifbs.example.test", apiKey: "key" };

    await lockerFacade.testConnection(request, response);

    expect(testConnection.firstCall.args).to.deep.equal([
      "ifbs",
      request.body,
      { tenantId: TENANT },
    ]);
    expect(response.send.firstCall.args[0]).to.deep.equal(result);
  });

  it("answers 400 for a connection test of a provider without one", async () => {
    request.params.provider = "unknown";

    await lockerFacade.testConnection(request, response);

    expect(response.status.firstCall.args).to.deep.equal([400]);
  });

  it("answers a provider the tenant has no application for with its status", async () => {
    const { NotFoundError } = require("../src/errors/BaseError");
    AccessInfoService.getAccessPoints.rejects(
      new NotFoundError("ifbs_application_not_found", { tenant: TENANT }),
    );

    await lockerFacade.listLocations(request, response);

    expect(response.status.firstCall.args).to.deep.equal([404]);
  });
});
