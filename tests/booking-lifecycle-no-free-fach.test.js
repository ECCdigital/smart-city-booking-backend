/**
 * Änderung and Wiederherstellung without a free Fach (tickets#1042),
 * through the HTTP form on the lifecycle harness: at an Anlage with its own
 * list the access seam answers `ConflictError compartments_unavailable`,
 * and the transition does not take place - in every state of the booking.
 * At `requested | payment_due` the hold anew finds no Fach, at `confirmed`
 * the Zuteilung in front of the update or the grant. The admin answer is
 * the 409 the Admin UI shows as „Kein Fach frei“; the stored booking stays
 * as it was, an Änderung with its old content, a Wiederherstellung
 * cancelled.
 */

const { expect } = require("chai");
const sinon = require("sinon");

const {
  installHarness,
  checkoutBody,
  adminForm,
  stateOf,
  TENANT,
  ADMIN,
  CUSTOMER,
  TIME_BEGIN,
  TIME_END,
  DAY,
} = require("./helpers/booking-lifecycle-harness");

describe("booking lifecycle: Änderung and Wiederherstellung without a free Fach", function () {
  let h;

  beforeEach(async function () {
    h = await installHarness();
  });

  afterEach(async function () {
    sinon.restore();
    await h.close();
  });

  const api = () => h.api();

  async function checkout(bookableId) {
    const res = await api()
      .post(`/api/v2/${TENANT}/checkout`)
      .set(h.as(CUSTOMER))
      .send(checkoutBody(bookableId));
    expect(res.status).to.equal(200);
    return res.body.data.booking.id;
  }

  const pay = (id) =>
    api().post(`/api/${TENANT}/bookings/${id}/pay`).set(h.as(ADMIN)).send({});
  const reject = (id) =>
    api()
      .post(`/api/${TENANT}/bookings/${id}/reject`)
      .set(h.as(ADMIN))
      .send({ reason: "Irrtum" });
  const update = (id, changes) =>
    api()
      .put(`/api/${TENANT}/bookings`)
      .set(h.as(ADMIN))
      .send(adminForm(h.stored(id), changes));
  const reinstate = (id) =>
    api().post(`/api/${TENANT}/bookings/${id}/reinstate`).set(h.as(ADMIN));

  async function bookingIn(state) {
    const id = await checkout(state === "requested" ? "room" : "auto-room");
    if (state === "confirmed") {
      await pay(id);
    }
    expect(stateOf(h.stored(id))).to.equal(state);
    h.clearEffects();
    return id;
  }

  const later = { timeBegin: TIME_BEGIN + DAY, timeEnd: TIME_END + DAY };

  function expectNoFreeFach(res) {
    expect(res.status).to.equal(409);
    expect(res.body).to.include({ code: "compartments_unavailable" });
  }

  describe("Änderung", function () {
    it("of a confirmed booking: the Zuteilung finds no Fach, 409, the old period stays, nothing is updated", async function () {
      const id = await bookingIn("confirmed");
      h.noFreeFach.add("access.allocate");

      const res = await update(id, later);

      expectNoFreeFach(res);
      const stored = h.stored(id);
      expect(stateOf(stored)).to.equal("confirmed");
      expect(stored).to.include({ timeBegin: TIME_BEGIN, timeEnd: TIME_END });
      expect(h.takeEffects()).to.deep.equal([
        "store.save B1 confirmed [receipt]",
        "access.allocate B1 FAILED",
        "store.restore B1 confirmed",
      ]);
    });

    for (const state of ["requested", "payment_due"]) {
      it(`of a booking ${state}: the Vormerkung anew finds no Fach, 409, the old period stays, nothing is revoked`, async function () {
        const id = await bookingIn(state);
        h.noFreeFach.add("access.hold");

        const res = await update(id, later);

        expectNoFreeFach(res);
        const stored = h.stored(id);
        expect(stateOf(stored)).to.equal(state);
        expect(stored).to.include({ timeBegin: TIME_BEGIN, timeEnd: TIME_END });
        expect(h.takeEffects()).to.deep.equal([
          `store.save B1 ${state}`,
          "access.hold B1 FAILED",
          `store.restore B1 ${state}`,
        ]);
      });
    }

    it("of a confirmed booking with a free Fach: the Zuteilung first, then the update", async function () {
      const id = await bookingIn("confirmed");

      const res = await update(id, later);

      expect(res.status).to.equal(201);
      expect(h.stored(id)).to.include({ timeBegin: TIME_BEGIN + DAY });
      expect(h.takeEffects()).to.deep.equal([
        "store.save B1 confirmed [receipt]",
        "access.allocate B1",
        "access.update B1",
      ]);
    });
  });

  describe("Wiederherstellung", function () {
    it("into confirmed: the Zuteilung finds no Fach, 409, the booking stays cancelled, nothing is granted", async function () {
      const id = await bookingIn("confirmed");
      await reject(id);
      h.clearEffects();
      h.noFreeFach.add("access.allocate");

      const res = await reinstate(id);

      expectNoFreeFach(res);
      expect(stateOf(h.stored(id))).to.equal("cancelled");
      expect(h.takeEffects()).to.deep.equal([
        "store.save B1 confirmed [receipt,cancellation]",
        "access.allocate B1 FAILED",
        "store.restore B1 cancelled",
      ]);
    });

    it("into requested: the Vormerkung finds no Fach, 409, the booking stays rejected", async function () {
      const id = await bookingIn("requested");
      await reject(id);
      h.clearEffects();
      h.noFreeFach.add("access.hold");

      const res = await reinstate(id);

      expectNoFreeFach(res);
      expect(stateOf(h.stored(id))).to.equal("rejected");
    });

    it("by clearing isRejected in the admin PUT: 409, the booking stays cancelled", async function () {
      const id = await bookingIn("confirmed");
      await reject(id);
      h.clearEffects();
      h.noFreeFach.add("access.allocate");

      const res = await update(id, { isRejected: false });

      expectNoFreeFach(res);
      expect(stateOf(h.stored(id))).to.equal("cancelled");
    });

    it("into confirmed with a free Fach: the Zuteilung first, then the grant", async function () {
      const id = await bookingIn("confirmed");
      await reject(id);
      h.clearEffects();

      const res = await reinstate(id);

      expect(res.status).to.equal(200);
      expect(stateOf(h.stored(id))).to.equal("confirmed");
      expect(h.takeEffects()).to.deep.equal([
        "store.save B1 confirmed [receipt,cancellation]",
        "access.allocate B1",
        "access.provision B1",
      ]);
    });
  });
});
