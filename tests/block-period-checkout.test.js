const assert = require("assert");
const sinon = require("sinon");
const { generateBlockPeriodInstances } = require("../src/commons/utilities/block-period-generator");
const {
  isBlockPeriodBookingValid,
  shouldSkipOpeningHoursCheck,
} = require("../src/commons/availability/availability-rules/block-period-rules");
const {
  runBlockPeriodCheck,
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
const OpeningHoursManager = require("../src/commons/utilities/opening-hours-manager");
const { BookableManager } = require("../src/commons/data-managers/bookable-manager");
const MembershipManager = require("../src/commons/data-managers/membership-manager");
const { normalizeCheckError } = require("../src/commons/services/checkout/normalize-check-error");
const { CHECKOUT_REASONS } = require("../src/commons/services/checkout/checkout-reasons");

const TENANT_ID = "tenant-1";

const SERVICE_HOURS = [
  {
    weekdays: [1, 2, 3, 4, 5],
    startTime: "08:00",
    endTime: "18:00",
  },
];

const weekendPeriod = {
  id: "weekend",
  label: "Wochenende",
  startWeekday: 6,
  startTime: "08:00",
  endWeekday: 0,
  endTime: "20:00",
};

function localDate(isoDate, time = "00:00") {
  const [year, month, day] = isoDate.split("-").map(Number);
  const [hours, minutes] = time.split(":").map(Number);
  return new Date(year, month - 1, day, hours, minutes, 0, 0);
}

function blockPeriodBookable(overrides = {}) {
  return {
    id: "camping-a",
    tenantId: TENANT_ID,
    title: "Camping A",
    type: "resource",
    isBookable: true,
    isBlockPeriodRelated: true,
    blockPeriods: [weekendPeriod],
    amount: 1,
    permittedUsers: [],
    permittedRoles: [],
    isOpeningHoursRelated: true,
    openingHours: [
      {
        weekdays: [1, 2, 3, 4, 5],
        startTime: "08:00",
        endTime: "18:00",
      },
    ],
    ...overrides,
  };
}

function getWeekendInstance() {
  const [instance] = generateBlockPeriodInstances(
    localDate("2026-06-01"),
    localDate("2026-06-30"),
    [weekendPeriod],
  );
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

describe("block period checkout and availability rules", () => {
  it("skips opening hours checks for block-period bookables", () => {
    assert.strictEqual(
      shouldSkipOpeningHoursCheck(blockPeriodBookable()),
      true,
    );
    assert.strictEqual(
      shouldSkipOpeningHoursCheck({ isLongRange: true }),
      true,
    );
    assert.strictEqual(
      shouldSkipOpeningHoursCheck({ isScheduleRelated: true }),
      false,
    );
  });

  it("accepts an exact block instance and rejects partial windows", () => {
    const bookable = blockPeriodBookable();
    const instance = getWeekendInstance();

    assert.strictEqual(
      isBlockPeriodBookingValid(
        bookable,
        instance.timeBegin,
        instance.timeEnd,
      ),
      true,
    );
    assert.strictEqual(
      isBlockPeriodBookingValid(
        bookable,
        instance.timeBegin,
        instance.timeEnd - 60 * 60 * 1000,
      ),
      false,
    );
  });

  it("throws a block-period check error for partial bookings", () => {
    const bookable = blockPeriodBookable();
    const instance = getWeekendInstance();

    assert.throws(
      () =>
        runBlockPeriodCheck({
          originBookable: bookable,
          timeBegin: instance.timeBegin,
          timeEnd: instance.timeEnd - 60 * 60 * 1000,
        }),
      (error) => error.checkType === CHECK_TYPES.BLOCK_PERIOD,
    );
  });

  it("returns block-period-mismatch from checkWindowAvailability", async () => {
    const bookable = blockPeriodBookable();
    const instance = getWeekendInstance();
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
      assert.strictEqual(partial.reason, "block-period-mismatch");
    } finally {
      MembershipManager.getMembershipsByTenantAndRoles = originalMembershipLookup;
    }
  });

  it("ignores opening hours during checkout for block-period bookables", async () => {
    const bookable = blockPeriodBookable();
    const instance = getWeekendInstance();
    const checkout = new ManualItemCheckoutService({
      user: "user-1",
      tenantId: TENANT_ID,
      timeBegin: instance.timeBegin,
      timeEnd: instance.timeEnd,
      bookableId: bookable.id,
      amount: 1,
      couponCode: null,
    });

    const originalConflict = OpeningHoursManager.hasOpeningHoursConflict;
    const originalAncestors = BookableManager.getAncestorBookables;

    OpeningHoursManager.hasOpeningHoursConflict = async () => true;
    BookableManager.getAncestorBookables = async () => [];

    try {
      await checkout.init(bookable);
      const result = await checkout.checkOpeningHours();
      assert.strictEqual(result.available, true);
    } finally {
      OpeningHoursManager.hasOpeningHoursConflict = originalConflict;
      BookableManager.getAncestorBookables = originalAncestors;
    }
  });

  it("maps block-period checkout errors to a stable reason code", () => {
    const normalized = normalizeCheckError({
      checkType: CHECK_TYPES.BLOCK_PERIOD,
      available: false,
      message: "Für das Objekt Camping A muss eine vollständige Block-Periode gebucht werden.",
    });

    assert.strictEqual(
      normalized.reason,
      CHECKOUT_REASONS.BLOCK_PERIOD_MISMATCH,
    );
  });

  it("accepts a full block period through checkout checkBlockPeriod", async () => {
    const bookable = blockPeriodBookable();
    const instance = getWeekendInstance();
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
    const result = await checkout.checkBlockPeriod();
    assert.strictEqual(result.available, true);
  });

  it("returns insufficient-lead-time from checkWindowAvailability", async () => {
    const bookable = blockPeriodBookable({
      preparationLeadTimeMinutes: 120,
      serviceHours: SERVICE_HOURS,
    });
    const instance = getWeekendInstance();
    const provider = buildProvider(bookable);
    const originalMembershipLookup =
      MembershipManager.getMembershipsByTenantAndRoles;
    const clock = sinon.useFakeTimers(
      localDate("2026-06-05", "17:30").getTime(),
    );

    MembershipManager.getMembershipsByTenantAndRoles = async () => [];

    try {
      const insufficient = await checkWindowAvailability(provider, {
        timeBegin: instance.timeBegin,
        timeEnd: instance.timeEnd,
        amount: 1,
        user: "user-1",
      });
      clock.setSystemTime(localDate("2026-06-05", "10:00").getTime());
      const sufficient = await checkWindowAvailability(provider, {
        timeBegin: instance.timeBegin,
        timeEnd: instance.timeEnd,
        amount: 1,
        user: "user-1",
      });

      assert.strictEqual(insufficient.available, false);
      assert.strictEqual(insufficient.reason, "insufficient-lead-time");
      assert.strictEqual(sufficient.available, true);
    } finally {
      clock.restore();
      MembershipManager.getMembershipsByTenantAndRoles =
        originalMembershipLookup;
    }
  });
});
