/**
 * The acceptance matrix of the tenant supervision (spec §5.1, §12): every
 * row of the decision table, for a bookable and for an event, over list,
 * detail, prices, availability and every entrance of a new self-booking -
 * checkout v1, checkout v2 and the group checkout.
 *
 * The rows below are the spec table, written down as literals; nothing here
 * is computed by the gate. The matrices of `bookable-review-routes` and
 * `event-review-routes` walk the many further read paths per offer type;
 * this one is the consolidated acceptance walk and adds the checkout
 * entrances they leave out per row (v1 and group), and the cutover
 * scenarios around a block.
 */

const { expect } = require("chai");
const sinon = require("sinon");

const {
  installHarness,
  bookable,
  checkoutBody,
  TENANT,
  ADMIN,
  OWNER,
  ROLE_HOLDER,
  CUSTOMER,
  TIME_BEGIN,
  TIME_END,
  DAY,
} = require("./helpers/booking-lifecycle-harness");
const { installRouteWorld } = require("./helpers/route-world");
const EventManager = require("../src/commons/data-managers/event-manager");
const { Event } = require("../src/commons/entities/event/event");

const ANY_STATUS = [null, "pending", "approved", "rejected"];
const ANY_WISH = [false, true];

/**
 * Spec §5.1, row by row:
 * | level | review status | publication wish | list | direct link + new self-booking |
 */
const SPEC_ROWS = [
  {
    level: "free",
    statuses: ANY_STATUS,
    wishes: [false],
    listed: false,
    reachable: true,
  },
  {
    level: "free",
    statuses: ANY_STATUS,
    wishes: [true],
    listed: true,
    reachable: true,
  },
  {
    level: "supervised",
    statuses: ["approved"],
    wishes: [false],
    listed: false,
    reachable: true,
  },
  {
    level: "supervised",
    statuses: ["approved"],
    wishes: [true],
    listed: true,
    reachable: true,
  },
  {
    level: "supervised",
    statuses: [null, "pending", "rejected"],
    wishes: ANY_WISH,
    listed: false,
    reachable: false,
  },
  {
    level: "blocked",
    statuses: ANY_STATUS,
    wishes: ANY_WISH,
    listed: false,
    reachable: false,
  },
];

const CASES = SPEC_ROWS.flatMap(
  ({ level, statuses, wishes, listed, reachable }) =>
    statuses.flatMap((status) =>
      wishes.map((isPublic) => ({
        level,
        status,
        isPublic,
        listed,
        reachable,
      })),
    ),
);

const review = (status) => ({
  status,
  submittedAt: null,
  decidedAt: null,
  decidedBy: null,
  reason: null,
});

const ROOM_ID = "acceptance-room";
const ROOM_NAME = "Abnahmeraum";
const EVENT_ID = "E1";
const EVENT_NAME = "Abnahmekonzert";

describe("supervision: the acceptance matrix (§5.1) for both offer types", function () {
  this.timeout(60000);

  let h;
  let events;
  let ticketBefore;

  before(async function () {
    h = await installHarness({
      bookables: {
        [ROOM_ID]: bookable({
          id: ROOM_ID,
          title: ROOM_NAME,
          ownerUserId: ROLE_HOLDER,
        }),
      },
    });
    installRouteWorld({
      tenantId: TENANT,
      tenant: h.tenant,
      ownerUserId: ROLE_HOLDER,
      bookables: h.bookables,
    });
    for (const [name, impl] of [
      ["getEvent", async (id) => events[id] ?? null],
      ["getEvents", async () => Object.values(events)],
    ]) {
      EventManager[name].restore();
      sinon.stub(EventManager, name).callsFake(impl);
    }
  });

  after(async function () {
    sinon.restore();
    await h.close();
  });

  beforeEach(function () {
    ticketBefore = {
      isPublic: h.bookables.ticket.isPublic,
      review: h.bookables.ticket.review,
    };
    // The ticket itself is approved and listed: the event decides.
    h.bookables.ticket.isPublic = true;
    h.bookables.ticket.review = review("approved");
    h.bookables[ROOM_ID].isPublic = true;
    h.bookables[ROOM_ID].review = review("approved");
    events = {
      [EVENT_ID]: new Event({
        id: EVENT_ID,
        tenantId: TENANT,
        ownerUserId: ROLE_HOLDER,
        isPublic: true,
        review: review("approved"),
        information: {
          name: EVENT_NAME,
          startDate: "2027-06-21",
          startTime: "19:00",
          endDate: "2027-06-21",
          endTime: "22:00",
          tags: [],
          flags: [],
        },
        eventLocation: { name: "Stadthalle" },
        eventOrganizer: { contactPersonEmailAddress: "orga@example.test" },
      }),
    };
  });

  afterEach(function () {
    h.tenant.supervisionLevel = "free";
    Object.assign(h.bookables.ticket, ticketBefore);
    h.store.clear();
    h.takeEffects();
  });

  const call = (method, path, userId, body) => {
    let req = h.api()[method](path).timeout({ response: 5000 });
    if (userId) req = req.set(h.as(userId));
    if (body) req = req.send(body);
    return req;
  };

  const groupBody = (bookableId, slots) => ({
    bookableItems: [{ bookableId, amount: 1 }],
    bookingAttempts: slots,
    name: "Erika Muster",
    mail: CUSTOMER,
    paymentProvider: "giroCockpit",
  });

  const OFFER_TYPES = [
    {
      type: "bookable",
      name: ROOM_NAME,
      arrange: ({ status, isPublic }) => {
        h.bookables[ROOM_ID].review = review(status);
        h.bookables[ROOM_ID].isPublic = isPublic;
      },
      list: `/api/${TENANT}/bookables/public`,
      detail: `/api/${TENANT}/bookables/public/${ROOM_ID}`,
      prices: `/api/${TENANT}/bookables/${ROOM_ID}/prices`,
      availability: `/api/${TENANT}/bookables/${ROOM_ID}/availability`,
      single: () => checkoutBody(ROOM_ID),
      group: () =>
        groupBody(ROOM_ID, [
          { timeBegin: TIME_BEGIN + DAY, timeEnd: TIME_END + DAY },
          { timeBegin: TIME_BEGIN + 2 * DAY, timeEnd: TIME_END + 2 * DAY },
        ]),
    },
    {
      type: "event",
      name: EVENT_NAME,
      arrange: ({ status, isPublic }) => {
        events[EVENT_ID].review = review(status);
        events[EVENT_ID].isPublic = isPublic;
      },
      list: `/api/${TENANT}/events`,
      detail: `/api/${TENANT}/events/${EVENT_ID}`,
      // Booking an event is booking its ticket.
      prices: `/api/${TENANT}/bookables/ticket/prices`,
      availability: `/api/${TENANT}/bookables/ticket/availability`,
      single: () => checkoutBody("ticket", { timeBegin: null, timeEnd: null }),
      group: () =>
        groupBody("ticket", [
          { timeBegin: null, timeEnd: null },
          { timeBegin: null, timeEnd: null },
        ]),
    },
  ];

  for (const offer of OFFER_TYPES) {
    describe(`a ${offer.type}`, function () {
      for (const row of CASES) {
        const { level, status, isPublic, listed, reachable } = row;

        it(`${level} / ${status ?? "no status"} / wish ${isPublic ? "on" : "off"}: list ${listed ? "yes" : "no"}, link and booking ${reachable ? "yes" : "no"}`, async function () {
          h.tenant.supervisionLevel = level;
          offer.arrange(row);

          // Signing in as a customer opens nothing.
          for (const userId of [null, CUSTOMER]) {
            const list = await call("get", offer.list, userId);
            expect(
              list.status === 200 && list.text.includes(offer.name),
              `list -> ${list.status}`,
            ).to.equal(listed);

            for (const surface of ["detail", "prices", "availability"]) {
              const res = await call("get", offer[surface], userId);
              expect(res.status, `${surface} as ${userId}`).to.equal(
                reachable ? 200 : 404,
              );
            }
          }

          const v1 = await call(
            "post",
            `/api/${TENANT}/checkout`,
            null,
            offer.single(),
          );
          expect(v1.status, "checkout v1").to.equal(reachable ? 200 : 409);

          const v2 = await call(
            "post",
            `/api/v2/${TENANT}/checkout`,
            CUSTOMER,
            offer.single(),
          );
          expect(v2.body.success, "checkout v2").to.equal(reachable);

          const bookedSingly = h.store.size;
          expect(bookedSingly, "stored single bookings").to.equal(
            reachable ? 2 : 0,
          );

          const group = await call(
            "post",
            `/api/v2/${TENANT}/checkout/group`,
            CUSTOMER,
            offer.group(),
          );
          expect(group.body.success, "group checkout").to.equal(reachable);
          expect(h.store.size - bookedSingly, "stored group slots").to.equal(
            reachable ? 2 : 0,
          );
        });
      }
    });
  }

  /**
   * The cutover scenarios of spec §12: what was delivered before a block or
   * a withdrawal opens nothing afterwards, and what exists stays usable.
   */
  const CLOSINGS = [
    {
      name: "the tenant is blocked",
      close: () => {
        h.tenant.supervisionLevel = "blocked";
      },
    },
    {
      name: "the approval is withdrawn",
      close: (offer) => offer.arrange({ status: "rejected", isPublic: true }),
    },
  ];

  for (const offer of OFFER_TYPES) {
    for (const closing of CLOSINGS) {
      it(`a ${offer.type}: a checkout form opened before ${closing.name} books nothing afterwards, the existing booking keeps its status route`, async function () {
        h.tenant.supervisionLevel = "supervised";
        const page = await call("get", offer.detail);
        expect(page.status).to.equal(200);
        const first = await call(
          "post",
          `/api/v2/${TENANT}/checkout`,
          CUSTOMER,
          offer.single(),
        );
        expect(first.body.success).to.equal(true);
        const [bookingId] = [...h.store.keys()];
        const existing = JSON.stringify([...h.store.entries()]);

        closing.close(offer);

        // The form that is still open sends what it would have sent before.
        const v1 = await call(
          "post",
          `/api/${TENANT}/checkout`,
          null,
          offer.single(),
        );
        expect(v1.status, "checkout v1").to.equal(409);
        for (const [path, body] of [
          [`/api/v2/${TENANT}/checkout`, offer.single()],
          [`/api/v2/${TENANT}/checkout/group`, offer.group()],
        ]) {
          const res = await call("post", path, CUSTOMER, body);
          expect(res.body.success, path).to.equal(false);
        }
        expect((await call("get", offer.detail)).status).to.equal(404);

        expect(JSON.stringify([...h.store.entries()])).to.equal(existing);
        const status = await call(
          "get",
          `/api/${TENANT}/bookings/${bookingId}/status`,
        );
        expect(status.status).to.equal(200);
      });
    }
  }

  it("keeps the management routes open to the owner of a blocked tenant", async function () {
    h.tenant.supervisionLevel = "blocked";

    for (const path of [
      `/api/tenants/${TENANT}`,
      `/api/${TENANT}/bookables`,
      `/api/${TENANT}/bookables/${ROOM_ID}`,
      `/api/${TENANT}/bookables/${ROOM_ID}/prices`,
      `/api/${TENANT}/events`,
      `/api/${TENANT}/events/${EVENT_ID}`,
      `/api/${TENANT}/bookings`,
    ]) {
      for (const userId of [OWNER, ADMIN]) {
        const res = await call("get", path, userId);
        expect(res.status, `${path} as ${userId}`).to.equal(200);
      }
    }
    // Preparing goes on: the owner still edits an offer of the blocked tenant.
    const edit = await call("put", `/api/${TENANT}/bookables`, OWNER, {
      ...h.bookables[ROOM_ID],
      title: `${ROOM_NAME} (neu)`,
    });
    expect(edit.status).to.equal(201);
    h.bookables[ROOM_ID].title = ROOM_NAME;
  });
});
