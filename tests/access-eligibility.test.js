const { expect } = require("chai");
const sinon = require("sinon");

const AccessService = require("../src/commons/services/access/access-service");
const {
  ACCESS_BLOCKING_REASONS,
} = require("../src/commons/services/access/access-service");
const BookingManager = require("../src/commons/data-managers/booking-manager");
const { BookableManager } = require("../src/commons/data-managers/bookable-manager");
const PermissionsService = require("../src/commons/services/permission-service");
const { Booking } = require("../src/commons/entities/booking/booking");
const { AccessPointMode } = require("../src/commons/entities/access/access-point");

const MINUTE = 60 * 1000;

function createBooking(overrides = {}) {
  return new Booking({
    id: "booking-1",
    tenantId: "tenant-1",
    assignedUserId: "user-1",
    mail: "owner@example.com",
    isCommitted: true,
    isPayed: true,
    priceEur: 0,
    timeBegin: 1000,
    timeEnd: 2000,
    bookableItems: [{ bookableId: "room" }],
    ...overrides,
  });
}

function createDoorPoint(overrides = {}) {
  return {
    id: "door-1",
    type: "door",
    mode: AccessPointMode.REMOTE,
    accessBuffer: { beforeMs: 0, afterMs: 0 },
    isProvisioned: true,
    ...overrides,
  };
}

describe("AccessService.evaluateBookingAccessEligibility", () => {
  const now = 1500;

  it("reports rejected bookings", () => {
    const booking = createBooking({ isRejected: true });
    const result = AccessService.evaluateBookingAccessEligibility(
      booking,
      [createDoorPoint()],
      { now, userId: "user-1" },
    );

    expect(result.canView).to.be.false;
    expect(result.canOperate).to.be.false;
    expect(result.primaryBlockingReason).to.equal(
      ACCESS_BLOCKING_REASONS.REJECTED,
    );
  });

  it("reports uncommitted bookings", () => {
    const booking = createBooking({ isCommitted: false });
    const result = AccessService.evaluateBookingAccessEligibility(
      booking,
      [createDoorPoint()],
      { now, userId: "user-1" },
    );

    expect(result.canView).to.be.false;
    expect(result.primaryBlockingReason).to.equal(
      ACCESS_BLOCKING_REASONS.NOT_COMMITTED,
    );
  });

  it("reports unpaid priced bookings", () => {
    const booking = createBooking({ priceEur: 25, isPayed: false });
    const result = AccessService.evaluateBookingAccessEligibility(
      booking,
      [createDoorPoint()],
      { now, userId: "user-1" },
    );

    expect(result.canView).to.be.false;
    expect(result.primaryBlockingReason).to.equal(
      ACCESS_BLOCKING_REASONS.PAYMENT_REQUIRED,
    );
  });

  it("reports outside_access_window when no point is in the buffered window", () => {
    const booking = createBooking({
      timeBegin: 100 * MINUTE,
      timeEnd: 200 * MINUTE,
    });
    const point = createDoorPoint({
      accessBuffer: { beforeMs: 15 * MINUTE, afterMs: 0 },
    });
    const result = AccessService.evaluateBookingAccessEligibility(
      booking,
      [point],
      { now: 80 * MINUTE, userId: "user-1" },
    );

    expect(result.canOperate).to.be.false;
    expect(result.blockingReasons).to.include(
      ACCESS_BLOCKING_REASONS.OUTSIDE_ACCESS_WINDOW,
    );
  });

  it("allows operation within the lead-time buffer", () => {
    const booking = createBooking({
      timeBegin: 100 * MINUTE,
      timeEnd: 200 * MINUTE,
    });
    const point = createDoorPoint({
      accessBuffer: { beforeMs: 15 * MINUTE, afterMs: 0 },
    });
    const result = AccessService.evaluateBookingAccessEligibility(
      booking,
      [point],
      { now: 90 * MINUTE, userId: "user-1" },
    );

    expect(result.canOperate).to.be.true;
    expect(result.operableAccessPointIds).to.deep.equal(["door-1"]);
  });

  it("reports not_provisioned for authorization doors without provisioning", () => {
    const booking = createBooking({
      timeBegin: now - MINUTE,
      timeEnd: now + MINUTE,
    });
    const point = createDoorPoint({
      mode: AccessPointMode.AUTHORIZATION,
      isProvisioned: false,
    });
    const result = AccessService.evaluateBookingAccessEligibility(
      booking,
      [point],
      { now, userId: "user-1" },
    );

    expect(result.canOperate).to.be.true;
    expect(result.canOperateRemote).to.be.false;
    expect(result.canUseAuthorization).to.be.false;
    expect(result.blockingReasons).to.include(
      ACCESS_BLOCKING_REASONS.NOT_PROVISIONED,
    );
    expect(result.blockingReasons).to.include(
      ACCESS_BLOCKING_REASONS.NO_REMOTE_ACCESS,
    );
  });

  it("reports authorization_revoked when access was revoked", () => {
    const booking = createBooking({
      timeBegin: now - MINUTE,
      timeEnd: now + MINUTE,
      accessInfo: [
        {
          accessPointId: "door-1",
          authorizationId: "auth-1",
          isProvisioned: true,
          revokedAt: now - 1000,
        },
      ],
    });
    const point = createDoorPoint({
      mode: AccessPointMode.BOTH,
      authorizationId: "auth-1",
      isProvisioned: true,
    });
    const result = AccessService.evaluateBookingAccessEligibility(
      booking,
      [point],
      { now, userId: "user-1" },
    );

    expect(result.canUseAuthorization).to.be.false;
    expect(result.blockingReasons).to.include(
      ACCESS_BLOCKING_REASONS.AUTHORIZATION_REVOKED,
    );
  });

  it("enables authorization use when provisioned", () => {
    const booking = createBooking({
      timeBegin: now - MINUTE,
      timeEnd: now + MINUTE,
      accessInfo: [
        {
          accessPointId: "door-1",
          authorizationId: "auth-1",
          isProvisioned: true,
        },
      ],
    });
    const point = createDoorPoint({
      mode: AccessPointMode.AUTHORIZATION,
      authorizationId: "auth-1",
      isProvisioned: true,
    });
    const result = AccessService.evaluateBookingAccessEligibility(
      booking,
      [point],
      { now, userId: "user-1" },
    );

    expect(result.canUseAuthorization).to.be.true;
    expect(result.canOperateRemote).to.be.false;
    expect(result.blockingReasons).to.include(
      ACCESS_BLOCKING_REASONS.NO_REMOTE_ACCESS,
    );
  });

  it("reports locker_not_ready when a locker is not provisioned", () => {
    const booking = createBooking({
      timeBegin: now - MINUTE,
      timeEnd: now + MINUTE,
    });
    const locker = {
      id: "locker-1",
      type: "locker",
      mode: AccessPointMode.REMOTE,
      isProvisioned: false,
      accessBuffer: { beforeMs: 0, afterMs: 0 },
    };
    const result = AccessService.evaluateBookingAccessEligibility(
      booking,
      [locker],
      { now, userId: "user-1" },
    );

    expect(result.blockingReasons).to.include(
      ACCESS_BLOCKING_REASONS.LOCKER_NOT_READY,
    );
    expect(result.canOperate).to.be.true;
  });

  it("allows managers without ownership", () => {
    const booking = createBooking({
      assignedUserId: "other-user",
      timeBegin: now - MINUTE,
      timeEnd: now + MINUTE,
    });
    const result = AccessService.evaluateBookingAccessEligibility(
      booking,
      [createDoorPoint()],
      { now, userId: "manager-1", hasManagePermission: true },
    );

    expect(result.canOperate).to.be.true;
    expect(result.canView).to.be.true;
  });

  it("denies non-owners without manage permission", () => {
    const booking = createBooking({
      assignedUserId: "other-user",
      timeBegin: now - MINUTE,
      timeEnd: now + MINUTE,
    });
    const result = AccessService.evaluateBookingAccessEligibility(
      booking,
      [createDoorPoint()],
      { now, userId: "user-1", hasManagePermission: false },
    );

    expect(result.canOperate).to.be.false;
    expect(result.canView).to.be.false;
  });
});

describe("AccessService.canOperate via evaluateBookingAccessEligibility", () => {
  let sandbox;

  beforeEach(() => {
    sandbox = sinon.createSandbox();
  });

  afterEach(() => {
    sandbox.restore();
  });

  it("delegates to eligibility for a resolved door", async () => {
    const now = Date.now();
    const booking = createBooking({
      timeBegin: now - 10 * MINUTE,
      timeEnd: now + 60 * MINUTE,
    });
    sandbox.stub(BookingManager, "getBooking").resolves(booking);
    sandbox.stub(AccessService, "_getDoorAccessPoints").resolves([
      {
        accessPoint: {
          id: "door-1",
          tenant: "tenant-1",
          type: "door",
          mode: AccessPointMode.REMOTE,
        },
        bookingContext: {
          accessBuffer: { beforeMs: 0, afterMs: 0 },
          isProvisioned: true,
        },
      },
    ]);
    sandbox.stub(PermissionsService, "_isOwner").returns(true);

    const allowed = await AccessService.canOperate(
      "user-1",
      "tenant-1",
      "booking-1",
      "door-1",
      false,
    );
    expect(allowed).to.be.true;
  });

  it("returns false when the access point is not part of the booking", async () => {
    const booking = createBooking();
    sandbox.stub(BookingManager, "getBooking").resolves(booking);
    sandbox.stub(AccessService, "_getDoorAccessPoints").resolves([]);

    const allowed = await AccessService.canOperate(
      "user-1",
      "tenant-1",
      "booking-1",
      "missing-door",
      true,
    );
    expect(allowed).to.be.false;
  });
});

describe("AccessService.getUserBookingsWithAccess includeEligibility", () => {
  let sandbox;

  beforeEach(() => {
    sandbox = sinon.createSandbox();
  });

  afterEach(() => {
    sandbox.restore();
  });

  it("attaches accessEligibility when requested", async () => {
    const now = Date.now();
    const booking = createBooking({
      timeBegin: now - MINUTE,
      timeEnd: now + MINUTE,
    });
    sandbox.stub(BookingManager, "getUserBookingsFiltered").resolves([booking]);
    sandbox
      .stub(AccessService, "_getAccessTriggerMapsForTenants")
      .resolves(new Map([["tenant-1", new Map([["room", new Map([["door-1", "remote"]])]])]]));
    sandbox
      .stub(AccessService, "_getFilteredBookingAccessPoints")
      .resolves([createDoorPoint()]);
    sandbox
      .stub(AccessService, "_resolveManagePermissionByTenant")
      .resolves(new Map([["tenant-1", false]]));
    sandbox.stub(BookableManager, "getBookablesByIds").resolves([]);

    const results = await AccessService.getUserBookingsWithAccess("user-1", {
      state: "active",
      includeEligibility: true,
      now,
    });

    expect(results).to.have.length(1);
    expect(results[0].accessEligibility).to.include({
      canOperate: true,
      canOperateRemote: true,
    });
    expect(results[0].accessEligibility.operableAccessPointIds).to.deep.equal([
      "door-1",
    ]);
  });

  it("honors access buffers for active filtering when includeEligibility is set", async () => {
    const now = 90 * MINUTE;
    const booking = createBooking({
      timeBegin: 100 * MINUTE,
      timeEnd: 200 * MINUTE,
    });
    sandbox.stub(BookingManager, "getUserBookingsFiltered").resolves([booking]);
    sandbox
      .stub(AccessService, "_getAccessTriggerMapsForTenants")
      .resolves(
        new Map([
          ["tenant-1", new Map([["room", new Map([["door-1", "remote"]])]])],
        ]),
      );
    sandbox.stub(AccessService, "_getFilteredBookingAccessPoints").resolves([
      createDoorPoint({
        accessBuffer: { beforeMs: 15 * MINUTE, afterMs: 0 },
      }),
    ]);
    sandbox
      .stub(AccessService, "_resolveManagePermissionByTenant")
      .resolves(new Map([["tenant-1", false]]));
    sandbox.stub(BookableManager, "getBookablesByIds").resolves([]);

    const results = await AccessService.getUserBookingsWithAccess("user-1", {
      state: "active",
      includeEligibility: true,
      now,
    });

    expect(results).to.have.length(1);
    expect(results[0].accessEligibility.canOperate).to.be.true;
    expect(results[0].accessEligibility.blockingReasons).to.not.include(
      ACCESS_BLOCKING_REASONS.OUTSIDE_ACCESS_WINDOW,
    );
  });

  it("includes uncommitted bookings when includeEligibility is set", async () => {
    const now = 90 * MINUTE;
    const booking = createBooking({
      isCommitted: false,
      timeBegin: 100 * MINUTE,
      timeEnd: 200 * MINUTE,
    });
    sandbox.stub(BookingManager, "getUserBookingsFiltered").resolves([booking]);
    sandbox
      .stub(AccessService, "_getAccessTriggerMapsForTenants")
      .resolves(
        new Map([
          ["tenant-1", new Map([["room", new Map([["door-1", "remote"]])]])],
        ]),
      );
    sandbox.stub(AccessService, "_getFilteredBookingAccessPoints").resolves([
      createDoorPoint({
        accessBuffer: { beforeMs: 15 * MINUTE, afterMs: 0 },
      }),
    ]);
    sandbox
      .stub(AccessService, "_resolveManagePermissionByTenant")
      .resolves(new Map([["tenant-1", false]]));
    sandbox.stub(BookableManager, "getBookablesByIds").resolves([]);

    const results = await AccessService.getUserBookingsWithAccess("user-1", {
      state: "active",
      includeEligibility: true,
      now,
    });

    expect(results).to.have.length(1);
    expect(results[0].isCommitted).to.be.false;
    expect(results[0].accessEligibility.canOperate).to.be.false;
    expect(results[0].accessEligibility.primaryBlockingReason).to.equal(
      ACCESS_BLOCKING_REASONS.NOT_COMMITTED,
    );
  });
});
