const { expect } = require("chai");
const sinon = require("sinon");

const AccessService = require("../src/commons/services/access/access-service");
const {
  BookableManager,
} = require("../src/commons/data-managers/bookable-manager");

describe("AccessService bookable access point inheritance", () => {
  let sandbox;
  let originalInheritParents;
  let originalInheritChildren;

  beforeEach(() => {
    sandbox = sinon.createSandbox();
    originalInheritParents = process.env.ACCESS_POINTS_INHERIT_PARENTS;
    originalInheritChildren = process.env.ACCESS_POINTS_INHERIT_CHILDREN;
  });

  afterEach(() => {
    sandbox.restore();
    restoreEnv("ACCESS_POINTS_INHERIT_PARENTS", originalInheritParents);
    restoreEnv("ACCESS_POINTS_INHERIT_CHILDREN", originalInheritChildren);
  });

  function restoreEnv(key, value) {
    if (value === undefined) {
      delete process.env[key];
      return;
    }

    process.env[key] = value;
  }

  function createBookable(id, title, pointIds) {
    return {
      id,
      title,
      accessPointDetails: {
        active: true,
        points: pointIds.map((pointId) => ({
          id: pointId,
          provider: "nuki",
          externalId: `${pointId}-external`,
          label: pointId,
          mode: "authorization",
        })),
      },
    };
  }

  it("resolves access points from booked, parent, and child bookables", async () => {
    const selfBookable = createBookable("room", "Room", [
      "door-shared",
      "door-self",
    ]);
    const parentBookable = createBookable("building", "Building", [
      "door-parent",
      "door-shared",
    ]);
    const childBookable = createBookable("cabinet", "Cabinet", ["door-child"]);
    const bookablesById = new Map(
      [childBookable, parentBookable, selfBookable].map((bookable) => [
        bookable.id,
        bookable,
      ]),
    );
    const booking = {
      id: "booking-1",
      tenantId: "tenant-1",
      timeBegin: 1,
      timeEnd: 2,
      bookableItems: [{ bookableId: "room" }],
      accessInfo: [{ accessPointId: "door-self", authorizationId: "auth-1" }],
    };

    sandbox
      .stub(BookableManager, "getRelatedBookables")
      .withArgs("room", "tenant-1")
      .resolves([childBookable]);
    sandbox
      .stub(BookableManager, "getAllParentBookables")
      .withArgs("room", "tenant-1")
      .resolves([parentBookable]);
    sandbox
      .stub(BookableManager, "getBookablesByIds")
      .callsFake(async (tenant, ids) =>
        [childBookable.id, parentBookable.id, selfBookable.id]
          .filter((id) => ids.includes(id))
          .map((id) => bookablesById.get(id)),
      );

    const doors = await AccessService._getDoorAccessPoints("tenant-1", booking);

    expect(doors.map(({ accessPoint }) => accessPoint.id)).to.deep.equal([
      "door-shared",
      "door-self",
      "door-parent",
      "door-child",
    ]);
    expect(doors.map(({ accessPoint }) => accessPoint.relation)).to.deep.equal([
      "self",
      "self",
      "parent",
      "child",
    ]);
    expect(doors[0].accessPoint.bookableTitle).to.equal("Room");
    expect(doors[1].bookingContext.authorizationId).to.equal("auth-1");
  });

  it("can disable inherited parents and children by environment flag", async () => {
    process.env.ACCESS_POINTS_INHERIT_PARENTS = "false";
    process.env.ACCESS_POINTS_INHERIT_CHILDREN = "false";

    const selfBookable = createBookable("room", "Room", ["door-self"]);
    const booking = {
      id: "booking-1",
      tenantId: "tenant-1",
      bookableItems: [{ bookableId: "room" }],
    };
    const getRelatedBookables = sandbox.stub(
      BookableManager,
      "getRelatedBookables",
    );
    const getAllParentBookables = sandbox.stub(
      BookableManager,
      "getAllParentBookables",
    );
    sandbox.stub(BookableManager, "getBookablesByIds").resolves([selfBookable]);

    const doors = await AccessService._getDoorAccessPoints("tenant-1", booking);

    expect(getRelatedBookables.notCalled).to.be.true;
    expect(getAllParentBookables.notCalled).to.be.true;
    expect(doors).to.have.length(1);
    expect(doors[0].accessPoint).to.include({
      id: "door-self",
      relation: "self",
    });
  });
});
