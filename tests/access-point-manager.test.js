const { expect } = require("chai");
const sinon = require("sinon");

const AccessPointManager = require("../src/commons/data-managers/access-point-manager");
const AccessPointModel = require("../src/commons/data-managers/models/accessPointModel");
const { AccessPoint } = require("../src/commons/entities/access/access-point");
const { ValidationError } = require("../src/errors/ValidationError");

function createAccessPoint(overrides = {}) {
  return AccessPoint.create({
    id: "point-1",
    tenantId: "tenant-1",
    provider: "nuki",
    externalId: "lock-1",
    ...overrides,
  });
}

function fakeDocument(accessPoint) {
  return { toEntity: () => accessPoint };
}

describe("AccessPointManager", () => {
  let sandbox;

  beforeEach(() => {
    sandbox = sinon.createSandbox();
  });

  afterEach(() => {
    sandbox.restore();
  });

  describe("getAccessPoints", () => {
    it("only reads access points of the given tenant", async () => {
      const find = sandbox.stub(AccessPointModel, "find").resolves([]);

      await AccessPointManager.getAccessPoints("tenant-1");

      expect(find.calledOnceWithExactly({ tenantId: "tenant-1" })).to.be.true;
    });

    it("returns access point entities", async () => {
      const accessPoint = createAccessPoint();
      sandbox
        .stub(AccessPointModel, "find")
        .resolves([fakeDocument(accessPoint)]);

      const accessPoints = await AccessPointManager.getAccessPoints("tenant-1");

      expect(accessPoints).to.deep.equal([accessPoint]);
    });
  });

  describe("getAccessPoint", () => {
    it("scopes the lookup to id and tenant", async () => {
      const findOne = sandbox.stub(AccessPointModel, "findOne").resolves(null);

      await AccessPointManager.getAccessPoint("point-1", "tenant-1");

      expect(
        findOne.calledOnceWithExactly({ id: "point-1", tenantId: "tenant-1" }),
      ).to.be.true;
    });

    it("returns null when the tenant has no such access point", async () => {
      sandbox.stub(AccessPointModel, "findOne").resolves(null);

      const accessPoint = await AccessPointManager.getAccessPoint(
        "point-1",
        "other-tenant",
      );

      expect(accessPoint).to.equal(null);
    });

    it("returns an access point entity", async () => {
      const expected = createAccessPoint();
      sandbox
        .stub(AccessPointModel, "findOne")
        .resolves(fakeDocument(expected));

      const accessPoint = await AccessPointManager.getAccessPoint(
        "point-1",
        "tenant-1",
      );

      expect(accessPoint).to.equal(expected);
    });
  });

  describe("getAccessPointsByIds", () => {
    it("scopes the lookup to the tenant and the given ids", async () => {
      const find = sandbox.stub(AccessPointModel, "find").resolves([]);

      await AccessPointManager.getAccessPointsByIds("tenant-1", [
        "point-1",
        "point-2",
      ]);

      expect(
        find.calledOnceWithExactly({
          tenantId: "tenant-1",
          id: { $in: ["point-1", "point-2"] },
        }),
      ).to.be.true;
    });

    it("does not query the database without ids", async () => {
      const find = sandbox.stub(AccessPointModel, "find").resolves([]);

      const accessPoints = await AccessPointManager.getAccessPointsByIds(
        "tenant-1",
        [],
      );

      expect(accessPoints).to.deep.equal([]);
      expect(find.called).to.be.false;
    });

    it("leaves out ids the tenant does not know", async () => {
      const accessPoint = createAccessPoint();
      sandbox
        .stub(AccessPointModel, "find")
        .resolves([fakeDocument(accessPoint)]);

      const accessPoints = await AccessPointManager.getAccessPointsByIds(
        "tenant-1",
        ["point-1", "ghost-point"],
      );

      expect(accessPoints).to.deep.equal([accessPoint]);
    });
  });

  describe("getAccessPointByScanCode", () => {
    it("matches the current and the previous scan codes within the tenant", async () => {
      const findOne = sandbox.stub(AccessPointModel, "findOne").resolves(null);

      await AccessPointManager.getAccessPointByScanCode("tenant-1", "code-1");

      expect(
        findOne.calledOnceWithExactly({
          tenantId: "tenant-1",
          $or: [{ scanCode: "code-1" }, { previousScanCodes: "code-1" }],
        }),
      ).to.be.true;
    });

    it("returns an access point entity", async () => {
      const expected = createAccessPoint();
      sandbox
        .stub(AccessPointModel, "findOne")
        .resolves(fakeDocument(expected));

      const accessPoint = await AccessPointManager.getAccessPointByScanCode(
        "tenant-1",
        expected.scanCode,
      );

      expect(accessPoint).to.equal(expected);
    });

    it("returns null for a code no access point of the tenant carries", async () => {
      sandbox.stub(AccessPointModel, "findOne").resolves(null);

      const accessPoint = await AccessPointManager.getAccessPointByScanCode(
        "tenant-1",
        "never-issued",
      );

      expect(accessPoint).to.equal(null);
    });
  });

  describe("removeAccessPoint", () => {
    it("only deletes within the given tenant", async () => {
      const deleteOne = sandbox
        .stub(AccessPointModel, "deleteOne")
        .resolves({ deletedCount: 1 });

      await AccessPointManager.removeAccessPoint("point-1", "tenant-1");

      expect(
        deleteOne.calledOnceWithExactly({
          id: "point-1",
          tenantId: "tenant-1",
        }),
      ).to.be.true;
    });
  });

  describe("storeAccessPoint", () => {
    let findOneAndUpdate;

    beforeEach(() => {
      findOneAndUpdate = sandbox
        .stub(AccessPointModel, "findOneAndUpdate")
        .resolves();
    });

    it("upserts scoped to id and tenant", async () => {
      await AccessPointManager.storeAccessPoint(
        createAccessPoint(),
        "tenant-1",
      );

      const [filter, , options] = findOneAndUpdate.firstCall.args;
      expect(filter).to.deep.equal({ id: "point-1", tenantId: "tenant-1" });
      expect(options).to.deep.equal({ upsert: true });
    });

    it("stores the access point under the tenant of the request", async () => {
      const accessPoint = createAccessPoint({ tenantId: "spoofed-tenant" });

      const stored = await AccessPointManager.storeAccessPoint(
        accessPoint,
        "tenant-1",
      );

      expect(stored.tenantId).to.equal("tenant-1");
      expect(findOneAndUpdate.firstCall.args[0]).to.deep.equal({
        id: "point-1",
        tenantId: "tenant-1",
      });
    });

    it("persists the scan codes but not the runtime metadata", async () => {
      const accessPoint = createAccessPoint();
      accessPoint.metadata = { capabilities: ["remote"] };

      await AccessPointManager.storeAccessPoint(accessPoint, "tenant-1");

      const stored = findOneAndUpdate.firstCall.args[1];
      expect(stored.scanCode).to.equal(accessPoint.scanCode);
      expect(stored).to.not.have.property("metadata");
    });

    it("accepts plain objects and returns the stored entity", async () => {
      const stored = await AccessPointManager.storeAccessPoint(
        { id: "point-2", provider: "nuki", scanCode: "code-2" },
        "tenant-1",
      );

      expect(stored).to.be.instanceOf(AccessPoint);
      expect(stored.id).to.equal("point-2");
    });

    it("rejects an invalid access point before touching the database", async () => {
      const accessPoint = createAccessPoint();
      accessPoint.provider = "";

      let caught = null;
      try {
        await AccessPointManager.storeAccessPoint(accessPoint, "tenant-1");
      } catch (err) {
        caught = err;
      }

      expect(caught).to.be.instanceOf(ValidationError);
      expect(findOneAndUpdate.called).to.be.false;
    });
  });
});
