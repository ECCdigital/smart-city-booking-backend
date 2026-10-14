/**
 * The Buchungsweg of a booking (`bookedVia`, ECCdigital/tickets#485), seen
 * through the HTTP form: the checkout sets it once when it creates a
 * booking, from the checkout policy and the sign-in, an edit keeps it, a
 * client never sets it, and the administration reads it in the list and
 * the detail of a booking.
 */

const { expect } = require("chai");
const sinon = require("sinon");

const {
  installHarness,
  checkoutBody,
  adminForm,
  TENANT,
  ADMIN,
  CUSTOMER,
  TIME_BEGIN,
  TIME_END,
  DAY,
} = require("./helpers/booking-lifecycle-harness");
const UserManager = require("../src/commons/data-managers/user-manager");

describe("Buchungsweg: how a booking was created", function () {
  let h;

  beforeEach(async function () {
    h = await installHarness();
  });

  afterEach(async function () {
    sinon.restore();
    await h.close();
  });

  const api = () => h.api();

  /** A checkout through the storefront (v2), signed in as `userId` or not. */
  async function checkoutV2(userId, overrides = {}) {
    const req = api().post(`/api/v2/${TENANT}/checkout`);
    if (userId) req.set(h.as(userId));
    const res = await req.send(checkoutBody("room", overrides));
    expect(res.status).to.equal(200);
    return res.body.data.booking.id;
  }

  /** A checkout through the old checkout of the Admin UI (v1). */
  async function checkoutV1(userId, overrides = {}) {
    const req = api().post(`/api/${TENANT}/checkout`);
    if (userId) req.set(h.as(userId));
    const res = await req.send(checkoutBody("room", overrides));
    expect(res.status).to.equal(200);
    return res.body.id;
  }

  /** A group checkout through the storefront of two slots, a day apart. */
  async function groupCheckout(userId) {
    const req = api().post(`/api/v2/${TENANT}/checkout/group`);
    if (userId) req.set(h.as(userId));
    const res = await req.send({
      bookableItems: [{ bookableId: "room", amount: 1 }],
      bookingAttempts: [
        { timeBegin: TIME_BEGIN, timeEnd: TIME_END },
        { timeBegin: TIME_BEGIN + DAY, timeEnd: TIME_END + DAY },
      ],
      name: "Erika Muster",
      mail: CUSTOMER,
      paymentProvider: "giroCockpit",
    });
    expect(res.status).to.equal(200);
    return res.body.data.groupBooking.id;
  }

  const update = (id, changes) =>
    api()
      .put(`/api/${TENANT}/bookings`)
      .set(h.as(ADMIN))
      .send(adminForm(h.stored(id), changes));

  describe("the checkout sets it from the policy and the sign-in", function () {
    it("a signed-in checkout of the storefront is booked via the user account", async function () {
      const id = await checkoutV2(CUSTOMER);

      expect(h.stored(id).bookedVia).to.equal("user");
    });

    it("a checkout of the storefront without sign-in is booked as a guest", async function () {
      const id = await checkoutV2(null);

      expect(h.stored(id).bookedVia).to.equal("guest");
    });

    it("the old checkout of the Admin UI follows the same rule", async function () {
      const signedIn = await checkoutV1(CUSTOMER);
      const guest = await checkoutV1(null);

      expect(h.stored(signedIn).bookedVia).to.equal("user");
      expect(h.stored(guest).bookedVia).to.equal("guest");
    });

    it("a suspended user books as a guest, as the checkout treats them as anonymous", async function () {
      UserManager.getUser.callsFake(async (id) => ({
        id,
        isSuspended: id === CUSTOMER,
      }));

      const id = await checkoutV2(CUSTOMER);

      expect(h.stored(id).bookedVia).to.equal("guest");
    });

    it("an admin signed in at the checkout books via the user account", async function () {
      const id = await checkoutV2(ADMIN, { mail: ADMIN });

      expect(h.stored(id).bookedVia).to.equal("user");
    });

    it("a manual booking of the administration is booked by the admin and belongs to the first mail", async function () {
      const booking = await h.manualBooking("room");

      expect(h.stored(booking.id).bookedVia).to.equal("admin");
      expect(h.stored(booking.id).assignedUserId).to.equal(CUSTOMER);
    });

    it("every booking of a group carries the same value, the group none", async function () {
      const signedIn = await groupCheckout(CUSTOMER);
      const guest = await groupCheckout(null);

      expect(h.members(signedIn).map((b) => b.bookedVia)).to.deep.equal([
        "user",
        "user",
      ]);
      expect(h.members(guest).map((b) => b.bookedVia)).to.deep.equal([
        "guest",
        "guest",
      ]);
      expect(h.groups.get(signedIn)).to.not.have.property("bookedVia");
    });
  });

  describe("a client never sets it", function () {
    it("the value a checkout sends is dropped", async function () {
      const id = await checkoutV2(null, { bookedVia: "admin" });

      expect(h.stored(id).bookedVia).to.equal("guest");
    });

    it("the value a manual booking sends is dropped", async function () {
      const booking = await h.manualBooking("room", {}, { bookedVia: "user" });

      expect(h.stored(booking.id).bookedVia).to.equal("admin");
    });

    it("the value an edit sends is dropped", async function () {
      const id = await checkoutV2(null);

      const put = await update(id, { bookedVia: "admin" });

      expect(put.status).to.equal(201);
      expect(h.stored(id).bookedVia).to.equal("guest");
    });
  });

  describe("an edit keeps it", function () {
    it("a guest booking stays a guest booking without owner when the admin changes the mail", async function () {
      const id = await checkoutV2(null);

      const put = await update(id, { mail: "max@example.test" });

      expect(put.status).to.equal(201);
      expect(put.body.bookedVia).to.equal("guest");
      expect(h.stored(id).bookedVia).to.equal("guest");
      expect(h.stored(id).assignedUserId).to.not.be.ok;
    });

    it("a booking via the user account stays the account's when the admin changes the mail", async function () {
      const id = await checkoutV2(CUSTOMER);

      const put = await update(id, { mail: "max@example.test" });

      expect(put.status).to.equal(201);
      expect(h.stored(id).bookedVia).to.equal("user");
      expect(h.stored(id).assignedUserId).to.equal(CUSTOMER);
    });

    it("a booking from before has none, and an edit gives it none", async function () {
      const id = await checkoutV2(null);
      delete h.stored(id).bookedVia;

      const put = await update(id, { bookedVia: "guest" });

      expect(put.status).to.equal(201);
      expect(put.body).to.not.have.property("bookedVia");
      expect(h.stored(id)).to.not.have.property("bookedVia");
    });
  });

  describe("the administration reads it", function () {
    it("in the list and the detail of a booking", async function () {
      const id = await checkoutV2(CUSTOMER);

      const list = await api().get(`/api/${TENANT}/bookings`).set(h.as(ADMIN));
      const detail = await api()
        .get(`/api/${TENANT}/bookings/${id}`)
        .set(h.as(ADMIN));

      expect(list.status).to.equal(200);
      expect(list.body.find((b) => b.id === id).bookedVia).to.equal("user");
      expect(detail.status).to.equal(200);
      expect(detail.body.bookedVia).to.equal("user");
    });
  });
});
