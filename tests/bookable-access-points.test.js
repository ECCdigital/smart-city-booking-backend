const { expect } = require("chai");
const sinon = require("sinon");

const BookableController = require("../src/platform/api/controllers/bookable-controller");
const {
  BookableManager,
} = require("../src/commons/data-managers/bookable-manager");
const BookableModel = require("../src/commons/data-managers/models/bookableModel");
const AccessPointManager = require("../src/commons/data-managers/access-point-manager");
const { ValidationError } = require("../src/errors/ValidationError");

function knownAccessPoint(id) {
  return { id: id, tenantId: "tenant-1", provider: "nuki", mode: "remote" };
}

describe("BookableController access point references", () => {
  let sandbox;
  let request;
  let response;
  let storeBookable;
  let next;

  beforeEach(() => {
    sandbox = sinon.createSandbox();

    storeBookable = sandbox.stub(BookableManager, "storeBookable").resolves();
    sandbox.stub(BookableManager, "checkPublicBookableCount").resolves(true);
    sandbox.stub(BookableManager, "getBookable").resolves({
      id: "bookable-1",
      tenantId: "tenant-1",
      isPublic: false,
    });

    request = {
      params: { tenant: "tenant-1" },
      query: {},
      body: {
        id: "bookable-1",
        tenantId: "tenant-1",
        title: "Room",
        accessPointDetails: { active: true, accessPointIds: [] },
      },
      user: { id: "user-1" },
      // The tenant owner: reach any, and the right to create.
      reach: "any",
      principal: { userId: "user-1", isTenantOwner: true, grants: {} },
    };
    response = {
      status: sandbox.stub().returnsThis(),
      send: sandbox.stub(),
      sendStatus: sandbox.stub(),
    };
    next = sandbox.stub();
  });

  afterEach(() => {
    sandbox.restore();
  });

  function stubAccessPoints(ids) {
    return sandbox
      .stub(AccessPointManager, "getAccessPointsByIds")
      .resolves(ids.map(knownAccessPoint));
  }

  it("accepts references to access points of the tenant", async () => {
    request.body.accessPointDetails.accessPointIds = ["door-1", "door-2"];
    stubAccessPoints(["door-1", "door-2"]);

    await BookableController.updateBookable(request, response, next);

    expect(storeBookable.calledOnce).to.be.true;
    expect(response.status.calledWith(201)).to.be.true;
  });

  it("looks the references up in the tenant of the path", async () => {
    request.body.tenantId = "other-tenant";
    request.body.accessPointDetails.accessPointIds = ["door-1"];
    const getAccessPointsByIds = stubAccessPoints(["door-1"]);

    await BookableController.updateBookable(request, response, next);

    expect(getAccessPointsByIds.firstCall.args[0]).to.equal("tenant-1");
  });

  it("rejects an unknown access point id with a validation error", async () => {
    request.body.accessPointDetails.accessPointIds = ["door-1", "ghost-door"];
    stubAccessPoints(["door-1"]);

    await BookableController.updateBookable(request, response, next);

    expect(storeBookable.called).to.be.false;

    const err = next.firstCall.args[0];
    expect(err).to.be.instanceOf(ValidationError);
    expect(err.statusCode).to.equal(400);
    expect(err.errors).to.deep.equal([
      {
        field: "accessPointDetails.accessPointIds",
        code: "unknown_access_point",
        params: { accessPointId: "ghost-door" },
      },
    ]);
  });

  it("rejects unknown references on create as well", async () => {
    delete request.body.id;
    request.body.accessPointDetails.accessPointIds = ["ghost-door"];
    stubAccessPoints([]);

    await BookableController.createBookable(request, response, next);

    expect(storeBookable.called).to.be.false;
    expect(next.firstCall.args[0]).to.be.instanceOf(ValidationError);
  });

  it("validates references even while access is switched off", async () => {
    request.body.accessPointDetails = {
      active: false,
      accessPointIds: ["ghost-door"],
    };
    stubAccessPoints([]);

    await BookableController.updateBookable(request, response, next);

    expect(storeBookable.called).to.be.false;
    expect(next.firstCall.args[0]).to.be.instanceOf(ValidationError);
  });

  it("does not query the collection without references", async () => {
    const getAccessPointsByIds = stubAccessPoints([]);

    await BookableController.updateBookable(request, response, next);

    expect(getAccessPointsByIds.called).to.be.false;
    expect(storeBookable.calledOnce).to.be.true;
  });
});

describe("BookableManager access point references", () => {
  let sandbox;

  beforeEach(() => {
    sandbox = sinon.createSandbox();
  });

  afterEach(() => {
    sandbox.restore();
  });

  it("seeds access resolution from bookables with at least one reference", async () => {
    const find = sandbox.stub(BookableModel, "find").resolves([]);

    await BookableManager.getBookablesWithAccessPoints("tenant-1");

    expect(find.firstCall.args[0]).to.deep.equal({
      tenantId: "tenant-1",
      "accessPointDetails.active": true,
      "accessPointDetails.accessPointIds.0": { $exists: true },
    });
  });

  it("finds every bookable referencing one access point", async () => {
    const find = sandbox.stub(BookableModel, "find").resolves([]);

    await BookableManager.getBookablesByAccessPointId("tenant-1", "door-1");

    expect(find.firstCall.args[0]).to.deep.equal({
      tenantId: "tenant-1",
      "accessPointDetails.active": true,
      "accessPointDetails.accessPointIds": "door-1",
    });
  });

  it("pulls a deleted access point out of the bookables of its tenant", async () => {
    const updateMany = sandbox.stub(BookableModel, "updateMany").resolves();

    await BookableManager.detachAccessPoint("tenant-1", "door-1");

    expect(updateMany.firstCall.args).to.deep.equal([
      {
        tenantId: "tenant-1",
        "accessPointDetails.accessPointIds": "door-1",
      },
      { $pull: { "accessPointDetails.accessPointIds": "door-1" } },
    ]);
  });
});
