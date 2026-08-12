const { expect } = require("chai");
const sinon = require("sinon");

const AccessService = require("../src/commons/services/access/access-service");
const {
  ACCESS_BLOCKING_REASONS,
} = require("../src/commons/services/access/access-service");
const AccessLogService = require("../src/commons/services/access/access-log-service");
const AccessController = require("../src/platform/api/controllers/access-controller");
const BookingManager = require("../src/commons/data-managers/booking-manager");
const PermissionsService = require("../src/commons/services/permission-service");
const {
  registerAccessProvider,
} = require("../src/commons/services/access/providers/access-provider-registry");
const { Booking } = require("../src/commons/entities/booking/booking");
const {
  AccessPointMode,
} = require("../src/commons/entities/access/access-point");
const { ForbiddenError } = require("../src/errors/BaseError");

const MINUTE = 60 * 1000;
const TEST_PROVIDER = "test-open-provider";

let providerOpen = async () => ({});

class TestOpenProvider {
  async open(accessPoint, context) {
    return providerOpen(accessPoint, context);
  }
}

registerAccessProvider(TEST_PROVIDER, TestOpenProvider);

function createBooking(overrides = {}) {
  const now = Date.now();

  return new Booking({
    id: "booking-1",
    tenantId: "tenant-1",
    assignedUserId: "user-1",
    isCommitted: true,
    isPayed: true,
    priceEur: 0,
    timeBegin: now - 5 * MINUTE,
    timeEnd: now + 55 * MINUTE,
    bookableItems: [{ bookableId: "room" }],
    ...overrides,
  });
}

function stubResolvedDoor(sandbox, booking, { accessPoint = {} } = {}) {
  sandbox.stub(BookingManager, "getBooking").resolves(booking);
  sandbox.stub(AccessService, "_getBookingAccessPointsFromBooking").resolves({
    booking,
    lockers: [],
    doors: [
      {
        accessPoint: {
          id: "door-1",
          tenant: "tenant-1",
          type: "door",
          provider: TEST_PROVIDER,
          externalId: "lock-1",
          label: "Main door",
          mode: AccessPointMode.REMOTE,
          config: {},
          ...accessPoint,
        },
        bookingContext: {
          tenant: "tenant-1",
          bookingId: booking.id,
          timeBegin: booking.timeBegin,
          timeEnd: booking.timeEnd,
          accessBuffer: { beforeMs: 0, afterMs: 0 },
          isProvisioned: true,
          booking,
        },
      },
    ],
  });
}

describe("AccessService.open", () => {
  let sandbox;

  beforeEach(() => {
    sandbox = sinon.createSandbox();
    providerOpen = sandbox
      .stub()
      .resolves({ processId: 42, openProcessId: 99 });
    sandbox.stub(AccessLogService, "log").resolves();
    sandbox.stub(PermissionsService, "_isOwner").returns(true);
  });

  afterEach(() => {
    sandbox.restore();
  });

  it("returns the provider result and audits the success", async () => {
    const booking = createBooking();
    stubResolvedDoor(sandbox, booking);

    const outcome = await AccessService.open(
      "tenant-1",
      "booking-1",
      "door-1",
      "user-1",
    );

    expect(outcome).to.deep.equal({
      success: true,
      data: { processId: 42, openProcessId: 99 },
    });
    expect(providerOpen.calledOnce).to.be.true;
    expect(AccessLogService.log.firstCall.args[0]).to.include({
      action: "open",
      result: "success",
    });
  });

  const denials = [
    {
      title: "a rejected booking",
      booking: { isRejected: true },
      expected: [ACCESS_BLOCKING_REASONS.REJECTED],
    },
    {
      title: "an uncommitted booking",
      booking: { isCommitted: false },
      expected: [ACCESS_BLOCKING_REASONS.NOT_COMMITTED],
    },
    {
      title: "an unpaid priced booking",
      booking: { priceEur: 10, isPayed: false },
      expected: [ACCESS_BLOCKING_REASONS.PAYMENT_REQUIRED],
    },
    {
      title: "a booking outside its access window",
      booking: {
        timeBegin: Date.now() + 60 * MINUTE,
        timeEnd: Date.now() + 120 * MINUTE,
      },
      expected: [ACCESS_BLOCKING_REASONS.OUTSIDE_ACCESS_WINDOW],
    },
  ];

  for (const { title, booking: overrides, expected } of denials) {
    it(`denies and audits ${title}`, async () => {
      stubResolvedDoor(sandbox, createBooking(overrides));

      const outcome = await AccessService.open(
        "tenant-1",
        "booking-1",
        "door-1",
        "user-1",
      );

      expect(outcome).to.deep.equal({
        success: false,
        blockingReasons: expected,
      });
      expect(providerOpen.called).to.be.false;

      const logged = AccessLogService.log.firstCall.args[0];
      expect(logged).to.include({ action: "open", result: "denied" });
      expect(logged.blockingReasons).to.deep.equal(expected);
      expect(logged.actor).to.deep.equal({ userId: "user-1", source: "user" });
    });
  }

  it("denies a user who neither owns the booking nor may manage it", async () => {
    PermissionsService._isOwner.returns(false);
    stubResolvedDoor(sandbox, createBooking());

    const outcome = await AccessService.open(
      "tenant-1",
      "booking-1",
      "door-1",
      "user-2",
    );

    expect(outcome).to.deep.equal({ success: false, blockingReasons: [] });
    expect(providerOpen.called).to.be.false;
    expect(AccessLogService.log.firstCall.args[0]).to.include({
      result: "denied",
    });
  });

  it("opens for a user with the manage-bookings permission", async () => {
    PermissionsService._isOwner.returns(false);
    stubResolvedDoor(sandbox, createBooking());

    const outcome = await AccessService.open(
      "tenant-1",
      "booking-1",
      "door-1",
      "manager-1",
      { hasManagePermission: true },
    );

    expect(outcome.success).to.be.true;
    expect(providerOpen.calledOnce).to.be.true;
  });

  it("audits every blocking reason in priority order", async () => {
    stubResolvedDoor(
      sandbox,
      createBooking({ isRejected: true, priceEur: 10, isPayed: false }),
    );

    const outcome = await AccessService.open(
      "tenant-1",
      "booking-1",
      "door-1",
      "user-1",
    );

    expect(outcome.blockingReasons).to.deep.equal([
      ACCESS_BLOCKING_REASONS.REJECTED,
      ACCESS_BLOCKING_REASONS.PAYMENT_REQUIRED,
    ]);
    expect(
      AccessLogService.log.firstCall.args[0].blockingReasons,
    ).to.deep.equal(outcome.blockingReasons);
  });

  it("passes the otp on to the provider", async () => {
    stubResolvedDoor(sandbox, createBooking());

    await AccessService.open("tenant-1", "booking-1", "door-1", "user-1", {
      otp: "1234",
    });

    expect(providerOpen.firstCall.args[1].openOptions).to.deep.equal({
      otp: "1234",
    });
  });

  it("audits a provider error as a failure and rethrows", async () => {
    stubResolvedDoor(sandbox, createBooking());
    providerOpen.rejects(new Error("lock offline"));

    let error;
    try {
      await AccessService.open("tenant-1", "booking-1", "door-1", "user-1");
    } catch (err) {
      error = err;
    }

    expect(error?.message).to.equal("lock offline");
    expect(AccessLogService.log.firstCall.args[0]).to.include({
      action: "open",
      result: "failure",
    });
  });

  it("rejects when the access point is not part of the booking", async () => {
    stubResolvedDoor(sandbox, createBooking());

    let error;
    try {
      await AccessService.open("tenant-1", "booking-1", "other-door", "user-1");
    } catch (err) {
      error = err;
    }

    expect(error).to.be.an.instanceOf(ForbiddenError);
    expect(AccessLogService.log.called).to.be.false;
  });

  it("rejects when the booking does not exist", async () => {
    sandbox.stub(BookingManager, "getBooking").resolves(null);

    let error;
    try {
      await AccessService.open("tenant-1", "missing", "door-1", "user-1");
    } catch (err) {
      error = err;
    }

    expect(error).to.be.an.instanceOf(ForbiddenError);
    expect(AccessLogService.log.called).to.be.false;
  });
});

describe("AccessController.open", () => {
  let sandbox;
  let request;
  let response;

  beforeEach(() => {
    sandbox = sinon.createSandbox();
    sandbox.stub(PermissionsService, "_allowUpdateAny").resolves(false);

    request = {
      params: { tenant: "tenant-1", accessPointId: "door-1" },
      query: { bookingId: "booking-1" },
      body: {},
      user: { id: "user-1" },
    };
    response = {
      status: sandbox.stub().returnsThis(),
      json: sandbox.stub(),
      sendStatus: sandbox.stub(),
    };
  });

  afterEach(() => {
    sandbox.restore();
  });

  it("answers a successful open with the success envelope", async () => {
    sandbox
      .stub(AccessService, "open")
      .resolves({ success: true, data: { processId: 42 } });

    await AccessController.open(request, response);

    expect(response.status.calledWith(200)).to.be.true;
    expect(response.json.firstCall.args[0]).to.deep.equal({
      success: true,
      data: { processId: 42 },
    });
  });

  it("answers a denial with HTTP 200 and the blocking reasons", async () => {
    sandbox.stub(AccessService, "open").resolves({
      success: false,
      blockingReasons: [ACCESS_BLOCKING_REASONS.PAYMENT_REQUIRED],
    });

    await AccessController.open(request, response);

    expect(response.status.calledWith(200)).to.be.true;
    expect(response.json.firstCall.args[0]).to.deep.equal({
      success: false,
      data: {
        blockingReasons: [ACCESS_BLOCKING_REASONS.PAYMENT_REQUIRED],
      },
    });
  });

  it("hands the manage-bookings permission to the service", async () => {
    PermissionsService._allowUpdateAny.resolves(true);
    const open = sandbox
      .stub(AccessService, "open")
      .resolves({ success: true, data: {} });

    await AccessController.open(request, response);

    expect(open.firstCall.args[4]).to.deep.include({
      hasManagePermission: true,
    });
  });

  it("answers 403 when the access point is not part of the booking", async () => {
    sandbox
      .stub(AccessService, "open")
      .rejects(new ForbiddenError("access_point_not_in_booking"));

    await AccessController.open(request, response);

    expect(response.sendStatus.calledWith(403)).to.be.true;
  });

  it("answers 500 on unexpected errors", async () => {
    sandbox.stub(AccessService, "open").rejects(new Error("boom"));

    await AccessController.open(request, response);

    expect(response.status.calledWith(500)).to.be.true;
  });
});
