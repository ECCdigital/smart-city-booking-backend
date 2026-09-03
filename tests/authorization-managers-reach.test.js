/**
 * The managers translate the reach into their query condition (authorize
 * spec §4.1): `own` is `ownerUserId` at bookables, events and coupons and
 * `assignedUserId` at bookings and group bookings; lists filter in the
 * query, a single read under `own` loads with the condition and answers
 * null where nothing is found. A caller without a reach reads as before.
 */

const { expect } = require("chai");
const sinon = require("sinon");

const {
  BookableManager,
} = require("../src/commons/data-managers/bookable-manager");
const BookableModel = require("../src/commons/data-managers/models/bookableModel");
const EventManager = require("../src/commons/data-managers/event-manager");
const EventModel = require("../src/commons/data-managers/models/eventModel");
const CouponManager = require("../src/commons/data-managers/coupon-manager");
const CouponModel = require("../src/commons/data-managers/models/couponModel");
const BookingManager = require("../src/commons/data-managers/booking-manager");
const BookingModel = require("../src/commons/data-managers/models/bookingModel");
const GroupBookingManager = require("../src/commons/data-managers/group-booking-manager");
const GroupBookingModel = require("../src/commons/data-managers/models/groupBookingModel");

const OWN = { reach: "own", userId: "u1" };
const ANY = { reach: "any", userId: "u1" };

/** A mongoose query that answers `value` on `exec()` and passes `populate`. */
function query(value) {
  return { populate: () => query(value), exec: async () => value };
}

describe("authorization: the managers' own condition", function () {
  afterEach(function () {
    sinon.restore();
  });

  describe("BookableManager (ownerUserId)", function () {
    beforeEach(function () {
      sinon.stub(BookableManager, "getCustomFieldDefinitions").resolves({});
    });

    it("filters the list under own and not under any", async function () {
      const find = sinon.stub(BookableModel, "find").resolves([]);
      await BookableManager.getBookables("t1", OWN);
      await BookableManager.getBookables("t1", ANY);
      await BookableManager.getBookables("t1");
      expect(find.args.map(([filter]) => filter)).to.deep.equal([
        { tenantId: "t1", ownerUserId: "u1" },
        { tenantId: "t1" },
        { tenantId: "t1" },
      ]);
    });

    it("loads a single bookable with the condition under own", async function () {
      const findOne = sinon.stub(BookableModel, "findOne").resolves(null);
      expect(await BookableManager.getBookable("b1", "t1", OWN)).to.equal(null);
      expect(findOne.firstCall.args[0]).to.deep.equal({
        id: "b1",
        tenantId: "t1",
        ownerUserId: "u1",
      });
      await BookableManager.getBookable("b1", "t1");
      expect(findOne.secondCall.args[0]).to.deep.equal({
        id: "b1",
        tenantId: "t1",
      });
    });
  });

  describe("EventManager (ownerUserId)", function () {
    it("filters the list and the single read under own", async function () {
      const find = sinon.stub(EventModel, "find").resolves([]);
      const findOne = sinon.stub(EventModel, "findOne").resolves(null);
      await EventManager.getEvents("t1", OWN);
      await EventManager.getEvents("t1");
      await EventManager.getEvent("e1", "t1", OWN);
      expect(find.firstCall.args[0]).to.deep.equal({
        tenantId: "t1",
        ownerUserId: "u1",
      });
      expect(find.secondCall.args[0]).to.deep.equal({ tenantId: "t1" });
      expect(findOne.firstCall.args[0]).to.deep.equal({
        id: "e1",
        tenantId: "t1",
        ownerUserId: "u1",
      });
    });
  });

  describe("CouponManager (ownerUserId)", function () {
    it("filters the list and the single read under own", async function () {
      const find = sinon.stub(CouponModel, "find").resolves([]);
      const findOne = sinon.stub(CouponModel, "findOne").resolves(null);
      await CouponManager.getCoupons("t1", OWN);
      await CouponManager.getCoupon("c1", "t1", OWN);
      await CouponManager.getCoupon("c1", "t1");
      expect(find.firstCall.args[0]).to.deep.equal({
        tenantId: "t1",
        ownerUserId: "u1",
      });
      expect(findOne.firstCall.args[0]).to.deep.equal({
        id: "c1",
        tenantId: "t1",
        ownerUserId: "u1",
      });
      expect(findOne.secondCall.args[0]).to.deep.equal({
        id: "c1",
        tenantId: "t1",
      });
    });
  });

  describe("BookingManager (assignedUserId)", function () {
    it("filters the tenant list, the related and the event bookings under own", async function () {
      const find = sinon.stub(BookingModel, "find").resolves([]);
      sinon
        .stub(BookableModel, "find")
        .resolves([{ id: "ticket-1" }, { id: "ticket-2" }]);
      await BookingManager.getTenantBookings("t1", OWN);
      await BookingManager.getRelatedBookings("t1", "b1", OWN);
      await BookingManager.getEventBookings("t1", "e1", OWN);
      await BookingManager.getTenantBookings("t1");
      expect(find.args.map(([filter]) => filter)).to.deep.equal([
        { tenantId: "t1", assignedUserId: "u1" },
        {
          tenantId: "t1",
          "bookableItems.bookableId": "b1",
          assignedUserId: "u1",
        },
        {
          tenantId: "t1",
          "bookableItems.bookableId": { $in: ["ticket-1", "ticket-2"] },
          assignedUserId: "u1",
        },
        { tenantId: "t1" },
      ]);
    });

    it("loads a single booking with the condition under own", async function () {
      const findOne = sinon.stub(BookingModel, "findOne").resolves(null);
      expect(await BookingManager.getBooking("b1", "t1", OWN)).to.equal(null);
      expect(findOne.firstCall.args[0]).to.deep.equal({
        id: "b1",
        tenantId: "t1",
        assignedUserId: "u1",
      });
      await BookingManager.getBooking("b1", "t1");
      expect(findOne.secondCall.args[0]).to.deep.equal({
        id: "b1",
        tenantId: "t1",
      });
    });
  });

  describe("GroupBookingManager (assignedUserId)", function () {
    it("filters the list and both single reads under own", async function () {
      const find = sinon.stub(GroupBookingModel, "find").resolves([]);
      const findOne = sinon
        .stub(GroupBookingModel, "findOne")
        .returns(query(null));
      await GroupBookingManager.getGroupBookings("t1", OWN);
      await GroupBookingManager.getGroupBooking("t1", "g1");
      expect(
        await GroupBookingManager.getGroupBooking("t1", "g1", true, OWN),
      ).to.equal(null);
      expect(
        await GroupBookingManager.getGroupBookingByBookingId(
          "t1",
          "b1",
          false,
          OWN,
        ),
      ).to.equal(null);
      expect(find.firstCall.args[0]).to.deep.equal({
        tenantId: "t1",
        assignedUserId: "u1",
      });
      expect(findOne.secondCall.args[0]).to.deep.equal({
        tenantId: "t1",
        id: "g1",
        assignedUserId: "u1",
      });
      expect(findOne.thirdCall.args[0]).to.deep.equal({
        tenantId: "t1",
        bookingIds: "b1",
        assignedUserId: "u1",
      });
    });
  });
});
