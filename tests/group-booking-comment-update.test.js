/**
 * Saving the comment of a group writes the comment alone (ticket
 * ECCdigital/tickets#303): `PUT /group-bookings/:id` takes
 * `updateData: { internalComments }` and nothing else. Any other field, a
 * missing or empty `updateData` and a comment that is not a string answer
 * `400` and leave the group as it was.
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
  TIME_BEGIN,
  TIME_END,
  DAY,
} = require("./helpers/booking-lifecycle-harness");
const GroupBookingModel = require("../src/commons/data-managers/models/groupBookingModel");

describe("PUT /group-bookings/:id writes the comment alone", function () {
  this.timeout(20000);
  let h;
  let updateOne;

  beforeEach(async function () {
    h = await installHarness();
    updateOne = sinon
      .stub(GroupBookingModel, "updateOne")
      .callsFake(async (filter, update) => {
        const doc = h.groups.get(filter.id);
        if (!doc || doc.tenantId !== filter.tenantId) {
          return { matchedCount: 0 };
        }
        Object.assign(doc, update);
        return { matchedCount: 1 };
      });
  });

  afterEach(async function () {
    sinon.restore();
    await h.close();
  });

  const api = () => h.api();

  /** A group of two slots, a day apart, as the checkout stores it. */
  async function storedGroup() {
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
    h.clearEffects();
    return res.body.data.groupBooking.id;
  }

  const save = (id, body) =>
    api()
      .put(`/api/${TENANT}/group-bookings/${id}`)
      .set(h.as(ADMIN))
      .send(body);

  it("saves the comment and leaves every other field as it was", async function () {
    const id = await storedGroup();
    const before = JSON.parse(JSON.stringify(h.groups.get(id)));

    const res = await save(id, {
      updateData: { internalComments: "Schlüssel bei Pforte" },
    });

    expect(res.status).to.equal(200);
    expect(res.body.internalComments).to.equal("Schlüssel bei Pforte");
    expect(h.groups.get(id)).to.deep.equal({
      ...before,
      internalComments: "Schlüssel bei Pforte",
    });
  });

  for (const [name, body] of [
    ["the mail", { updateData: { mail: "x@example.org" } }],
    ["the tenant", { updateData: { tenantId: "tenant-2" } }],
    ["the members", { updateData: { bookingIds: ["foreign"] } }],
    [
      "the whole series next to the comment, as the Admin UI sent it",
      {
        updateData: {
          id: "ignored",
          tenantId: TENANT,
          bookingIds: [],
          hooks: [],
          mail: CUSTOMER,
          internalComments: "Neu",
        },
      },
    ],
    ["no updateData", {}],
    ["an empty updateData", { updateData: {} }],
    ["a comment that is not a string", { updateData: { internalComments: 5 } }],
    [
      "an operator as the comment",
      { updateData: { internalComments: { $ne: "" } } },
    ],
  ]) {
    it(`refuses ${name} with 400 and leaves the group as it was`, async function () {
      const id = await storedGroup();
      const before = JSON.parse(JSON.stringify(h.groups.get(id)));

      const res = await save(id, body);

      expect(res.status).to.equal(400);
      expect(res.body).to.include({
        error: "BadRequestError",
        code: "invalid_group_booking_update",
      });
      expect(res.body.params.allowed).to.deep.equal(["internalComments"]);
      expect(updateOne.called).to.equal(false);
      expect(h.groups.get(id)).to.deep.equal(before);
    });
  }
});
