/**
 * The refund preview a signed-in customer gets before cancelling their own
 * request (ECCdigital/tickets#1360): the tiers of the tenant, as the
 * cancellation itself stores them, in the customer's form of the preview. The
 * administration keeps its preview, which reads a request as its rejection.
 * Seen through the HTTP form, over the lifecycle harness.
 */

const { expect } = require("chai");
const sinon = require("sinon");

const {
  installHarness,
  bookable,
  checkoutBody,
  TENANT,
  ADMIN,
  CUSTOMER,
} = require("./helpers/booking-lifecycle-harness");

const HOUR = 60 * 60 * 1000;

const TIERS = [
  { hoursBeforeStart: 48, refundPercentage: 100 },
  { hoursBeforeStart: 24, refundPercentage: 50 },
  { hoursBeforeStart: 0, refundPercentage: 20 },
];

describe("the refund preview of a customer's own request", function () {
  let h;

  beforeEach(async function () {
    h = await installHarness({
      tenant: { cancellationRefundTiers: TIERS },
      bookables: {
        "request-room": bookable({
          id: "request-room",
          title: "Raum (Anfrage)",
          priceCategories: [
            { priceEur: 100, interval: { start: null, end: null } },
          ],
        }),
        "fixed-room": bookable({
          id: "fixed-room",
          title: "Raum (nicht stornierbar)",
          priceCategories: [
            { priceEur: 100, interval: { start: null, end: null } },
          ],
          cancellationPolicy: { userCancellable: false, contactHint: "" },
        }),
      },
    });
  });

  afterEach(async function () {
    sinon.restore();
    await h.close();
  });

  const api = () => h.api();

  /** A request of the customer for 100 €, beginning in 32 hours. */
  async function ownRequest(bookableId = "request-room") {
    const timeBegin = Date.now() + 32 * HOUR;
    const res = await api()
      .post(`/api/v2/${TENANT}/checkout`)
      .set(h.as(CUSTOMER))
      .send(
        checkoutBody(bookableId, { timeBegin, timeEnd: timeBegin + 2 * HOUR }),
      );
    expect(res.status).to.equal(200);
    const id = res.body.data.booking.id;
    expect(h.stored(id).status).to.equal("requested");
    expect(h.stored(id).priceEur).to.equal(100);
    return id;
  }

  const preview = (id, who) =>
    api()
      .get(`/api/${TENANT}/bookings/${id}/cancellation-refund-preview`)
      .set(h.as(who));

  it("is the tiers for the customer, in the customer's form", async function () {
    const id = await ownRequest();

    const res = await preview(id, CUSTOMER);

    expect(res.status).to.equal(200);
    expect(res.body).to.include({
      bookingId: id,
      appliedRefundPercentage: 50,
      refundAmountEur: 50,
      cancellationFeeEur: 50,
      appliedTierHours: 24,
    });
    expect(res.body).not.to.have.any.keys(
      "origin",
      "rejection",
      "cancelledByUserId",
    );
  });

  it("is what the customer's cancellation stores", async function () {
    const id = await ownRequest();

    const res = await preview(id, CUSTOMER);
    const cancelled = await api()
      .post(`/api/${TENANT}/bookings/${id}/cancel`)
      .set(h.as(CUSTOMER))
      .send({ reason: "Termin verschoben" });

    expect(cancelled.status).to.equal(200);
    const stored = h.stored(id).cancellationRefund;
    expect(stored).to.include({ origin: "user", rejection: false });
    expect({
      appliedRefundPercentage: res.body.appliedRefundPercentage,
      refundAmountEur: res.body.refundAmountEur,
      cancellationFeeEur: res.body.cancellationFeeEur,
    }).to.deep.equal({
      appliedRefundPercentage: stored.appliedRefundPercentage,
      refundAmountEur: stored.refundAmountEur,
      cancellationFeeEur: stored.cancellationFeeEur,
    });
  });

  it("stays the rejection in full for the administration", async function () {
    const id = await ownRequest();

    const res = await preview(id, ADMIN);

    expect(res.status).to.equal(200);
    expect(res.body).to.include({
      bookingId: id,
      origin: "admin",
      rejection: true,
      appliedRefundPercentage: 100,
      refundAmountEur: 100,
      cancellationFeeEur: 0,
    });
  });

  it("refuses a booking the customer may not cancel: 403 booking_user_cancellation_disabled", async function () {
    const id = await ownRequest("fixed-room");

    const res = await preview(id, CUSTOMER);

    expect(res.status).to.equal(403);
    expect(res.text).to.equal("booking_user_cancellation_disabled");
  });
});
