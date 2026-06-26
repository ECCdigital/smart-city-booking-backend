const assert = require("assert");
const { generateTimePeriodInstances } = require("../src/commons/utilities/time-period-generator");
const {
  isTimePeriodBookingValid,
} = require("../src/commons/availability/availability-rules/time-period-rules");
const {
  runTimePeriodCheck,
} = require("../src/commons/availability/checkout-availability-checks");
const {
  checkWindowAvailability,
} = require("../src/commons/availability/check-window-availability");
const {
  InMemoryAvailabilityDataProvider,
} = require("../src/commons/availability/providers");
const {
  ManualItemCheckoutService,
  CHECK_TYPES,
} = require("../src/commons/services/checkout/item-checkout-service");
const MembershipManager = require("../src/commons/data-managers/membership-manager");
const { normalizeCheckError } = require("../src/commons/services/checkout/normalize-check-error");
const { CHECKOUT_REASONS } = require("../src/commons/services/checkout/checkout-reasons");

const TENANT_ID = "tenant-1";

const morningSlot = {
  weekdays: [1, 2, 3, 4, 5],
  startTime: "10:00",
  endTime: "15:00",
};

function localDate(isoDate, time = "00:00") {
  const [year, month, day] = isoDate.split("-").map(Number);
  const [hours, minutes] = time.split(":").map(Number);
  return new Date(year, month - 1, day, hours, minutes, 0, 0);
}

function timePeriodBookable(overrides = {}) {
  return {
    id: "meeting-room-a",
    tenantId: TENANT_ID,
    title: "Meeting Room A",
    type: "room",
    isBookable: true,
    isTimePeriodRelated: true,
    timePeriods: [morningSlot],
    amount: 1,
    permittedUsers: [],
    permittedRoles: [],
    ...overrides,
  };
}

function getTuesdaySlotInstance() {
  const [instance] = generateTimePeriodInstances(
    localDate("2026-06-01"),
    localDate("2026-06-30"),
    [morningSlot],
  ).filter((slot) => {
    const date = new Date(slot.timeBegin);
    return date.getDay() === 2;
  });
  return instance;
}

function buildProvider(bookable, bookingsByBookableId = {}) {
  return new InMemoryAvailabilityDataProvider({
    tenantId: TENANT_ID,
    bookable,
    parentBookables: [],
    relatedBookables: [],
    relatedBookablesByParentId: {},
    bookingsByBookableId: new Map(Object.entries(bookingsByBookableId)),
    tenant: { maxBookingAdvanceInMonths: null },
    event: null,
    eventBookings: [],
  });
}

describe("time period checkout and availability rules", () => {
  it("accepts an exact time-period slot and rejects partial windows", () => {
    const bookable = timePeriodBookable();
    const instance = getTuesdaySlotInstance();

    assert.strictEqual(
      isTimePeriodBookingValid(
        bookable,
        instance.timeBegin,
        instance.timeEnd,
      ),
      true,
    );
    assert.strictEqual(
      isTimePeriodBookingValid(
        bookable,
        instance.timeBegin,
        instance.timeEnd - 60 * 60 * 1000,
      ),
      false,
    );
    assert.strictEqual(
      isTimePeriodBookingValid(
        { isScheduleRelated: true },
        instance.timeBegin,
        instance.timeEnd,
      ),
      true,
    );
  });

  it("rejects bookings on weekdays outside the configured time periods", () => {
    const bookable = timePeriodBookable();
    const saturdayStart = localDate("2026-06-06", "10:00");
    const saturdayEnd = localDate("2026-06-06", "15:00");

    assert.strictEqual(
      isTimePeriodBookingValid(
        bookable,
        saturdayStart.getTime(),
        saturdayEnd.getTime(),
      ),
      false,
    );
  });

  it("throws a time-period check error for partial bookings", () => {
    const bookable = timePeriodBookable();
    const instance = getTuesdaySlotInstance();

    assert.throws(
      () =>
        runTimePeriodCheck({
          originBookable: bookable,
          timeBegin: instance.timeBegin,
          timeEnd: instance.timeEnd - 60 * 60 * 1000,
        }),
      (error) => error.checkType === CHECK_TYPES.TIME_PERIOD,
    );
  });

  it("returns time-period-mismatch from checkWindowAvailability", async () => {
    const bookable = timePeriodBookable();
    const instance = getTuesdaySlotInstance();
    const provider = buildProvider(bookable);
    const originalMembershipLookup =
      MembershipManager.getMembershipsByTenantAndRoles;

    MembershipManager.getMembershipsByTenantAndRoles = async () => [];

    try {
      const exact = await checkWindowAvailability(provider, {
        timeBegin: instance.timeBegin,
        timeEnd: instance.timeEnd,
        amount: 1,
        user: "user-1",
      });
      const partial = await checkWindowAvailability(provider, {
        timeBegin: instance.timeBegin,
        timeEnd: instance.timeEnd - 60 * 60 * 1000,
        amount: 1,
        user: "user-1",
      });

      assert.strictEqual(exact.available, true);
      assert.strictEqual(partial.available, false);
      assert.strictEqual(partial.reason, "time-period-mismatch");
    } finally {
      MembershipManager.getMembershipsByTenantAndRoles = originalMembershipLookup;
    }
  });

  it("maps time-period checkout errors to a stable reason code", () => {
    const normalized = normalizeCheckError({
      checkType: CHECK_TYPES.TIME_PERIOD,
      available: false,
      message:
        "Für das Objekt Meeting Room A muss ein vollständiger Zeitslot gebucht werden.",
    });

    assert.strictEqual(
      normalized.reason,
      CHECKOUT_REASONS.TIME_PERIOD_MISMATCH,
    );
  });

  it("accepts a full time period through checkout checkTimePeriod", async () => {
    const bookable = timePeriodBookable();
    const instance = getTuesdaySlotInstance();
    const checkout = new ManualItemCheckoutService({
      user: "user-1",
      tenantId: TENANT_ID,
      timeBegin: instance.timeBegin,
      timeEnd: instance.timeEnd,
      bookableId: bookable.id,
      amount: 1,
      couponCode: null,
    });

    await checkout.init(bookable);
    const result = await checkout.checkTimePeriod();
    assert.strictEqual(result.available, true);
  });
});
