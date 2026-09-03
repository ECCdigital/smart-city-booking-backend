const { expect } = require("chai");
const sinon = require("sinon");

const AccessService = require("../src/commons/services/access/access-service");
const { Booking } = require("../src/commons/entities/booking/booking");
const BookingManager = require("../src/commons/data-managers/booking-manager");
const {
  BookableManager,
} = require("../src/commons/data-managers/bookable-manager");
const AccessPointManager = require("../src/commons/data-managers/access-point-manager");
const mailModule = require("../src/commons/mail-service");
const AccessLogService = require("../src/commons/services/access/access-log-service");
const AccessScanService = require("../src/commons/services/access/access-scan-service");
const { AccessPoint } = require("../src/commons/entities/access/access-point");

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
      accessPointDetails: { active: true, accessPointIds: pointIds },
    };
  }

  /**
   * Answer access point lookups from the tenant-wide collection, as the
   * `accesspoints` collection does at runtime.
   */
  function stubAccessPoints(ids) {
    const accessPoints = ids.map((id) => ({
      id,
      tenantId: "tenant-1",
      type: "door",
      provider: "nuki",
      externalId: `${id}-external`,
      label: id,
      mode: "authorization",
      config: {},
    }));

    sandbox
      .stub(AccessPointManager, "getAccessPointsByIds")
      .callsFake(async (tenant, requestedIds) =>
        accessPoints.filter((accessPoint) =>
          requestedIds.includes(accessPoint.id),
        ),
      );
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
      accessInfo: [
        {
          accessPointId: "door-self",
          grant: {
            authorizationId: "auth-1",
            externalPrincipalId: null,
            secret: null,
          },
        },
      ],
    };

    stubAccessPoints(["door-shared", "door-self", "door-parent", "door-child"]);
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

    const doors = (
      await AccessService._getBookingAccessPointsFromBooking(
        "tenant-1",
        booking,
      )
    ).doors;

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
    expect(doors[1].bookingContext.grant.authorizationId).to.equal("auth-1");
  });

  it("hands the stored door along with its rules and scan code, so nothing reads it again", async () => {
    const selfBookable = createBookable("room", "Room", ["door-self"]);
    const booking = {
      id: "booking-1",
      tenantId: "tenant-1",
      timeBegin: 1,
      timeEnd: 2,
      bookableItems: [{ bookableId: "room" }],
      accessInfo: [],
    };

    sandbox.stub(AccessPointManager, "getAccessPointsByIds").resolves([
      {
        id: "door-self",
        tenantId: "tenant-1",
        type: "door",
        provider: "nuki",
        externalId: "door-self-external",
        label: "Door",
        mode: "remote",
        config: {},
        scanCode: "current-code",
        previousScanCodes: ["retired-code"],
        validationRules: [{ type: "qrScan" }],
      },
    ]);
    sandbox.stub(BookableManager, "getRelatedBookables").resolves([]);
    sandbox.stub(BookableManager, "getAllParentBookables").resolves([]);
    sandbox.stub(BookableManager, "getBookablesByIds").resolves([selfBookable]);

    const [door] = (
      await AccessService._getBookingAccessPointsFromBooking(
        "tenant-1",
        booking,
      )
    ).doors;

    expect(door.accessPoint).to.include({
      id: "door-self",
      type: "door",
      scanCode: "current-code",
      bookableId: "room",
      relation: "self",
    });
    expect(door.accessPoint.validationRules).to.deep.equal([
      { type: "qrScan" },
    ]);
  });

  it("resolves a stored door without a rules field as one without rules", async () => {
    const selfBookable = createBookable("room", "Room", ["door-self"]);
    const booking = {
      id: "booking-1",
      tenantId: "tenant-1",
      timeBegin: 1,
      timeEnd: 2,
      bookableItems: [{ bookableId: "room" }],
      accessInfo: [],
    };

    stubAccessPoints(["door-self"]);
    sandbox.stub(BookableManager, "getRelatedBookables").resolves([]);
    sandbox.stub(BookableManager, "getAllParentBookables").resolves([]);
    sandbox.stub(BookableManager, "getBookablesByIds").resolves([selfBookable]);

    const [door] = (
      await AccessService._getBookingAccessPointsFromBooking(
        "tenant-1",
        booking,
      )
    ).doors;

    expect(door.accessPoint.validationRules).to.deep.equal([]);
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
    stubAccessPoints(["door-self"]);
    const getRelatedBookables = sandbox.stub(
      BookableManager,
      "getRelatedBookables",
    );
    const getAllParentBookables = sandbox.stub(
      BookableManager,
      "getAllParentBookables",
    );
    sandbox.stub(BookableManager, "getBookablesByIds").resolves([selfBookable]);

    const doors = (
      await AccessService._getBookingAccessPointsFromBooking(
        "tenant-1",
        booking,
      )
    ).doors;

    expect(getRelatedBookables.notCalled).to.be.true;
    expect(getAllParentBookables.notCalled).to.be.true;
    expect(doors).to.have.length(1);
    expect(doors[0].accessPoint).to.include({
      id: "door-self",
      relation: "self",
    });
  });
});

describe("AccessService compartments of a booking", () => {
  let sandbox;

  const BIKE_BOXES = {
    id: "loc-7",
    tenantId: "tenant-1",
    type: "locker",
    provider: "ifbs",
    externalId: "7",
    label: "Fahrradboxen",
    mode: "remote",
    validationRules: [],
    scanCode: "code-7",
  };

  const GRANTED = {
    accessPointId: "loc-7",
    accessPointType: "locker",
    provider: "ifbs",
    externalId: "7",
    mode: "remote",
    bookableId: "bikebox",
    hold: null,
    compartment: "62100103",
    externalBookingId: "27473",
    isProvisioned: true,
    provisionedAt: 900,
    revokedAt: null,
    grant: {
      authorizationId: "27473",
      externalPrincipalId: null,
      secret: null,
    },
  };

  const HELD = {
    ...GRANTED,
    hold: { holdId: "27474", expiresAt: 3000, compartment: "62100104" },
    compartment: "62100104",
    externalBookingId: null,
    isProvisioned: false,
    provisionedAt: null,
    grant: null,
  };

  beforeEach(() => {
    sandbox = sinon.createSandbox();
    sandbox.stub(BookableManager, "getRelatedBookables").resolves([]);
    sandbox.stub(BookableManager, "getAllParentBookables").resolves([]);
  });

  afterEach(() => {
    sandbox.restore();
  });

  function stubBookable(accessPointIds, accessBuffer = undefined) {
    sandbox.stub(BookableManager, "getBookablesByIds").resolves([
      {
        id: "bikebox",
        title: "Fahrradbox",
        accessPointDetails: { active: true, accessPointIds, accessBuffer },
      },
    ]);
  }

  function booking(accessInfo) {
    return new Booking({
      id: "booking-1",
      tenantId: "tenant-1",
      isCommitted: true,
      timeBegin: 1000,
      timeEnd: 2000,
      bookableItems: [{ bookableId: "bikebox", amount: 2 }],
      accessInfo,
    });
  }

  it("resolves one pair per compartment entry at the stored locker system, under the compartment's id", async () => {
    stubBookable(["loc-7"], { before: 15 });
    sandbox
      .stub(AccessPointManager, "getAccessPointsByIds")
      .resolves([BIKE_BOXES]);

    const { compartments, doors, lockerSystems } =
      await AccessService._getBookingAccessPointsFromBooking(
        "tenant-1",
        booking([GRANTED, HELD]),
      );

    expect(doors).to.deep.equal([]);
    expect(compartments.map(({ accessPoint }) => accessPoint.id)).to.deep.equal(
      ["loc-7:27473", "loc-7:hold"],
    );
    expect(compartments[0].accessPoint).to.include({
      type: "locker",
      provider: "ifbs",
      externalId: "7",
      label: "Fahrradboxen",
      mode: "remote",
      scanCode: "code-7",
      bookableId: "bikebox",
      relation: "self",
    });
    expect(compartments[0].bookingContext).to.deep.include({
      tenant: "tenant-1",
      bookingId: "booking-1",
      timeBegin: 1000,
      timeEnd: 2000,
      accessBuffer: { beforeMs: 15 * 60 * 1000, afterMs: 0 },
      accessFrom: 1000 - 15 * 60 * 1000,
      accessTo: 2000,
      hold: null,
      compartment: "62100103",
      externalBookingId: "27473",
      isProvisioned: true,
      revokedAt: null,
    });
    expect(compartments[0].bookingContext.grant.authorizationId).to.equal(
      "27473",
    );
    expect(compartments[1].bookingContext).to.deep.include({
      hold: HELD.hold,
      compartment: "62100104",
      externalBookingId: null,
      isProvisioned: false,
      grant: null,
    });
    expect([...lockerSystems.keys()]).to.deep.equal(["loc-7"]);
    expect(lockerSystems.get("loc-7").amount).to.equal(2);
  });

  it("owes a booking no compartment at a locker system it reaches through a parent or child bookable", async () => {
    BookableManager.getAllParentBookables.resolves([
      {
        id: "station",
        title: "Bahnhof",
        accessPointDetails: { active: true, accessPointIds: ["loc-7"] },
      },
    ]);
    sandbox.stub(BookableManager, "getBookablesByIds").resolves([
      {
        id: "bikebox",
        title: "Fahrradbox",
        accessPointDetails: { active: true, accessPointIds: [] },
      },
      {
        id: "station",
        title: "Bahnhof",
        accessPointDetails: { active: true, accessPointIds: ["loc-7"] },
      },
    ]);
    sandbox
      .stub(AccessPointManager, "getAccessPointsByIds")
      .resolves([BIKE_BOXES]);

    const { compartments, lockerSystems } =
      await AccessService._getBookingAccessPointsFromBooking(
        "tenant-1",
        booking([]),
      );

    expect(compartments).to.deep.equal([]);
    expect(lockerSystems.size).to.equal(0);
  });

  it("still resolves a granted compartment at a locker system the bookable dropped, owing nothing more at it", async () => {
    stubBookable([]);
    const getAccessPointsByIds = sandbox
      .stub(AccessPointManager, "getAccessPointsByIds")
      .resolves([BIKE_BOXES]);

    const { compartments, lockerSystems } =
      await AccessService._getBookingAccessPointsFromBooking(
        "tenant-1",
        booking([GRANTED]),
      );

    expect(getAccessPointsByIds.firstCall.args[1]).to.deep.equal(["loc-7"]);
    expect(compartments.map(({ accessPoint }) => accessPoint.id)).to.deep.equal(
      ["loc-7:27473"],
    );
    expect(lockerSystems.get("loc-7")).to.include({
      bookable: null,
      amount: 0,
    });
  });

  it("lists a compartment through getByBooking with what a client may see, and nothing else", async () => {
    stubBookable(["loc-7"]);
    sandbox
      .stub(AccessPointManager, "getAccessPointsByIds")
      .resolves([BIKE_BOXES]);
    sandbox.stub(BookingManager, "getBooking").resolves(booking([GRANTED]));

    const points = await AccessService.getByBooking("tenant-1", "booking-1");

    expect(points).to.deep.equal([
      {
        id: "loc-7:27473",
        tenantId: "tenant-1",
        type: "locker",
        provider: "ifbs",
        label: "Fahrradboxen",
        mode: "remote",
        validationRuleTypes: [],
        capabilities: ["open"],
        accessBuffer: { beforeMs: 0, afterMs: 0 },
        accessFrom: 1000,
        accessTo: 2000,
        isProvisioned: true,
        externalBookingId: "27473",
        compartment: "62100103",
      },
    ]);
  });
});

describe("One access point shape on both ways", () => {
  let sandbox;
  let accessPoint;

  const CORE_FIELDS = [
    "id",
    "tenantId",
    "type",
    "provider",
    "label",
    "mode",
    "validationRuleTypes",
    "capabilities",
  ];

  beforeEach(() => {
    sandbox = sinon.createSandbox();
    accessPoint = AccessPoint.create({
      id: "door-1",
      tenantId: "tenant-1",
      provider: "nuki",
      externalId: "lock-1",
      label: "Werkstatt Nord",
      mode: "remote",
    });

    sandbox
      .stub(AccessPointManager, "getAccessPointByScanCode")
      .resolves(accessPoint);
    sandbox
      .stub(AccessPointManager, "getAccessPointsByIds")
      .resolves([accessPoint]);
    sandbox.stub(BookingManager, "getBooking").resolves(
      new Booking({
        id: "booking-1",
        tenantId: "tenant-1",
        assignedUserId: "booker-1",
        isCommitted: true,
        timeBegin: 1000,
        timeEnd: 2000,
        bookableItems: [{ bookableId: "room" }],
        accessInfo: [{ accessPointId: "door-1", isProvisioned: true }],
      }),
    );
    sandbox.stub(BookableManager, "getBookablesByIds").resolves([
      {
        id: "room",
        title: "Room",
        accessPointDetails: { active: true, accessPointIds: ["door-1"] },
      },
    ]);
    sandbox.stub(BookableManager, "getRelatedBookables").resolves([]);
    sandbox.stub(BookableManager, "getAllParentBookables").resolves([]);
  });

  afterEach(() => {
    sandbox.restore();
  });

  function coreFieldsOf(view) {
    return Object.fromEntries(CORE_FIELDS.map((field) => [field, view[field]]));
  }

  it("answers a scanned code and a booking with the same core fields", async () => {
    const scanned = await AccessScanService.resolveScanCode(
      "tenant-1",
      accessPoint.scanCode,
      "user-1",
    );
    const [listed] = await AccessService.getByBooking("tenant-1", "booking-1");

    expect(coreFieldsOf(listed)).to.deep.equal(coreFieldsOf(scanned.data));
    expect(listed.validationRuleTypes).to.deep.equal(["qrScan"]);
    expect(listed.capabilities).to.deep.equal(["open", "close", "getStatus"]);
  });

  it("asks the booker for evidence, even where they may manage the bookings", async () => {
    const [listed] = await AccessService.getByBooking("tenant-1", "booking-1", {
      userId: "booker-1",
      hasManagePermission: true,
    });

    expect(listed.validationRuleTypes).to.deep.equal(["qrScan"]);
  });

  it("asks for no evidence where somebody manages a booking that is not theirs", async () => {
    const [listed] = await AccessService.getByBooking("tenant-1", "booking-1", {
      userId: "manager-1",
      hasManagePermission: true,
    });

    expect(listed.validationRuleTypes).to.deep.equal([]);
  });

  it("adds the booking context only where there is a booking", async () => {
    const scanned = await AccessScanService.resolveScanCode(
      "tenant-1",
      accessPoint.scanCode,
      "user-1",
    );
    const [listed] = await AccessService.getByBooking("tenant-1", "booking-1");

    expect(scanned.data).to.not.have.property("isProvisioned");
    expect(listed).to.deep.include({
      isProvisioned: true,
      accessFrom: 1000,
      accessTo: 2000,
      accessBuffer: { beforeMs: 0, afterMs: 0 },
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
            grant: null,
          },
        },
      ],
    });
    sandbox.stub(BookingManager, "storeBooking").resolves(booking);
    sandbox.stub(mailModule, "compose").resolves([]);
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
