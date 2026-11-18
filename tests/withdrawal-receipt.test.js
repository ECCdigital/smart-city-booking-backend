/**
 * The withdrawal receipt (glossary "Widerrufbeleg") over HTTP: accepting a
 * withdrawal issues it - not the cancellation document - the reprint of a
 * withdrawn booking issues it anew as a further revision, and the download
 * route answers its bytes.
 *
 * Runs on the lifecycle harness: real routers, controllers and issuance
 * over an in-memory store, the renderers and the number draw recorded.
 */

const { expect } = require("chai");
const sinon = require("sinon");
const WithdrawalService = require("../src/commons/services/payment/withdrawal-service");

const {
  installHarness,
  checkoutBody,
  TENANT,
  ADMIN,
  CUSTOMER,
} = require("./helpers/booking-lifecycle-harness");

describe("withdrawal receipt", function () {
  let h;

  beforeEach(async function () {
    h = await installHarness();
  });

  afterEach(async function () {
    sinon.restore();
    await h.close();
  });

  const api = () => h.api();
  const documentsOf = (stored, type) =>
    stored.attachments
      .filter((att) => att.type === type)
      .map((att) => [att.withdrawalId || att.cancellationId, att.revision]);

  /** A paid private booking whose withdrawal the administration accepted. */
  async function withdrawnBooking() {
    const checkout = await api()
      .post(`/api/v2/${TENANT}/checkout`)
      .set(h.as(CUSTOMER))
      .send(checkoutBody("auto-room", { company: "" }));
    const id = checkout.body.data.booking.id;
    await api().post(`/api/${TENANT}/bookings/${id}/pay`).set(h.as(ADMIN));
    const res = await api()
      .post(`/api/${TENANT}/bookings/${id}/accept-withdrawal`)
      .set(h.as(ADMIN));
    expect(res.status).to.equal(200);
    return id;
  }

  it("is issued when a withdrawal is accepted, instead of the cancellation document", async function () {
    const id = await withdrawnBooking();

    expect(documentsOf(h.stored(id), "withdrawal")).to.deep.equal([
      ["WB-1", 1],
    ]);
    expect(documentsOf(h.stored(id), "cancellation")).to.deep.equal([]);
  });

  it("is issued anew by the reprint of a withdrawn booking", async function () {
    const id = await withdrawnBooking();

    const res = await api()
      .post(`/api/${TENANT}/bookings/${id}/cancellation-receipt`)
      .set(h.as(ADMIN));

    expect(res.status).to.equal(200);
    expect(documentsOf(h.stored(id), "withdrawal")).to.deep.equal([
      ["WB-1", 1],
      ["WB-1", 2],
    ]);
    expect(documentsOf(h.stored(id), "cancellation")).to.deep.equal([]);
  });

  it("is downloaded by its file name, by the booker too", async function () {
    const id = await withdrawnBooking();
    const { name } = h
      .stored(id)
      .attachments.find((att) => att.type === "withdrawal");
    sinon
      .stub(WithdrawalService, "getWithdrawal")
      .resolves(Buffer.from("%PDF-withdrawal"));

    const res = await api()
      .get(`/api/${TENANT}/bookings/${id}/withdrawal-receipt/${name}`)
      .set(h.as(CUSTOMER));

    expect(res.status).to.equal(200);
    expect(res.headers["content-type"]).to.match(/application\/pdf/);
    expect(WithdrawalService.getWithdrawal.firstCall.args).to.deep.equal([
      TENANT,
      name,
      id,
    ]);
  });
});
