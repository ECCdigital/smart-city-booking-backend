/**
 * The tenant router on the authorization, end to end over the lifecycle
 * harness (authorize spec §4.2, ticket 2): a booking outside the reach
 * `own` does not exist for the request (404), the same booking answers
 * its owner and the administration, and the router's refusal is the one
 * JSON form of `ForbiddenError`.
 */

const { expect } = require("chai");
const sinon = require("sinon");

const {
  installHarness,
  TENANT,
  ADMIN,
  ROLE_HOLDER,
  CUSTOMER,
  TIME_BEGIN,
  TIME_END,
} = require("./helpers/booking-lifecycle-harness");
const { Booking } = require("../src/commons/entities/booking/booking");
const {
  BookableManager,
} = require("../src/commons/data-managers/bookable-manager");

const OTHER_CUSTOMER = "max@example.test";

describe("authorization on the tenant router: the reach of a booking", function () {
  this.timeout(20000);

  let h;

  before(async function () {
    h = await installHarness();
    // What the booking's population reads beyond the harness.
    sinon
      .stub(BookableManager, "getBookablesByIdsWithCustomFields")
      .resolves([]);
    h.store.set(
      "B-erika",
      JSON.parse(
        JSON.stringify(
          new Booking({
            id: "B-erika",
            tenantId: TENANT,
            assignedUserId: CUSTOMER,
            mail: CUSTOMER,
            name: "Erika Muster",
            status: "confirmed",
            priceEur: 40,
            paymentProvider: "giroCockpit",
            timeBegin: TIME_BEGIN,
            timeEnd: TIME_END,
            bookableItems: [{ bookableId: "room", amount: 1 }],
            attachments: [],
            accessInfo: [],
            hooks: [],
          }),
        ),
      ),
    );
  });

  after(async function () {
    sinon.restore();
    await h.close();
  });

  const get = (path, userId) => {
    const req = h.api().get(`/api/${TENANT}${path}`);
    return userId ? req.set(h.as(userId)) : req;
  };

  it("answers the owner and the administration, and 404 to another customer", async function () {
    expect((await get("/bookings/B-erika", CUSTOMER)).status).to.equal(200);
    expect((await get("/bookings/B-erika", ROLE_HOLDER)).status).to.equal(200);
    expect((await get("/bookings/B-erika", ADMIN)).status).to.equal(200);

    const other = await get("/bookings/B-erika", OTHER_CUSTOMER);
    expect(other.status).to.equal(404);
    expect(other.body.code).to.equal("booking_not_found");
  });

  it("lists a customer the own bookings only, the administration all", async function () {
    const ids = (res) => res.body.map((booking) => booking.id);
    expect(ids(await get("/bookings", CUSTOMER))).to.deep.equal(["B-erika"]);
    expect(ids(await get("/bookings", OTHER_CUSTOMER))).to.deep.equal([]);
    expect(ids(await get("/bookings", ROLE_HOLDER))).to.include("B-erika");
  });

  it("answers 401 to the anonymous on a route that is not public", async function () {
    expect((await get("/bookings/B-erika")).status).to.equal(401);
  });

  it("refuses without reach in the one JSON form, before the handler", async function () {
    const res = await get("/workflow/", CUSTOMER);
    expect(res.status).to.equal(403);
    expect(res.body).to.deep.equal({
      error: "ForbiddenError",
      code: "forbidden",
      statusCode: 403,
      params: {},
    });
  });

  it("keeps the customer's own documents reachable and the others' not", async function () {
    const mine = await get("/bookings/B-erika/receipt/RE-1", CUSTOMER);
    expect(mine.status).to.not.equal(403);
    expect(mine.status).to.not.equal(404);
    const theirs = await get("/bookings/B-erika/receipt/RE-1", OTHER_CUSTOMER);
    expect(theirs.status).to.equal(404);
  });
});
