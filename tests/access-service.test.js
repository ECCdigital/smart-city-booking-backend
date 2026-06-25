const { expect } = require("chai");
const sinon = require("sinon");

const AccessService = require("../src/commons/services/access/access-service");
const BookingManager = require("../src/commons/data-managers/booking-manager");
const {
  BookableManager,
} = require("../src/commons/data-managers/bookable-manager");
const MailController = require("../src/commons/mail-service/mail-controller");
const AccessLogService = require("../src/commons/services/access/access-log-service");

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

describe("AccessService locker access window", () => {
  let sandbox;

  beforeEach(() => {
    sandbox = sinon.createSandbox();
  });

  afterEach(() => {
    sandbox.restore();
  });

  it("resolves accessFrom, accessTo, and accessBuffer for locker access points", () => {
    const booking = {
      id: "booking-1",
      tenantId: "tenant-1",
      timeBegin: 1000,
      timeEnd: 2000,
      lockerInfo: [
        {
          processId: "ifbs-booking-99",
          lockerSystem: "ifbs",
          id: "location-1",
        },
      ],
    };

    const lockers = AccessService._getLockerAccessPoints("tenant-1", booking);

    expect(lockers).to.have.length(1);
    expect(lockers[0].accessPoint).to.include({
      id: "ifbs-booking-99",
      provider: "ifbs",
      type: "locker",
      mode: "remote",
    });
    expect(lockers[0].bookingContext).to.deep.include({
      timeBegin: 1000,
      timeEnd: 2000,
      accessBuffer: { beforeMs: 0, afterMs: 0 },
      accessFrom: 1000,
      accessTo: 2000,
    });
  });

  it("uses ifbsMetadata.nummer as the access point id for iFBS lockers", () => {
    const booking = {
      id: "booking-1",
      tenantId: "tenant-1",
      timeBegin: 1000,
      timeEnd: 2000,
      lockerInfo: [
        {
          processId: "27473",
          lockerSystem: "ifbs",
          ifbsMetadata: {
            boxId: "239",
            nummer: "62100103",
            bookingId: 27473,
          },
        },
      ],
    };

    const lockers = AccessService._getLockerAccessPoints("tenant-1", booking);

    expect(lockers[0].accessPoint.id).to.equal("62100103");
    expect(lockers[0].bookingContext.externalBookingId).to.equal("27473");
  });

  it("exposes locker access window fields via getByBooking", async () => {
    const bookingContext = {
      tenant: "tenant-1",
      bookingId: "booking-1",
      externalBookingId: "ifbs-booking-99",
      lastOpenBoxId: "open-box-1",
      accessBuffer: { beforeMs: 0, afterMs: 0 },
      accessFrom: 1000,
      accessTo: 2000,
    };

    sandbox.stub(AccessService, "_getBookingAccessPoints").resolves({
      lockers: [
        {
          accessPoint: {
            id: "ifbs-booking-99",
            tenant: "tenant-1",
            provider: "ifbs",
            type: "locker",
            mode: "remote",
          },
          bookingContext,
        },
      ],
      doors: [],
    });

    const points = await AccessService.getByBooking("tenant-1", "booking-1");

    expect(points).to.have.length(1);
    expect(points[0]).to.deep.include({
      id: "ifbs-booking-99",
      type: "locker",
      provider: "ifbs",
      mode: "remote",
      externalBookingId: "ifbs-booking-99",
      lastOpenBoxId: "open-box-1",
      isProvisioned: true,
      accessBuffer: { beforeMs: 0, afterMs: 0 },
      accessFrom: 1000,
      accessTo: 2000,
    });
  });
});

describe("AccessService provisionForBooking", () => {
  let sandbox;

  beforeEach(() => {
    sandbox = sinon.createSandbox();
  });

  afterEach(() => {
    sandbox.restore();
  });

  it("records remote access points in accessInfo without provider authorization", async () => {
    const booking = {
      id: "booking-1",
      tenantId: "tenant-1",
      timeBegin: 1,
      timeEnd: 2,
      bookableItems: [{ bookableId: "room" }],
      accessInfo: [],
      mail: "user@example.com",
    };
    const accessPoint = {
      id: "door-remote",
      tenant: "tenant-1",
      type: "door",
      provider: "nuki",
      externalId: "22756246871",
      label: "Lab",
      mode: "remote",
      config: {},
      bookableId: "room",
      bookableTitle: "Room",
      relation: "self",
    };

    sandbox.stub(AccessService, "_getBookingAccessPoints").resolves({
      booking,
      doors: [
        {
          accessPoint,
          bookingContext: {
            tenant: "tenant-1",
            bookingId: "booking-1",
            isProvisioned: false,
            authorizationId: null,
          },
        },
      ],
    });
    sandbox.stub(BookingManager, "storeBooking").resolves(booking);
    sandbox.stub(MailController, "sendAccessProvisioned").resolves();
    sandbox.stub(AccessLogService, "log").resolves();

    const result = await AccessService.provisionForBooking(
      "tenant-1",
      "booking-1",
    );

    expect(result).to.have.length(1);
    expect(result[0]).to.include({
      accessPointId: "door-remote",
      provider: "nuki",
      mode: "remote",
      isProvisioned: true,
    });
    expect(result[0].provisionedAt).to.be.a("number");
    expect(BookingManager.storeBooking.calledOnce).to.be.true;
  });
});
