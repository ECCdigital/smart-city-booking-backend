const assert = require("assert");
const BookingManager = require("../src/commons/data-managers/booking-manager");
const {
  AvailabilityContext,
} = require("../src/commons/services/availability/availability-context");
const {
  ManualItemCheckoutService,
} = require("../src/commons/services/checkout/item-checkout-service");
const OpeningHoursManager = require("../src/commons/utilities/opening-hours-manager");
const { BookableManager } = require("../src/commons/data-managers/bookable-manager");
const TenantManager = require("../src/commons/data-managers/tenant-manager");
const EventManager = require("../src/commons/data-managers/event-manager");
const MembershipManager = require("../src/commons/data-managers/membership-manager");
const TenantModel = require("../src/commons/data-managers/models/tenantModel");
const {
  checkWindowAvailability,
} = require("../src/commons/availability/check-window-availability");
const {
  ContextDataProvider,
  InMemoryAvailabilityDataProvider,
} = require("../src/commons/availability/providers");

const TENANT_ID = "tenant-1";
const TIME_BEGIN = 1_000;
const TIME_END = 5_000;

function booking(id, bookableId, amount, overrides = {}) {
  return {
    id,
    isRejected: false,
    timeBegin: TIME_BEGIN,
    timeEnd: TIME_END,
    bookableItems: [{ bookableId, amount }],
    ...overrides,
  };
}

function scheduleBookable(overrides = {}) {
  return {
    id: "room-a",
    tenantId: TENANT_ID,
    title: "Room A",
    type: "resource",
    isBookable: true,
    isScheduleRelated: true,
    amount: 5,
    permittedUsers: [],
    permittedRoles: [],
    ...overrides,
  };
}

function buildBookingsMap(entries) {
  return new Map(Object.entries(entries));
}

function buildInMemoryProvider({
  bookable,
  parentBookables = [],
  relatedBookables = [],
  relatedBookablesByParentId = {},
  bookingsByBookableId,
  tenant = null,
  event = null,
  eventBookings = [],
}) {
  return new InMemoryAvailabilityDataProvider({
    tenantId: TENANT_ID,
    bookable,
    parentBookables,
    relatedBookables,
    relatedBookablesByParentId,
    bookingsByBookableId: buildBookingsMap(bookingsByBookableId),
    tenant,
    event,
    eventBookings,
  });
}

function buildContextProvider({
  bookable,
  parentBookables = [],
  relatedBookables = [],
  relatedBookablesByParentId,
  bookingsByBookableId,
  tenant = null,
  event = null,
  eventBookings = [],
}) {
  const context = new AvailabilityContext({
    tenantId: TENANT_ID,
    bookableId: bookable.id,
    timeBegin: TIME_BEGIN,
    timeEnd: TIME_END,
  });

  context.bookable = bookable;
  context.parentBookables = parentBookables;
  context.relatedBookables = relatedBookables;
  context.tenant = tenant;
  context.event = event;
  context.eventBookings = eventBookings;
  context.bookingsByBookableId = buildBookingsMap(bookingsByBookableId);

  if (relatedBookablesByParentId) {
    context.relatedBookablesByParentId = buildBookingsMap(
      relatedBookablesByParentId,
    );
  }

  return new ContextDataProvider(context);
}

async function assertProvidersAgree(fixture, params) {
  const memoryProvider = buildInMemoryProvider(fixture);
  const contextProvider = buildContextProvider(fixture);

  const [memoryResult, contextResult] = await Promise.all([
    checkWindowAvailability(memoryProvider, params),
    checkWindowAvailability(contextProvider, params),
  ]);

  assert.strictEqual(
    memoryResult.available,
    contextResult.available,
    `providers disagree: memory=${memoryResult.reason}, context=${contextResult.reason}`,
  );

  return memoryResult;
}

async function isCheckoutAvailable(fixture, params) {
  const stubs = createCheckoutStubs(fixture);
  const originals = installStubs(stubs);

  try {
    const checkout = new ManualItemCheckoutService({
      user: params.user ?? "user-1",
      tenantId: TENANT_ID,
      timeBegin: params.timeBegin,
      timeEnd: params.timeEnd,
      bookableId: fixture.bookable.id,
      amount: params.amount,
      couponCode: null,
    });
    await checkout.init(fixture.bookable);

    await checkout.checkAll();
    return true;
  } catch {
    return false;
  } finally {
    restoreStubs(originals);
  }
}

function createCheckoutStubs(fixture) {
  return {
    BookingManager: {
      getConcurrentBookings: async (bookableId) => {
        const bookings = fixture.bookingsByBookableId[bookableId] ?? [];
        return BookingManager.filterConcurrentBookings(
          bookings,
          TIME_BEGIN,
          TIME_END,
        );
      },
      getRelatedBookings: async (_tenantId, bookableId) =>
        fixture.bookingsByBookableId[bookableId] ?? [],
      getEventBookings: async () => fixture.eventBookings ?? [],
    },
    BookableManager: {
      getAncestorBookables: async () => fixture.parentBookables ?? [],
      getRelatedBookables: async (bookableId) => {
        if (bookableId === fixture.bookable.id) {
          return fixture.relatedBookables ?? [];
        }

        return fixture.relatedBookablesByParentId?.[bookableId] ?? [];
      },
    },
    TenantManager: {
      getTenant: async () => fixture.tenant ?? null,
    },
    TenantModel: {
      findOne: async () =>
        fixture.tenant
          ? {
              toEntity: () => fixture.tenant,
            }
          : null,
    },
    EventManager: {
      getEvent: async () => fixture.event ?? null,
    },
    OpeningHoursManager: {
      hasOpeningHoursConflict: async () => false,
    },
  };
}

function installStubs(stubs) {
  const originals = {};
  const targets = {
    BookingManager,
    BookableManager,
    TenantManager,
    TenantModel,
    EventManager,
    OpeningHoursManager,
  };

  for (const [targetName, methods] of Object.entries(stubs)) {
    const target = targets[targetName];
    for (const [method, impl] of Object.entries(methods)) {
      originals[`${targetName}.${method}`] = target[method];
      target[method] = impl;
    }
  }

  return originals;
}

function restoreStubs(originals) {
  const targets = {
    BookingManager,
    BookableManager,
    TenantManager,
    TenantModel,
    EventManager,
    OpeningHoursManager,
  };

  for (const key of Object.keys(originals)) {
    const [targetName, method] = key.split(".");
    targets[targetName][method] = originals[key];
  }
}

describe("availability R2 — provider contract", () => {
  let originalGetMemberships;

  beforeEach(() => {
    originalGetMemberships = MembershipManager.getMembershipsByTenantAndRoles;
    MembershipManager.getMembershipsByTenantAndRoles = async () => [];
  });

  afterEach(() => {
    MembershipManager.getMembershipsByTenantAndRoles = originalGetMemberships;
  });

  it("returns the same availability for context and in-memory providers", async () => {
    const fixture = {
      bookable: scheduleBookable(),
      bookingsByBookableId: {
        "room-a": [booking("b1", "room-a", 2)],
      },
    };

    const result = await assertProvidersAgree(fixture, {
      timeBegin: TIME_BEGIN,
      timeEnd: TIME_END,
      amount: 2,
      user: "user-1",
    });

    assert.strictEqual(result.available, true);
  });

  it("returns the same denial when origin capacity is exceeded", async () => {
    const fixture = {
      bookable: scheduleBookable({ amount: 4 }),
      bookingsByBookableId: {
        "room-a": [booking("b1", "room-a", 3)],
      },
    };

    const result = await assertProvidersAgree(fixture, {
      timeBegin: TIME_BEGIN,
      timeEnd: TIME_END,
      amount: 2,
      user: "user-1",
    });

    assert.strictEqual(result.available, false);
    assert.strictEqual(result.reason, "availability");
  });

  it("returns the same denial for parent exclusive capacity", async () => {
    const fixture = {
      bookable: scheduleBookable({ id: "child-room", amount: 10 }),
      parentBookables: [
        {
          id: "parent-room",
          title: "Parent",
          amount: 1,
          isScheduleRelated: true,
        },
      ],
      bookingsByBookableId: {
        "child-room": [],
        "parent-room": [booking("b1", "parent-room", 1)],
      },
    };

    const result = await assertProvidersAgree(fixture, {
      timeBegin: TIME_BEGIN,
      timeEnd: TIME_END,
      amount: 1,
      user: "user-1",
    });

    assert.strictEqual(result.available, false);
    assert.strictEqual(result.reason, "parent-availability");
  });
});

describe("availability R2 — checkout parity", () => {
  let originalGetMemberships;

  beforeEach(() => {
    originalGetMemberships = MembershipManager.getMembershipsByTenantAndRoles;
    MembershipManager.getMembershipsByTenantAndRoles = async () => [];
  });

  afterEach(() => {
    MembershipManager.getMembershipsByTenantAndRoles = originalGetMemberships;
  });

  it("matches checkout for an available schedule-related booking", async () => {
    const fixture = {
      bookable: scheduleBookable(),
      bookingsByBookableId: {
        "room-a": [booking("b1", "room-a", 1)],
      },
    };

    const params = {
      timeBegin: TIME_BEGIN,
      timeEnd: TIME_END,
      amount: 2,
      user: "user-1",
    };

    const [orchestratorResult, checkoutResult] = await Promise.all([
      checkWindowAvailability(buildInMemoryProvider(fixture), params),
      isCheckoutAvailable(fixture, params),
    ]);

    assert.strictEqual(orchestratorResult.available, checkoutResult);
    assert.strictEqual(orchestratorResult.available, true);
  });

  it("matches checkout when child capacity blocks the booking", async () => {
    const fixture = {
      bookable: scheduleBookable({ id: "parent-room", amount: 20 }),
      relatedBookables: [
        {
          id: "child-room",
          title: "Child",
          amount: 3,
          isScheduleRelated: true,
        },
      ],
      bookingsByBookableId: {
        "parent-room": [],
        "child-room": [booking("b1", "child-room", 2)],
      },
    };

    const params = {
      timeBegin: TIME_BEGIN,
      timeEnd: TIME_END,
      amount: 2,
      user: "user-1",
    };

    const [orchestratorResult, checkoutResult] = await Promise.all([
      checkWindowAvailability(buildInMemoryProvider(fixture), params),
      isCheckoutAvailable(fixture, params),
    ]);

    assert.strictEqual(orchestratorResult.available, checkoutResult);
    assert.strictEqual(orchestratorResult.available, false);
    assert.strictEqual(orchestratorResult.reason, "child-bookings");
  });

  it("matches checkout for ticket parent capacity with child bookings", async () => {
    const fixture = {
      bookable: {
        id: "ticket-a",
        tenantId: TENANT_ID,
        title: "Ticket A",
        type: "ticket",
        isBookable: true,
        isScheduleRelated: true,
        amount: 1,
        permittedUsers: [],
        permittedRoles: [],
      },
      parentBookables: [
        {
          id: "event-parent",
          title: "Event Parent",
          amount: 4,
          isScheduleRelated: true,
        },
      ],
      relatedBookables: [
        { id: "ticket-a", title: "Ticket A", isScheduleRelated: true },
        { id: "ticket-b", title: "Ticket B", isScheduleRelated: true },
      ],
      relatedBookablesByParentId: {
        "event-parent": [
          { id: "ticket-a", title: "Ticket A", isScheduleRelated: true },
          { id: "ticket-b", title: "Ticket B", isScheduleRelated: true },
        ],
      },
      bookingsByBookableId: {
        "event-parent": [booking("b1", "event-parent", 2)],
        "ticket-b": [booking("b2", "ticket-b", 2)],
        "ticket-a": [],
      },
    };

    const params = {
      timeBegin: TIME_BEGIN,
      timeEnd: TIME_END,
      amount: 1,
      user: "user-1",
    };

    const [orchestratorResult, checkoutResult] = await Promise.all([
      checkWindowAvailability(buildInMemoryProvider(fixture), params),
      isCheckoutAvailable(fixture, params),
    ]);

    assert.strictEqual(orchestratorResult.available, checkoutResult);
    assert.strictEqual(orchestratorResult.available, false);
    assert.strictEqual(orchestratorResult.reason, "parent-availability");
  });

  it("matches checkout when booking duration is too short", async () => {
    const fixture = {
      bookable: scheduleBookable({
        minBookingDuration: 2,
      }),
      bookingsByBookableId: {
        "room-a": [],
      },
    };

    const params = {
      timeBegin: TIME_BEGIN,
      timeEnd: TIME_BEGIN + 60 * 60 * 1000,
      amount: 1,
      user: "user-1",
    };

    const [orchestratorResult, checkoutResult] = await Promise.all([
      checkWindowAvailability(buildInMemoryProvider(fixture), params),
      isCheckoutAvailable(fixture, params),
    ]);

    assert.strictEqual(orchestratorResult.available, checkoutResult);
    assert.strictEqual(orchestratorResult.available, false);
    assert.strictEqual(orchestratorResult.reason, "booking-duration");
  });

  it("matches checkout when max booking advance is exceeded", async () => {
    const fixture = {
      bookable: scheduleBookable(),
      bookingsByBookableId: {
        "room-a": [],
      },
      tenant: {
        maxBookingAdvanceInMonths: 1,
      },
    };

    const farFuture = new Date();
    farFuture.setMonth(farFuture.getMonth() + 6);

    const params = {
      timeBegin: farFuture.getTime(),
      timeEnd: farFuture.getTime() + 60 * 60 * 1000,
      amount: 1,
      user: "user-1",
    };

    const [orchestratorResult, checkoutResult] = await Promise.all([
      checkWindowAvailability(buildInMemoryProvider(fixture), params),
      isCheckoutAvailable(fixture, params),
    ]);

    assert.strictEqual(orchestratorResult.available, checkoutResult);
    assert.strictEqual(orchestratorResult.available, false);
    assert.strictEqual(orchestratorResult.reason, "max-booking-date");
  });
});
