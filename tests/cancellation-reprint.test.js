/**
 * The cancellation reprint (ticket 3 of the BookingLifecycle chain):
 * `POST /bookings/:id/cancellation-receipt` and
 * `POST /group-bookings/:id/cancellation-receipt` issue the cancellation
 * document anew as a further revision under the same number, from the
 * refund audit the cancellation left behind. Same right and answer as the
 * receipt reprint; a booking that is not cancelled answers 409.
 *
 * Runs on the lifecycle harness: real routers, controllers and issuance
 * over an in-memory store, the renderers and the number draw recorded.
 */

const { expect } = require("chai");
const sinon = require("sinon");
const PdfService = require("../src/commons/pdf-service/pdf-service");
const CancellationService = require("../src/commons/services/payment/cancellation-service");

const {
  installHarness,
  checkoutBody,
  TENANT,
  ADMIN,
  CUSTOMER,
  TIME_BEGIN,
  TIME_END,
  DAY,
} = require("./helpers/booking-lifecycle-harness");

describe("cancellation reprint: POST .../cancellation-receipt", function () {
  let h;

  beforeEach(async function () {
    h = await installHarness();
  });

  afterEach(async function () {
    sinon.restore();
    await h.close();
  });

  const api = () => h.api();
  const cancellations = (stored) =>
    stored.attachments
      .filter((att) => att.type === "cancellation")
      .map((att) => [att.cancellationId, att.revision]);

  /** A paid booking the administration cancelled with a partial refund. */
  async function cancelledBooking() {
    const checkout = await api()
      .post(`/api/v2/${TENANT}/checkout`)
      .set(h.as(CUSTOMER))
      .send(checkoutBody("auto-room"));
    const id = checkout.body.data.booking.id;
    await api().post(`/api/${TENANT}/bookings/${id}/pay`).set(h.as(ADMIN));
    await api()
      .post(`/api/${TENANT}/bookings/${id}/reject`)
      .set(h.as(ADMIN))
      .send({ reason: "Sturm", refundPercentage: 50 });
    expect(cancellations(h.stored(id))).to.deep.equal([["ST-1", 1]]);
    h.clearEffects();
    return id;
  }

  /** A customer's group checkout of two slots of the auto-confirmed room. */
  async function groupCheckout() {
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
        attachmentStatus: [],
      });
    expect(res.status).to.equal(200);
    return res.body.data.groupBooking.id;
  }

  /** A paid group the administration cancelled. */
  async function cancelledGroup() {
    const id = await groupCheckout();
    await api()
      .post(`/api/${TENANT}/group-bookings/${id}/pay`)
      .set(h.as(ADMIN));
    await api()
      .post(`/api/${TENANT}/group-bookings/${id}/reject`)
      .set(h.as(ADMIN))
      .send({ reason: "Sturm" });
    for (const member of h.members(id)) {
      expect(cancellations(member)).to.deep.equal([["ST-1", 1]]);
    }
    h.clearEffects();
    return id;
  }

  describe("a single booking", function () {
    it("issues the cancellation document anew as revision 2 under the same number, from the stored refund audit, and mails nothing", async function () {
      const id = await cancelledBooking();
      const audit = h.stored(id).cancellationRefund;

      const res = await api()
        .post(`/api/${TENANT}/bookings/${id}/cancellation-receipt`)
        .set(h.as(ADMIN));

      expect(res.status).to.equal(200);
      expect(res.body.success).to.equal(true);
      expect(res.body.errors).to.deep.equal([]);
      expect(cancellations(res.body.data)).to.deep.equal([
        ["ST-1", 1],
        ["ST-1", 2],
      ]);
      expect(cancellations(h.stored(id))).to.deep.equal([
        ["ST-1", 1],
        ["ST-1", 2],
      ]);
      const reprint = CancellationService.render.lastCall.args[0];
      expect(reprint.options.refundCalculation).to.deep.equal(audit);
      expect(reprint.options.cancellationReason).to.equal("Sturm");
      expect(reprint.options.alreadyPaid).to.equal(true);
      expect(h.takeEffects()).to.deep.equal([
        "documents.cancellation B1",
        "store.attach B1 cancellation",
      ]);
    });

    it("lets the owner reprint their own cancellation; for a stranger the booking does not exist (404)", async function () {
      const id = await cancelledBooking();

      const own = await api()
        .post(`/api/${TENANT}/bookings/${id}/cancellation-receipt`)
        .set(h.as(CUSTOMER));
      expect(own.status).to.equal(200);

      const stranger = await api()
        .post(`/api/${TENANT}/bookings/${id}/cancellation-receipt`)
        .set(h.as("fremd@example.test"));
      // Outside the reach `own` the booking is not there (authorize spec §4.2).
      expect(stranger.status).to.equal(404);
      expect(cancellations(h.stored(id))).to.have.length(2);
    });

    it("answers 409 not_cancelled for a booking that is not cancelled, without a draw", async function () {
      const checkout = await api()
        .post(`/api/v2/${TENANT}/checkout`)
        .set(h.as(CUSTOMER))
        .send(checkoutBody("auto-room"));
      const id = checkout.body.data.booking.id;
      h.clearEffects();

      const res = await api()
        .post(`/api/${TENANT}/bookings/${id}/cancellation-receipt`)
        .set(h.as(ADMIN));

      expect(res.status).to.equal(409);
      expect(res.body).to.include({ code: "not_cancelled", statusCode: 409 });
      expect(h.stored(id).attachments).to.deep.equal([]);
      expect(h.takeEffects()).to.deep.equal([]);
    });

    it("answers 404 for a booking that does not exist", async function () {
      const res = await api()
        .post(`/api/${TENANT}/bookings/nope/cancellation-receipt`)
        .set(h.as(ADMIN));

      expect(res.status).to.equal(404);
    });

    it("renders the reprint with the audit the cancellation stored", async function () {
      // Through the real renderer: the PDF is asked for the stored
      // calculation and the cancelled document's number.
      const id = await cancelledBooking();
      CancellationService.render.restore();
      const pdf = sinon
        .stub(PdfService, "generateSingleCancellationReceipt")
        .resolves({ name: "storno.pdf", buffer: Buffer.from("%PDF") });

      const res = await api()
        .post(`/api/${TENANT}/bookings/${id}/cancellation-receipt`)
        .set(h.as(ADMIN));

      expect(res.status).to.equal(200);
      const [, bookingId, number, original, options] = pdf.firstCall.args;
      expect(bookingId).to.equal(id);
      expect(number).to.equal("ST-1-2");
      expect(original).to.equal("RE-1-1");
      expect(options.refundCalculation).to.include({
        appliedRefundPercentage: 50,
        origin: "admin",
      });
      const reprint = cancellations(h.stored(id))[1];
      expect(reprint).to.deep.equal(["ST-1", 2]);
      const attachment = h.stored(id).attachments.at(-1);
      expect(attachment.name).to.equal("storno.pdf");
      expect(attachment.cancellation).to.include({
        appliedRefundPercentage: 50,
      });
      expect(attachment.cancellation.originalDocumentRef.number).to.equal(
        "RE-1-1",
      );
    });
  });

  describe("a group booking", function () {
    it("issues one aggregated cancellation document as revision 2, attached to every member, from the members' audits", async function () {
      const id = await cancelledGroup();
      const audits = h.members(id).map((member) => ({
        bookingId: member.id,
        ...member.cancellationRefund,
      }));

      const res = await api()
        .post(`/api/${TENANT}/group-bookings/${id}/cancellation-receipt`)
        .set(h.as(ADMIN));

      expect(res.status).to.equal(200);
      expect(res.body.success).to.equal(true);
      for (const member of res.body.data.bookings) {
        expect(cancellations(member)).to.deep.equal([
          ["ST-1", 1],
          ["ST-1", 2],
        ]);
      }
      const reprint = CancellationService.render.lastCall.args[0];
      expect(reprint.groupBookingId).to.equal(id);
      expect(reprint.options.refundCalculations).to.deep.equal(audits);
      expect(h.takeEffects()).to.deep.equal([
        "documents.aggregatedCancellation B1,B2",
        "store.attach B1 cancellation",
        "store.attach B2 cancellation",
      ]);
    });

    it("answers 409 not_cancelled for a group that is not cancelled", async function () {
      const id = await groupCheckout();
      h.clearEffects();

      const res = await api()
        .post(`/api/${TENANT}/group-bookings/${id}/cancellation-receipt`)
        .set(h.as(ADMIN));

      expect(res.status).to.equal(409);
      expect(res.body).to.include({ code: "not_cancelled" });
      expect(h.takeEffects()).to.deep.equal([]);
    });

    it("answers a user who is neither the group's customer nor its administration 404", async function () {
      const id = await cancelledGroup();

      const res = await api()
        .post(`/api/${TENANT}/group-bookings/${id}/cancellation-receipt`)
        .set(h.as("fremd@example.test"));

      // Outside the reach `own` the group is not there (authorize spec §4.2).
      expect(res.status).to.equal(404);
      expect(h.takeEffects()).to.deep.equal([]);
    });
  });
});
