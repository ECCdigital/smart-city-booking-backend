/**
 * The controllers of the tenant router on the reach (authorize spec §4.3,
 * ticket 2): a handler hands `req.reach` and the principal's user to its
 * manager and never branches over rights itself. What is left to the
 * adapter: the creation over the obsolete PUT (§5, §11), the anonymized
 * projection of the booking lists, and the 404 of a record outside the
 * reach that the manager did not find.
 */

const { expect } = require("chai");
const sinon = require("sinon");

const BookableController = require("../src/platform/api/controllers/bookable-controller");
const {
  BookingController,
} = require("../src/platform/api/controllers/booking-controller");
const {
  GroupBookingController,
} = require("../src/platform/api/controllers/group-booking-controller");
const EventController = require("../src/platform/api/controllers/event-controller");
const RoleController = require("../src/platform/api/controllers/role-controller");
const {
  TenantController,
} = require("../src/platform/api/controllers/tenant-controller");
const {
  BookableManager,
} = require("../src/commons/data-managers/bookable-manager");
const BookingManager = require("../src/commons/data-managers/booking-manager");
const GroupBookingManager = require("../src/commons/data-managers/group-booking-manager");
const MembershipManager = require("../src/commons/data-managers/membership-manager");
const { RoleManager } = require("../src/commons/data-managers/role-manager");
const ChallengeManager = require("../src/commons/data-managers/challenge-manager");
const BookingService = require("../src/commons/services/checkout/booking-service");
const WorkflowService = require("../src/commons/services/workflow/workflow-service");
const { ForbiddenError } = require("../src/errors/BaseError");
const { Role } = require("../src/commons/entities/role/role");

function response() {
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
    json(payload) {
      this.body = payload;
      return this;
    },
    sendStatus(code) {
      this.statusCode = code;
      return this;
    },
    setHeader() {},
  };
}

/** A request of the tenant `t1` with the reach and the principal given. */
function request({ reach, principal, params = {}, query = {}, body = {} }) {
  return {
    params: { tenant: "t1", ...params },
    query,
    body,
    reach,
    principal,
    user: principal?.userId ? { id: principal.userId } : null,
  };
}

const customer = { userId: "erika", isTenantOwner: false, grants: {} };
const owner = { userId: "owner", isTenantOwner: true, grants: {} };
const updater = {
  userId: "updater",
  isTenantOwner: false,
  grants: { manageBookables: { updateAny: true } },
};
const anonymous = { userId: null, isTenantOwner: false, grants: {} };

describe("tenant controllers on the reach", function () {
  afterEach(function () {
    sinon.restore();
  });

  describe("the obsolete PUT: the creation is the adapter's second decision", function () {
    it("refuses a creation to a principal who may update but not create", async function () {
      const store = sinon.stub(BookableManager, "storeBookable").resolves();
      const next = sinon.stub();
      await BookableController.createBookable(
        request({ reach: "any", principal: updater, body: { title: "Raum" } }),
        response(),
        next,
      );
      expect(next.firstCall.args[0]).to.be.instanceOf(ForbiddenError);
      expect(store.called).to.equal(false);
    });

    it("lets the tenant owner create", async function () {
      sinon.stub(BookableManager, "checkPublicBookableCount").resolves(true);
      const store = sinon.stub(BookableManager, "storeBookable").resolves();
      const res = response();
      await BookableController.createBookable(
        request({ reach: "any", principal: owner, body: { title: "Raum" } }),
        res,
        sinon.stub(),
      );
      expect(res.statusCode).to.equal(201);
      expect(store.calledOnce).to.equal(true);
    });
  });

  describe("a single record outside the reach", function () {
    it("answers 404 for a booking the manager does not find under own", async function () {
      const getBooking = sinon
        .stub(BookingManager, "getBooking")
        .resolves(null);
      const res = response();
      await BookingController.getBooking(
        request({ reach: "own", principal: customer, params: { id: "b1" } }),
        res,
      );
      expect(res.statusCode).to.equal(404);
      expect(res.body.code).to.equal("booking_not_found");
      expect(getBooking.firstCall.args).to.deep.equal([
        "b1",
        "t1",
        { reach: "own", userId: "erika" },
      ]);
    });

    it("answers 404 for a bookable the manager does not find under own", async function () {
      sinon.stub(BookableManager, "getBookable").resolves(null);
      const remove = sinon.stub(BookableManager, "removeBookable").resolves();
      const res = response();
      await BookableController.removeBookable(
        request({ reach: "own", principal: customer, params: { id: "r1" } }),
        res,
      );
      expect(res.statusCode).to.equal(404);
      expect(remove.called).to.equal(false);
    });

    it("answers 404 for a group the manager does not find under own", async function () {
      const load = sinon
        .stub(GroupBookingManager, "getGroupBooking")
        .resolves(null);
      const res = response();
      await GroupBookingController.getGroupBooking(
        request({ reach: "own", principal: customer, params: { id: "g1" } }),
        res,
      );
      expect(res.statusCode).to.equal(404);
      expect(res.body.code).to.equal("group_booking_not_found");
      expect(load.firstCall.args).to.deep.equal([
        "t1",
        "g1",
        false,
        { reach: "own", userId: "erika" },
      ]);
    });
  });

  describe("the lists", function () {
    it("hands the reach to the manager", async function () {
      const list = sinon
        .stub(GroupBookingManager, "getGroupBookings")
        .resolves([]);
      await GroupBookingController.getGroupBookings(
        request({ reach: "own", principal: customer }),
        response(),
      );
      expect(list.firstCall.args).to.deep.equal([
        "t1",
        { reach: "own", userId: "erika" },
      ]);
    });

    it("GET /bookings: the anonymized projection for anyone with the flag", async function () {
      sinon
        .stub(BookingManager, "getTenantBookings")
        .resolves([{ id: "b1", tenantId: "t1", name: "Erika", timeBegin: 1 }]);
      const res = response();
      await BookingController.getBookings(
        request({
          reach: "public",
          principal: anonymous,
          query: { public: "true" },
        }),
        res,
        sinon.stub(),
      );
      expect(res.statusCode).to.equal(200);
      expect(res.body[0]).to.not.have.property("name");
      expect(res.body[0].id).to.equal("b1");
    });

    it("GET /bookings: refuses the public without the flag", async function () {
      const list = sinon.stub(BookingManager, "getTenantBookings").resolves([]);
      const next = sinon.stub();
      await BookingController.getBookings(
        request({ reach: "public", principal: anonymous }),
        response(),
        next,
      );
      expect(next.firstCall.args[0]).to.be.instanceOf(ForbiddenError);
      expect(list.called).to.equal(false);
    });

    it("GET /events/:id/bookings: nothing for the public, the reach's for the rest", async function () {
      const list = sinon.stub(BookingManager, "getEventBookings").resolves([]);
      const res = response();
      await BookingController.getEventBookings(
        request({
          reach: "public",
          principal: anonymous,
          params: { id: "e1" },
        }),
        res,
      );
      expect(res.body).to.deep.equal([]);
      expect(list.called).to.equal(false);

      await BookingController.getEventBookings(
        request({ reach: "own", principal: customer, params: { id: "e1" } }),
        response(),
      );
      expect(list.firstCall.args).to.deep.equal([
        "t1",
        "e1",
        { reach: "own", userId: "erika" },
      ]);
    });

    it("GET /bookables/:id/bookings: the reach's bookings without the flag", async function () {
      const related = sinon
        .stub(BookingManager, "getRelatedBookings")
        .resolves([{ id: "b1", tenantId: "t1", name: "Erika" }]);
      const res = response();
      await BookingController.getRelatedBookings(
        request({ reach: "own", principal: customer, params: { id: "r1" } }),
        res,
        sinon.stub(),
      );
      expect(res.statusCode).to.equal(200);
      expect(res.body[0].name).to.equal("Erika");
      expect(related.firstCall.args).to.deep.equal([
        "t1",
        "r1",
        { reach: "own", userId: "erika" },
      ]);
    });
  });

  describe("the named actions", function () {
    it("counts the own seats only under own", async function () {
      const count = sinon
        .stub(BookingService, "getBookedSeatsCount")
        .resolves(3);
      const res = response();
      await EventController.getBookedSeatsCount(
        request({ reach: "own", principal: customer, params: { id: "e1" } }),
        res,
      );
      expect(res.body).to.deep.equal({ bookedSeats: 3 });
      expect(count.firstCall.args).to.deep.equal([
        "t1",
        "e1",
        { onlyOwn: true, userId: "erika" },
      ]);

      await EventController.getBookedSeatsCount(
        request({ reach: "any", principal: owner, params: { id: "e1" } }),
        response(),
      );
      expect(count.secondCall.args[2]).to.deep.equal({});
    });

    it("GET /roles/tenant answers the user's own roles (§7.4)", async function () {
      sinon
        .stub(MembershipManager, "getMembershipByTenantAndUserID")
        .resolves({ roles: ["r1"] });
      sinon
        .stub(RoleManager, "getRole")
        .resolves(new Role({ id: "r1", name: "Kasse", tenantId: "t1" }));
      const res = response();
      await RoleController.getUserRolesByTenant(
        request({ reach: "own", principal: customer }),
        res,
      );
      expect(res.statusCode).to.equal(200);
      expect(res.body.map((role) => role.id)).to.deep.equal(["r1"]);
    });

    it("POST /challenges creates the challenge in the tenant of the route (§11)", async function () {
      const create = sinon
        .stub(ChallengeManager, "createChallenge")
        .callsFake(async (tenantId, body) => ({ ...body, tenantId }));
      const res = response();
      await TenantController.createChallenge(
        request({ reach: "any", principal: owner, body: { key: "frage" } }),
        res,
      );
      expect(res.statusCode).to.equal(201);
      expect(create.firstCall.args[0]).to.equal("t1");
      expect(res.body.tenantId).to.equal("t1");
    });

    it("GET /bookings/:ids/status answers the status without the dead loop (§11)", async function () {
      sinon.stub(BookingManager, "getBookingStatus").resolves([{ id: "b1" }]);
      const service = sinon.stub(BookingService, "getBookingStatus");
      const res = response();
      await BookingController.getBookingStatus(
        request({
          reach: "public",
          principal: anonymous,
          params: { ids: "b1,b2" },
        }),
        res,
      );
      expect(res.statusCode).to.equal(200);
      expect(service.called).to.equal(false);
    });
  });

  it("populates a booking it found under own", async function () {
    sinon
      .stub(BookingManager, "getBooking")
      .resolves({ id: "b1", tenantId: "t1", bookableItems: [] });
    sinon
      .stub(BookableManager, "getBookablesByIdsWithCustomFields")
      .resolves([]);
    sinon.stub(WorkflowService, "getWorkflowStatusMap").resolves(new Map());
    const res = response();
    await BookingController.getBooking(
      request({ reach: "own", principal: customer, params: { id: "b1" } }),
      res,
    );
    expect(res.statusCode).to.equal(200);
    expect(res.body._populated).to.have.property("workflowStatus");
  });
});
