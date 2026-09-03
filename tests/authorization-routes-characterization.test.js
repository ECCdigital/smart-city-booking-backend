/**
 * Characterization of the authorization as it is today, route by route
 * (authorize spec §8.2): every route of every router under `src/platform`
 * is called with five principals - anonymous, signed in without a role,
 * holder of every role level, tenant owner, instance owner - and the
 * status code each gets is pinned in
 * `tests/snapshots/authorization/routes.json`. A 403 whose body is more
 * than the bare `Forbidden` of `sendStatus(403)` is pinned with its body,
 * to show the seven answer forms of a refusal (§1) that §7.6 folds into
 * one. A route that never answers is pinned as `timeout` - the hanging
 * challenge endpoints (§7.5).
 *
 * It pins, it does not judge: each ticket of the chain that puts a router
 * on `authorize()` reports the flips against this table. The harness runs
 * the real routers over the in-memory world of `helpers/route-world.js`;
 * what a handler answers past the authorization (200, 400, 404, 500 of a
 * fixture it did not expect) is the world's, and secondary.
 */

const { expect } = require("chai");
const sinon = require("sinon");

const {
  installHarness,
  bookable,
  TENANT,
  ADMIN,
  OWNER,
  ROLE_HOLDER,
  CUSTOMER,
  TIME_BEGIN,
  TIME_END,
} = require("./helpers/booking-lifecycle-harness");
const { installRouteWorld, FIXTURE_ID } = require("./helpers/route-world");
const { routesOf } = require("./helpers/route-inventory");
const { expectSnapshot } = require("./helpers/snapshot");
const { Booking } = require("../src/commons/entities/booking/booking");

const SNAPSHOT = "authorization/routes.json";
/** How long a route may take before it counts as hanging. */
const RESPONSE_TIMEOUT_MS = 2000;

process.env.STORE_FRONT_URL ||= "https://store.example.test";

/** The five principals, in the order of the table. */
const PRINCIPALS = [
  ["anonymous", null],
  ["signedIn", CUSTOMER],
  ["roleHolder", ROLE_HOLDER],
  ["tenantOwner", OWNER],
  ["instanceOwner", ADMIN],
];

/** The values of the route parameters: the tenant, a provider, the fixture. */
function paramValue(name) {
  if (name === "tenant") return TENANT;
  if (name === "provider") return "nuki";
  return FIXTURE_ID;
}

const url = (path) =>
  path.replace(/:([a-zA-Z]+)/g, (match, name) => paramValue(name));

/** What a 403 is pinned as: bare, or with the body that is more than bare. */
function pinned(res) {
  if (res.status === 403 && res.text && res.text !== "Forbidden") {
    return `403 ${res.text}`;
  }
  return res.status;
}

describe("authorization today: every route with every principal", function () {
  this.timeout(120000);

  let h;
  let seed;

  /** Puts the fixture booking and its group back: a request may change them. */
  function reseed() {
    h.store.set(FIXTURE_ID, JSON.parse(JSON.stringify(seed)));
    h.groups.set(FIXTURE_ID, {
      id: FIXTURE_ID,
      tenantId: TENANT,
      bookingIds: [FIXTURE_ID],
      assignedUserId: CUSTOMER,
      mail: CUSTOMER,
    });
    h.clearEffects();
  }

  before(async function () {
    h = await installHarness({
      bookables: {
        [FIXTURE_ID]: bookable({
          id: FIXTURE_ID,
          title: "Fixture",
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
    // The customer's own confirmed booking, and its group.
    seed = new Booking({
      id: FIXTURE_ID,
      tenantId: TENANT,
      assignedUserId: CUSTOMER,
      mail: CUSTOMER,
      name: "Erika Muster",
      status: "confirmed",
      priceEur: 40,
      paymentProvider: "giroCockpit",
      timeBegin: TIME_BEGIN,
      timeEnd: TIME_END,
      bookableItems: [{ bookableId: FIXTURE_ID, amount: 1 }],
      attachments: [],
      accessInfo: [],
      hooks: [],
    });
    reseed();
  });

  after(async function () {
    sinon.restore();
    await h.close();
  });

  async function call(route, userId) {
    reseed();
    let req = h.api()[route.method.toLowerCase()](url(route.path));
    if (userId) {
      req = req.set(h.as(userId));
    }
    if (["POST", "PUT", "PATCH"].includes(route.method)) {
      req = req.send({ id: FIXTURE_ID, tenantId: TENANT });
    }
    try {
      return pinned(await req.timeout({ response: RESPONSE_TIMEOUT_MS }));
    } catch (err) {
      if (err.timeout) {
        return "timeout";
      }
      throw err;
    }
  }

  it("pins the status code of every route for every principal", async function () {
    const routes = routesOf(h.app);
    expect(routes.length).to.be.greaterThan(200);

    const table = {};
    for (const route of routes) {
      const row = {};
      for (const [name, userId] of PRINCIPALS) {
        row[name] = await call(route, userId);
      }
      // A route registered twice (`GET /api/instances/public`) is listed twice.
      const key = `${route.method} ${route.path}`;
      table[key in table ? `${key} #2` : key] = row;
    }

    expectSnapshot(SNAPSHOT, `${JSON.stringify(table, null, 2)}\n`);
  });
});
