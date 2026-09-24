/**
 * The booking-bound customer routes (tenant supervision spec §5.2, §6.1,
 * ticket 18): a customer with a booking has a contract with the tenant, so
 * `GET /api/bookings/assigned`, the booking status v1 and v2 and
 * `GET /api/access/bookings` carry a tenant snapshot - name and the
 * support/emergency contact - whatever the supervision level, and the core
 * data of the event of a ticket booking. The storefront renders its booking
 * pages from these answers and never from the public tenant or catalog
 * projection, which a non-public tenant does not have.
 */

const { expect } = require("chai");
const sinon = require("sinon");

const BookingStatusControllerV2 = require("../src/platform/api/v2/controllers/booking-status.controller");
const {
  BookingController,
} = require("../src/platform/api/controllers/booking-controller");
const BookingManager = require("../src/commons/data-managers/booking-manager");
const TenantManager = require("../src/commons/data-managers/tenant-manager");
const EventManager = require("../src/commons/data-managers/event-manager");
const { Booking } = require("../src/commons/entities/booking/booking");
const Tenant = require("../src/commons/entities/tenant/tenant");
const { Event } = require("../src/commons/entities/event/event");
const {
  SUPERVISION_LEVELS,
} = require("../src/commons/services/supervision/supervision-constants");

const TENANT = "tenant-1";

const CUSTOMER_SERVICE = {
  name: "Stadtwerke Hotline",
  phone: "+49 123 456",
  email: "hilfe@stadt.de",
};

/** The snapshot every route answers for the fixture tenant. */
const TENANT_SNAPSHOT = {
  id: TENANT,
  name: "Stadt Musterhausen",
  contactName: "Erika Amt",
  mail: "amt@stadt.de",
  phone: "+49 555 1",
  accessApps: [{ id: "ifbs", customerService: CUSTOMER_SERVICE }],
};

/** The core data every route answers for the event of the ticket. */
const EVENT_SNAPSHOT = {
  id: "E1",
  title: "Sommerkonzert",
  timeBegin: new Date("2027-06-21T19:00").getTime(),
  timeEnd: new Date("2027-06-21T22:00").getTime(),
};

/** A tenant at the non-public level, with everything the snapshot leaves out. */
function tenant(overrides = {}) {
  return new Tenant({
    id: TENANT,
    name: "Stadt Musterhausen",
    contactName: "Erika Amt",
    mail: "amt@stadt.de",
    phone: "+49 555 1",
    website: "https://stadt.example",
    location: "Musterhausen",
    supervisionLevel: SUPERVISION_LEVELS.BLOCKED,
    supervisionChangedAt: new Date("2026-09-01"),
    applications: [
      {
        type: "access",
        id: "ifbs",
        active: true,
        apiKey: { iv: "iv", data: "secret" },
        customerService: CUSTOMER_SERVICE,
      },
      { type: "payment", id: "invoice", active: true },
    ],
    ...overrides,
  });
}

function event() {
  return new Event({
    id: "E1",
    tenantId: TENANT,
    information: {
      name: "Sommerkonzert",
      description: "A long description that stays home",
      startDate: "2027-06-21",
      startTime: "19:00",
      endDate: "2027-06-21",
      endTime: "22:00",
    },
  });
}

function roomBooking(overrides = {}) {
  return new Booking({
    id: "B-1",
    tenantId: TENANT,
    assignedUserId: "erika",
    mail: "erika@example.test",
    priceEur: 40,
    status: "confirmed",
    timeBegin: 1000,
    timeEnd: 2000,
    bookableItems: [
      {
        bookableId: "room",
        amount: 1,
        _bookableUsed: { id: "room", type: "room", title: "Raum" },
      },
    ],
    ...overrides,
  });
}

function ticketBooking(overrides = {}) {
  return roomBooking({
    id: "B-2",
    bookableItems: [
      {
        bookableId: "ticket",
        amount: 2,
        _bookableUsed: {
          id: "ticket",
          type: "ticket",
          title: "Ticket",
          eventId: "E1",
        },
      },
    ],
    ...overrides,
  });
}

/** The world behind the managers: the tenants and events that exist. */
function installWorld({ tenants = [tenant()], events = [event()] } = {}) {
  const tenantsByIds = sinon
    .stub(TenantManager, "getTenantsByIds")
    .callsFake(async (ids) => tenants.filter((t) => ids.includes(t.id)));
  const eventsByIds = sinon
    .stub(EventManager, "getEventsByIds")
    .callsFake(async (refs) =>
      events.filter((e) =>
        refs.some((r) => r.tenantId === e.tenantId && r.id === e.id),
      ),
    );
  return { tenantsByIds, eventsByIds };
}

/** A response as the v1 controllers write it. */
function v1Response() {
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

describe("booking-bound customer routes: tenant snapshot and event core data", function () {
  afterEach(function () {
    sinon.restore();
  });

  describe("GET /api/:tenant/bookings/:ids/status (v1)", function () {
    async function statusOf(ids, stored) {
      sinon.stub(BookingManager, "getBookings").resolves(stored);
      const response = v1Response();
      await BookingController.getBookingStatus(
        { params: { tenant: TENANT, ids } },
        response,
      );
      expect(response.statusCode).to.equal(200);
      return response.body;
    }

    it("carries the tenant snapshot and the event core data next to the status", async function () {
      installWorld();

      const [ticket, room] = await statusOf("B-2,B-1", [
        ticketBooking(),
        roomBooking(),
      ]);

      expect(ticket).to.deep.equal({
        ...ticketBooking().exportStatus(),
        tenant: TENANT_SNAPSHOT,
        event: EVENT_SNAPSHOT,
      });
      expect(room.tenant).to.deep.equal(TENANT_SNAPSHOT);
      expect(room).to.not.have.property("event");
    });

    it("names nothing of the supervision in the snapshot", async function () {
      installWorld();

      const [item] = await statusOf("B-1", [roomBooking()]);

      expect(Object.keys(item.tenant)).to.deep.equal([
        "id",
        "name",
        "contactName",
        "mail",
        "phone",
        "accessApps",
      ]);
      expect(JSON.stringify(item)).to.not.include("supervision");
    });

    it("answers tenant: null for a booking of a deleted tenant", async function () {
      installWorld({ tenants: [] });

      const [item] = await statusOf("B-1", [roomBooking()]);

      expect(item.tenant).to.equal(null);
    });
  });

  describe("GET /api/v2/:tenant/bookings/:ids/status", function () {
    async function statusOf(ids, stored) {
      sinon.stub(BookingManager, "getBookings").resolves(stored);
      const response = {
        status: sinon.stub().returnsThis(),
        json: sinon.stub().returnsThis(),
      };
      await BookingStatusControllerV2.getBookingStatus(
        { params: { tenant: TENANT, ids } },
        response,
      );
      expect(response.status.firstCall.args).to.deep.equal([200]);
      return response.json.firstCall.args[0].data.bookings;
    }

    it("carries the tenant snapshot of a non-public tenant next to the status", async function () {
      installWorld();

      const [item] = await statusOf("B-1", [roomBooking()]);

      expect(item.status).to.equal("confirmed");
      expect(item.tenant).to.deep.equal(TENANT_SNAPSHOT);
    });

    it("carries the event core data of a ticket booking, and no event on a room booking", async function () {
      installWorld();

      const [ticket, room] = await statusOf("B-2,B-1", [
        ticketBooking(),
        roomBooking(),
      ]);

      expect(ticket.event).to.deep.equal(EVENT_SNAPSHOT);
      expect(Object.keys(ticket.event)).to.deep.equal([
        "id",
        "title",
        "timeBegin",
        "timeEnd",
      ]);
      expect(room).to.not.have.property("event");
    });

    it("answers tenant: null for a booking of a deleted tenant", async function () {
      installWorld({ tenants: [] });

      const [item] = await statusOf("B-1", [roomBooking()]);

      expect(item.success).to.equal(true);
      expect(item.tenant).to.equal(null);
    });

    it("answers event: null for a ticket booking whose event is gone", async function () {
      installWorld({ events: [] });

      const [item] = await statusOf("B-2", [ticketBooking()]);

      expect(item.event).to.equal(null);
    });

    it("loads the tenants once for the whole answer, not per booking", async function () {
      const { tenantsByIds } = installWorld();

      await statusOf("B-1,B-2", [roomBooking(), ticketBooking()]);

      expect(tenantsByIds.callCount).to.equal(1);
      expect(tenantsByIds.firstCall.args[0]).to.deep.equal([TENANT]);
    });
  });
});
