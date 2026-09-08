const assert = require("assert");
const sinon = require("sinon");
const {
  BundleCheckoutService,
} = require("../src/commons/services/checkout/bundle-checkout-service");
const BookingManager = require("../src/commons/data-managers/booking-manager");

const TENANT_ID = "tenant-1";

function bundleService() {
  return new BundleCheckoutService({
    user: "user-1",
    tenant: TENANT_ID,
    timeBegin: 1788272933117,
    timeEnd: 1788280133117,
    bookableItems: [],
  });
}

describe("BundleCheckoutService.generateBookingReference", function () {
  afterEach(function () {
    sinon.restore();
  });

  it("returns a chunked reference the tenant does not know yet", async function () {
    const getBooking = sinon.stub(BookingManager, "getBooking").resolves(null);

    const reference = await bundleService().generateBookingReference();

    assert.match(
      reference,
      /^[ABCDEFGHJKMNPQRSTUXY]{4}-[ABCDEFGHJKMNPQRSTUXY]{4}$/,
    );
    assert.strictEqual(getBooking.callCount, 1);
    assert.deepStrictEqual(getBooking.firstCall.args, [reference, TENANT_ID]);
  });

  it("draws again when the tenant already has a booking under the reference", async function () {
    const getBooking = sinon
      .stub(BookingManager, "getBooking")
      .onFirstCall()
      .resolves({ id: "TAKEN" })
      .onSecondCall()
      .resolves(null);

    const reference = await bundleService().generateBookingReference();

    assert.strictEqual(getBooking.callCount, 2);
    assert.notStrictEqual(reference, getBooking.firstCall.args[0]);
    assert.strictEqual(reference, getBooking.secondCall.args[0]);
  });

  it("gives up after the retry budget instead of handing out a colliding reference", async function () {
    sinon.stub(BookingManager, "getBooking").resolves({ id: "TAKEN" });

    await assert.rejects(
      () => bundleService().generateBookingReference(8, 4, undefined, true, 3),
      /Retry count exceeded/,
    );
  });

  it("skips the lookup entirely when uniqueness is not requested", async function () {
    const getBooking = sinon.stub(BookingManager, "getBooking");

    await bundleService().generateBookingReference(8, 4, undefined, false);

    assert.strictEqual(getBooking.callCount, 0);
  });
});
