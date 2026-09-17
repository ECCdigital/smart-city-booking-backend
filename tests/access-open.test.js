const { expect } = require("chai");
const sinon = require("sinon");

const AccessService = require("../src/commons/services/access/access-service");
const {
  ACCESS_BLOCKING_REASONS,
} = require("../src/commons/services/access/access-blocking-reasons");
const AccessLogService = require("../src/commons/services/access/access-log-service");
const AccessProvider = require("../src/commons/services/access/providers/access-provider");
const AccessController = require("../src/platform/api/controllers/access-controller");
const BookingManager = require("../src/commons/data-managers/booking-manager");
const AccessPointManager = require("../src/commons/data-managers/access-point-manager");
const {
  registerAccessProvider,
} = require("../src/commons/services/access/providers/access-provider-registry");
const { Booking } = require("../src/commons/entities/booking/booking");
const {
  AccessPointMode,
} = require("../src/commons/entities/access/access-point");
const { ForbiddenError } = require("../src/errors/BaseError");
const { LockBusyError } = require("../src/errors/LockBusyError");

const MINUTE = 60 * 1000;
const TEST_PROVIDER = "test-open-provider";

let providerOpen = async () => ({ state: "opened", openProcessId: null });
let providerClose = async () => {};
let providerStatus = async () => ({
  open: false,
  locked: true,
  doorOpen: null,
});

class TestOpenProvider extends AccessProvider {
  async open(accessPoint, context) {
    return providerOpen(accessPoint, context);
  }

  async close(accessPoint, context) {
    return providerClose(accessPoint, context);
  }

  async getStatus(accessPoint, context) {
    return providerStatus(accessPoint, context);
  }

  static get capabilities() {
    return ["open", "close", "getStatus"];
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

/**
 * A door as the resolver hands it to the open path: the stored access point,
 * rules and scan code included, paired with the booking context it was
 * resolved with. The open path reads nothing else.
 */
function stubResolvedDoor(
  sandbox,
  booking,
  { accessPoint = {}, bookingContext = {} } = {},
) {
  sandbox.stub(BookingManager, "getBooking").resolves(booking);
  sandbox.stub(AccessService, "_getBookingAccessPointsFromBooking").resolves({
    booking,
    compartments: [],
    doors: [
      {
        accessPoint: {
          id: "door-1",
          tenantId: "tenant-1",
          type: "door",
          provider: TEST_PROVIDER,
          externalId: "lock-1",
          label: "Main door",
          mode: AccessPointMode.REMOTE,
          config: {},
          scanCode: "current-code",
          previousScanCodes: ["retired-code"],
          validationRules: [],
          ...accessPoint,
        },
        bookingContext: {
          tenant: "tenant-1",
          bookingId: booking.id,
          timeBegin: booking.timeBegin,
          timeEnd: booking.timeEnd,
          accessBuffer: { beforeMs: 0, afterMs: 0 },
          isProvisioned: true,
          grant: null,
          revokedAt: null,
          booking,
          ...bookingContext,
        },
      },
    ],
  });
}

/**
 * A granted compartment as the resolver hands it over: the locker system's
 * row - without rules - under the compartment's own id, paired with the
 * entry of the booking.
 */
function stubResolvedCompartment(sandbox, booking) {
  sandbox.stub(BookingManager, "getBooking").resolves(booking);
  sandbox.stub(AccessService, "_getBookingAccessPointsFromBooking").resolves({
    booking,
    doors: [],
    compartments: [
      {
        accessPoint: {
          id: "loc-7:booking-17",
          tenantId: "tenant-1",
          type: "locker",
          provider: TEST_PROVIDER,
          externalId: "7",
          mode: AccessPointMode.REMOTE,
          validationRules: [],
        },
        bookingContext: {
          tenant: "tenant-1",
          bookingId: booking.id,
          timeBegin: booking.timeBegin,
          timeEnd: booking.timeEnd,
          accessBuffer: { beforeMs: 0, afterMs: 0 },
          isProvisioned: true,
          grant: { authorizationId: "booking-17" },
          revokedAt: null,
          externalBookingId: "booking-17",
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
      .resolves({ state: "pending", openProcessId: "99" });
    sandbox.stub(AccessLogService, "log").resolves();
  });

  afterEach(() => {
    sandbox.restore();
  });

  it("answers with the process to poll and audits the success", async () => {
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
      data: { openProcessId: "99" },
    });
    expect(providerOpen.calledOnce).to.be.true;
    expect(AccessLogService.log.firstCall.args[0]).to.include({
      action: "open",
      result: "success",
    });
  });

  it("answers an open that is already done with no process to poll", async () => {
    const booking = createBooking();
    stubResolvedDoor(sandbox, booking);
    providerOpen.resolves({ state: "opened", openProcessId: null });

    const outcome = await AccessService.open(
      "tenant-1",
      "booking-1",
      "door-1",
      "user-1",
    );

    expect(outcome).to.deep.equal({
      success: true,
      data: { openProcessId: null },
    });
  });

  it("keeps the provider's own answer in the audit log", async () => {
    const booking = createBooking();
    stubResolvedDoor(sandbox, booking);

    await AccessService.open("tenant-1", "booking-1", "door-1", "user-1");

    expect(AccessLogService.log.firstCall.args[0].payload).to.include({
      state: "pending",
      openProcessId: "99",
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

  it("never forwards a caller-supplied otp to the provider", async () => {
    // The former `otp` parameter is gone for good: a provider that needs an
    // OTP computes it itself (docs/specs/salto-ks-remote-open.md §4).
    stubResolvedDoor(sandbox, createBooking());

    await AccessService.open("tenant-1", "booking-1", "door-1", "user-1", {
      otp: "1234",
    });

    expect(providerOpen.firstCall.args[1]).to.not.have.property("openOptions");
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
      errorCode: null,
      accessRole: "booker",
    });
  });

  it("audits a busy lock as a failure with the Lock Busy code and rethrows", async () => {
    stubResolvedDoor(sandbox, createBooking());
    providerOpen.rejects(
      new LockBusyError(
        "nuki",
        "open",
        "Nuki reports smartlock 'lock-1' busy with its previous action",
      ),
    );

    let error;
    try {
      await AccessService.open("tenant-1", "booking-1", "door-1", "user-1");
    } catch (err) {
      error = err;
    }

    expect(error).to.be.instanceOf(LockBusyError);
    expect(AccessLogService.log.firstCall.args[0]).to.include({
      action: "open",
      result: "failure",
      errorCode: "lock_busy",
      errorMessage:
        "Nuki reports smartlock 'lock-1' busy with its previous action",
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

describe("AccessService.open with validation rules", () => {
  let sandbox;

  const QR_RULE = { validationRules: [{ type: "qrScan" }] };

  beforeEach(() => {
    sandbox = sinon.createSandbox();
    providerOpen = sandbox.stub().resolves({ processId: 42 });
    sandbox.stub(AccessLogService, "log").resolves();
  });

  afterEach(() => {
    sandbox.restore();
  });

  // Ownership is left to the data - `createBooking` assigns the booking to
  // "user-1", so anyone else acting here is looking at someone else's booking.
  function open(options, userId = "user-1") {
    return AccessService.open(
      "tenant-1",
      "booking-1",
      "door-1",
      userId,
      options,
    );
  }

  it("opens when the presented code is the door's current one", async () => {
    stubResolvedDoor(sandbox, createBooking(), { accessPoint: QR_RULE });

    const outcome = await open({
      evidence: [{ type: "qrScan", scanCode: "current-code" }],
    });

    expect(outcome.success).to.be.true;
    expect(providerOpen.calledOnce).to.be.true;

    const logged = AccessLogService.log.firstCall.args[0];
    expect(logged).to.include({ result: "success", evidenceBypassed: false });
    expect(logged.payload.validatedEvidence).to.deep.equal(["qrScan"]);
  });

  it("denies a remote open without evidence at a door that requires a scan", async () => {
    stubResolvedDoor(sandbox, createBooking(), { accessPoint: QR_RULE });

    const outcome = await open({ channel: "remote" });

    expect(outcome).to.deep.equal({
      success: false,
      blockingReasons: [ACCESS_BLOCKING_REASONS.EVIDENCE_MISSING],
    });
    expect(providerOpen.called).to.be.false;

    const logged = AccessLogService.log.firstCall.args[0];
    expect(logged).to.include({ action: "open", result: "denied" });
    expect(logged.blockingReasons).to.deep.equal([
      ACCESS_BLOCKING_REASONS.EVIDENCE_MISSING,
    ]);
  });

  it("denies a code that was rotated out", async () => {
    stubResolvedDoor(sandbox, createBooking(), { accessPoint: QR_RULE });

    const outcome = await open({
      evidence: [{ type: "qrScan", scanCode: "retired-code" }],
    });

    expect(outcome.blockingReasons).to.deep.equal([
      ACCESS_BLOCKING_REASONS.EVIDENCE_INVALID,
    ]);
    expect(providerOpen.called).to.be.false;
  });

  it("fails closed when a configured rule cannot be evaluated", async () => {
    stubResolvedDoor(sandbox, createBooking(), {
      accessPoint: { validationRules: [{ type: "retiredRule" }] },
    });

    const outcome = await open({});

    expect(outcome.blockingReasons).to.deep.equal([
      ACCESS_BLOCKING_REASONS.EVIDENCE_RULE_UNAVAILABLE,
    ]);
    expect(providerOpen.called).to.be.false;
  });

  it("holds a booker with the manage-bookings permission to the rules", async () => {
    stubResolvedDoor(sandbox, createBooking(), { accessPoint: QR_RULE });

    const outcome = await open({ hasManagePermission: true });

    expect(outcome).to.deep.equal({
      success: false,
      blockingReasons: [ACCESS_BLOCKING_REASONS.EVIDENCE_MISSING],
    });
    expect(providerOpen.called).to.be.false;
    expect(AccessLogService.log.firstCall.args[0]).to.include({
      result: "denied",
      accessRole: "booker",
      evidenceBypassed: false,
    });
  });

  it("lets a manager skip the rules of a booking that is not theirs and audits it", async () => {
    stubResolvedDoor(sandbox, createBooking(), { accessPoint: QR_RULE });

    const outcome = await open({ hasManagePermission: true }, "manager-9");

    expect(outcome.success).to.be.true;
    expect(AccessLogService.log.firstCall.args[0]).to.include({
      result: "success",
      accessRole: "manager",
      evidenceBypassed: true,
    });
  });

  it("lets a booker with the manage-bookings permission in once they scan", async () => {
    stubResolvedDoor(sandbox, createBooking(), { accessPoint: QR_RULE });

    const outcome = await open({
      hasManagePermission: true,
      evidence: [{ type: "qrScan", scanCode: "current-code" }],
    });

    expect(outcome.success).to.be.true;
    expect(AccessLogService.log.firstCall.args[0]).to.include({
      result: "success",
      accessRole: "booker",
      evidenceBypassed: false,
    });
  });

  it("does not report a bypass when the door required no evidence", async () => {
    stubResolvedDoor(sandbox, createBooking());

    await open({ hasManagePermission: true });

    expect(AccessLogService.log.firstCall.args[0]).to.include({
      evidenceBypassed: false,
    });
  });

  it("checks the booking before it asks for evidence", async () => {
    stubResolvedDoor(sandbox, createBooking({ isCommitted: false }), {
      accessPoint: QR_RULE,
    });

    const outcome = await open({});

    expect(outcome.blockingReasons).to.deep.equal([
      ACCESS_BLOCKING_REASONS.NOT_COMMITTED,
    ]);
    expect(AccessLogService.log.firstCall.args[0]).to.include({
      result: "denied",
      accessRole: "booker",
    });
  });

  it("audits the reported channel unchanged, on success and on denial", async () => {
    stubResolvedDoor(sandbox, createBooking(), { accessPoint: QR_RULE });

    await open({
      channel: "qrScan",
      evidence: [{ type: "qrScan", scanCode: "current-code" }],
    });
    await open({ channel: "remote" });

    expect(AccessLogService.log.firstCall.args[0].channel).to.equal("qrScan");
    expect(AccessLogService.log.secondCall.args[0].channel).to.equal("remote");
  });

  it("audits no channel when the client reported none", async () => {
    stubResolvedDoor(sandbox, createBooking());

    await open({});

    expect(AccessLogService.log.firstCall.args[0].channel).to.equal(null);
  });

  it("fails closed when the rules of the door are unknown", async () => {
    stubResolvedDoor(sandbox, createBooking(), {
      accessPoint: { validationRules: null },
    });

    const outcome = await open({});

    expect(outcome).to.deep.equal({
      success: false,
      blockingReasons: [ACCESS_BLOCKING_REASONS.EVIDENCE_RULE_UNAVAILABLE],
    });
    expect(providerOpen.called).to.be.false;
  });

  it("asks for no evidence at a compartment of a locker system without rules", async () => {
    const booking = createBooking();
    stubResolvedCompartment(sandbox, booking);

    const outcome = await AccessService.open(
      "tenant-1",
      "booking-1",
      "loc-7:booking-17",
      "user-1",
    );

    expect(outcome.success).to.be.true;
  });

  it("judges the evidence by the door the resolver handed over, without reading it again", async () => {
    stubResolvedDoor(sandbox, createBooking(), { accessPoint: QR_RULE });
    sandbox
      .stub(AccessPointManager, "getAccessPoint")
      .rejects(new Error("the open path must not read the door a second time"));

    const outcome = await open({
      evidence: [{ type: "qrScan", scanCode: "current-code" }],
    });

    expect(outcome.success).to.be.true;
  });
});

describe("AccessService open at a door that only takes a code", () => {
  let sandbox;

  const GRANTED = {
    isProvisioned: true,
    grant: { authorizationId: "auth-1" },
  };

  beforeEach(() => {
    sandbox = sinon.createSandbox();
    providerOpen = sandbox.stub().resolves({ state: "opened" });
    sandbox.stub(AccessLogService, "log").resolves();
  });

  afterEach(() => {
    sandbox.restore();
  });

  function stubCodeDoor(bookingContext) {
    stubResolvedDoor(sandbox, createBooking(), {
      accessPoint: { mode: AccessPointMode.AUTHORIZATION },
      bookingContext,
    });
  }

  it("refuses a remote open to the booker, since the door has no remote way in", async () => {
    stubCodeDoor(GRANTED);

    const outcome = await AccessService.open(
      "tenant-1",
      "booking-1",
      "door-1",
      "user-1",
      { channel: "remote" },
    );

    expect(outcome).to.deep.equal({
      success: false,
      blockingReasons: [ACCESS_BLOCKING_REASONS.NO_REMOTE_ACCESS],
    });
    expect(providerOpen.called).to.be.false;

    const logged = AccessLogService.log.firstCall.args[0];
    expect(logged).to.include({
      action: "open",
      result: "denied",
      accessRole: "booker",
      channel: "remote",
    });
    expect(logged.blockingReasons).to.deep.equal([
      ACCESS_BLOCKING_REASONS.NO_REMOTE_ACCESS,
    ]);
  });

  it("refuses the management the same way - there is no door to open remotely", async () => {
    stubCodeDoor(GRANTED);

    const outcome = await AccessService.open(
      "tenant-1",
      "booking-1",
      "door-1",
      "manager-1",
      { hasManagePermission: true },
    );

    expect(outcome).to.deep.equal({
      success: false,
      blockingReasons: [ACCESS_BLOCKING_REASONS.NO_REMOTE_ACCESS],
    });
    expect(providerOpen.called).to.be.false;
  });

  it("names the missing grant before the missing remote way", async () => {
    stubCodeDoor({ isProvisioned: false, grant: null });

    const outcome = await AccessService.open(
      "tenant-1",
      "booking-1",
      "door-1",
      "user-1",
    );

    expect(outcome.blockingReasons).to.deep.equal([
      ACCESS_BLOCKING_REASONS.NOT_PROVISIONED,
      ACCESS_BLOCKING_REASONS.NO_REMOTE_ACCESS,
    ]);
    expect(providerOpen.called).to.be.false;
  });

  it("opens a door that takes a code and a remote command alike", async () => {
    stubResolvedDoor(sandbox, createBooking(), {
      accessPoint: { mode: AccessPointMode.BOTH },
      bookingContext: GRANTED,
    });

    const outcome = await AccessService.open(
      "tenant-1",
      "booking-1",
      "door-1",
      "user-1",
    );

    expect(outcome.success).to.be.true;
    expect(providerOpen.calledOnce).to.be.true;
  });
});

describe("AccessService close and status with validation rules", () => {
  let sandbox;

  beforeEach(() => {
    sandbox = sinon.createSandbox();
    providerClose = sandbox.stub().resolves();
    providerStatus = sandbox
      .stub()
      .resolves({ open: false, locked: true, doorOpen: null });
    sandbox.stub(AccessLogService, "log").resolves();
    // Ownership is left to the data: the booking is assigned to "user-1".
    stubResolvedDoor(sandbox, createBooking(), {
      accessPoint: { validationRules: [{ type: "qrScan" }] },
    });
  });

  afterEach(() => {
    sandbox.restore();
  });

  it("closes without evidence and answers with the state the lock reports", async () => {
    const result = await AccessService.close(
      "tenant-1",
      "booking-1",
      "door-1",
      "user-1",
    );

    expect(result).to.deep.equal({
      open: false,
      locked: true,
      doorOpen: null,
      statusSource: "provider_status",
    });
  });

  it("audits a close refused by a busy lock as a failure with the Lock Busy code and rethrows", async () => {
    providerClose = sandbox
      .stub()
      .rejects(
        new LockBusyError(
          "nuki",
          "close",
          "Nuki reports smartlock 'lock-1' busy with its previous action",
        ),
      );

    let error;
    try {
      await AccessService.close("tenant-1", "booking-1", "door-1", "user-1");
    } catch (err) {
      error = err;
    }

    expect(error).to.be.instanceOf(LockBusyError);
    expect(providerStatus.called).to.be.false;
    expect(AccessLogService.log.firstCall.args[0]).to.include({
      action: "close",
      result: "failure",
      errorCode: "lock_busy",
      errorMessage:
        "Nuki reports smartlock 'lock-1' busy with its previous action",
    });
  });

  it("audits close and status in the capacity they were commanded in, naming the user", async () => {
    await AccessService.close("tenant-1", "booking-1", "door-1", "user-1");
    await AccessService.getStatus("tenant-1", "booking-1", "door-1", "user-1");

    expect(AccessLogService.log.firstCall.args[0]).to.include({
      action: "close",
      accessRole: "booker",
      windowOverridden: false,
    });
    expect(AccessLogService.log.secondCall.args[0]).to.include({
      action: "status",
      accessRole: "booker",
      windowOverridden: false,
    });
    expect(AccessLogService.log.secondCall.args[0].actor).to.deep.equal({
      userId: "user-1",
      source: "user",
    });
  });

  it("audits a status read nobody asked for as the system's", async () => {
    await AccessService.getStatus("tenant-1", "booking-1", "door-1");

    expect(AccessLogService.log.firstCall.args[0]).to.include({
      action: "status",
      accessRole: null,
      windowOverridden: false,
    });
    expect(AccessLogService.log.firstCall.args[0].actor).to.deep.equal({
      userId: null,
      source: "system",
    });
  });

  it("does not claim the lock turned before the lock says so", async () => {
    providerStatus = sandbox
      .stub()
      .resolves({ open: true, locked: false, doorOpen: null });

    const result = await AccessService.close(
      "tenant-1",
      "booking-1",
      "door-1",
      "user-1",
    );

    expect(result).to.deep.include({ open: true, locked: false });
  });

  it("answers a lock it cannot read after closing with nothing known", async () => {
    providerStatus = sandbox.stub().rejects(new Error("provider unreachable"));

    const result = await AccessService.close(
      "tenant-1",
      "booking-1",
      "door-1",
      "user-1",
    );

    expect(result).to.deep.equal({
      open: null,
      locked: null,
      doorOpen: null,
      statusSource: null,
    });
    expect(AccessLogService.log.firstCall.args[0]).to.include({
      action: "close",
      result: "success",
    });
  });

  it("reports the status without evidence, in named fields only", async () => {
    const status = await AccessService.getStatus(
      "tenant-1",
      "booking-1",
      "door-1",
    );

    expect(status).to.deep.equal({
      open: false,
      locked: true,
      doorOpen: null,
      statusSource: "provider_status",
    });
  });

  it("keeps the provider's own status answer in the audit log", async () => {
    await AccessService.getStatus("tenant-1", "booking-1", "door-1");

    expect(AccessLogService.log.firstCall.args[0].payload).to.deep.equal({
      open: false,
      locked: true,
      doorOpen: null,
    });
  });

  it("reports an open attempt with the fields only an attempt has", async () => {
    const status = await AccessService.getOpenStatus(
      "tenant-1",
      "booking-1",
      "door-1",
      null,
    );

    expect(status).to.deep.equal({
      open: false,
      locked: true,
      doorOpen: null,
      statusSource: "provider_status",
      confirmed: null,
      errorCode: null,
      errorMessage: null,
    });
  });
});

describe("AccessService admin override after the access window", () => {
  let sandbox;

  /** The booking ended an hour ago; the door carries no buffer. */
  function pastBooking() {
    const now = Date.now();
    return createBooking({
      timeBegin: now - 120 * MINUTE,
      timeEnd: now - 60 * MINUTE,
    });
  }

  beforeEach(() => {
    sandbox = sinon.createSandbox();
    providerOpen = sandbox
      .stub()
      .resolves({ state: "opened", openProcessId: null });
    providerClose = sandbox.stub().resolves();
    providerStatus = sandbox
      .stub()
      .resolves({ open: true, locked: false, doorOpen: null });
    sandbox.stub(AccessLogService, "log").resolves();
  });

  afterEach(() => {
    sandbox.restore();
  });

  it("lets a manager close, read the status and poll the open after the window", async () => {
    stubResolvedDoor(sandbox, pastBooking());

    for (const action of ["close", "status", "open-status"]) {
      expect(
        await AccessService.canOperate(
          "manager-9",
          "tenant-1",
          "booking-1",
          "door-1",
          true,
        ),
        action,
      ).to.be.true;
    }
  });

  it("refuses a manager before the window opens", async () => {
    const now = Date.now();
    stubResolvedDoor(
      sandbox,
      createBooking({
        timeBegin: now + 60 * MINUTE,
        timeEnd: now + 120 * MINUTE,
      }),
    );

    expect(
      await AccessService.canOperate(
        "manager-9",
        "tenant-1",
        "booking-1",
        "door-1",
        true,
      ),
    ).to.be.false;
  });

  it("refuses the booker after the window as before", async () => {
    stubResolvedDoor(sandbox, pastBooking());

    expect(
      await AccessService.canOperate(
        "user-1",
        "tenant-1",
        "booking-1",
        "door-1",
        false,
      ),
    ).to.be.false;
  });

  it("refuses a manager the open after the window, with the window as the reason", async () => {
    stubResolvedDoor(sandbox, pastBooking());

    const outcome = await AccessService.open(
      "tenant-1",
      "booking-1",
      "door-1",
      "manager-9",
      { hasManagePermission: true },
    );

    expect(outcome.success).to.be.false;
    expect(outcome.blockingReasons).to.include(
      ACCESS_BLOCKING_REASONS.OUTSIDE_ACCESS_WINDOW,
    );
    expect(providerOpen.called).to.be.false;
    expect(AccessLogService.log.firstCall.args[0]).to.include({
      action: "open",
      result: "denied",
      accessRole: "manager",
      windowOverridden: false,
    });
  });

  it("marks a manager's close after the window as overridden, in their capacity", async () => {
    stubResolvedDoor(sandbox, pastBooking());

    const result = await AccessService.close(
      "tenant-1",
      "booking-1",
      "door-1",
      "manager-9",
      { hasManagePermission: true },
    );

    expect(result.statusSource).to.equal("provider_status");
    expect(providerClose.calledOnce).to.be.true;
    expect(AccessLogService.log.firstCall.args[0]).to.include({
      action: "close",
      result: "success",
      accessRole: "manager",
      windowOverridden: true,
    });
  });

  it("marks a failed overridden close as overridden too", async () => {
    stubResolvedDoor(sandbox, pastBooking());
    providerClose = sandbox.stub().rejects(new Error("lock unreachable"));

    let error;
    try {
      await AccessService.close(
        "tenant-1",
        "booking-1",
        "door-1",
        "manager-9",
        { hasManagePermission: true },
      );
    } catch (err) {
      error = err;
    }

    expect(error).to.be.an("error");
    expect(AccessLogService.log.firstCall.args[0]).to.include({
      action: "close",
      result: "failure",
      accessRole: "manager",
      windowOverridden: true,
    });
  });

  it("names the manager as the actor of an overridden status read", async () => {
    stubResolvedDoor(sandbox, pastBooking());

    const status = await AccessService.getStatus(
      "tenant-1",
      "booking-1",
      "door-1",
      "manager-9",
      { hasManagePermission: true },
    );

    expect(status).to.deep.include({ open: true, locked: false });
    expect(AccessLogService.log.firstCall.args[0]).to.include({
      action: "status",
      result: "success",
      accessRole: "manager",
      windowOverridden: true,
    });
    expect(AccessLogService.log.firstCall.args[0].actor).to.deep.equal({
      userId: "manager-9",
      source: "user",
    });
  });

  it("names the manager as the actor of an overridden open-status read", async () => {
    stubResolvedDoor(sandbox, pastBooking());

    await AccessService.getOpenStatus(
      "tenant-1",
      "booking-1",
      "door-1",
      null,
      "manager-9",
      { hasManagePermission: true },
    );

    expect(AccessLogService.log.firstCall.args[0]).to.include({
      action: "status",
      result: "success",
      accessRole: "manager",
      windowOverridden: true,
    });
    expect(AccessLogService.log.firstCall.args[0].actor).to.deep.equal({
      userId: "manager-9",
      source: "user",
    });
  });

  it("grants the override to the booker who may manage the bookings, in their own capacity", async () => {
    stubResolvedDoor(sandbox, pastBooking());

    await AccessService.close("tenant-1", "booking-1", "door-1", "user-1", {
      hasManagePermission: true,
    });

    expect(AccessLogService.log.firstCall.args[0]).to.include({
      action: "close",
      accessRole: "booker",
      windowOverridden: true,
    });
  });

  it("records no override on a close inside the window", async () => {
    stubResolvedDoor(sandbox, createBooking());

    await AccessService.close("tenant-1", "booking-1", "door-1", "manager-9", {
      hasManagePermission: true,
    });

    expect(AccessLogService.log.firstCall.args[0]).to.include({
      action: "close",
      accessRole: "manager",
      windowOverridden: false,
    });
  });
});

describe("AccessController.open", () => {
  let sandbox;
  let request;
  let response;

  beforeEach(() => {
    sandbox = sinon.createSandbox();

    // The reach of `booking.operate` the route decided: `own` is the booker,
    // `any` the manager (authorize spec §5).
    request = {
      params: { tenant: "tenant-1", accessPointId: "door-1" },
      query: { bookingId: "booking-1" },
      body: {},
      user: { id: "user-1" },
      reach: "own",
      principal: { userId: "user-1" },
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

  it("hands the reach `any` to the service as the manage permission", async () => {
    request.reach = "any";
    const open = sandbox
      .stub(AccessService, "open")
      .resolves({ success: true, data: {} });

    await AccessController.open(request, response);

    expect(open.firstCall.args[4]).to.deep.include({
      hasManagePermission: true,
    });
  });

  it("hands the evidence and the reported channel to the service", async () => {
    const open = sandbox
      .stub(AccessService, "open")
      .resolves({ success: true, data: {} });
    request.body = {
      evidence: [{ type: "qrScan", scanCode: "current-code" }],
      channel: "qrScan",
    };

    await AccessController.open(request, response);

    expect(open.firstCall.args[4]).to.deep.include({
      evidence: [{ type: "qrScan", scanCode: "current-code" }],
      channel: "qrScan",
    });
  });

  it("treats a body without evidence as no evidence at all", async () => {
    const open = sandbox
      .stub(AccessService, "open")
      .resolves({ success: true, data: {} });

    await AccessController.open(request, response);

    expect(open.firstCall.args[4]).to.deep.include({
      evidence: [],
      channel: null,
    });
  });

  it("passes on a channel it does not know rather than judging it", async () => {
    const open = sandbox
      .stub(AccessService, "open")
      .resolves({ success: true, data: {} });
    request.body = { channel: "kiosk" };

    await AccessController.open(request, response);

    expect(open.firstCall.args[4]).to.deep.include({ channel: "kiosk" });
  });

  it("drops a channel and an evidence list of the wrong shape", async () => {
    const open = sandbox
      .stub(AccessService, "open")
      .resolves({ success: true, data: {} });
    request.body = { evidence: "not-a-list", channel: { spoofed: true } };

    await AccessController.open(request, response);

    expect(open.firstCall.args[4]).to.deep.include({
      evidence: [],
      channel: null,
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

  it("answers a busy lock with HTTP 423 and the Lock Busy body, no retry hint", async () => {
    sandbox
      .stub(AccessService, "open")
      .rejects(new LockBusyError("nuki", "open", "busy"));

    await AccessController.open(request, response);

    expect(response.status.calledOnceWith(423)).to.be.true;
    expect(response.json.firstCall.args[0]).to.deep.equal({
      error: "LockBusyError",
      code: "lock_busy",
      statusCode: 423,
      params: { provider: "nuki", action: "open" },
    });
  });
});

describe("AccessController.close", () => {
  let sandbox;
  let request;
  let response;

  beforeEach(() => {
    sandbox = sinon.createSandbox();
    request = {
      params: { tenant: "tenant-1", accessPointId: "door-1" },
      query: { bookingId: "booking-1" },
      body: {},
      user: { id: "user-1" },
      reach: "own",
      principal: { userId: "user-1" },
    };
    response = {
      status: sandbox.stub().returnsThis(),
      json: sandbox.stub(),
      sendStatus: sandbox.stub(),
    };
    sandbox.stub(AccessService, "canOperate").resolves(true);
  });

  afterEach(() => {
    sandbox.restore();
  });

  it("answers a busy lock with HTTP 423 and the Lock Busy body, no retry hint", async () => {
    sandbox
      .stub(AccessService, "close")
      .rejects(new LockBusyError("nuki", "close", "busy"));

    await AccessController.close(request, response);

    expect(response.status.calledOnceWith(423)).to.be.true;
    expect(response.json.firstCall.args[0]).to.deep.equal({
      error: "LockBusyError",
      code: "lock_busy",
      statusCode: 423,
      params: { provider: "nuki", action: "close" },
    });
  });

  it("answers 500 on any other close failure", async () => {
    sandbox.stub(AccessService, "close").rejects(new Error("boom"));

    await AccessController.close(request, response);

    expect(response.status.calledWith(500)).to.be.true;
  });

  it("hands the user and their manage permission to the close, so the audit knows the capacity", async () => {
    request.reach = "tenant";
    request.principal = { userId: "manager-9", reach: "tenant" };
    request.user = { id: "manager-9" };
    sandbox.stub(AccessController, "_canManage").returns(true);
    const close = sandbox.stub(AccessService, "close").resolves({});

    await AccessController.close(request, response);

    expect(close.firstCall.args).to.deep.equal([
      "tenant-1",
      "booking-1",
      "door-1",
      "manager-9",
      { hasManagePermission: true },
    ]);
  });
});

describe("AccessController status reads", () => {
  let sandbox;
  let request;
  let response;

  beforeEach(() => {
    sandbox = sinon.createSandbox();
    request = {
      params: { tenant: "tenant-1", accessPointId: "door-1" },
      query: { bookingId: "booking-1", openProcessId: "77" },
      body: {},
      user: { id: "manager-9" },
      reach: "tenant",
      principal: { userId: "manager-9", reach: "tenant" },
    };
    response = {
      status: sandbox.stub().returnsThis(),
      json: sandbox.stub(),
      sendStatus: sandbox.stub(),
    };
    sandbox.stub(AccessService, "canOperate").resolves(true);
    sandbox.stub(AccessController, "_canManage").returns(true);
  });

  afterEach(() => {
    sandbox.restore();
  });

  it("hands the user and their manage permission to the status read", async () => {
    const getStatus = sandbox.stub(AccessService, "getStatus").resolves({});

    await AccessController.getStatus(request, response);

    expect(getStatus.firstCall.args).to.deep.equal([
      "tenant-1",
      "booking-1",
      "door-1",
      "manager-9",
      { hasManagePermission: true },
    ]);
  });

  it("hands the user and their manage permission to the open-status read", async () => {
    const getOpenStatus = sandbox
      .stub(AccessService, "getOpenStatus")
      .resolves({});

    await AccessController.getOpenStatus(request, response);

    expect(getOpenStatus.firstCall.args).to.deep.equal([
      "tenant-1",
      "booking-1",
      "door-1",
      "77",
      "manager-9",
      { hasManagePermission: true },
    ]);
  });
});
