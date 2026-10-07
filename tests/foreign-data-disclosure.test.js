/**
 * No answer gives away data of others (ECCdigital/tickets#260, findings 1,
 * 8, 9 and 10 of the release check 4.3 in ECCdigital/tickets#138):
 *
 *   - the public bookables carry neither the mail address of the member
 *     who created them (`ownerUserId`) nor the permitted persons
 *     (`permittedUsers`) nor the discounts per person (`bookingDiscounts`);
 *     the permitted roles and `requiresLogin` stay, so a client can offer
 *     the login;
 *   - a checkout refused for a taken bookable names no bookings of others;
 *   - the dashboard of a tenant owner counts the persons of their tenants
 *     only;
 *   - creating a person answers without the password hash.
 *
 * At the routes, over the lifecycle harness and the route world.
 */

const { expect } = require("chai");
const sinon = require("sinon");

const {
  installHarness,
  bookable,
  checkoutBody,
  TENANT,
  TENANT_B,
  ADMIN,
  OWNER,
  OWNER_B,
  ROLE_HOLDER,
  CUSTOMER,
  TIME_BEGIN,
  TIME_END,
  DAY,
} = require("./helpers/booking-lifecycle-harness");
const { installRouteWorld, FIXTURE_ID } = require("./helpers/route-world");
const {
  BookableManager,
} = require("../src/commons/data-managers/bookable-manager");
const EventManager = require("../src/commons/data-managers/event-manager");
const BookingManager = require("../src/commons/data-managers/booking-manager");
const DashboardManager = require("../src/commons/data-managers/dashboard-manager");
const UserModel = require("../src/commons/data-managers/models/userModel");
const MembershipModel = require("../src/commons/data-managers/models/membershipModel");
const {
  DashboardCache,
} = require("../src/commons/services/dashboard/dashboard-cache");
const { Event } = require("../src/commons/entities/event/event");
const { Booking } = require("../src/commons/entities/booking/booking");
const { User } = require("../src/commons/entities/user/user");
const UserManager = require("../src/commons/data-managers/user-manager");
const {
  CHECKOUT_REASONS,
} = require("../src/commons/services/checkout/checkout-reasons");

const CREATOR = "ersteller@example.test";
const PERMITTED = "berechtigt@example.test";
const DISCOUNTED = "rabatt@example.test";
const ROLE = "role-werkstatt";

/** A bookable that names persons wherever the schema lets it. */
function restricted(id, overrides = {}) {
  return bookable({
    id,
    title: `Werkstatt ${id}`,
    isPublic: true,
    ownerUserId: CREATOR,
    permittedUsers: [PERMITTED],
    permittedRoles: [ROLE],
    requiresLogin: true,
    bookingDiscounts: {
      users: [{ userId: DISCOUNTED, discountPercent: 50 }],
      roles: [{ roleId: ROLE, discountPercent: 10 }],
    },
    ...overrides,
  });
}

/** Every mail address of a person that the bookables above carry. */
const PERSONS = [CREATOR, PERMITTED, DISCOUNTED];

function expectNoPersonData(body, path) {
  const text = JSON.stringify(body);
  for (const field of ["ownerUserId", "permittedUsers", "bookingDiscounts"]) {
    expect(text, `${path} carries ${field}`).to.not.include(`"${field}"`);
  }
  for (const person of PERSONS) {
    expect(text, `${path} names ${person}`).to.not.include(person);
  }
}

describe("no foreign data in public answers (ECCdigital/tickets#260)", function () {
  this.timeout(30000);

  let h;

  before(async function () {
    h = await installHarness({
      bookables: {
        [FIXTURE_ID]: bookable({
          id: FIXTURE_ID,
          title: "Fixture",
          ownerUserId: ROLE_HOLDER,
        }),
        werkstatt: restricted("werkstatt", {
          eventId: "E-public",
          checkoutBookableIds: ["zubehoer"],
        }),
        zubehoer: restricted("zubehoer"),
      },
    });
    installRouteWorld({
      tenantId: TENANT,
      tenant: h.tenant,
      ownerUserId: ROLE_HOLDER,
      bookables: h.bookables,
      tenants: { [TENANT_B]: h.tenantB },
    });
  });

  after(async function () {
    sinon.restore();
    await h.close();
  });

  const call = (method, path, userId, body) => {
    let req = h.api()[method](path);
    if (userId) req = req.set(h.as(userId));
    return body ? req.send(body) : req;
  };

  describe("public bookables", function () {
    before(function () {
      // `?populate=true` embeds the event and the related bookables.
      BookableManager.getRelatedBookables.callsFake(async (id) =>
        id === "werkstatt" ? [h.bookables.zubehoer] : [],
      );
      EventManager.getEvent.callsFake(
        async (id, tenantId) =>
          new Event({
            id,
            tenantId,
            title: "Sommerfest",
            ownerUserId: CREATOR,
            isPublic: true,
          }),
      );
    });

    const PATHS = [
      `/api/${TENANT}/bookables/public`,
      `/api/${TENANT}/bookables/public?populate=true`,
      `/api/${TENANT}/bookables/public/werkstatt`,
      `/api/${TENANT}/bookables/public/werkstatt?populate=true`,
    ];

    it("name neither the creator nor the permitted nor the discounted persons, whoever asks", async function () {
      for (const path of PATHS) {
        // The anonymous, a signed-in customer and the staff with `any`,
        // whom the public routes hand the tenant's whole.
        for (const userId of [null, CUSTOMER, ROLE_HOLDER, OWNER, ADMIN]) {
          const res = await call("get", path, userId);
          expect(res.status, `${path} as ${userId}`).to.equal(200);
          expectNoPersonData(res.body, `${path} as ${userId}`);
        }
      }
    });

    it("keep the permitted roles and requiresLogin, so a client can offer the login", async function () {
      const one = await call(
        "get",
        `/api/${TENANT}/bookables/public/werkstatt`,
      );
      expect(one.body.permittedRoles).to.deep.equal([ROLE]);
      expect(one.body.requiresLogin).to.equal(true);
      expect(one.body.title).to.equal("Werkstatt werkstatt");

      const list = await call("get", `/api/${TENANT}/bookables/public`);
      const listed = list.body.find((b) => b.id === "werkstatt");
      expect(listed.permittedRoles).to.deep.equal([ROLE]);
      expect(listed.requiresLogin).to.equal(true);
    });

    it("keep them on the embedded related bookables", async function () {
      const res = await call(
        "get",
        `/api/${TENANT}/bookables/public/werkstatt?populate=true`,
      );
      const [related] = res.body._populated.relatedBookables;
      expect(related.id).to.equal("zubehoer");
      expect(related.permittedRoles).to.deep.equal([ROLE]);
      expect(related.requiresLogin).to.equal(true);
      expect(res.body._populated.event.title).to.equal("Sommerfest");
    });

    it("leave the management read of a bookable whole", async function () {
      const res = await call(
        "get",
        `/api/${TENANT}/bookables/werkstatt`,
        ROLE_HOLDER,
      );
      expect(res.status).to.equal(200);
      expect(res.body.ownerUserId).to.equal(CREATOR);
      expect(res.body.permittedUsers).to.deep.equal([PERMITTED]);
      expect(res.body.bookingDiscounts.users).to.have.length(1);
    });
  });

  describe("a checkout refused for a taken bookable", function () {
    /** A booking of somebody else that takes the whole room. */
    const FOREIGN = "fremde-buchung-4711";

    before(function () {
      BookingManager.getConcurrentBookings.callsFake(async (bookableId) =>
        bookableId === "room"
          ? [
              new Booking({
                id: FOREIGN,
                tenantId: TENANT,
                assignedUserId: "nachbar@example.test",
                mail: "nachbar@example.test",
                timeBegin: TIME_BEGIN - DAY,
                timeEnd: TIME_END + 2 * DAY,
                bookableItems: [{ bookableId: "room", amount: 10 }],
              }),
            ]
          : [],
      );
    });

    after(function () {
      BookingManager.getConcurrentBookings.resolves([]);
    });

    function expectNoForeignBooking(res, path) {
      const text = JSON.stringify(res.body);
      expect(text, path).to.include(CHECKOUT_REASONS.BOOKABLE_UNAVAILABLE);
      expect(text, path).to.not.include("concurrentBookings");
      expect(text, path).to.not.include(FOREIGN);
      expect(text, path).to.not.include("nachbar@example.test");
    }

    const v2 = `/api/v2/${TENANT}/checkout`;
    const groupBody = {
      bookableItems: [{ bookableId: "room", amount: 1 }],
      bookingAttempts: [
        { timeBegin: TIME_BEGIN, timeEnd: TIME_END },
        { timeBegin: TIME_BEGIN + DAY, timeEnd: TIME_END + DAY },
      ],
      name: "Erika Muster",
      mail: CUSTOMER,
      paymentProvider: "giroCockpit",
    };

    for (const userId of [null, CUSTOMER]) {
      const who = userId ? "signed in" : "anonymous";

      it(`names no booking of others to the ${who}, at every v2 entrance`, async function () {
        const entrances = [
          [
            `${v2}/validate/room`,
            { start: TIME_BEGIN, end: TIME_END, amount: 1 },
          ],
          [v2, checkoutBody("room")],
          [`${v2}/validate-group`, groupBody],
          [`${v2}/group`, groupBody],
        ];
        for (const [path, body] of entrances) {
          const res = await call("post", path, userId, body);
          // The group validation answers per attempt.
          const refusals = res.body.data?.attempts
            ? res.body.data.attempts.map((attempt) => attempt.success)
            : [res.body.success];
          expect(refusals, path).to.not.include(true);
          expectNoForeignBooking(res, path);
        }
        expect(h.store.size).to.equal(0);
      });
    }

    it("still says how much is left", async function () {
      const res = await call("post", `${v2}/validate/room`, null, {
        start: TIME_BEGIN,
        end: TIME_END,
        amount: 1,
      });
      expect(res.body.error.params).to.include({
        totalCapacity: 10,
        booked: 10,
        remaining: 0,
      });
    });

    it("names no booking of others in the legacy checkout either", async function () {
      for (const [path, body] of [
        [
          `/api/${TENANT}/checkout/validateItem`,
          {
            bookableId: "room",
            amount: 1,
            timeBegin: TIME_BEGIN,
            timeEnd: TIME_END,
          },
        ],
        [`/api/${TENANT}/checkout`, checkoutBody("room")],
      ]) {
        const res = await call("post", path, null, body);
        expect(res.status, path).to.equal(409);
        const text = JSON.stringify(res.body) + res.text;
        expect(text, path).to.not.include(FOREIGN);
        expect(text, path).to.not.include("concurrentBookings");
      }
    });
  });

  describe("the instance dashboard", function () {
    /** Every person of the instance, members of no tenant included. */
    const PERSONS_OF_INSTANCE = 57;
    /**
     * The active memberships by tenant: a person in both tenants, one
     * whose membership in the first one waits for the invitation.
     */
    const MEMBERSHIPS = [
      { userId: OWNER, tenantId: TENANT, status: "active" },
      { userId: ROLE_HOLDER, tenantId: TENANT, status: "active" },
      { userId: CUSTOMER, tenantId: TENANT, status: "active" },
      {
        userId: "eingeladen@example.test",
        tenantId: TENANT,
        status: "invited",
      },
      { userId: OWNER_B, tenantId: TENANT_B, status: "active" },
      { userId: CUSTOMER, tenantId: TENANT_B, status: "active" },
    ];
    /** The tenants a membership store condition names. */
    const tenantsOf = (condition) =>
      typeof condition === "string" ? [condition] : condition.$in;
    /** The persons with an active membership in each of the tenants. */
    const personsOf = (tenantIds) =>
      new Set(
        MEMBERSHIPS.filter(
          (m) => tenantIds.includes(m.tenantId) && m.status === "active",
        ).map((m) => m.userId),
      ).size;

    before(function () {
      // The counting manager runs for real, over the store of this test.
      DashboardManager.countUsers.restore();
      sinon.stub(UserModel, "countDocuments").resolves(PERSONS_OF_INSTANCE);
      sinon
        .stub(MembershipModel, "distinct")
        .callsFake(async (field, { tenantId, status }) => [
          ...new Set(
            MEMBERSHIPS.filter(
              (m) =>
                m.status === status && tenantsOf(tenantId).includes(m.tenantId),
            ).map((m) => m[field]),
          ),
        ]);
      DashboardManager.countActiveMembershipsByTenant.callsFake(
        async (tenantIds) =>
          new Map(tenantIds.map((id) => [id, personsOf([id])])),
      );
    });

    beforeEach(function () {
      DashboardCache.invalidateAll();
    });

    const summaryAs = async (userId) => {
      const res = await call("get", "/api/v2/dashboard/summary", userId);
      expect(res.status, userId).to.equal(200);
      return res.body.data;
    };

    it("counts for a tenant owner the persons of their tenant only", async function () {
      const data = await summaryAs(OWNER);

      expect(data.totals.users).to.equal(3);
      expect(data.byTenant.map((row) => row.tenantId)).to.deep.equal([TENANT]);
    });

    it("counts for the owner of the second tenant theirs", async function () {
      const data = await summaryAs(OWNER_B);

      expect(data.totals.users).to.equal(2);
    });

    it("counts for the staff with the tenant's dashboard the persons of that tenant", async function () {
      const data = await summaryAs(ROLE_HOLDER);

      expect(data.totals.users).to.equal(3);
    });

    it("counts for the instance owner every person of the instance", async function () {
      const data = await summaryAs(ADMIN);

      expect(data.totals.users).to.equal(PERSONS_OF_INSTANCE);
      expect(data.byTenant.map((row) => row.users)).to.deep.equal([3, 2]);
    });
  });

  describe("creating a person", function () {
    const NEW = "neu@example.test";
    let created;

    before(function () {
      // Nobody is there under the new address; the store answers the
      // person as stored, the password hash included, as the real
      // manager does.
      UserManager.getUser.callsFake(async (id) =>
        id === NEW ? null : new User({ id }).exportPublic(),
      );
      UserManager.createUser.callsFake(async (user) => {
        created = user;
        return new User(JSON.parse(JSON.stringify(user)));
      });
    });

    it("answers the instance owner without the password hash", async function () {
      const res = await call("put", "/api/users", ADMIN, {
        id: NEW,
        firstName: "Neu",
        lastName: "Person",
        secret: "geheim-123",
      });

      expect(res.status).to.equal(200);
      expect(res.body).to.include({ id: NEW, firstName: "Neu" });
      expect(res.body).to.not.have.property("secret");
      expect(JSON.stringify(res.body)).to.not.include("sha1");
      // The person is stored with the hash all the same.
      expect(created.secret).to.match(/^sha1\$/);
      expect(created.verifyPassword("geheim-123")).to.equal(true);
    });

    it("leaves the creation to the instance owner", async function () {
      const res = await call("put", "/api/users", OWNER, {
        id: NEW,
        secret: "geheim-123",
      });

      expect(res.status).to.equal(403);
      expect(JSON.stringify(res.body)).to.not.include("sha1");
    });
  });
});
