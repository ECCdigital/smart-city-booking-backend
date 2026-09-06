/**
 * `bookable.lockerDetails` is a read field derived from the locker rows the
 * bookable references, in the shape the admin UI edited until the locker
 * fold: `active` when locker systems are switched on, one unit per row
 * with the bookable's amount. Nothing writes it - a value handed to the
 * entity is dropped - and the bookable routes attach it on the way out.
 */

const { expect } = require("chai");
const sinon = require("sinon");

const { Bookable } = require("../src/commons/entities/bookable/bookable");
const {
  deriveLockerDetails,
} = require("../src/commons/entities/bookable/locker-details");
const {
  withLockerDetails,
} = require("../src/commons/services/access/bookable-locker-details");
const AccessPointManager = require("../src/commons/data-managers/access-point-manager");

const BIKE_BOXES = {
  id: "loc-7",
  tenantId: "tenant-1",
  type: "locker",
  provider: "ifbs",
  externalId: "7",
  providerLocationId: "7",
  mode: "remote",
};

const SIZE_S = {
  id: "size-s",
  tenantId: "tenant-1",
  type: "locker",
  provider: "pareva",
  externalId: "S",
  providerLocationId: "L1",
  mode: "authorization",
};

const DOOR = {
  id: "door-1",
  tenantId: "tenant-1",
  type: "door",
  provider: "nuki",
  externalId: "1001",
  mode: "authorization",
};

function bookable(overrides = {}) {
  return {
    id: "bikebox",
    tenantId: "tenant-1",
    amount: 2,
    accessPointDetails: {
      active: true,
      accessPointIds: [BIKE_BOXES.id, DOOR.id, SIZE_S.id],
    },
    ...overrides,
  };
}

describe("deriveLockerDetails", () => {
  it("lists one unit per referenced locker row, an iFBS location and a Pareva size in their old shapes, doors left out", () => {
    expect(
      deriveLockerDetails(bookable(), [BIKE_BOXES, DOOR, SIZE_S]),
    ).to.deep.equal({
      active: true,
      units: [
        { lockerSystem: "ifbs", locationId: "7", amount: 2 },
        { id: "S", lockerSystem: "pareva", amount: 2 },
      ],
    });
  });

  it("is inactive without locker rows", () => {
    expect(deriveLockerDetails(bookable(), [DOOR])).to.deep.equal({
      active: false,
      units: [],
    });
  });

  it("is inactive while the bookable's access points are switched off, the units still listed", () => {
    const off = bookable({
      accessPointDetails: { active: false, accessPointIds: [BIKE_BOXES.id] },
    });

    expect(deriveLockerDetails(off, [BIKE_BOXES])).to.deep.equal({
      active: false,
      units: [{ lockerSystem: "ifbs", locationId: "7", amount: 2 }],
    });
  });

  it("gives a unit the amount the bookable distributes to its row, the bookable's where none is distributed", () => {
    const spread = bookable({
      accessPointDetails: {
        active: true,
        accessPointIds: [BIKE_BOXES.id, SIZE_S.id],
        accessPointAmounts: { [SIZE_S.id]: 5 },
      },
    });

    expect(deriveLockerDetails(spread, [BIKE_BOXES, SIZE_S])).to.deep.equal({
      active: true,
      units: [
        { lockerSystem: "ifbs", locationId: "7", amount: 2 },
        { id: "S", lockerSystem: "pareva", amount: 5 },
      ],
    });
  });

  it("is dropped from a bookable handed in with one", () => {
    const entity = new Bookable({
      id: "bikebox",
      tenantId: "tenant-1",
      lockerDetails: {
        active: true,
        units: [{ id: "S", lockerSystem: "pareva" }],
      },
    });

    expect(entity).to.not.have.property("lockerDetails");
  });
});

describe("withLockerDetails", () => {
  afterEach(() => sinon.restore());

  it("loads the referenced rows of the tenant once and attaches the derived field to every bookable", async () => {
    const getAccessPointsByIds = sinon
      .stub(AccessPointManager, "getAccessPointsByIds")
      .resolves([BIKE_BOXES, DOOR, SIZE_S]);
    const room = bookable({
      id: "room",
      accessPointDetails: { active: true, accessPointIds: [DOOR.id] },
    });

    const result = await withLockerDetails("tenant-1", [bookable(), room]);

    expect(getAccessPointsByIds.callCount).to.equal(1);
    expect(getAccessPointsByIds.firstCall.args).to.deep.equal([
      "tenant-1",
      [BIKE_BOXES.id, DOOR.id, SIZE_S.id],
    ]);
    expect(result[0].lockerDetails).to.deep.equal({
      active: true,
      units: [
        { lockerSystem: "ifbs", locationId: "7", amount: 2 },
        { id: "S", lockerSystem: "pareva", amount: 2 },
      ],
    });
    expect(result[1].lockerDetails).to.deep.equal({ active: false, units: [] });
    expect(result[1]).to.include({ id: "room" });
  });

  it("asks for nothing when no bookable references an access point", async () => {
    const getAccessPointsByIds = sinon.stub(
      AccessPointManager,
      "getAccessPointsByIds",
    );

    const [plain] = await withLockerDetails("tenant-1", [
      bookable({ accessPointDetails: { active: false, accessPointIds: [] } }),
    ]);

    expect(getAccessPointsByIds.called).to.equal(false);
    expect(plain.lockerDetails).to.deep.equal({ active: false, units: [] });
  });
});
