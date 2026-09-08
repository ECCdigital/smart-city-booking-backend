const assert = require("assert");
const sinon = require("sinon");
const {
  BookingController,
} = require("../src/platform/api/controllers/booking-controller");
const BookingManager = require("../src/commons/data-managers/booking-manager");
const {
  BookableManager,
} = require("../src/commons/data-managers/bookable-manager");
const WorkflowService = require("../src/commons/services/workflow/workflow-service");

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

describe("Phase 1 booking performance", () => {
  afterEach(() => {
    sinon.restore();
  });

  describe("WorkflowService.getWorkflowStatusMap", () => {
    it("maps booking ids to workflow states and archive", async () => {
      const statusMap = WorkflowService.buildWorkflowStatusMap({
        active: true,
        states: [
          {
            id: "open",
            tasks: [{ id: "booking-1" }, { id: "booking-2" }],
          },
        ],
        archive: [{ id: "booking-3" }],
      });

      assert.strictEqual(
        WorkflowService.resolveWorkflowStatus(statusMap, "booking-1"),
        "open",
      );
      assert.strictEqual(
        WorkflowService.resolveWorkflowStatus(statusMap, "booking-3"),
        "archive",
      );
      assert.strictEqual(
        WorkflowService.resolveWorkflowStatus(statusMap, "missing"),
        null,
      );
    });
  });

  describe("BookingController.getBookings", () => {
    it("populates only allowed bookings and batches workflow/bookable loads", async () => {
      const bookings = [
        {
          id: "booking-allowed",
          tenantId: "tenant-1",
          bookableItems: [{ bookableId: "bookable-1" }],
        },
        {
          id: "booking-denied",
          tenantId: "tenant-1",
          bookableItems: [{ bookableId: "bookable-2" }],
        },
      ];

      // The reach is the manager's query condition: under `own` the store
      // answers the user's own booking only (authorize spec §4.1).
      const getTenantBookings = sinon
        .stub(BookingManager, "getTenantBookings")
        .callsFake(async (tenantId, scope) =>
          scope?.reach === "own" ? [bookings[0]] : bookings,
        );

      const getBookablesStub = sinon
        .stub(BookableManager, "getBookablesByIdsWithCustomFields")
        .resolves([{ id: "bookable-1", title: "Room A" }]);
      const getWorkflowMapStub = sinon
        .stub(WorkflowService, "getWorkflowStatusMap")
        .resolves(new Map([["booking-allowed", "open"]]));

      const response = createMockResponse();
      await BookingController.getBookings(
        {
          params: { tenant: "tenant-1" },
          query: { populate: "true" },
          user: { id: "user-1" },
          reach: "own",
          principal: { userId: "user-1" },
        },
        response,
      );

      assert.deepStrictEqual(getTenantBookings.firstCall.args, [
        "tenant-1",
        { reach: "own", userId: "user-1" },
      ]);
      assert.strictEqual(response.statusCode, 200);
      assert.strictEqual(response.body.length, 1);
      assert.strictEqual(response.body[0].id, "booking-allowed");
      assert.strictEqual(response.body[0]._populated.bookable.id, "bookable-1");
      assert.strictEqual(response.body[0]._populated.workflowStatus, "open");
      assert.strictEqual(getBookablesStub.callCount, 1);
      assert.deepStrictEqual(getBookablesStub.firstCall.args[1], [
        "bookable-1",
      ]);
      assert.strictEqual(getWorkflowMapStub.callCount, 1);
    });
  });
});
