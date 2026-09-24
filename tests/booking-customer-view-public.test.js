/**
 * The customer view of a booking (ticket 18) is for the booking-bound
 * customer routes alone: the public booking projections - the public status
 * page and the anonymized booking list - carry neither the tenant snapshot
 * nor the event core data, whatever the level of the tenant. End to end over
 * the lifecycle harness, so what is pinned is the answer on the wire.
 */

const { expect } = require("chai");
const sinon = require("sinon");

const {
  installHarness,
  TENANT,
  ADMIN,
  ROLE_HOLDER,
} = require("./helpers/booking-lifecycle-harness");
const { installRouteWorld } = require("./helpers/route-world");
const TenantManager = require("../src/commons/data-managers/tenant-manager");
const EventManager = require("../src/commons/data-managers/event-manager");
const Tenant = require("../src/commons/entities/tenant/tenant");
const { Event } = require("../src/commons/entities/event/event");
const {
  SUPERVISION_LEVELS,
} = require("../src/commons/services/supervision/supervision-constants");

describe("booking-bound customer view: not on the public projections", function () {
  this.timeout(30000);

  let h;
  let ticketBookingId;

  before(async function () {
    h = await installHarness({ tenant: { enablePublicStatusView: true } });
    installRouteWorld({
      tenantId: TENANT,
      tenant: h.tenant,
      ownerUserId: ROLE_HOLDER,
      bookables: h.bookables,
    });
    // The two loads of the customer view, answered from the harness world:
    // the tenant as it is at the moment of the request, the event of the
    // ticket as the harness knows it.
    TenantManager.getTenantsByIds.restore();
    sinon
      .stub(TenantManager, "getTenantsByIds")
      .callsFake(async (ids) =>
        ids.includes(TENANT) ? [new Tenant(h.tenant)] : [],
      );
    EventManager.getEventsByIds.restore();
    sinon.stub(EventManager, "getEventsByIds").callsFake(async (refs) =>
      refs.some((ref) => ref.tenantId === TENANT && ref.id === "E1")
        ? [
            new Event({
              id: "E1",
              tenantId: TENANT,
              information: {
                name: "Sommerkonzert",
                startDate: "2027-06-21",
                startTime: "19:00",
                endDate: "2027-06-21",
                endTime: "22:00",
              },
            }),
          ]
        : [],
    );
    ticketBookingId = (await h.manualBooking("ticket")).id;
  });

  after(async function () {
    sinon.restore();
    await h.close();
  });

  afterEach(function () {
    h.tenant.supervisionLevel = SUPERVISION_LEVELS.FREE;
  });

  it("the public status page of a ticket booking names neither the tenant nor the event", async function () {
    const res = await h
      .api()
      .get(
        `/api/${TENANT}/bookings/${ticketBookingId}/status/public?lastname=Erika%20Muster`,
      );

    expect(res.status).to.equal(200);
    expect(res.body.bookingId).to.equal(ticketBookingId);
    expect(res.body).to.not.have.property("tenant");
    expect(res.body).to.not.have.property("event");
  });

  it("the anonymized booking list carries no tenant snapshot, to the management either", async function () {
    const anonymous = await h.api().get(`/api/${TENANT}/bookings?public=true`);
    const management = await h
      .api()
      .get(`/api/${TENANT}/bookings?public=true`)
      .set(h.as(ADMIN));

    for (const res of [anonymous, management]) {
      expect(res.status).to.equal(200);
      expect(res.body.map((b) => b.id)).to.include(ticketBookingId);
      for (const item of res.body) {
        expect(item).to.not.have.property("tenant");
        expect(item).to.not.have.property("event");
      }
    }
  });

  it("the customer's own bookings carry the snapshot of a non-public tenant while the public projections stay bare", async function () {
    h.tenant.supervisionLevel = SUPERVISION_LEVELS.BLOCKED;

    const assigned = await h
      .api()
      .get(`/api/${TENANT}/bookings/${ticketBookingId}/status`);
    const publicStatus = await h
      .api()
      .get(
        `/api/${TENANT}/bookings/${ticketBookingId}/status/public?lastname=Erika%20Muster`,
      );

    expect(assigned.status).to.equal(200);
    expect(assigned.body[0].tenant).to.include({
      id: TENANT,
      name: "Stadt Musterhausen",
    });
    expect(assigned.body[0].event).to.include({
      id: "E1",
      title: "Sommerkonzert",
    });
    expect(JSON.stringify(assigned.body)).to.not.include("supervision");
    expect(publicStatus.status).to.equal(200);
    expect(publicStatus.body).to.not.have.property("tenant");
    expect(publicStatus.body).to.not.have.property("event");
  });
});
