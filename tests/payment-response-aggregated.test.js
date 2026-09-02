const assert = require("assert");
const sinon = require("sinon");
const PaymentController = require("../src/platform/api/controllers/payment-controller");
const BookingManager = require("../src/commons/data-managers/booking-manager");
const PaymentUtils = require("../src/commons/utilities/payment-utils");

const TENANT_ID = "tenant-1";

function request(query) {
  return {
    params: { tenant: TENANT_ID },
    query: { tenant: TENANT_ID, ...query },
  };
}

function response() {
  return {
    redirect: sinon.spy(),
    sendStatus: sinon.spy(),
    status: sinon.stub().returnsThis(),
    send: sinon.spy(),
  };
}

describe("PaymentController.paymentResponse", function () {
  let getPaymentService;

  beforeEach(function () {
    sinon.stub(BookingManager, "getBookings").resolves([
      { id: "B-1", paymentProvider: "epaybl" },
      { id: "B-2", paymentProvider: "epaybl" },
    ]);
    getPaymentService = sinon
      .stub(PaymentUtils, "getPaymentService")
      .callsFake(async (tenantId, bookingId) => ({
        paymentResponse: async () =>
          `https://store.example.com/payment/${Array.isArray(bookingId) ? "group" : bookingId}?status=success`,
      }));
  });

  afterEach(function () {
    sinon.restore();
  });

  it('treats aggregated="false" from the provider redirect as a per-booking response', async function () {
    const res = response();

    await PaymentController.paymentResponse(
      request({ ids: "B-1,B-2", aggregated: "false" }),
      res,
    );

    assert.strictEqual(getPaymentService.callCount, 2);
    assert.strictEqual(getPaymentService.firstCall.args[1], "B-1");
    assert.strictEqual(getPaymentService.secondCall.args[1], "B-2");
    assert.strictEqual(res.redirect.callCount, 1);
    const [status, url] = res.redirect.firstCall.args;
    assert.strictEqual(status, 302);
    assert.strictEqual(new URL(url).searchParams.get("ids"), "B-1,B-2");
  });

  it('treats aggregated="true" as one aggregated response for all bookings', async function () {
    const res = response();

    await PaymentController.paymentResponse(
      request({ ids: "B-1,B-2", aggregated: "true" }),
      res,
    );

    assert.strictEqual(getPaymentService.callCount, 1);
    assert.deepStrictEqual(getPaymentService.firstCall.args[1], ["B-1", "B-2"]);
    assert.deepStrictEqual(getPaymentService.firstCall.args[3], {
      aggregated: true,
    });
    assert.strictEqual(res.redirect.callCount, 1);
    assert.strictEqual(
      res.redirect.firstCall.args[1],
      "https://store.example.com/payment/group?status=success",
    );
  });

  it("falls back to per-booking responses when the flag is absent", async function () {
    const res = response();

    await PaymentController.paymentResponse(request({ ids: "B-1,B-2" }), res);

    assert.strictEqual(getPaymentService.callCount, 2);
  });
});
