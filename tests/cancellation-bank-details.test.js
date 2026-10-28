/**
 * The bank details of a cancellation (ECCdigital/tickets#565): one rule,
 * `refundBankDetails`, keeps them for a paid booking and drops them for an
 * unpaid one, the same for the direct cancellation, the cancellation
 * request and the rejection by the administration. Seen through the HTTP
 * form, over the lifecycle harness: at the cancellation document and, for
 * the request, at the stored hook.
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
const CancellationService = require("../src/commons/services/payment/cancellation-service");

const BANK_DETAILS = {
  accountHolder: "Erika Muster",
  bankName: "Sparkasse",
  iban: "DE89370400440532013000",
  bic: "COBADEFFXXX",
};

describe("bank details of a cancellation", function () {
  let h;

  beforeEach(async function () {
    h = await installHarness();
  });

  afterEach(async function () {
    sinon.restore();
    await h.close();
  });

  const api = () => h.api();

  /** A booking of the customer, awaiting payment or, `paid`, confirmed. */
  async function booking({ paid }) {
    const res = await api()
      .post(`/api/v2/${TENANT}/checkout`)
      .set(h.as(CUSTOMER))
      .send(checkoutBody("auto-room"));
    expect(res.status).to.equal(200);
    const id = res.body.data.booking.id;
    if (paid) {
      await api()
        .post(`/api/${TENANT}/bookings/${id}/pay`)
        .set(h.as(ADMIN))
        .send({});
    }
    expect(h.stored(id).status).to.equal(paid ? "confirmed" : "payment_due");
    h.clearEffects();
    return id;
  }

  /** The bank details the cancellation document was handed. */
  const documentBankDetails = () =>
    CancellationService.render.lastCall.args[0].options.bankDetails;

  const cancel = (id) =>
    api()
      .post(`/api/${TENANT}/bookings/${id}/cancel`)
      .set(h.as(CUSTOMER))
      .send({ reason: "Krank", bankDetails: BANK_DETAILS });

  const reject = (id) =>
    api()
      .post(`/api/${TENANT}/bookings/${id}/reject`)
      .set(h.as(ADMIN))
      .send({ reason: "Ausgefallen", bankDetails: BANK_DETAILS });

  async function requestAndRelease(id) {
    const requested = await api()
      .post(`/api/${TENANT}/bookings/${id}/request-reject`)
      .send({ reason: "Krank", bankDetails: BANK_DETAILS });
    expect(requested.status).to.equal(201);
    const [hook] = h.stored(id).hooks;
    const payload = hook.payload;
    const released = await api()
      .get(`/api/${TENANT}/bookings/${id}/hooks/${hook.id}/release`)
      .set(h.as(ADMIN));
    expect(released.status).to.equal(200);
    return payload;
  }

  describe("the direct cancellation", function () {
    it("keeps them for a paid booking", async function () {
      const id = await booking({ paid: true });

      const res = await cancel(id);

      expect(res.status).to.equal(200);
      expect(documentBankDetails()).to.deep.equal(BANK_DETAILS);
    });

    it("drops them for an unpaid booking", async function () {
      const id = await booking({ paid: false });

      const res = await cancel(id);

      expect(res.status).to.equal(200);
      expect(h.stored(id).status).to.equal("cancelled");
      expect(documentBankDetails()).to.equal(undefined);
    });
  });

  describe("the cancellation request", function () {
    it("keeps them for a paid booking, in the hook and the document", async function () {
      const id = await booking({ paid: true });

      const payload = await requestAndRelease(id);

      expect(payload.bankDetails).to.be.an("object");
      expect(documentBankDetails()).to.deep.equal(BANK_DETAILS);
    });

    it("drops them for an unpaid booking, neither in the hook nor the document", async function () {
      const id = await booking({ paid: false });

      const payload = await requestAndRelease(id);

      expect(payload).not.to.have.property("bankDetails");
      expect(h.stored(id).status).to.equal("cancelled");
      expect(documentBankDetails()).to.equal(undefined);
    });
  });

  describe("the rejection by the administration", function () {
    it("keeps them for a paid booking", async function () {
      const id = await booking({ paid: true });

      const res = await reject(id);

      expect(res.status).to.equal(200);
      expect(documentBankDetails()).to.deep.equal(BANK_DETAILS);
    });

    it("drops them for an unpaid booking", async function () {
      const id = await booking({ paid: false });

      const res = await reject(id);

      expect(res.status).to.equal(200);
      expect(h.stored(id).status).to.equal("cancelled");
      expect(documentBankDetails()).to.equal(undefined);
    });
  });
});
