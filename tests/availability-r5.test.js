const assert = require("assert");
const sinon = require("sinon");
const CalendarController = require("../src/platform/api/controllers/calendar-controller");
const CalendarServiceV2 = require("../src/commons/services/calendar-service-v2");
const CalendarService = require("../src/commons/services/calendar-service");

function createMockResponse() {
  const headers = new Map();
  return {
    headers,
    statusCode: null,
    body: null,
    set(name, value) {
      headers.set(name, value);
    },
    status(code) {
      this.statusCode = code;
      return this;
    },
    send(body) {
      this.body = body;
      return this;
    },
  };
}

describe("availability R5 — API rollout", () => {
  afterEach(() => {
    sinon.restore();
  });

  it("serves V2 on the primary /availability route", async () => {
    sinon.stub(CalendarServiceV2, "checkAvailability").resolves({
      title: "Room A",
      availability: [{ timeBegin: 1, timeEnd: 2, available: true }],
    });

    const response = createMockResponse();
    await CalendarController.getBookableAvailability(
      {
        params: { tenant: "tenant-1", id: "room-a" },
        query: { amount: 1 },
        user: null,
      },
      response,
    );

    assert.strictEqual(response.statusCode, 200);
    assert.strictEqual(response.headers.get("X-Availability-Engine"), "v2");
    assert.strictEqual(CalendarServiceV2.checkAvailability.calledOnce, true);
  });

  it("keeps /availability/v2 as an alias for the primary route", async () => {
    sinon.stub(CalendarServiceV2, "checkAvailability").resolves({
      title: "Room A",
      availability: [],
    });

    const response = createMockResponse();
    await CalendarController.getBookableAvailabilityV2(
      {
        params: { tenant: "tenant-1", id: "room-a" },
        query: {},
        user: null,
      },
      response,
    );

    assert.strictEqual(response.statusCode, 200);
    assert.strictEqual(response.headers.get("X-Availability-Engine"), "v2");
  });

  it("marks /availability/v1 as deprecated and still uses CalendarService", async () => {
    sinon.stub(CalendarService, "checkAvailability").resolves({
      title: "Room A",
      availability: [],
    });

    const response = createMockResponse();
    await CalendarController.getBookableAvailabilityV1(
      {
        params: { tenant: "tenant-1", id: "room-a" },
        query: {},
        user: null,
        originalUrl: "/api/tenant-1/bookables/room-a/availability/v1",
      },
      response,
    );

    assert.strictEqual(response.statusCode, 200);
    assert.strictEqual(response.headers.get("Deprecation"), "true");
    assert.strictEqual(
      response.headers.get("X-Availability-Engine"),
      "v1-legacy",
    );
    assert.ok(response.headers.get("Link")?.includes("/availability"));
    assert.strictEqual(CalendarService.checkAvailability.calledOnce, true);
  });
});
