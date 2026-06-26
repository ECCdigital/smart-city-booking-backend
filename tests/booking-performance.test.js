const assert = require("assert");
const sinon = require("sinon");
const { BookingController } = require("../src/platform/api/controllers/booking-controller");
const BookingManager = require("../src/commons/data-managers/booking-manager");
const {
  BookableManager,
} = require("../src/commons/data-managers/bookable-manager");
const PermissionsService = require("../src/commons/services/permission-service");
const WorkflowService = require("../src/commons/services/workflow/workflow-service");
const InstanceManager = require("../src/commons/data-managers/instance-manager");
const MembershipManager = require("../src/commons/data-managers/membership-manager");
const UserManager = require("../src/commons/data-managers/user-manager");

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

  describe("PermissionsService.createReadContext", () => {
    it("allows readOwn only for owned bookings", async () => {
      sinon.stub(InstanceManager, "getInstance").resolves({
        ownerUserIds: [],
      });
      sinon.stub(MembershipManager, "getMembershipByTenantAndUserID").resolves({
        owner: false,
      });
      sinon.stub(UserManager, "getUserPermissions").resolves({
        tenants: [
          {
            tenantId: "tenant-1",
            isOwner: false,
            manageBookings: { readOwn: true, readAny: false },
          },
        ],
      });

      const context = await PermissionsService.createReadContext(
        "user-1",
        "tenant-1",
        "manageBookings",
      );

      assert.strictEqual(
        PermissionsService.allowReadWithContext(
          { tenantId: "tenant-1", assignedUserId: "user-1" },
          context,
        ),
        true,
      );
      assert.strictEqual(
        PermissionsService.allowReadWithContext(
          { tenantId: "tenant-1", assignedUserId: "other-user" },
          context,
        ),
        false,
      );
    });

    it("short-circuits all bookings for tenant owners", async () => {
      sinon.stub(InstanceManager, "getInstance").resolves({
        ownerUserIds: [],
      });
      sinon.stub(MembershipManager, "getMembershipByTenantAndUserID").resolves({
        owner: true,
      });
      sinon.stub(UserManager, "getUserPermissions").resolves({ tenants: [] });

      const context = await PermissionsService.createReadContext(
        "user-1",
        "tenant-1",
        "manageBookings",
      );

      assert.strictEqual(PermissionsService.canReadAllWithContext(context), true);
    });
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

      sinon.stub(BookingManager, "getTenantBookings").resolves(bookings);
      sinon.stub(PermissionsService, "createReadContext").resolves({
        userId: "user-1",
        tenantId: "tenant-1",
        isInstanceOwner: false,
        isTenantOwner: false,
        hasReadAny: false,
        hasReadOwn: true,
      });
      sinon
        .stub(PermissionsService, "canReadAllWithContext")
        .returns(false);
      sinon
        .stub(PermissionsService, "allowReadWithContext")
        .callsFake((booking) => booking.id === "booking-allowed");

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
        },
        response,
      );

      assert.strictEqual(response.statusCode, 200);
      assert.strictEqual(response.body.length, 1);
      assert.strictEqual(response.body[0].id, "booking-allowed");
      assert.strictEqual(response.body[0]._populated.bookable.id, "bookable-1");
      assert.strictEqual(response.body[0]._populated.workflowStatus, "open");
      assert.strictEqual(getBookablesStub.callCount, 1);
      assert.deepStrictEqual(getBookablesStub.firstCall.args[1], ["bookable-1"]);
      assert.strictEqual(getWorkflowMapStub.callCount, 1);
    });
  });
});
