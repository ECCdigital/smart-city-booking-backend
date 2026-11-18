/**
 * The bank details of a cancellation request (ECCdigital/tickets#16): the
 * customer's IBAN, BIC, account holder and bank lie in the stored hook
 * only encrypted with `CRYPTO_SECRET`, the release hands them to the
 * cancellation document in plain text, and the API answers them masked.
 * Seen through the HTTP form, over the lifecycle harness.
 */

const { expect } = require("chai");
const sinon = require("sinon");

const {
  installHarness,
  checkoutBody,
  TENANT,
  ADMIN,
  CUSTOMER,
} = require("./helpers/booking-lifecycle-harness");
const BookingManager = require("../src/commons/data-managers/booking-manager");
const CancellationService = require("../src/commons/services/payment/cancellation-service");
const { Booking } = require("../src/commons/entities/booking/booking");
const SecurityUtils = require("../src/commons/utilities/security-utils");

const BANK_DETAILS = {
  accountHolder: "Erika Muster",
  bankName: "Sparkasse",
  iban: "DE89370400440532013000",
  bic: "COBADEFFXXX",
};

describe("bank details of a cancellation request", function () {
  let h;
  const secret = process.env.CRYPTO_SECRET;

  beforeEach(async function () {
    h = await installHarness();
  });

  afterEach(async function () {
    process.env.CRYPTO_SECRET = secret;
    sinon.restore();
    await h.close();
  });

  const api = () => h.api();

  async function confirmedBooking() {
    const res = await api()
      .post(`/api/v2/${TENANT}/checkout`)
      .set(h.as(CUSTOMER))
      .send(checkoutBody("auto-room"));
    expect(res.status).to.equal(200);
    const id = res.body.data.booking.id;
    await api()
      .post(`/api/${TENANT}/bookings/${id}/pay`)
      .set(h.as(ADMIN))
      .send({});
    h.clearEffects();
    return id;
  }

  const requestReject = (id, body) =>
    api().post(`/api/${TENANT}/bookings/${id}/request-reject`).send(body);
  const releaseHook = (id, hookId) =>
    api()
      .get(`/api/${TENANT}/bookings/${id}/hooks/${hookId}/release`)
      .set(h.as(ADMIN));

  it("stores every field of the bank details encrypted, no IBAN in plain text", async function () {
    const id = await confirmedBooking();

    const res = await requestReject(id, {
      reason: "",
      bankDetails: BANK_DETAILS,
    });

    expect(res.status).to.equal(201);
    const stored = h.stored(id).hooks[0].payload.bankDetails;
    for (const field of Object.keys(BANK_DETAILS)) {
      expect(SecurityUtils.isEncrypted(stored[field]), field).to.equal(true);
    }
    expect(JSON.stringify(h.stored(id))).not.to.contain(BANK_DETAILS.iban);
  });

  it("hands the decrypted bank details to the cancellation document on release", async function () {
    const id = await confirmedBooking();
    await requestReject(id, { reason: "", bankDetails: BANK_DETAILS });
    const [hook] = h.stored(id).hooks;

    const res = await releaseHook(id, hook.id);

    expect(res.status).to.equal(200);
    const { options } = CancellationService.render.lastCall.args[0];
    expect(options.bankDetails).to.deep.equal(BANK_DETAILS);
  });

  it("still reads bank details stored in plain text before the migration", async function () {
    const id = await confirmedBooking();
    await requestReject(id, { reason: "" });
    const [hook] = h.stored(id).hooks;
    hook.payload.bankDetails = { ...BANK_DETAILS };

    const res = await releaseHook(id, hook.id);

    expect(res.status).to.equal(200);
    const { options } = CancellationService.render.lastCall.args[0];
    expect(options.bankDetails).to.deep.equal(BANK_DETAILS);
  });

  describe("the API answers them masked", function () {
    const MASKED = {
      accountHolder: "***",
      bankName: "***",
      iban: "****3000",
      bic: "***",
    };

    const bankDetailsOf = (booking) => booking.hooks[0].payload.bankDetails;

    it("for one booking", async function () {
      const id = await confirmedBooking();
      await requestReject(id, { reason: "", bankDetails: BANK_DETAILS });

      const res = await api()
        .get(`/api/${TENANT}/bookings/${id}`)
        .set(h.as(ADMIN));

      expect(res.status).to.equal(200);
      expect(bankDetailsOf(res.body)).to.deep.equal(MASKED);
    });

    it("for the list", async function () {
      const id = await confirmedBooking();
      await requestReject(id, { reason: "", bankDetails: BANK_DETAILS });

      const res = await api().get(`/api/${TENANT}/bookings`).set(h.as(ADMIN));

      expect(res.status).to.equal(200);
      const booking = res.body.find((b) => b.id === id);
      expect(bankDetailsOf(booking)).to.deep.equal(MASKED);
    });

    it("for the customer's own bookings", async function () {
      const id = await confirmedBooking();
      await requestReject(id, { reason: "", bankDetails: BANK_DETAILS });
      sinon
        .stub(BookingManager, "getAssignedBookings")
        .callsFake(async () => [new Booking(h.stored(id))]);

      const res = await api()
        .get(`/api/${TENANT}/bookings/assigned`)
        .set(h.as(CUSTOMER));

      expect(res.status).to.equal(200);
      expect(bankDetailsOf(res.body[0])).to.deep.equal(MASKED);
    });

    it("masks bank details stored in plain text as well", async function () {
      const id = await confirmedBooking();
      await requestReject(id, { reason: "" });
      h.stored(id).hooks[0].payload.bankDetails = { ...BANK_DETAILS };

      const res = await api()
        .get(`/api/${TENANT}/bookings/${id}`)
        .set(h.as(ADMIN));

      expect(bankDetailsOf(res.body)).to.deep.equal(MASKED);
    });
  });

  it("writes nothing and answers an error when CRYPTO_SECRET is missing", async function () {
    const id = await confirmedBooking();
    delete process.env.CRYPTO_SECRET;

    const res = await requestReject(id, {
      reason: "",
      bankDetails: BANK_DETAILS,
    });

    expect(res.status).to.equal(500);
    expect(h.stored(id).hooks).to.deep.equal([]);
  });

  it("writes nothing and answers an error when CRYPTO_SECRET has the wrong length", async function () {
    const id = await confirmedBooking();
    process.env.CRYPTO_SECRET = "too-short";

    const res = await requestReject(id, {
      reason: "",
      bankDetails: BANK_DETAILS,
    });

    expect(res.status).to.equal(500);
    expect(h.stored(id).hooks).to.deep.equal([]);
  });
});
