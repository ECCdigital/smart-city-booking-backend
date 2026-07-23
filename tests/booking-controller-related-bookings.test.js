const assert = require("assert");
const sinon = require("sinon");
const {
  BookingController,
} = require("../src/platform/api/controllers/booking-controller");
const {
  BookableManager,
} = require("../src/commons/data-managers/bookable-manager");
const BookingManager = require("../src/commons/data-managers/booking-manager");

function createMockResponse() {
  return {
    statusCode: null,
    body: null,
    status(code) {
      this.statusCode = code;
      return this;
    },
    send(payload) {
      this.body = payload;
      return this;
    },
    sendStatus(code) {
      this.statusCode = code;
      return this;
    },
  };
}

describe("BookingController.getRelatedBookings", () => {
  afterEach(() => {
    sinon.restore();
  });

  it("includes bookings from all ancestors when ?parent=true", async () => {
    sinon
      .stub(BookingManager, "getRelatedBookings")
      .callsFake(async (_tenant, id) => {
        if (id === "child-1") {
          return [
            {
              id: "booking-child",
              tenantId: "tenant-1",
              bookableId: "child-1",
            },
          ];
        }
        if (id === "parent-1") {
          return [
            {
              id: "booking-parent",
              tenantId: "tenant-1",
              bookableId: "parent-1",
            },
          ];
        }
        if (id === "grandparent-1") {
          return [
            {
              id: "booking-grandparent",
              tenantId: "tenant-1",
              bookableId: "grandparent-1",
            },
          ];
        }
        return [];
      });
    sinon
      .stub(BookableManager, "getAncestorBookables")
      .resolves([{ id: "parent-1" }, { id: "grandparent-1" }]);

    const response = createMockResponse();
    await BookingController.getRelatedBookings(
      {
        params: { tenant: "tenant-1", id: "child-1" },
        query: { parent: "true", public: "true" },
      },
      response,
    );

    assert.strictEqual(response.statusCode, 200);
    assert.deepStrictEqual(response.body.map((booking) => booking.id).sort(), [
      "booking-child",
      "booking-grandparent",
      "booking-parent",
    ]);
  });
});
