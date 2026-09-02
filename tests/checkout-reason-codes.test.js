const assert = require("assert");
const {
  runBookingDurationCheck,
  runPermissionCheck,
} = require("../src/commons/availability/checkout-availability-checks");
const {
  CHECK_TYPES,
} = require("../src/commons/availability/checkout-check-types");
const {
  CHECKOUT_REASONS,
} = require("../src/commons/services/checkout/checkout-reasons");
const {
  normalizeCheckError,
  resolveReason,
} = require("../src/commons/services/checkout/normalize-check-error");
const { Bookable } = require("../src/commons/entities/bookable/bookable");

const HOUR = 60 * 60 * 1000;

function scheduleBookable(overrides = {}) {
  return new Bookable({
    id: "room-a",
    tenantId: "tenant-1",
    title: "Meeting Room A",
    type: "room",
    isBookable: true,
    isScheduleRelated: true,
    permittedUsers: [],
    permittedRoles: [],
    ...overrides,
  });
}

async function thrown(fn) {
  try {
    await fn();
  } catch (err) {
    return err;
  }
  assert.fail("expected the check to throw");
}

describe("checkout reason codes come from the checks, not from their prose", function () {
  it("a too short booking carries DURATION_TOO_SHORT", async function () {
    const err = await thrown(() =>
      runBookingDurationCheck({
        originBookable: scheduleBookable({ minBookingDuration: 2 }),
        timeBegin: 0,
        timeEnd: HOUR,
      }),
    );

    assert.strictEqual(err.checkType, CHECK_TYPES.BOOKING_DURATION);
    assert.strictEqual(err.reason, CHECKOUT_REASONS.DURATION_TOO_SHORT);
    assert.strictEqual(
      normalizeCheckError(err).reason,
      CHECKOUT_REASONS.DURATION_TOO_SHORT,
    );
  });

  it("a too long booking carries DURATION_TOO_LONG", async function () {
    const err = await thrown(() =>
      runBookingDurationCheck({
        originBookable: scheduleBookable({ maxBookingDuration: 1 }),
        timeBegin: 0,
        timeEnd: 3 * HOUR,
      }),
    );

    assert.strictEqual(err.reason, CHECKOUT_REASONS.DURATION_TOO_LONG);
    assert.strictEqual(
      normalizeCheckError(err).reason,
      CHECKOUT_REASONS.DURATION_TOO_LONG,
    );
  });

  it("a bookable that is not bookable carries BOOKABLE_NOT_BOOKABLE", async function () {
    const err = await thrown(() =>
      runPermissionCheck({
        provider: { getTenantId: () => "tenant-1" },
        originBookable: scheduleBookable({ isBookable: false }),
        userId: "user-1",
      }),
    );

    assert.strictEqual(err.checkType, CHECK_TYPES.PERMISSION);
    assert.strictEqual(err.reason, CHECKOUT_REASONS.BOOKABLE_NOT_BOOKABLE);
    assert.strictEqual(
      normalizeCheckError(err).reason,
      CHECKOUT_REASONS.BOOKABLE_NOT_BOOKABLE,
    );
  });

  it("falls back to the check type's default reason when a check carries none", function () {
    assert.strictEqual(
      resolveReason({
        checkType: CHECK_TYPES.BOOKING_DURATION,
        message: "Die Buchungsdauer muss mindestens 2 Stunden betragen.",
      }),
      CHECKOUT_REASONS.DURATION_INVALID,
    );
    assert.strictEqual(
      resolveReason({
        checkType: CHECK_TYPES.PERMISSION,
        message: "Das Objekt ist nicht buchbar.",
      }),
      CHECKOUT_REASONS.PERMISSION_DENIED,
    );
  });

  it("keeps the reason out of the interpolation params", function () {
    const normalized = normalizeCheckError({
      checkType: CHECK_TYPES.BOOKING_DURATION,
      reason: CHECKOUT_REASONS.DURATION_TOO_SHORT,
      available: false,
      message: "zu kurz",
      title: "Meeting Room A",
    });

    assert.deepStrictEqual(normalized.params, { title: "Meeting Room A" });
    assert.strictEqual(normalized.debugMessage, "zu kurz");
  });
});
