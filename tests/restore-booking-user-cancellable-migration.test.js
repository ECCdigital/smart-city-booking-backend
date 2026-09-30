const assert = require("assert");
const sinon = require("sinon");
const migration = require("../migrations/scripts/30-09-2026-restore-booking-user-cancellable");

describe("30-09-2026-restore-booking-user-cancellable migration", () => {
  afterEach(() => {
    sinon.restore();
  });

  it("restores userCancellable on bookings whose policy lost the flag", async () => {
    const Booking = { updateMany: sinon.stub().resolves() };
    const mongoose = {
      model: sinon.stub().withArgs("Booking").returns(Booking),
    };

    await migration.up(mongoose);

    assert.ok(Booking.updateMany.calledOnce);
    assert.deepStrictEqual(Booking.updateMany.firstCall.args, [
      {
        cancellationPolicy: { $type: "object" },
        "cancellationPolicy.userCancellable": { $exists: false },
      },
      { $set: { "cancellationPolicy.userCancellable": true } },
    ]);
  });

  it("leaves bookings alone on down", async () => {
    const Booking = { updateMany: sinon.stub().resolves() };
    const mongoose = { model: sinon.stub().returns(Booking) };

    await migration.down(mongoose);

    assert.ok(Booking.updateMany.notCalled);
  });
});
