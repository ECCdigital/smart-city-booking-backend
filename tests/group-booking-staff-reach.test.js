/**
 * The staff's reads of a group under the reach of the request (ticket
 * ECCdigital/tickets#265): the refund preview of a group cancellation
 * and the answer after saving the comment of a group read the group with
 * `scopeOf(req)`, as every other group handler does. Without it the
 * manager refuses the read ("groupBooking read without a reach") and the
 * route answers 500.
 *
 * Runs on the lifecycle harness; the comment is saved through the real
 * `GroupBookingManager.updateGroupBooking` over the harness' group store.
 */

const { expect } = require("chai");
const sinon = require("sinon");

const {
  installHarness,
  TENANT,
  ADMIN,
  CUSTOMER,
  ROLE_HOLDER,
  TIME_BEGIN,
  TIME_END,
  DAY,
} = require("./helpers/booking-lifecycle-harness");
const GroupBookingModel = require("../src/commons/data-managers/models/groupBookingModel");

describe("group bookings read by the staff within their reach", function () {
  this.timeout(20000);
  let h;

  beforeEach(async function () {
    h = await installHarness();
  });

  afterEach(async function () {
    sinon.restore();
    await h.close();
  });

  const api = () => h.api();

  /** A confirmed group of two paid slots, a day apart. */
  async function confirmedGroup() {
    const res = await api()
      .post(`/api/v2/${TENANT}/checkout/group`)
      .set(h.as(CUSTOMER))
      .send({
        bookableItems: [{ bookableId: "auto-room", amount: 1 }],
        bookingAttempts: [
          { timeBegin: TIME_BEGIN, timeEnd: TIME_END },
          { timeBegin: TIME_BEGIN + DAY, timeEnd: TIME_END + DAY },
        ],
        name: "Erika Muster",
        mail: CUSTOMER,
        paymentProvider: "giroCockpit",
      });
    expect(res.status).to.equal(200);
    const id = res.body.data.groupBooking.id;
    await api()
      .post(`/api/${TENANT}/group-bookings/${id}/pay`)
      .set(h.as(ADMIN));
    h.clearEffects();
    return id;
  }

  for (const [name, principal] of [
    ["a role holder", ROLE_HOLDER],
    ["the instance owner", ADMIN],
  ]) {
    describe(`as ${name}`, function () {
      it("GET /group-bookings/:id/cancellation-refund-preview answers the refund of every member", async function () {
        const id = await confirmedGroup();

        const res = await api()
          .get(
            `/api/${TENANT}/group-bookings/${id}/cancellation-refund-preview`,
          )
          .set(h.as(principal));

        expect(res.status).to.equal(200);
        expect(res.body.groupBookingId).to.equal(id);
        expect(res.body.bookings.map((b) => b.bookingId)).to.have.members(
          h.groups.get(id).bookingIds,
        );
      });

      it("PUT /group-bookings/:id saves the comment and answers the group", async function () {
        const id = await confirmedGroup();
        sinon
          .stub(GroupBookingModel, "updateOne")
          .callsFake(async (filter, update) => {
            const doc = h.groups.get(filter.id);
            if (!doc || doc.tenantId !== filter.tenantId) {
              return { matchedCount: 0 };
            }
            Object.assign(doc, update);
            return { matchedCount: 1 };
          });

        const res = await api()
          .put(`/api/${TENANT}/group-bookings/${id}`)
          .set(h.as(principal))
          .send({ updateData: { internalComments: "Schlüssel bei Pforte" } });

        expect(res.status).to.equal(200);
        expect(res.body.id).to.equal(id);
        expect(res.body.internalComments).to.equal("Schlüssel bei Pforte");
        expect(h.groups.get(id).internalComments).to.equal(
          "Schlüssel bei Pforte",
        );
      });
    });
  }
});
