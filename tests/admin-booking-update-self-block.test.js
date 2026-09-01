const assert = require("assert");
const sinon = require("sinon");
const BookingManager = require("../src/commons/data-managers/booking-manager");
const {
  BookableManager,
} = require("../src/commons/data-managers/bookable-manager");
const MembershipManager = require("../src/commons/data-managers/membership-manager");
const TenantManager = require("../src/commons/data-managers/tenant-manager");
const EventManager = require("../src/commons/data-managers/event-manager");
const UserManager = require("../src/commons/data-managers/user-manager");
const OpeningHoursManager = require("../src/commons/utilities/opening-hours-manager");
const LockerService = require("../src/commons/services/locker/locker-service");
const AccessService = require("../src/commons/services/access/access-service");
const BookingService = require("../src/commons/services/checkout/booking-service");

const TENANT_ID = "tenant-1";
const BOOKING_ID = "EDIT-ME";
const OTHER_BOOKING_ID = "OTHER-1";
const SIBLING_BOOKING_ID = "SIBLING-1";
const TIME_BEGIN = Date.UTC(2026, 5, 15, 10, 0, 0);
const TIME_END = Date.UTC(2026, 5, 15, 11, 0, 0);
const NEW_TIME_BEGIN = Date.UTC(2026, 5, 15, 12, 0, 0);
const NEW_TIME_END = Date.UTC(2026, 5, 15, 13, 0, 0);

function priceCategories(priceEur = 10) {
  return [
    {
      priceEur,
      interval: { start: null, end: null },
      fixedPrice: true,
      holidays: [],
      weekdays: [],
    },
  ];
}

function bookableSnapshot(overrides = {}) {
  return {
    id: "room-1",
    tenantId: TENANT_ID,
    title: "Room 1",
    type: "resource",
    isBookable: true,
    isScheduleRelated: true,
    amount: 1,
    priceType: "per-item",
    priceValueAddedTax: 19,
    priceCategories: priceCategories(10),
    permittedUsers: [],
    permittedRoles: [],
    autoCommitBooking: false,
    preparationLeadTimeMinutes: null,
    serviceHours: [
      {
        weekdays: [1, 2, 3, 4, 5],
        startTime: "08:00",
        endTime: "18:00",
      },
    ],
    ...overrides,
  };
}

function bookingRecord({
  id = BOOKING_ID,
  timeBegin = TIME_BEGIN,
  timeEnd = TIME_END,
  snapshot = bookableSnapshot(),
  priceEur = 11.9,
  vatIncludedEur = 1.9,
  itemNet = 10,
  itemGross = 11.9,
} = {}) {
  return {
    id,
    tenantId: TENANT_ID,
    assignedUserId: "user@example.com",
    timeBegin,
    timeEnd,
    timeCreated: TIME_BEGIN - 86_400_000,
    name: "Admin Edit",
    company: "",
    street: "",
    zipCode: "",
    location: "",
    mail: "user@example.com",
    phone: "",
    comment: "",
    isCommitted: false,
    isPayed: false,
    isRejected: false,
    paymentProvider: "invoice",
    paymentMethod: "",
    priceEur,
    vatIncludedEur,
    bookableItems: [
      {
        bookableId: "room-1",
        amount: 1,
        userPriceEur: itemNet,
        userGrossPriceEur: itemGross,
        regularPriceEur: itemNet,
        regularGrossPriceEur: itemGross,
        _bookableUsed: snapshot,
      },
    ],
    attachmentStatus: [],
    attachments: [],
    customFieldValues: [],
  };
}

describe("BookingService.updateBooking — admin edit self-block & prices", () => {
  /** @type {ReturnType<typeof bookingRecord>[]} */
  let concurrent;
  /** @type {sinon.SinonStub} */
  let storeBooking;
  /** @type {ReturnType<typeof bookableSnapshot>} */
  let catalogBookable;

  beforeEach(() => {
    concurrent = [bookingRecord()];
    catalogBookable = bookableSnapshot();

    sinon.stub(BookingManager, "getBooking").callsFake(async (id) => {
      if (id === BOOKING_ID) {
        return concurrent.find((b) => b.id === BOOKING_ID) || bookingRecord();
      }
      return { id: null };
    });
    storeBooking = sinon
      .stub(BookingManager, "storeBooking")
      .callsFake(async (value) => value);
    sinon
      .stub(BookingManager, "getConcurrentBookings")
      .callsFake(async (bookableId, _tenantId, timeBegin, timeEnd) =>
        BookingManager.filterConcurrentBookings(
          concurrent.filter((b) =>
            b.bookableItems.some((item) => item.bookableId === bookableId),
          ),
          timeBegin,
          timeEnd,
        ),
      );
    sinon
      .stub(BookingManager, "getRelatedBookings")
      .callsFake(async (_tenantId, bookableId) =>
        concurrent.filter((b) =>
          b.bookableItems.some((item) => item.bookableId === bookableId),
        ),
      );
    sinon.stub(BookingManager, "getEventBookings").resolves([]);

    sinon
      .stub(BookableManager, "getBookable")
      .callsFake(async () => catalogBookable);
    sinon.stub(BookableManager, "getAncestorBookables").resolves([]);
    sinon.stub(BookableManager, "getRelatedBookables").resolves([]);
    sinon.stub(BookableManager, "getCustomFieldDefinitions").resolves({
      instanceFields: [],
      tenantFields: [],
    });

    sinon
      .stub(MembershipManager, "getMembershipByTenantAndUserID")
      .resolves(null);
    sinon
      .stub(MembershipManager, "getMembershipsByTenantAndRoles")
      .resolves([]);
    sinon.stub(TenantManager, "getTenant").resolves(null);
    sinon.stub(EventManager, "getEvent").resolves(null);
    sinon.stub(UserManager, "getRawUser").resolves(null);
    sinon.stub(OpeningHoursManager, "hasOpeningHoursConflict").resolves(false);

    sinon.stub(LockerService, "getInstance").returns({
      handleUpdate: sinon.stub().resolves(),
      handleCreate: sinon.stub().resolves(),
      handlePreReserve: sinon.stub().resolves(),
      getAvailableLocker: sinon.stub().resolves([]),
    });
    sinon.stub(AccessService, "updateForBooking").resolves([]);
    sinon.stub(AccessService, "provisionForBooking").resolves([]);
    sinon.stub(AccessService, "revokeForBooking").resolves([]);
  });

  afterEach(() => {
    sinon.restore();
  });

  function lastPreparedStore() {
    const stored = storeBooking
      .getCalls()
      .map((c) => c.args[0])
      .filter((b) => b && b.id === BOOKING_ID);
    assert.ok(stored.length > 0, "expected prepared booking to be stored");
    return stored[stored.length - 1];
  }

  it("allows updating an existing booking that would otherwise conflict with itself", async () => {
    const updated = bookingRecord();

    const result = await BookingService.updateBooking(TENANT_ID, updated);

    assert.strictEqual(result.id, BOOKING_ID);
    assert.strictEqual(lastPreparedStore().id, BOOKING_ID);
  });

  it("allows moving into a window that conflicts only with the booking being edited", async () => {
    concurrent = [
      bookingRecord({
        timeBegin: NEW_TIME_BEGIN,
        timeEnd: NEW_TIME_END,
      }),
    ];

    const updated = bookingRecord({
      timeBegin: NEW_TIME_BEGIN,
      timeEnd: NEW_TIME_END,
    });

    const result = await BookingService.updateBooking(TENANT_ID, updated);

    assert.strictEqual(result.id, BOOKING_ID);
    assert.strictEqual(result.timeBegin, NEW_TIME_BEGIN);
  });

  it("allows admin update even when overlapping a different booking", async () => {
    concurrent = [
      bookingRecord(),
      bookingRecord({
        id: OTHER_BOOKING_ID,
        timeBegin: TIME_BEGIN,
        timeEnd: TIME_END,
      }),
    ];

    const result = await BookingService.updateBooking(
      TENANT_ID,
      bookingRecord(),
    );

    assert.strictEqual(result.id, BOOKING_ID);
    assert.strictEqual(lastPreparedStore().id, BOOKING_ID);
  });

  it("does not let insufficient lead time block an update", async () => {
    const snapshot = bookableSnapshot({
      preparationLeadTimeMinutes: 10_000,
    });
    concurrent = [bookingRecord({ snapshot })];

    const updated = bookingRecord({ snapshot });
    const result = await BookingService.updateBooking(TENANT_ID, updated);

    assert.strictEqual(result.id, BOOKING_ID);
  });

  it("recomputes item and booking prices from edited priceCategories including zero", async () => {
    const snapshot = bookableSnapshot({
      priceCategories: priceCategories(0),
    });
    concurrent = [
      bookingRecord({
        snapshot,
        priceEur: 11.9,
        vatIncludedEur: 1.9,
        itemNet: 10,
        itemGross: 11.9,
      }),
    ];

    const updated = bookingRecord({
      snapshot,
      // Stale top-level / item prices as the Admin UI sends today
      priceEur: 11.9,
      vatIncludedEur: 1.9,
      itemNet: 10,
      itemGross: 11.9,
    });

    await BookingService.updateBooking(TENANT_ID, updated);
    const stored = lastPreparedStore();

    assert.strictEqual(stored.bookableItems[0].userPriceEur, 0);
    assert.strictEqual(stored.bookableItems[0].userGrossPriceEur, 0);
    assert.strictEqual(stored.bookableItems[0].regularPriceEur, 0);
    assert.strictEqual(stored.bookableItems[0].regularGrossPriceEur, 0);
    assert.strictEqual(stored.priceEur, 0);
    assert.strictEqual(stored.vatIncludedEur, 0);
  });

  it("overwrites stale booking prices when admin edits priceCategories to a new non-zero value", async () => {
    const snapshot = bookableSnapshot({
      priceCategories: priceCategories(20),
    });
    concurrent = [
      bookingRecord({
        snapshot,
        priceEur: 11.9,
        vatIncludedEur: 1.9,
        itemNet: 10,
        itemGross: 11.9,
      }),
    ];

    const updated = bookingRecord({
      snapshot,
      priceEur: 11.9,
      vatIncludedEur: 1.9,
      itemNet: 10,
      itemGross: 11.9,
    });

    await BookingService.updateBooking(TENANT_ID, updated);
    const stored = lastPreparedStore();

    assert.strictEqual(stored.bookableItems[0].userPriceEur, 20);
    assert.strictEqual(stored.bookableItems[0].userGrossPriceEur, 23.8);
    assert.strictEqual(stored.priceEur, 23.8);
    assert.strictEqual(stored.vatIncludedEur, 3.8);
  });

  it("does not apply assigned user's booking discount when admin edits priceCategories", async () => {
    const assigneeId = "admin@stadt.de";
    MembershipManager.getMembershipByTenantAndUserID.resolves({
      userId: assigneeId,
      roles: [],
    });

    const snapshot = bookableSnapshot({
      priceCategories: priceCategories(20),
      bookingDiscounts: {
        users: [{ userId: assigneeId, discountPercent: 100 }],
        roles: [],
      },
    });
    concurrent = [
      bookingRecord({
        snapshot,
        priceEur: 11.9,
        vatIncludedEur: 1.9,
        itemNet: 10,
        itemGross: 11.9,
      }),
    ];
    concurrent[0].assignedUserId = assigneeId;

    const updated = bookingRecord({
      snapshot,
      priceEur: 11.9,
      vatIncludedEur: 1.9,
      itemNet: 10,
      itemGross: 11.9,
    });
    updated.assignedUserId = assigneeId;

    await BookingService.updateBooking(TENANT_ID, updated);
    const stored = lastPreparedStore();

    // Admin entered list price via priceCategories must win over bookingDiscounts
    assert.strictEqual(stored.bookableItems[0].userPriceEur, 20);
    assert.strictEqual(stored.bookableItems[0].userGrossPriceEur, 23.8);
    assert.strictEqual(stored.bookableItems[0].regularPriceEur, 20);
    assert.strictEqual(stored.priceEur, 23.8);
    assert.strictEqual(stored.vatIncludedEur, 3.8);
  });

  it("allows admin update even when a group sibling overlaps the same window", async () => {
    concurrent = [
      bookingRecord(),
      bookingRecord({
        id: SIBLING_BOOKING_ID,
        timeBegin: TIME_BEGIN,
        timeEnd: TIME_END,
      }),
    ];

    const result = await BookingService.updateBooking(
      TENANT_ID,
      bookingRecord(),
    );

    assert.strictEqual(result.id, BOOKING_ID);
  });
});

describe("BookingService.createBooking — admin create never hard-fails checks", () => {
  let clock;

  beforeEach(() => {
    clock = sinon.useFakeTimers(new Date("2026-06-15T09:00:00Z").getTime());

    const snapshot = bookableSnapshot({
      preparationLeadTimeMinutes: 120,
    });

    sinon.stub(BookingManager, "getBooking").resolves({ id: null });
    sinon
      .stub(BookingManager, "storeBooking")
      .callsFake(async (value) => value);
    sinon.stub(BookingManager, "getConcurrentBookings").resolves([]);
    sinon.stub(BookingManager, "getRelatedBookings").resolves([]);
    sinon.stub(BookingManager, "getEventBookings").resolves([]);

    sinon.stub(BookableManager, "getBookable").resolves(snapshot);
    sinon.stub(BookableManager, "getAncestorBookables").resolves([]);
    sinon.stub(BookableManager, "getRelatedBookables").resolves([]);
    sinon.stub(BookableManager, "getCustomFieldDefinitions").resolves({
      instanceFields: [],
      tenantFields: [],
    });

    sinon
      .stub(MembershipManager, "getMembershipByTenantAndUserID")
      .resolves(null);
    sinon
      .stub(MembershipManager, "getMembershipsByTenantAndRoles")
      .resolves([]);
    sinon.stub(TenantManager, "getTenant").resolves(null);
    sinon.stub(EventManager, "getEvent").resolves(null);
    sinon.stub(UserManager, "getRawUser").resolves(null);
    sinon.stub(OpeningHoursManager, "hasOpeningHoursConflict").resolves(false);

    sinon.stub(LockerService, "getInstance").returns({
      handleUpdate: sinon.stub().resolves(),
      handleCreate: sinon.stub().resolves(),
      handlePreReserve: sinon.stub().resolves(),
      getAvailableLocker: sinon.stub().resolves([]),
    });
    sinon.stub(AccessService, "updateForBooking").resolves([]);
    sinon.stub(AccessService, "provisionForBooking").resolves([]);
    sinon.stub(AccessService, "revokeForBooking").resolves([]);
  });

  afterEach(() => {
    if (clock) {
      clock.restore();
      clock = null;
    }
    sinon.restore();
  });

  it("does not let insufficient lead time block a manual create", async () => {
    const snapshot = bookableSnapshot({
      preparationLeadTimeMinutes: 120,
    });

    const result = await BookingService.createBooking({
      tenantId: TENANT_ID,
      user: { id: "admin@example.com" },
      simulate: true,
      manualBooking: true,
      bookingAttempt: {
        timeBegin: Date.UTC(2026, 5, 15, 10, 0, 0),
        timeEnd: Date.UTC(2026, 5, 15, 11, 0, 0),
        bookableItems: [
          {
            bookableId: "room-1",
            amount: 1,
            _bookableUsed: snapshot,
          },
        ],
        name: "Create Smoke",
        mail: "user@example.com",
        paymentProvider: "invoice",
        isCommitted: false,
        isPayed: false,
        isRejected: false,
      },
    });

    assert.ok(result.id);
    assert.strictEqual(result.mail, "user@example.com");
  });
});
