/**
 * The deletion of a booking (`booking-deletion.js`), run over the
 * in-memory adapters: the access taken back, the documents removed, the
 * booking gone - in that order, and nothing further where a step fails.
 */

const { expect } = require("chai");

const {
  createBookingDeletion,
} = require("../src/commons/services/booking-lifecycle/booking-deletion");
const { NotFoundError } = require("../src/errors/BaseError");
const { inMemoryAdapters } = require("./helpers/in-memory-lifecycle-adapters");

const TENANT = "tenant-1";

function booking(overrides = {}) {
  return {
    id: "B-1",
    tenantId: TENANT,
    status: "confirmed",
    priceEur: 40,
    mail: "erika@example.test",
    attachments: [{ type: "receipt", receiptId: "receipt-1" }],
    accessInfo: [],
    bookableItems: [],
    ...overrides,
  };
}

async function failing(promise) {
  try {
    await promise;
  } catch (err) {
    return err;
  }
  return null;
}

describe("booking deletion", function () {
  it("takes the access back, removes the documents, then the booking", async function () {
    const adapters = inMemoryAdapters({ bookings: [booking()] });
    const deletion = createBookingDeletion(adapters);

    await deletion.remove(TENANT, "B-1");

    expect(adapters.access.calls).to.deep.equal([
      { op: "revoke", args: [TENANT, "B-1"] },
    ]);
    expect(adapters.documents.calls).to.have.length(1);
    expect(adapters.documents.calls[0].op).to.equal("remove");
    expect(adapters.documents.calls[0].args[0].tenantId).to.equal(TENANT);
    expect(adapters.documents.calls[0].args[0].booking.id).to.equal("B-1");
    expect(adapters.store.calls).to.deep.equal([
      { op: "remove", args: [TENANT, "B-1"] },
    ]);
    expect(adapters.store.rows.has("B-1")).to.equal(false);
  });

  it("answers booking_not_found for a booking the store does not hold, without effect", async function () {
    const adapters = inMemoryAdapters({ bookings: [] });
    const deletion = createBookingDeletion(adapters);

    const error = await failing(deletion.remove(TENANT, "B-1"));

    expect(error).to.be.instanceOf(NotFoundError);
    expect(error.code).to.equal("booking_not_found");
    expect(adapters.access.calls).to.deep.equal([]);
  });

  it("a revoke that fails stops the deletion: documents and booking stand", async function () {
    const adapters = inMemoryAdapters({
      bookings: [booking()],
      failOn: { access: ["revoke"] },
    });
    const deletion = createBookingDeletion(adapters);

    const error = await failing(deletion.remove(TENANT, "B-1"));

    expect(error).to.be.instanceOf(Error);
    expect(adapters.documents.calls).to.deep.equal([]);
    expect(adapters.store.rows.has("B-1")).to.equal(true);
  });

  it("documents that cannot be removed leave the booking standing", async function () {
    const adapters = inMemoryAdapters({
      bookings: [booking()],
      failOn: { documents: ["remove"] },
    });
    const deletion = createBookingDeletion(adapters);

    const error = await failing(deletion.remove(TENANT, "B-1"));

    expect(error).to.be.instanceOf(Error);
    expect(adapters.store.calls).to.deep.equal([]);
    expect(adapters.store.rows.has("B-1")).to.equal(true);
  });
});
