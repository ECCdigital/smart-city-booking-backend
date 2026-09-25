/**
 * The managers translate the reach into their query condition (ADR
 * 0002): each names its resource, the owner key is the table's - `own` is
 * `ownerUserId` at bookables, events and coupons, `assignedUserId` at
 * bookings and group bookings, `uploadedBy` at media, and the tenant set
 * of the scope at tenants. Lists filter in the query, a single read
 * under `own` loads with the condition and answers null where nothing is
 * found. A caller without a reach is refused: the domain says `DOMAIN`.
 * Under `public` the managers of the offers read the tenant's records
 * whole and hand them to the public projection (ADR 0003): a list
 * method to `listed`, a method that names an id to `reached`; the tenant
 * manager filters by the public levels. No manager reads everything
 * under `public` without projecting it.
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
const TenantManager = require("../src/commons/data-managers/tenant-manager");
const TenantModel = require("../src/commons/data-managers/models/tenantModel");
const MediaManager = require("../src/commons/data-managers/media-manager");
const MediaModel = require("../src/commons/data-managers/models/mediaModel");
const MembershipManager = require("../src/commons/data-managers/membership-manager");
const {
  DOMAIN,
  PUBLIC,
} = require("../src/commons/services/authorization/reach");
const projection = require("../src/commons/services/supervision/public-projection");

const OWN = { reach: "own", userId: "u1" };
const ANY = { reach: "any", userId: "u1" };

/** A mongoose query that answers `value` on `exec()` and passes `populate`. */
function query(value) {
  return { populate: () => query(value), exec: async () => value };
}

/** The reads that take a scope, with the arguments in front of it. */
const READS = [
  ["BookableManager.getBookables", () => BookableManager.getBookables("t1")],
  [
    "BookableManager.getBookable",
    () => BookableManager.getBookable("b1", "t1"),
  ],
  ["EventManager.getEvents", () => EventManager.getEvents("t1")],
  ["EventManager.getEvent", () => EventManager.getEvent("e1", "t1")],
  ["CouponManager.getCoupons", () => CouponManager.getCoupons("t1")],
  ["CouponManager.getCoupon", () => CouponManager.getCoupon("c1", "t1")],
  [
    "BookingManager.getTenantBookings",
    () => BookingManager.getTenantBookings("t1"),
  ],
  [
    "BookingManager.getBookings",
    () => BookingManager.getBookings("t1", ["b1"]),
  ],
  [
    "BookingManager.getRelatedBookings",
    () => BookingManager.getRelatedBookings("t1", "b1"),
  ],
  [
    "BookingManager.getRelatedBookingsBatch",
    () => BookingManager.getRelatedBookingsBatch("t1", ["b1"]),
  ],
  ["BookingManager.getBooking", () => BookingManager.getBooking("b1", "t1")],
  [
    "BookingManager.getEventBookings",
    () => BookingManager.getEventBookings("t1", "e1"),
  ],
  [
    "GroupBookingManager.getGroupBookings",
    () => GroupBookingManager.getGroupBookings("t1"),
  ],
  [
    "GroupBookingManager.getGroupBooking",
    () => GroupBookingManager.getGroupBooking("t1", "g1", false),
  ],
  [
    "GroupBookingManager.getGroupBookingByBookingId",
    () => GroupBookingManager.getGroupBookingByBookingId("t1", "b1", false),
  ],
  ["TenantManager.getTenants", () => TenantManager.getTenants()],
  ["TenantManager.countTenants", () => TenantManager.countTenants()],
  ["MediaManager.getMedia", () => MediaManager.getMedia("m1", "t1")],
];

describe("authorization: the managers' own condition", function () {
  afterEach(function () {
    sinon.restore();
  });

  describe("a read without a reach is refused, at every method", function () {
    beforeEach(function () {
      sinon.stub(BookableManager, "getCustomFieldDefinitions").resolves({});
      for (const [Model, method] of [
        [BookableModel, "find"],
        [BookableModel, "findOne"],
        [EventModel, "find"],
        [EventModel, "findOne"],
        [CouponModel, "find"],
        [CouponModel, "findOne"],
        [BookingModel, "find"],
        [BookingModel, "findOne"],
        [GroupBookingModel, "find"],
        [TenantModel, "find"],
        [TenantModel, "countDocuments"],
        [MediaModel, "findOne"],
      ]) {
        sinon.stub(Model, method).resolves([]);
      }
      sinon.stub(GroupBookingModel, "findOne").returns(query(null));
    });

    for (const [name, read] of READS) {
      it(name, async function () {
        let error = null;
        try {
          await read();
        } catch (err) {
          error = err;
        }
        expect(error?.message, name).to.match(/without a reach/);
      });
    }
  });

  describe("BookableManager (ownerUserId)", function () {
    beforeEach(function () {
      sinon.stub(BookableManager, "getCustomFieldDefinitions").resolves({});
    });

    it("filters the list under own, and not under any or for the domain", async function () {
      const find = sinon.stub(BookableModel, "find").resolves([]);
      await BookableManager.getBookables("t1", OWN);
      await BookableManager.getBookables("t1", ANY);
      await BookableManager.getBookables("t1", DOMAIN);
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
      await BookableManager.getBookable("b1", "t1", DOMAIN);
      expect(findOne.secondCall.args[0]).to.deep.equal({
        id: "b1",
        tenantId: "t1",
      });
    });

    it("populates the event and the related bookables as the domain, when asked", async function () {
      sinon.stub(BookableModel, "findOne").resolves({
        toEntity: () => ({ id: "b1", tenantId: "t1", eventId: "e1" }),
      });
      const event = sinon.stub(EventManager, "getEvent").resolves({ id: "e1" });
      const related = sinon
        .stub(BookableManager, "getRelatedBookables")
        .resolves([{ id: "b2" }]);
      sinon
        .stub(BookableManager, "_toEntityWithCustomFields")
        .callsFake((raw) => raw?.toEntity() ?? null);

      const plain = await BookableManager.getBookable("b1", "t1", OWN);
      expect(plain._populated).to.equal(undefined);

      const populated = await BookableManager.getBookable("b1", "t1", OWN, {
        populate: true,
      });
      expect(populated._populated).to.deep.equal({
        event: { id: "e1" },
        relatedBookables: [{ id: "b2" }],
      });
      expect(event.firstCall.args).to.deep.equal(["e1", "t1", DOMAIN]);
      expect(related.firstCall.args).to.deep.equal(["b1", "t1", DOMAIN]);
    });
  });

  describe("the public projection of the offers under public (ADR 0003)", function () {
    let listed;
    let reached;

    beforeEach(function () {
      sinon.stub(BookableManager, "getCustomFieldDefinitions").resolves({});
      sinon
        .stub(BookableManager, "_toEntitiesWithCustomFields")
        .callsFake((docs) => docs.map((doc) => doc.toEntity()));
      sinon
        .stub(BookableManager, "_toEntityWithCustomFields")
        .callsFake((doc) => doc?.toEntity() ?? null);
      // The projection answers what it was given, tagged: the test asks
      // which question the manager put, not what the rules say.
      listed = sinon
        .stub(projection, "listed")
        .callsFake(async (tenantId, offers) => [{ listed: tenantId, offers }]);
      reached = sinon
        .stub(projection, "reached")
        .callsFake(async (tenantId, offers) => [{ reached: tenantId, offers }]);
    });

    const doc = (id) => ({ toEntity: () => ({ id }) });

    /** The list methods: read the tenant's records whole, then `listed`. */
    const LISTS = [
      [
        "BookableManager.getBookables",
        () => BookableManager.getBookables("t1", PUBLIC),
        BookableModel,
        "find",
        { tenantId: "t1" },
      ],
      [
        "BookableManager.getBookablesByType",
        () => BookableManager.getBookablesByType("t1", "room", PUBLIC),
        BookableModel,
        "find",
        { tenantId: "t1", type: "room" },
      ],
      [
        "BookableManager.getEventBookables",
        () => BookableManager.getEventBookables("t1", "e1", PUBLIC),
        BookableModel,
        "find",
        { tenantId: "t1", eventId: "e1" },
      ],
      [
        "BookableManager.getParentBookables",
        () => BookableManager.getParentBookables("b1", "t1", PUBLIC),
        BookableModel,
        "find",
        { tenantId: "t1", relatedBookableIds: { $in: ["b1"] } },
      ],
      [
        "EventManager.getEvents",
        () => EventManager.getEvents("t1", PUBLIC),
        EventModel,
        "find",
        { tenantId: "t1" },
      ],
    ];

    for (const [name, read, Model, method, filter] of LISTS) {
      it(`${name} lists through the projection`, async function () {
        const find = sinon.stub(Model, method).resolves([doc("x")]);
        expect(await read()).to.deep.equal([
          { listed: "t1", offers: [{ id: "x" }] },
        ]);
        expect(find.firstCall.args[0]).to.deep.equal(filter);
        expect(reached.called).to.equal(false);
      });
    }

    for (const [name, read] of [
      [
        "BookableManager.getRelatedBookables",
        () => BookableManager.getRelatedBookables("b1", "t1", PUBLIC),
      ],
      [
        "BookableManager.getAncestorBookables",
        () => BookableManager.getAncestorBookables("b1", "t1", PUBLIC),
      ],
    ]) {
      it(`${name} lists through the projection, the graph unrestricted`, async function () {
        sinon.stub(BookableModel, "aggregate").returns({
          exec: async () => [{ reached: [{ id: "x" }] }],
        });
        sinon.stub(BookableModel, "hydrate").callsFake((obj) => doc(obj.id));
        expect(await read()).to.deep.equal([
          { listed: "t1", offers: [{ id: "x" }] },
        ]);
        const [, { $graphLookup }] = BookableModel.aggregate.firstCall.args[0];
        expect($graphLookup.restrictSearchWithMatch).to.deep.equal({
          tenantId: "t1",
        });
      });
    }

    /** The methods that name an id: read whole, then `reached`. */
    it("BookableManager.getBookable reaches through the projection, null where it does not", async function () {
      const findOne = sinon.stub(BookableModel, "findOne").resolves(doc("b1"));
      expect(
        await BookableManager.getBookable("b1", "t1", PUBLIC),
      ).to.deep.equal({ reached: "t1", offers: [{ id: "b1" }] });
      expect(findOne.firstCall.args[0]).to.deep.equal({
        id: "b1",
        tenantId: "t1",
      });
      reached.resolves([]);
      expect(await BookableManager.getBookable("b1", "t1", PUBLIC)).to.equal(
        null,
      );
      expect(listed.called).to.equal(false);
    });

    it("BookableManager.getBookablesByIds reaches through the projection", async function () {
      const find = sinon.stub(BookableModel, "find").resolves([doc("b1")]);
      expect(
        await BookableManager.getBookablesByIds("t1", ["b1"], PUBLIC),
      ).to.deep.equal([{ reached: "t1", offers: [{ id: "b1" }] }]);
      expect(find.firstCall.args[0]).to.deep.equal({
        tenantId: "t1",
        id: { $in: ["b1"] },
      });
    });

    it("EventManager.getEvent and getEventsByIds reach through the projection", async function () {
      sinon.stub(EventModel, "findOne").resolves(doc("e1"));
      const find = sinon.stub(EventModel, "find").resolves([doc("e1")]);
      expect(await EventManager.getEvent("e1", "t1", PUBLIC)).to.deep.equal({
        reached: "t1",
        offers: [{ id: "e1" }],
      });
      expect(
        await EventManager.getEventsByIds(
          [{ tenantId: "t1", id: "e1" }],
          PUBLIC,
        ),
      ).to.deep.equal([{ reached: "t1", offers: [{ id: "e1" }] }]);
      expect(find.firstCall.args[0]).to.deep.equal({
        tenantId: "t1",
        id: { $in: ["e1"] },
      });
      expect(listed.called).to.equal(false);
    });

    it("EventManager.getEventsByIds leaves out a tenant without a public projection", async function () {
      sinon.stub(EventModel, "find").resolves([doc("e1")]);
      const { NotFoundError } = require("../src/errors/BaseError");
      reached.rejects(
        new NotFoundError("tenant_not_found", { tenantId: "t1" }),
      );
      expect(
        await EventManager.getEventsByIds(
          [{ tenantId: "t1", id: "e1" }],
          PUBLIC,
        ),
      ).to.deep.equal([]);
    });

    it("TenantManager lists and counts the tenants at a public level", async function () {
      const find = sinon.stub(TenantModel, "find").resolves([]);
      const count = sinon.stub(TenantModel, "countDocuments").resolves(0);
      await TenantManager.getTenants(PUBLIC);
      await TenantManager.countTenants(PUBLIC);
      const condition = {
        supervisionLevel: { $in: ["free", "supervised", null] },
      };
      expect(find.firstCall.args[0]).to.deep.equal(condition);
      expect(count.firstCall.args[0]).to.deep.equal(condition);
      expect(listed.called).to.equal(false);
    });

    it("the managers of bookings, coupons, media and group bookings read whole: the handler projects", async function () {
      const reads = [
        [
          BookingModel,
          "find",
          () => BookingManager.getTenantBookings("t1", PUBLIC),
          { tenantId: "t1" },
        ],
        [
          CouponModel,
          "findOne",
          () => CouponManager.getCoupon("c1", "t1", PUBLIC),
          { id: "c1", tenantId: "t1" },
        ],
        [
          MediaModel,
          "findOne",
          () => MediaManager.getMedia("m1", "t1", PUBLIC),
          { id: "m1", tenantId: "t1" },
        ],
        [
          GroupBookingModel,
          "find",
          () => GroupBookingManager.getGroupBookings("t1", PUBLIC),
          { tenantId: "t1" },
        ],
      ];
      for (const [Model, method, read, filter] of reads) {
        const stub = sinon
          .stub(Model, method)
          .resolves(method === "find" ? [] : null);
        await read();
        expect(
          stub.firstCall.args[0],
          `${Model.modelName}.${method}`,
        ).to.deep.equal(filter);
      }
      expect(listed.called).to.equal(false);
      expect(reached.called).to.equal(false);
    });
  });

  describe("EventManager (ownerUserId)", function () {
    it("filters the list and the single read under own", async function () {
      const find = sinon.stub(EventModel, "find").resolves([]);
      const findOne = sinon.stub(EventModel, "findOne").resolves(null);
      await EventManager.getEvents("t1", OWN);
      await EventManager.getEvents("t1", DOMAIN);
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
      await CouponManager.getCoupon("c1", "t1", DOMAIN);
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
      await BookingManager.getTenantBookings("t1", DOMAIN);
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
      await BookingManager.getBooking("b1", "t1", DOMAIN);
      expect(findOne.secondCall.args[0]).to.deep.equal({
        id: "b1",
        tenantId: "t1",
      });
    });

    it("counts the seats of an event whole: the reach is the event's, not the tickets'", async function () {
      const aggregate = sinon
        .stub(BookingModel, "aggregate")
        .resolves([{ totalSeats: 7 }]);
      expect(await BookingManager.getBookedSeatsCount("t1", "e1")).to.equal(7);
      const [match, , secondMatch] = aggregate.firstCall.args[0];
      expect(match.$match).to.deep.equal({
        tenantId: "t1",
        isRejected: false,
        "bookableItems._bookableUsed.eventId": "e1",
      });
      expect(secondMatch.$match).to.deep.equal({
        "bookableItems._bookableUsed.eventId": "e1",
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
      await GroupBookingManager.getGroupBooking("t1", "g1", false, DOMAIN);
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
      expect(findOne.firstCall.args[0]).to.deep.equal({
        tenantId: "t1",
        id: "g1",
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

  describe("MediaManager (uploadedBy)", function () {
    it("loads a single medium with the condition under own", async function () {
      const findOne = sinon.stub(MediaModel, "findOne").resolves(null);
      expect(await MediaManager.getMedia("m1", "t1", OWN)).to.equal(null);
      expect(findOne.firstCall.args[0]).to.deep.equal({
        id: "m1",
        tenantId: "t1",
        uploadedBy: "u1",
      });
      await MediaManager.getMedia("m1", null, DOMAIN);
      expect(findOne.secondCall.args[0]).to.deep.equal({
        id: "m1",
        tenantId: null,
      });
    });
  });

  describe("TenantManager (the tenant set of the scope)", function () {
    it("lists the tenants of the set under own, all under any and for the domain, and never asks for memberships", async function () {
      const find = sinon.stub(TenantModel, "find").resolves([]);
      const memberships = sinon.stub(
        MembershipManager,
        "getMembershipsByUserID",
      );
      await TenantManager.getTenants({ ...OWN, tenantIds: ["t1", "t2"] });
      await TenantManager.getTenants(ANY);
      await TenantManager.getTenants(DOMAIN);
      expect(find.args.map(([filter]) => filter)).to.deep.equal([
        { id: { $in: ["t1", "t2"] } },
        {},
        {},
      ]);
      expect(memberships.called).to.equal(false);
    });

    it("refuses own without the tenant set", async function () {
      sinon.stub(TenantModel, "find").resolves([]);
      let error = null;
      try {
        await TenantManager.getTenants(OWN);
      } catch (err) {
        error = err;
      }
      expect(error?.message).to.match(/without the tenant set/);
    });

    it("counts under the same condition, with the supervision level", async function () {
      const count = sinon.stub(TenantModel, "countDocuments").resolves(0);
      await TenantManager.countTenants(
        { ...OWN, tenantIds: ["t1"] },
        { supervisionLevel: "pending" },
      );
      await TenantManager.countTenants(DOMAIN, { supervisionLevel: "free" });
      expect(count.args.map(([filter]) => filter)).to.deep.equal([
        { id: { $in: ["t1"] }, supervisionLevel: "pending" },
        { supervisionLevel: { $in: ["free", null] } },
      ]);
    });
  });
});
