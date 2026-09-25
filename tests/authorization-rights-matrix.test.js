/**
 * The rights matrix: what each kind of principal gets on the core routes,
 * written down from the glossary ("Rechte" in `CONTEXT.md`) and not
 * derived from the rights table - where the two disagree, this test is
 * the one to believe until someone decides otherwise.
 *
 * The world (`helpers/route-world.js` on the lifecycle harness) has two
 * tenants and seven principals:
 *
 *   anonymous       nobody
 *   customer        signed in, a member of tenant A without a role, with
 *                   the booking `fx` and its group
 *   reader          a member of A holding the `own` levels of every role
 *                   group alone; owns the bookable, event, coupon and
 *                   medium `mine` and the booking `b-reader`
 *   staff           a member of A holding every level of every group;
 *                   owns `fx` of every entity
 *   owner           the owner of tenant A, without a role
 *   admin           the instance owner
 *   foreignOwner    the owner of tenant B, a member nowhere else; owns
 *                   `fx-b` of every entity there and the booking `b-b`
 *
 * What the glossary says, and the matrix holds:
 *
 *   - `own` is the record whose owner key names the user: a reader lists
 *     and touches `mine` and never `fx`, which does not exist for them
 *     (404), and a customer reads their booking and nobody else's.
 *   - Everything of the tenant is the staff's, the owner's and the
 *     admin's alike; creating is a role level the reader lacks (403).
 *   - Tenant borders: a member of A is nobody in B - a management route
 *     refuses them (403), an own-record route has nothing for them
 *     (404, empty list) - and a record of A is not there under B's name,
 *     whoever asks.
 *   - Pending changes nothing for the signed in ("bei Freigabe ausstehend
 *     ruht nichts"); the public projection of the tenant is gone for the
 *     public, and signing in does not open it.
 *   - Declined: the membership rests and gives nothing - every member
 *     with a right is refused with the declination named, and keeps what
 *     any signed-in user has (the own booking, its group); the instance
 *     owner keeps everything; a stranger gets the plain 403 as before.
 *   - Roles are a member's (`own: "tenantMember"`): a member gets the
 *     public projection (`?public=true`) of the tenant's roles and an
 *     empty list without the flag, the management the roles; a stranger
 *     to the tenant and a resting membership are refused (403), as at
 *     every entry a level guards. Across tenants (`GET /api/roles`)
 *     nobody is a member: the instance owner alone gets through. The own
 *     roles (`/roles/tenant`) are the principal's own (`self`): the
 *     membership's roles, an empty list where it rests or is none, never
 *     a refusal (ticket 07).
 *   - `self` reaches no records; the tags and counters are public
 *     aggregates (ADR 0003): the count check of a tenant answers
 *     everyone, a stranger and a resting member included.
 *
 * A route that a reading of the glossary does not settle is left out on
 * purpose (the public booking list for the anonymous, the public routes
 * for the staff of a pending tenant): ticket 01 of the authorization
 * architecture decides those.
 */

const { expect } = require("chai");
const sinon = require("sinon");

const {
  installHarness,
  bookable,
  TENANT,
  TENANT_B,
  ADMIN,
  OWNER,
  OWNER_B,
  ROLE_HOLDER,
  READ_OWN_HOLDER,
  CUSTOMER,
  ROLE_ALL,
  ROLE_READ_OWN,
  TIME_BEGIN,
  TIME_END,
} = require("./helpers/booking-lifecycle-harness");
const { installRouteWorld, FIXTURE_ID } = require("./helpers/route-world");
const { Booking } = require("../src/commons/entities/booking/booking");

const A = TENANT;
const B = TENANT_B;
const FX = FIXTURE_ID;
const MINE = "mine";
const FX_B = "fx-b";
const BOOKING_OF_READER = "b-reader";
const BOOKING_OF_B = "b-b";
const GROUP_OF_B = "g-b";
/** The one role of tenant B in the route world. */
const ROLE_OF_B = `${FIXTURE_ID}-${TENANT_B}`;

/** The principals, by the name the matrix uses. */
const PRINCIPALS = {
  anonymous: null,
  customer: CUSTOMER,
  reader: READ_OWN_HOLDER,
  staff: ROLE_HOLDER,
  owner: OWNER,
  admin: ADMIN,
  foreignOwner: OWNER_B,
};

/** The refusal of a resting membership: 403 with the declination named. */
const DECLINED = "403 tenant_declined";
/** Every bookable of tenant A: the harness' catalogue, `fx` and `mine`. */
const ALL = "every bookable of the tenant";

describe("authorization rights matrix: the core routes by principal, stage and tenant", function () {
  this.timeout(60000);

  let h;
  let allBookablesOfA;

  const bookingOf = (id, tenantId, userId) =>
    JSON.parse(
      JSON.stringify(
        new Booking({
          id,
          tenantId,
          assignedUserId: userId,
          mail: userId,
          name: "Wer bucht",
          status: "confirmed",
          priceEur: 40,
          paymentProvider: "giroCockpit",
          timeBegin: TIME_BEGIN,
          timeEnd: TIME_END,
          bookableItems: [{ bookableId: FX, amount: 1 }],
          attachments: [],
          accessInfo: [],
          hooks: [],
        }),
      ),
    );

  /** Puts the bookings and groups back: a request may remove them. */
  function reseed() {
    h.store.clear();
    h.store.set(FX, bookingOf(FX, A, CUSTOMER));
    h.store.set(
      BOOKING_OF_READER,
      bookingOf(BOOKING_OF_READER, A, READ_OWN_HOLDER),
    );
    h.store.set(BOOKING_OF_B, bookingOf(BOOKING_OF_B, B, OWNER_B));
    h.groups.clear();
    h.groups.set(FX, {
      id: FX,
      tenantId: A,
      bookingIds: [FX],
      assignedUserId: CUSTOMER,
      mail: CUSTOMER,
    });
    h.groups.set(GROUP_OF_B, {
      id: GROUP_OF_B,
      tenantId: B,
      bookingIds: [BOOKING_OF_B],
      assignedUserId: OWNER_B,
      mail: OWNER_B,
    });
    h.clearEffects();
  }

  before(async function () {
    h = await installHarness({
      bookables: {
        [FX]: bookable({ id: FX, title: "Fixture", ownerUserId: ROLE_HOLDER }),
      },
    });
    installRouteWorld({
      tenantId: A,
      tenant: h.tenant,
      ownerUserId: ROLE_HOLDER,
      bookables: h.bookables,
      tenants: { [B]: h.tenantB },
      owned: [
        { id: MINE, tenantId: A, ownerUserId: READ_OWN_HOLDER },
        { id: FX_B, tenantId: B, ownerUserId: OWNER_B },
      ],
      groups: h.groups,
    });
    allBookablesOfA = Object.values(h.bookables)
      .filter((record) => record.tenantId === A)
      .map((record) => record.id);
    reseed();
  });

  after(async function () {
    sinon.restore();
    await h.close();
  });

  afterEach(function () {
    h.tenant.supervisionLevel = "free";
    delete h.tenant.supervisionChangedAt;
    delete h.tenant.supervisionReason;
  });

  function setStage(stage) {
    if (stage === "free") return;
    h.tenant.supervisionLevel = stage;
    h.tenant.supervisionChangedAt = new Date("2026-09-24T10:00:00.000Z");
    h.tenant.supervisionReason = "Kein Impressum";
  }

  async function call(method, path, userId, body) {
    reseed();
    let req = h.api()[method](path).timeout({ response: 5000 });
    if (userId) req = req.set(h.as(userId));
    if (body) req = req.send(body);
    return req;
  }

  /** The ids of a list answer: a plain array, or a page of `items`. */
  const idsOf = (body) =>
    (Array.isArray(body) ? body : body?.items ?? []).map((row) => row.id);

  /**
   * What an answer is, in the words of the matrix: a status, `403
   * tenant_declined`, or the sorted ids of a 200 list.
   */
  function answerOf(res) {
    if (res.status === 403 && res.body?.code === "tenant_declined") {
      return DECLINED;
    }
    if (res.status === 200 && (Array.isArray(res.body) || res.body?.items)) {
      return idsOf(res.body).sort();
    }
    return res.status;
  }

  const expected = (value) => {
    const ids = value === ALL ? allBookablesOfA : value;
    return Array.isArray(ids) ? [...ids].sort() : ids;
  };

  /**
   * A row of the matrix: the route, and what each principal gets. A
   * principal left out of a row is not asked.
   *
   * @param {string} method
   * @param {string} path
   * @param {Object<string, number|string|string[]>} answers
   * @param {Object} [body]
   */
  const row = (method, path, answers, body) => ({
    method,
    path,
    answers,
    body,
  });

  /** Runs the rows of a stage and names every cell that is off. */
  function itHolds(stage, rows) {
    for (const { method, path, answers, body } of rows) {
      const label = `${method.toUpperCase()} ${path}${body ? ` ${JSON.stringify(body)}` : ""}`;
      it(label, async function () {
        setStage(stage);
        const off = [];
        for (const [name, want] of Object.entries(answers)) {
          const res = await call(method, path, PRINCIPALS[name], body);
          const got = answerOf(res);
          if (JSON.stringify(got) !== JSON.stringify(expected(want))) {
            off.push(
              `${name}: expected ${JSON.stringify(want)}, got ${JSON.stringify(got)}`,
            );
          }
        }
        expect(off, label).to.deep.equal([]);
      });
    }
  }

  /**
   * Tenant A while free: the reach of each principal on the core routes.
   * `ALL` stands for every bookable of the tenant.
   */
  const inA = (path) => `/api/${A}${path}`;
  const freeRows = () => [
    // --- bookables: `own` is the owner key ---------------------------------
    row("get", inA("/bookables"), {
      anonymous: 401,
      customer: 403,
      reader: [MINE],
      staff: ALL,
      owner: ALL,
      admin: ALL,
      foreignOwner: 403,
    }),
    row("get", inA(`/bookables/${FX}`), {
      anonymous: 401,
      customer: 403,
      reader: 404,
      staff: 200,
      owner: 200,
      admin: 200,
      foreignOwner: 403,
    }),
    row("get", inA(`/bookables/${MINE}`), {
      anonymous: 401,
      customer: 403,
      reader: 200,
      staff: 200,
      owner: 200,
      admin: 200,
      foreignOwner: 403,
    }),
    row(
      "put",
      inA("/bookables"),
      {
        anonymous: 401,
        customer: 403,
        reader: 404,
        staff: 201,
        owner: 201,
        admin: 201,
        foreignOwner: 403,
      },
      { id: FX, tenantId: A },
    ),
    row(
      "put",
      inA("/bookables"),
      {
        anonymous: 401,
        customer: 403,
        reader: 201,
        staff: 201,
        owner: 201,
        admin: 201,
        foreignOwner: 403,
      },
      { id: MINE, tenantId: A },
    ),
    // Creating is a role level of its own: the reader has none.
    row(
      "put",
      inA("/bookables"),
      {
        anonymous: 401,
        customer: 403,
        reader: 403,
        staff: 201,
        owner: 201,
        admin: 201,
        foreignOwner: 403,
      },
      { tenantId: A, title: "Neu" },
    ),
    row("delete", inA(`/bookables/${FX}`), {
      anonymous: 401,
      customer: 403,
      reader: 404,
      staff: 200,
      owner: 200,
      admin: 200,
      foreignOwner: 403,
    }),
    row("delete", inA(`/bookables/${MINE}`), {
      anonymous: 401,
      customer: 403,
      reader: 200,
      staff: 200,
      owner: 200,
      admin: 200,
      foreignOwner: 403,
    }),
    // --- events ----------------------------------------------------------
    row(
      "put",
      inA("/events"),
      {
        anonymous: 401,
        customer: 403,
        reader: 404,
        staff: 201,
        owner: 201,
        admin: 201,
        foreignOwner: 403,
      },
      { id: FX, tenantId: A },
    ),
    row(
      "put",
      inA("/events"),
      {
        anonymous: 401,
        customer: 403,
        reader: 201,
        staff: 201,
        owner: 201,
        admin: 201,
        foreignOwner: 403,
      },
      { id: MINE, tenantId: A },
    ),
    row("delete", inA(`/events/${FX}`), {
      anonymous: 401,
      customer: 403,
      reader: 404,
      staff: 200,
      owner: 200,
      admin: 200,
      foreignOwner: 403,
    }),
    row("delete", inA(`/events/${MINE}`), {
      anonymous: 401,
      customer: 403,
      reader: 200,
      staff: 200,
      owner: 200,
      admin: 200,
      foreignOwner: 403,
    }),
    // The seats of an event: the staff's figure, not a public aggregate
    // (`event.seatCount`, ticket 19/5) - the event has to be within reach,
    // its seats are then counted whole (ADR 0002).
    row("get", inA(`/events/${FX}/count`), {
      anonymous: 401,
      customer: 403,
      reader: 404,
      staff: 200,
      owner: 200,
      admin: 200,
      foreignOwner: 403,
    }),
    row("get", inA(`/events/${MINE}/count`), {
      anonymous: 401,
      customer: 403,
      reader: 200,
      staff: 200,
      owner: 200,
      admin: 200,
      foreignOwner: 403,
    }),
    // --- coupons ---------------------------------------------------------
    row("get", inA("/coupons"), {
      anonymous: 401,
      customer: 403,
      reader: [MINE],
      staff: [FX, MINE],
      owner: [FX, MINE],
      admin: [FX, MINE],
      foreignOwner: 403,
    }),
    // A coupon out of reach is not there for the upsert either (ADR 0002):
    // the PUT turns into a creation, which the reader may not do.
    row(
      "put",
      inA("/coupons"),
      {
        anonymous: 401,
        customer: 403,
        reader: 403,
        staff: 201,
        owner: 201,
        admin: 201,
        foreignOwner: 403,
      },
      { id: FX, tenantId: A, type: "percentage", discount: 10 },
    ),
    row(
      "put",
      inA("/coupons"),
      {
        anonymous: 401,
        customer: 403,
        reader: 201,
        staff: 201,
        owner: 201,
        admin: 201,
        foreignOwner: 403,
      },
      { id: MINE, tenantId: A, type: "percentage", discount: 10 },
    ),
    row("delete", inA(`/coupons/${FX}`), {
      anonymous: 401,
      customer: 403,
      reader: 404,
      staff: 204,
      owner: 204,
      admin: 204,
      foreignOwner: 403,
    }),
    row("delete", inA(`/coupons/${MINE}`), {
      anonymous: 401,
      customer: 403,
      reader: 204,
      staff: 204,
      owner: 204,
      admin: 204,
      foreignOwner: 403,
    }),
    // --- bookings: `own` is the assigned user -----------------------------
    row("get", inA("/bookings"), {
      customer: [FX],
      reader: [BOOKING_OF_READER],
      staff: [FX, BOOKING_OF_READER],
      owner: [FX, BOOKING_OF_READER],
      admin: [FX, BOOKING_OF_READER],
      foreignOwner: [],
    }),
    row("get", inA(`/bookings/${FX}`), {
      anonymous: 401,
      customer: 200,
      reader: 404,
      staff: 200,
      owner: 200,
      admin: 200,
      foreignOwner: 404,
    }),
    row("get", inA(`/bookings/${BOOKING_OF_READER}`), {
      anonymous: 401,
      customer: 404,
      reader: 200,
      staff: 200,
      owner: 200,
      admin: 200,
      foreignOwner: 404,
    }),
    // Deleting a booking is the administration's alone, own or not.
    row("delete", inA(`/bookings/${FX}`), {
      anonymous: 401,
      customer: 403,
      reader: 403,
      staff: 200,
      owner: 200,
      admin: 200,
      foreignOwner: 403,
    }),
    // --- group bookings --------------------------------------------------
    row("get", inA("/group-bookings"), {
      anonymous: 401,
      customer: [FX],
      reader: [],
      staff: [FX],
      owner: [FX],
      admin: [FX],
      foreignOwner: [],
    }),
    row("get", inA(`/group-bookings/${FX}`), {
      anonymous: 401,
      customer: 200,
      reader: 404,
      staff: 200,
      owner: 200,
      admin: 200,
      foreignOwner: 404,
    }),
    // --- media: `own` is the uploader -------------------------------------
    row("get", `/api/v2/${A}/media`, {
      anonymous: 401,
      customer: 403,
      reader: [MINE],
      staff: [FX, MINE],
      owner: [FX, MINE],
      admin: [FX, MINE],
      foreignOwner: 403,
    }),
    // Behind the door of the metadata routes a medium out of reach is not
    // there (ticket 04); deleting one out of reach neither.
    row("get", `/api/v2/${A}/media/${FX}`, {
      anonymous: 401,
      customer: 404,
      reader: 404,
      staff: 200,
      owner: 200,
      admin: 200,
      foreignOwner: 404,
    }),
    row("get", `/api/v2/${A}/media/${MINE}`, {
      customer: 404,
      reader: 200,
      staff: 200,
    }),
    row("delete", `/api/v2/${A}/media/${FX}`, {
      anonymous: 401,
      customer: 403,
      reader: 404,
      foreignOwner: 403,
    }),
    // --- roles: a member's (`tenantMember`); a stranger is refused -------
    row("get", inA("/roles"), {
      anonymous: 401,
      customer: [],
      reader: [],
      staff: [FX],
      owner: [FX],
      admin: [FX],
      foreignOwner: 403,
    }),
    // The public projection is a member's.
    row("get", inA("/roles?public=true"), {
      anonymous: 401,
      customer: [FX],
      reader: [FX],
      staff: [FX],
      owner: [FX],
      admin: [FX],
      foreignOwner: 403,
    }),
    // Across tenants nobody is a member: the instance owner alone gets
    // every role of every tenant, whoever else asks is refused.
    row("get", "/api/roles?public=true", {
      anonymous: 401,
      customer: 403,
      reader: 403,
      staff: 403,
      owner: 403,
      admin: [FX, ROLE_OF_B],
      foreignOwner: 403,
    }),
    row("get", "/api/roles", {
      anonymous: 401,
      customer: 403,
      staff: 403,
      owner: 403,
      admin: [FX, ROLE_OF_B],
      foreignOwner: 403,
    }),
    // The own roles (`self`): what the membership holds.
    row("get", inA("/roles/tenant"), {
      anonymous: 401,
      customer: [],
      reader: [ROLE_READ_OWN],
      staff: [ROLE_ALL],
      owner: [],
      admin: [ROLE_ALL],
      foreignOwner: [],
    }),
    // --- a public counter (`bookable.meta`: public, `any` for the staff) --
    row("get", inA("/bookables/count/check"), {
      anonymous: 200,
      customer: 200,
      reader: 200,
      staff: 200,
      owner: 200,
      admin: 200,
      foreignOwner: 200,
    }),
    // --- the tenant itself: the owner's ------------------------------------
    row("get", `/api/tenants/${A}`, {
      anonymous: 401,
      customer: 403,
      reader: 403,
      staff: 403,
      owner: 200,
      admin: 200,
      foreignOwner: 403,
    }),
  ];

  describe("tenant A, free", function () {
    itHolds("free", freeRows());
  });

  describe("tenant A, waiting for approval: nothing rests for the signed in", function () {
    // The same rows as free, for everyone who is signed in.
    itHolds(
      "pending",
      freeRows().map(({ method, path, answers, body }) =>
        row(
          method,
          path,
          Object.fromEntries(
            Object.entries(answers).filter(([name]) => name !== "anonymous"),
          ),
          body,
        ),
      ),
    );

    // The public projection is gone for the public, and signing in does
    // not open it.
    itHolds("pending", [
      row("get", inA("/bookables/public"), {
        anonymous: 404,
        customer: 404,
      }),
      row("get", inA(`/bookables/public/${FX}`), {
        anonymous: 404,
        customer: 404,
      }),
    ]);
  });

  describe("tenant A, declined: the membership rests", function () {
    itHolds("declined", [
      // Every member with a right is refused with the declination named;
      // the stranger gets the plain 403; the instance owner keeps all.
      row("get", inA("/bookables"), {
        anonymous: 401,
        customer: DECLINED,
        reader: DECLINED,
        staff: DECLINED,
        owner: DECLINED,
        admin: ALL,
        foreignOwner: 403,
      }),
      row("get", inA(`/bookables/${FX}`), {
        reader: DECLINED,
        staff: DECLINED,
        owner: DECLINED,
        admin: 200,
        foreignOwner: 403,
      }),
      row(
        "put",
        inA("/bookables"),
        { reader: DECLINED, staff: DECLINED, owner: DECLINED, admin: 201 },
        { id: MINE, tenantId: A },
      ),
      row("get", inA("/coupons"), {
        reader: DECLINED,
        staff: DECLINED,
        owner: DECLINED,
        admin: [FX, MINE],
      }),
      row("get", `/api/v2/${A}/media`, {
        reader: DECLINED,
        staff: DECLINED,
        owner: DECLINED,
        admin: [FX, MINE],
      }),
      // The door is signed in: the resting membership reaches no medium.
      row("get", `/api/v2/${A}/media/${FX}`, {
        staff: 404,
        owner: 404,
        admin: 200,
      }),
      row("get", `/api/tenants/${A}`, {
        customer: DECLINED,
        staff: DECLINED,
        owner: DECLINED,
        admin: 200,
        foreignOwner: 403,
      }),
      // What any signed-in user has stays: the own booking and its group,
      // and nothing of anyone else's.
      row("get", inA("/bookings"), {
        customer: [FX],
        reader: [BOOKING_OF_READER],
        staff: [],
        owner: [],
        admin: [FX, BOOKING_OF_READER],
        foreignOwner: [],
      }),
      row("get", inA(`/bookings/${FX}`), {
        anonymous: 401,
        customer: 200,
        reader: 404,
        staff: 404,
        owner: 404,
        admin: 200,
      }),
      row("get", inA(`/bookings/${BOOKING_OF_READER}`), {
        reader: 200,
        staff: 404,
      }),
      row("get", inA("/group-bookings"), {
        customer: [FX],
        reader: [],
        staff: [],
        owner: [],
        admin: [FX],
      }),
      row("get", inA(`/group-bookings/${FX}`), {
        customer: 200,
        staff: 404,
        owner: 404,
        admin: 200,
      }),
      // The roles are a member's: the resting membership is refused with
      // the declination named, the stranger as before.
      row("get", inA("/roles"), {
        customer: DECLINED,
        reader: DECLINED,
        staff: DECLINED,
        owner: DECLINED,
        admin: [FX],
        foreignOwner: 403,
      }),
      row("get", inA("/roles?public=true"), {
        customer: DECLINED,
        reader: DECLINED,
        staff: DECLINED,
        owner: DECLINED,
        admin: [FX],
        foreignOwner: 403,
      }),
      row("get", "/api/roles?public=true", {
        customer: 403,
        staff: 403,
        owner: 403,
        admin: [FX, ROLE_OF_B],
        foreignOwner: 403,
      }),
      // A public counter stays open to everyone, with the public's answer.
      row("get", inA("/bookables/count/check"), {
        customer: 200,
        staff: 200,
        owner: 200,
        admin: 200,
        foreignOwner: 200,
      }),
      // The own roles are the principal's own (`self`), never refused: the
      // instance owner's own membership in A rests like every other - what
      // they keep is the reach `any`, not a role of the tenant.
      row("get", inA("/roles/tenant"), {
        customer: [],
        reader: [],
        staff: [],
        owner: [],
        admin: [],
        foreignOwner: [],
      }),
    ]);
  });

  describe("across the tenant border: tenant B", function () {
    const inB = (path) => `/api/${B}${path}`;
    itHolds("free", [
      // A member of A is nobody in B: the management routes refuse them.
      row("get", inB("/bookables"), {
        customer: 403,
        reader: 403,
        staff: 403,
        owner: 403,
        foreignOwner: [FX_B],
        admin: [FX_B],
      }),
      row("get", inB(`/bookables/${FX_B}`), {
        staff: 403,
        owner: 403,
        foreignOwner: 200,
        admin: 200,
      }),
      row(
        "put",
        inB("/bookables"),
        { staff: 403, owner: 403, foreignOwner: 201, admin: 201 },
        { id: FX_B, tenantId: B },
      ),
      row("delete", inB(`/bookables/${FX_B}`), {
        staff: 403,
        owner: 403,
        foreignOwner: 200,
        admin: 200,
      }),
      row("get", inB("/coupons"), {
        staff: 403,
        owner: 403,
        foreignOwner: [FX_B],
        admin: [FX_B],
      }),
      row("get", `/api/v2/${B}/media`, {
        staff: 403,
        owner: 403,
        foreignOwner: [FX_B],
        admin: [FX_B],
      }),
      row("get", `/api/tenants/${B}`, {
        staff: 403,
        owner: 403,
        foreignOwner: 200,
        admin: 200,
      }),
      // The own-record routes have nothing for them there.
      row("get", inB("/bookings"), {
        customer: [],
        reader: [],
        staff: [],
        owner: [],
        foreignOwner: [BOOKING_OF_B],
        admin: [BOOKING_OF_B],
      }),
      row("get", inB(`/bookings/${BOOKING_OF_B}`), {
        customer: 404,
        staff: 404,
        owner: 404,
        foreignOwner: 200,
        admin: 200,
      }),
      row("get", inB("/group-bookings"), {
        customer: [],
        owner: [],
        foreignOwner: [GROUP_OF_B],
        admin: [GROUP_OF_B],
      }),
      // A record of A is not there under B's name, whoever asks - the
      // customer's own booking included.
      row("get", inB(`/bookables/${FX}`), { foreignOwner: 404, admin: 404 }),
      row("get", inB(`/bookings/${FX}`), {
        customer: 404,
        foreignOwner: 404,
        admin: 404,
      }),
      row("get", inB(`/group-bookings/${FX}`), {
        customer: 404,
        foreignOwner: 404,
        admin: 404,
      }),
      row("get", inB(`/coupons`), { foreignOwner: [FX_B] }),
      // The roles of B are B's members'; a member of A is refused there
      // and has no own roles.
      row("get", inB("/roles?public=true"), {
        customer: 403,
        reader: 403,
        staff: 403,
        owner: 403,
        foreignOwner: [ROLE_OF_B],
        admin: [ROLE_OF_B],
      }),
      row("get", inB("/roles/tenant"), {
        staff: [],
        owner: [],
        foreignOwner: [],
        admin: [],
      }),
    ]);
  });
});
