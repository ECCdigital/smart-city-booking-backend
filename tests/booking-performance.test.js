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

  describe("BookingManager populate", () => {
    it("batches the bookable and workflow loads per tenant, as the domain", async () => {
      const bookings = [
        {
          id: "booking-1",
          tenantId: "tenant-1",
          bookableItems: [{ bookableId: "bookable-1" }],
        },
        {
          id: "booking-2",
          tenantId: "tenant-1",
          bookableItems: [{ bookableId: "bookable-1" }],
        },
        {
          id: "booking-3",
          tenantId: "tenant-2",
          bookableItems: [{ bookableId: "bookable-2" }],
        },
      ];

      const getBookablesStub = sinon
        .stub(BookableManager, "getBookablesByIdsWithCustomFields")
        .callsFake(async (tenantId, ids) =>
          ids.map((id) => ({ id, title: `${tenantId}/${id}` })),
        );
      const getWorkflowMapStub = sinon
        .stub(WorkflowService, "getWorkflowStatusMap")
        .resolves(new Map([["booking-1", "open"]]));

      await BookingManager._populate(bookings);

      assert.strictEqual(bookings[0]._populated.bookable.id, "bookable-1");
      assert.strictEqual(bookings[0]._populated.workflowStatus, "open");
      assert.strictEqual(bookings[1]._populated.workflowStatus, null);
      assert.strictEqual(
        bookings[2]._populated.bookable.title,
        "tenant-2/bookable-2",
      );
      assert.strictEqual(getBookablesStub.callCount, 2);
      assert.deepStrictEqual(getBookablesStub.firstCall.args.slice(0, 2), [
        "tenant-1",
        ["bookable-1"],
      ]);
      assert.strictEqual(getBookablesStub.firstCall.args[2].reach, "domain");
      assert.strictEqual(getWorkflowMapStub.callCount, 2);
    });
  });

  describe("BookingController.getBookings", () => {
    it("reads within the reach and asks the manager to populate on ?populate=true", async () => {
      const getTenantBookings = sinon
        .stub(BookingManager, "getTenantBookings")
        .resolves([{ id: "booking-allowed", tenantId: "tenant-1" }]);

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
        { populate: true },
      ]);
      assert.strictEqual(response.statusCode, 200);
      assert.strictEqual(response.body.length, 1);
      assert.strictEqual(response.body[0].id, "booking-allowed");
    });
  });
});
