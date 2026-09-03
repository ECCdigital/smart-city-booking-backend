/**
 * Characterization of the booking lifecycle as it is today, seen through
 * the HTTP form: every state change of a single booking - admission by the
 * checkout, confirmation, payment (administration and payment webhook),
 * cancellation, cancellation request, the admin PUT with its flag flips
 * and the hidden reinstatement - plus the reprint endpoints and the
 * workflow action that calls the same transitions.
 *
 * Written for the first ticket of the BookingLifecycle chain (Wayfinder,
 * "BookingLifecycle (1): Charakterisierungstests ..."); the vocabulary of
 * the states is the glossary in `CONTEXT.md`, "Buchungslebenszyklus". It
 * pins, it does not judge: each case lists the effects at the seam as a
 * table - store writes, access calls, documents, mails, workflow events -
 * in the order they happen today. The known defects are pinned as today's
 * behaviour and name the ticket of the chain that turns them; when that
 * ticket lands, the expectation here changes with it and the changelog
 * says so.
 *
 * The harness (`helpers/booking-lifecycle-harness.js`) runs the real
 * routers, controllers, `BookingService` and checkout over an in-memory
 * store; the seams record and, when told to, fail.
 */

const { expect } = require("chai");
const sinon = require("sinon");

const {
  installHarness,
  bookable,
  checkoutBody,
  adminForm,
  stateOf,
  TENANT,
  ADMIN,
  CUSTOMER,
  TIME_BEGIN,
  TIME_END,
  DAY,
} = require("./helpers/booking-lifecycle-harness");
const {
  BookingStatusAction,
} = require("../src/commons/services/workflow/workflow-action");

describe("booking lifecycle today: what each state change does at the seam", function () {
  let h;

  beforeEach(async function () {
    h = await installHarness();
  });

  afterEach(async function () {
    sinon.restore();
    await h.close();
  });

  // --- the requests ------------------------------------------------------

  const api = () => h.api();

  /** A customer's checkout through the storefront (v2). */
  async function checkout(bookableId, overrides) {
    const res = await api()
      .post(`/api/v2/${TENANT}/checkout`)
      .set(h.as(CUSTOMER))
      .send(checkoutBody(bookableId, overrides));
    expect(res.status).to.equal(200);
    return res.body;
  }

  const commit = (id) =>
    api().get(`/api/${TENANT}/bookings/${id}/commit`).set(h.as(ADMIN));
  const pay = (id, body = {}) =>
    api().post(`/api/${TENANT}/bookings/${id}/pay`).set(h.as(ADMIN)).send(body);
  const reject = (id, body = {}) =>
    api()
      .post(`/api/${TENANT}/bookings/${id}/reject`)
      .set(h.as(ADMIN))
      .send(body);
  const requestReject = (id, body = {}) =>
    api().post(`/api/${TENANT}/bookings/${id}/request-reject`).send(body);
  const releaseHook = (id, hookId) =>
    api()
      .get(`/api/${TENANT}/bookings/${id}/hooks/${hookId}/release`)
      .set(h.as(ADMIN));
  const update = (id, changes) =>
    api()
      .put(`/api/${TENANT}/bookings`)
      .set(h.as(ADMIN))
      .send(adminForm(h.stored(id), changes));

  /** A booking in a given state, with the rows of getting there forgotten. */
  async function bookingIn(state) {
    let id;
    switch (state) {
      case "requested":
        id = (await checkout("room")).data.booking.id;
        break;
      case "payment_due":
        id = (await checkout("auto-room")).data.booking.id;
        break;
      case "confirmed":
        id = (await checkout("auto-room")).data.booking.id;
        await pay(id);
        break;
      case "confirmed_free":
        id = (await checkout("free-room")).data.booking.id;
        break;
      default:
        throw new Error(`unknown state ${state}`);
    }
    expect(stateOf(h.stored(id))).to.equal(
      state === "confirmed_free" ? "confirmed" : state,
    );
    h.clearEffects();
    return id;
  }

  // -----------------------------------------------------------------------

  describe("admission: the checkout stores the booking and runs the effects of its state", function () {
    it("a self-service booking of a room to be confirmed arrives as requested", async function () {
      const body = await checkout("room");

      const { booking, payment } = body.data;
      expect(payment).to.equal(null);
      expect(stateOf(h.stored(booking.id))).to.equal("requested");
      expect(h.stored(booking.id)).to.include({
        assignedUserId: CUSTOMER,
        priceEur: 40,
        paymentProvider: "giroCockpit",
      });
      expect(h.takeEffects()).to.deep.equal([
        "store.save B1 requested",
        // Ticket 9: `onCreate` is the one event without `skipBookingStatus`.
        "workflow.onCreate B1 without skipBookingStatus",
        "access.hold B1",
        "mail.sendBookingRequestConfirmation B1",
        "mail.sendIncomingBooking B1",
        "supervisor.notify B1",
      ]);
    });

    it("a self-service booking of a room confirmed at once arrives as payment due and goes on to the payment link", async function () {
      const body = await checkout("auto-room");

      const { booking, payment } = body.data;
      expect(payment).to.deep.equal({
        provider: "giroCockpit",
        data: { url: "https://pay.example.test" },
      });
      expect(stateOf(h.stored(booking.id))).to.equal("payment_due");
      expect(h.takeEffects()).to.deep.equal([
        "store.save B1 payment_due",
        "workflow.onCreate B1 without skipBookingStatus",
        "access.hold B1",
        // Today a booking confirmation without receipt goes out here; the
        // spec's payment request (part 2 §8 `admit`) is ticket 9.
        "mail.sendBookingConfirmation B1",
        "mail.sendIncomingBooking B1",
        "supervisor.notify B1",
        "access.refreshHolds B1",
        "payment.createPayment B1",
      ]);
    });

    it("a self-service booking of a free room confirmed at once arrives as confirmed and is granted", async function () {
      const body = await checkout("free-room");

      const { booking, payment } = body.data;
      expect(payment).to.equal(null);
      expect(stateOf(h.stored(booking.id))).to.equal("confirmed");
      expect(h.stored(booking.id)).to.include({ priceEur: 0, isPayed: true });
      expect(h.takeEffects()).to.deep.equal([
        "store.save B1 confirmed",
        "workflow.onCreate B1 without skipBookingStatus",
        "access.hold B1",
        "access.provision B1",
        "mail.sendBookingConfirmation B1",
        "mail.sendIncomingBooking B1",
        "supervisor.notify B1",
      ]);
    });

    it("the legacy checkout answers the booking itself and runs the same effects", async function () {
      const res = await api()
        .post(`/api/${TENANT}/checkout`)
        .set(h.as(CUSTOMER))
        .send(checkoutBody("room"));

      expect(res.status).to.equal(200);
      expect(res.body).to.include({ id: h.stored(res.body.id).id });
      expect(stateOf(h.stored(res.body.id))).to.equal("requested");
      expect(h.takeEffects()).to.deep.equal([
        "store.save B1 requested",
        "workflow.onCreate B1 without skipBookingStatus",
        "access.hold B1",
        "mail.sendBookingRequestConfirmation B1",
        "mail.sendIncomingBooking B1",
        "supervisor.notify B1",
      ]);
    });

    it("a manual booking, confirmed and paid, is granted, receipted and confirmed by mail; the answer is the booking before the receipt", async function () {
      const booking = await h.manualBooking("room", {
        isCommitted: true,
        isPayed: true,
      });

      expect(booking.attachments).to.deep.equal([]);
      expect(booking.assignedUserId).to.equal(CUSTOMER);
      const stored = h.stored(booking.id);
      expect(stateOf(stored)).to.equal("confirmed");
      expect(stored.attachments.map((att) => att.type)).to.deep.equal([
        "receipt",
      ]);
      expect(h.takeEffects()).to.deep.equal([
        "store.save B1 confirmed",
        "workflow.onCreate B1 without skipBookingStatus",
        "access.hold B1",
        "access.provision B1",
        "documents.receipt B1",
        "store.save B1 confirmed [receipt]",
        "mail.sendBookingConfirmation B1 [RE-1.pdf]",
        "mail.sendIncomingBooking B1",
        "supervisor.notify B1",
      ]);
    });

    it("a manual booking, confirmed but unpaid, is held and confirmed by mail without a payment request", async function () {
      const booking = await h.manualBooking("room", { isCommitted: true });

      expect(stateOf(h.stored(booking.id))).to.equal("payment_due");
      expect(h.takeEffects()).to.deep.equal([
        "store.save B1 payment_due",
        "workflow.onCreate B1 without skipBookingStatus",
        "access.hold B1",
        "mail.sendBookingConfirmation B1",
        "mail.sendIncomingBooking B1",
        "supervisor.notify B1",
      ]);
    });

    it("a manual booking without flags arrives as requested", async function () {
      const booking = await h.manualBooking("room");

      expect(stateOf(h.stored(booking.id))).to.equal("requested");
      expect(h.takeEffects()).to.deep.equal([
        "store.save B1 requested",
        "workflow.onCreate B1 without skipBookingStatus",
        "access.hold B1",
        "mail.sendBookingRequestConfirmation B1",
        "mail.sendIncomingBooking B1",
        "supervisor.notify B1",
      ]);
    });

    it("a manual booking paid but unconfirmed is stored as such and treated as a request (ticket 9: 400 invalid_status)", async function () {
      const booking = await h.manualBooking("room", { isPayed: true });

      expect(stateOf(h.stored(booking.id))).to.equal("paid_unconfirmed");
      expect(h.takeEffects()).to.deep.equal([
        "store.save B1 paid_unconfirmed",
        "workflow.onCreate B1 without skipBookingStatus",
        "access.hold B1",
        "mail.sendBookingRequestConfirmation B1",
        "mail.sendIncomingBooking B1",
        "supervisor.notify B1",
      ]);
    });

    it("a hold that fails rolls the booking back: it never existed", async function () {
      h.failing.add("access.hold");

      const body = await checkout("room");

      expect(body.success).to.equal(false);
      expect(h.store.size).to.equal(0);
      expect(h.takeEffects()).to.deep.equal([
        "store.save B1 requested",
        "workflow.onCreate B1 without skipBookingStatus",
        "access.hold B1 FAILED",
        "store.remove B1",
      ]);
    });

    it("a mail that fails at admission is logged; the booking stands and the other mails go out", async function () {
      h.failing.add("mail.sendBookingRequestConfirmation");

      const body = await checkout("room");

      expect(stateOf(h.stored(body.data.booking.id))).to.equal("requested");
      expect(h.takeEffects()).to.deep.equal([
        "store.save B1 requested",
        "workflow.onCreate B1 without skipBookingStatus",
        "access.hold B1",
        "mail.sendBookingRequestConfirmation B1 FAILED",
        "mail.sendIncomingBooking B1",
        "supervisor.notify B1",
      ]);
    });
  });

  // -----------------------------------------------------------------------

  describe("confirmation: GET /bookings/:id/commit", function () {
    it("confirms a priced request, asks the payment provider for its payment request, and fires the workflow before the write", async function () {
      const id = await bookingIn("requested");

      const res = await commit(id);

      expect(res.status).to.equal(200);
      expect(res.body).to.deep.equal({ success: true, data: null, errors: [] });
      expect(stateOf(h.stored(id))).to.equal("payment_due");
      expect(h.takeEffects()).to.deep.equal([
        "workflow.onCommit B1",
        "store.save B1 payment_due",
        "payment.paymentRequest B1",
      ]);
    });

    it("confirms a free request, grants it and sends the free booking confirmation", async function () {
      const { booking } = (await checkout("free-request-room")).data;
      expect(stateOf(h.stored(booking.id))).to.equal("requested");
      // A free request is stored paid: the checkout sets `isPayed` from the
      // price, not from a payment (ticket 2 derives the flag from `status`).
      expect(h.stored(booking.id)).to.include({ priceEur: 0, isPayed: true });
      h.clearEffects();

      const res = await commit(booking.id);

      expect(res.status).to.equal(200);
      expect(stateOf(h.stored(booking.id))).to.equal("confirmed");
      expect(h.takeEffects()).to.deep.equal([
        "workflow.onCommit B1",
        "store.save B1 confirmed",
        "access.provision B1",
        "mail.sendFreeBookingConfirmation B1",
      ]);
    });

    it("answers 500 for a confirmed booking when the tenant has no payment service: commitBooking returns undefined (ticket 5)", async function () {
      const id = await bookingIn("requested");
      h.payment.available = false;

      const res = await commit(id);

      expect(res.status).to.equal(500);
      expect(res.text).to.equal("Could not commit booking");
      expect(stateOf(h.stored(id))).to.equal("payment_due");
      expect(h.takeEffects()).to.deep.equal([
        "workflow.onCommit B1",
        "store.save B1 payment_due",
      ]);
    });

    it("never mails the organizer of a ticket booking on confirmation - the block reads `type` off the item, not off `_bookableUsed` (ticket 5)", async function () {
      const booking = await h.manualBooking("ticket");
      expect(booking.bookableItems[0]._bookableUsed.type).to.equal("ticket");
      h.clearEffects();

      const res = await commit(booking.id);

      expect(res.status).to.equal(200);
      expect(h.takeEffects()).to.deep.equal([
        "workflow.onCommit B1",
        "store.save B1 payment_due",
        "payment.paymentRequest B1",
      ]);

      // The payment path reads `_bookableUsed` and does mail the organizer.
      await pay(booking.id);
      expect(h.takeEffects()).to.include("mail.sendNewBooking B1");
    });

    it("a grant that fails on a free confirmation restores the snapshot and answers 500 (ticket 5: recorded instead)", async function () {
      const { booking } = (await checkout("free-request-room")).data;
      h.clearEffects();
      h.failing.add("access.provision");

      const res = await commit(booking.id);

      expect(res.status).to.equal(500);
      expect(stateOf(h.stored(booking.id))).to.equal("requested");
      expect(h.takeEffects()).to.deep.equal([
        "workflow.onCommit B1",
        "store.save B1 confirmed",
        "access.provision B1 FAILED",
        "store.save B1 requested",
      ]);
    });

    it("a payment request that fails answers 500 for a booking that is confirmed (ticket 5: recorded instead)", async function () {
      const id = await bookingIn("requested");
      h.failing.add("payment.paymentRequest");

      const res = await commit(id);

      expect(res.status).to.equal(500);
      expect(stateOf(h.stored(id))).to.equal("payment_due");
      expect(h.takeEffects()).to.deep.equal([
        "workflow.onCommit B1",
        "store.save B1 payment_due",
        "payment.paymentRequest B1 FAILED",
      ]);
    });

    it("confirms a confirmed booking again, with a second payment request (ticket 5: 409 invalid_transition)", async function () {
      const id = await bookingIn("payment_due");

      const res = await commit(id);

      expect(res.status).to.equal(200);
      expect(h.takeEffects()).to.deep.equal([
        "workflow.onCommit B1",
        "store.save B1 payment_due",
        "payment.paymentRequest B1",
      ]);
    });
  });

  // -----------------------------------------------------------------------

  describe("payment: POST /bookings/:id/pay and the payment webhook", function () {
    it("the administration marks a booking paid: state write, grant, receipt as a second write, confirmation with the receipt", async function () {
      const id = await bookingIn("payment_due");

      const res = await pay(id, {
        paymentMethod: "CASH",
        timePaid: 1700000000000,
      });

      expect(res.status).to.equal(200);
      expect(res.body).to.deep.equal({ success: true, data: null, errors: [] });
      expect(h.stored(id)).to.include({
        isPayed: true,
        paymentMethod: "CASH",
        timePaid: 1700000000000,
      });
      expect(
        h.stored(id).attachments.map((att) => att.receiptId),
      ).to.deep.equal(["RE-1"]);
      expect(h.takeEffects()).to.deep.equal([
        "store.save B1 confirmed",
        "workflow.onPay B1",
        "access.provision B1",
        "documents.receipt B1",
        "store.save B1 confirmed [receipt]",
        "mail.sendBookingConfirmation B1 [RE-1.pdf]",
      ]);
    });

    it("the payment webhook runs the same transition with the provider's payment method", async function () {
      const id = await bookingIn("payment_due");

      const res = await h.webhook(`id=${id}`);

      expect(res.status).to.equal(200);
      // The method is the provider's word (the harness says CREDIT_CARD).
      expect(h.stored(id)).to.include({
        isPayed: true,
        paymentMethod: "CREDIT_CARD",
      });
      expect(h.takeEffects()).to.deep.equal([
        "store.save B1 confirmed",
        "workflow.onPay B1",
        "access.provision B1",
        "documents.receipt B1",
        "store.save B1 confirmed [receipt]",
        "mail.sendBookingConfirmation B1 [RE-1.pdf]",
      ]);
    });

    it("pays a request that was never confirmed: the flag is set, nothing is mailed (ticket 4: 409 invalid_transition)", async function () {
      const id = await bookingIn("requested");

      const res = await pay(id);

      expect(res.status).to.equal(200);
      expect(stateOf(h.stored(id))).to.equal("paid_unconfirmed");
      expect(h.takeEffects()).to.deep.equal([
        "store.save B1 paid_unconfirmed",
        "workflow.onPay B1",
        "access.provision B1",
      ]);
    });

    it("pays a paid booking again and issues a second receipt (ticket 4: 409 invalid_transition)", async function () {
      const id = await bookingIn("confirmed");

      const res = await pay(id);

      expect(res.status).to.equal(200);
      expect(
        h.stored(id).attachments.map((att) => att.receiptId),
      ).to.deep.equal(["RE-1", "RE-2"]);
      expect(h.takeEffects()).to.deep.equal([
        "store.save B1 confirmed [receipt]",
        "workflow.onPay B1",
        "access.provision B1",
        "documents.receipt B1",
        "store.save B1 confirmed [receipt,receipt]",
        "mail.sendBookingConfirmation B1 [RE-2.pdf]",
      ]);
    });

    it("a grant that fails leaves the booking paid; receipt and mail follow", async function () {
      const id = await bookingIn("payment_due");
      h.failing.add("access.provision");

      const res = await pay(id);

      expect(res.status).to.equal(200);
      expect(stateOf(h.stored(id))).to.equal("confirmed");
      expect(h.takeEffects()).to.deep.equal([
        "store.save B1 confirmed",
        "workflow.onPay B1",
        "access.provision B1 FAILED",
        "documents.receipt B1",
        "store.save B1 confirmed [receipt]",
        "mail.sendBookingConfirmation B1 [RE-1.pdf]",
      ]);
    });

    it("a receipt that fails answers 500 for a booking that is paid, without receipt or mail (ticket 4: recorded instead)", async function () {
      const id = await bookingIn("payment_due");
      h.failing.add("documents.receipt");

      const res = await pay(id);

      expect(res.status).to.equal(500);
      expect(res.text).to.equal("Could not set booking as paid");
      expect(stateOf(h.stored(id))).to.equal("confirmed");
      expect(h.stored(id).attachments).to.deep.equal([]);
      expect(h.takeEffects()).to.deep.equal([
        "store.save B1 confirmed",
        "workflow.onPay B1",
        "access.provision B1",
        "documents.receipt B1 FAILED",
      ]);
    });

    it("a mail that fails after the receipt is logged; the answer is 200", async function () {
      const id = await bookingIn("payment_due");
      h.failing.add("mail.sendBookingConfirmation");

      const res = await pay(id);

      expect(res.status).to.equal(200);
      expect(h.takeEffects()).to.deep.equal([
        "store.save B1 confirmed",
        "workflow.onPay B1",
        "access.provision B1",
        "documents.receipt B1",
        "store.save B1 confirmed [receipt]",
        "mail.sendBookingConfirmation B1 [RE-1.pdf] FAILED",
      ]);
    });

    it("paying a free booking issues no receipt", async function () {
      const id = await bookingIn("confirmed_free");

      const res = await pay(id);

      expect(res.status).to.equal(200);
      expect(h.takeEffects()).to.deep.equal([
        "store.save B1 confirmed",
        "workflow.onPay B1",
        "access.provision B1",
        "mail.sendBookingConfirmation B1",
      ]);
    });

    it("the receipt replaces the `mailAttach` documents in the confirmation instead of joining them (tickets 4, 8)", async function () {
      // Unpaid, the document of the room goes out with the confirmation.
      const unpaid = await checkout("room-with-doc");
      expect(h.takeEffects()).to.include(
        "mail.sendBookingConfirmation B1 [Hausordnung.pdf]",
      );

      // Paid at once, the receipt is all that goes out.
      await h.manualBooking("room-with-doc", {
        isCommitted: true,
        isPayed: true,
      });
      expect(h.takeEffects()).to.include(
        "mail.sendBookingConfirmation B2 [RE-1.pdf]",
      );

      // And the payment of the unpaid one carries the receipt alone.
      await pay(unpaid.data.booking.id);
      expect(h.takeEffects()).to.include(
        "mail.sendBookingConfirmation B1 [RE-2.pdf]",
      );
    });
  });

  // -----------------------------------------------------------------------

  describe("cancellation: POST /bookings/:id/reject", function () {
    it("cancels a paid booking: the cancellation document is rendered first and rides in the state write, then revoke and the cancel mail", async function () {
      const id = await bookingIn("confirmed");

      const res = await reject(id, { reason: "Raum gesperrt" });

      expect(res.status).to.equal(200);
      expect(res.text).to.equal("OK");
      const stored = h.stored(id);
      expect(stateOf(stored)).to.equal("cancelled");
      expect(stored.rejectionReason).to.equal("Raum gesperrt");
      expect(stored.cancellationRefund).to.include({
        origin: "admin",
        cancelledByUserId: ADMIN,
        originalAmountEur: 40,
      });
      expect(stored.attachments.map((att) => att.type)).to.deep.equal([
        "receipt",
        "cancellation",
      ]);
      expect(h.takeEffects()).to.deep.equal([
        "documents.cancellation B1",
        "store.save B1 cancelled [receipt,cancellation]",
        "workflow.onReject B1",
        "access.revoke B1",
        "mail.sendBookingCancel B1 [ST-1.pdf]",
      ]);
    });

    it("`skipCancellation` leaves the document out and mails without attachment", async function () {
      const id = await bookingIn("confirmed");

      const res = await reject(id, { reason: "", skipCancellation: true });

      expect(res.status).to.equal(200);
      expect(h.stored(id).attachments.map((att) => att.type)).to.deep.equal([
        "receipt",
      ]);
      expect(h.stored(id).cancellationRefund).to.include({ origin: "admin" });
      expect(h.takeEffects()).to.deep.equal([
        "store.save B1 cancelled [receipt]",
        "workflow.onReject B1",
        "access.revoke B1",
        "mail.sendBookingCancel B1",
      ]);
    });

    it("rejects a priced request with a cancellation document and the rejection mail", async function () {
      const id = await bookingIn("requested");

      const res = await reject(id, { reason: "Kein Platz" });

      expect(res.status).to.equal(200);
      expect(stateOf(h.stored(id))).to.equal("rejected");
      expect(h.takeEffects()).to.deep.equal([
        "documents.cancellation B1",
        "store.save B1 rejected [cancellation]",
        "workflow.onReject B1",
        "access.revoke B1",
        "mail.sendBookingRejection B1 [ST-1.pdf]",
      ]);
    });

    it("cancels a free booking without a document", async function () {
      const id = await bookingIn("confirmed_free");

      const res = await reject(id, { reason: "" });

      expect(res.status).to.equal(200);
      expect(stateOf(h.stored(id))).to.equal("cancelled");
      expect(h.takeEffects()).to.deep.equal([
        "store.save B1 cancelled",
        "workflow.onReject B1",
        "access.revoke B1",
        "mail.sendBookingCancel B1",
      ]);
    });

    it("an admin refund percentage overrides the tiers; an invalid one is a 400 before any effect", async function () {
      const id = await bookingIn("confirmed");

      const invalid = await reject(id, { refundPercentage: 150 });
      expect(invalid.status).to.equal(400);
      expect(invalid.text).to.equal("invalid_refund_percentage");
      expect(h.takeEffects()).to.deep.equal([]);

      const res = await reject(id, { refundPercentage: 50 });
      expect(res.status).to.equal(200);
      expect(h.stored(id).cancellationRefund).to.include({
        appliedRefundPercentage: 50,
        refundAmountEur: 20,
        cancellationFeeEur: 20,
        adminOverride: true,
      });
    });

    it("cancels a cancelled booking again and issues a second cancellation document (ticket 6: 409 invalid_transition)", async function () {
      const id = await bookingIn("confirmed");
      await reject(id, { reason: "einmal" });
      h.clearEffects();

      const res = await reject(id, { reason: "zweimal" });

      expect(res.status).to.equal(200);
      expect(
        h.stored(id).attachments.filter((att) => att.type === "cancellation"),
      ).to.have.length(2);
      expect(h.takeEffects()).to.deep.equal([
        "documents.cancellation B1",
        "store.save B1 cancelled [receipt,cancellation,cancellation]",
        "workflow.onReject B1",
        "access.revoke B1",
        "mail.sendBookingCancel B1 [ST-2.pdf]",
      ]);
    });

    it("a cancel mail that fails answers 500 for a booking that is cancelled (ticket 6: recorded instead)", async function () {
      const id = await bookingIn("confirmed");
      h.failing.add("mail.sendBookingCancel");

      const res = await reject(id, { reason: "" });

      expect(res.status).to.equal(500);
      expect(res.text).to.equal("Could not reject booking");
      expect(stateOf(h.stored(id))).to.equal("cancelled");
      expect(h.takeEffects()).to.deep.equal([
        "documents.cancellation B1",
        "store.save B1 cancelled [receipt,cancellation]",
        "workflow.onReject B1",
        "access.revoke B1",
        "mail.sendBookingCancel B1 [ST-1.pdf] FAILED",
      ]);
    });

    it("a revoke that fails is logged; the mail goes out", async function () {
      const id = await bookingIn("confirmed");
      h.failing.add("access.revoke");

      const res = await reject(id, { reason: "" });

      expect(res.status).to.equal(200);
      expect(h.takeEffects()).to.deep.equal([
        "documents.cancellation B1",
        "store.save B1 cancelled [receipt,cancellation]",
        "workflow.onReject B1",
        "access.revoke B1 FAILED",
        "mail.sendBookingCancel B1 [ST-1.pdf]",
      ]);
    });

    it("a cancellation document that fails leaves the booking untouched, 500 (ticket 6: the document follows the write)", async function () {
      const id = await bookingIn("confirmed");
      h.failing.add("documents.cancellation");

      const res = await reject(id, { reason: "" });

      expect(res.status).to.equal(500);
      expect(stateOf(h.stored(id))).to.equal("confirmed");
      expect(h.stored(id).cancellationRefund).to.equal(undefined);
      expect(h.takeEffects()).to.deep.equal([
        "documents.cancellation B1 FAILED",
      ]);
    });
  });

  // -----------------------------------------------------------------------

  describe("cancellation request: POST /bookings/:id/request-reject and the hook release", function () {
    it("stores a REJECT hook and mails the verification; the state stays", async function () {
      const id = await bookingIn("confirmed");

      const res = await requestReject(id, { reason: "Krank" });

      expect(res.status).to.equal(201);
      const stored = h.stored(id);
      expect(stateOf(stored)).to.equal("confirmed");
      expect(stored.hooks).to.have.length(1);
      expect(stored.hooks[0]).to.include({ type: "REJECT" });
      expect(stored.hooks[0].payload).to.deep.equal({ reason: "Krank" });
      expect(h.takeEffects()).to.deep.equal([
        "store.save B1 confirmed [receipt]",
        "mail.sendVerifyBookingRejection B1",
      ]);
    });

    it("keeps the bank details of the request, trimmed and upper-cased", async function () {
      const id = await bookingIn("confirmed");

      await requestReject(id, {
        reason: "",
        bankDetails: {
          accountHolder: " Erika Muster ",
          iban: "de12 3456",
          bic: "abc",
          bankName: "",
        },
      });

      expect(h.stored(id).hooks[0].payload.bankDetails).to.deep.equal({
        accountHolder: "Erika Muster",
        bankName: "",
        iban: "DE123456",
        bic: "ABC",
      });
    });

    it("refuses a booking whose policy is not user-cancellable, 403, without effect", async function () {
      h.bookables["fixed-room"] = bookable({
        id: "fixed-room",
        title: "Fester Raum",
        autoCommitBooking: true,
        cancellationPolicy: { userCancellable: false, contactHint: "" },
      });
      const { booking } = (await checkout("fixed-room")).data;
      h.clearEffects();

      const res = await requestReject(booking.id, { reason: "" });

      expect(res.status).to.equal(403);
      expect(res.body).to.include({
        code: "booking_user_cancellation_disabled",
      });
      expect(h.takeEffects()).to.deep.equal([]);
    });

    it("a verification mail that fails answers 500 for a hook that is stored (ticket 6: recorded instead)", async function () {
      const id = await bookingIn("confirmed");
      h.failing.add("mail.sendVerifyBookingRejection");

      const res = await requestReject(id, { reason: "" });

      // The service builds its `BaseError` with the params where the status
      // code goes, so the controller finds no numeric status and answers
      // its plain 500; the error code never reaches the client.
      expect(res.status).to.equal(500);
      expect(res.text).to.equal("Could not reject booking");
      expect(h.stored(id).hooks).to.have.length(1);
      expect(h.takeEffects()).to.deep.equal([
        "store.save B1 confirmed [receipt]",
        "mail.sendVerifyBookingRejection B1 FAILED",
      ]);
    });

    it("releasing the hook cancels as the customer: the hook goes, the refund is the customer's, the cancel mail goes out", async function () {
      const id = await bookingIn("confirmed");
      await requestReject(id, { reason: "Krank" });
      const [hook] = h.stored(id).hooks;
      h.clearEffects();

      const res = await releaseHook(id, hook.id);

      expect(res.status).to.equal(200);
      const stored = h.stored(id);
      expect(stateOf(stored)).to.equal("cancelled");
      expect(stored.hooks).to.deep.equal([]);
      expect(stored.rejectionReason).to.equal("Krank");
      expect(stored.cancellationRefund).to.include({ origin: "user" });
      expect(h.takeEffects()).to.deep.equal([
        "documents.cancellation B1",
        "store.save B1 cancelled [receipt,cancellation]",
        "workflow.onReject B1",
        "access.revoke B1",
        "mail.sendBookingCancel B1 [ST-1.pdf]",
      ]);
    });

    it("releasing the hook of a request sends the cancel mail, not the rejection: a hook counts as cancellation", async function () {
      const id = await bookingIn("requested");
      await requestReject(id, { reason: "" });
      const [hook] = h.stored(id).hooks;
      h.clearEffects();

      const res = await releaseHook(id, hook.id);

      expect(res.status).to.equal(200);
      expect(stateOf(h.stored(id))).to.equal("rejected");
      expect(h.takeEffects()).to.deep.equal([
        "documents.cancellation B1",
        "store.save B1 rejected [cancellation]",
        "workflow.onReject B1",
        "access.revoke B1",
        "mail.sendBookingCancel B1 [ST-1.pdf]",
      ]);
    });

    it("an unknown hook is a 404 without effect", async function () {
      const id = await bookingIn("confirmed");
      await requestReject(id, { reason: "" });
      h.clearEffects();

      const res = await releaseHook(id, "no-such-hook");

      expect(res.status).to.equal(404);
      expect(h.takeEffects()).to.deep.equal([]);
    });
  });

  // -----------------------------------------------------------------------

  describe("the admin PUT: content changes, flag flips and the hidden reinstatement", function () {
    it("moves a paid booking: one write, the access is updated, nothing is mailed", async function () {
      const id = await bookingIn("confirmed");

      const res = await update(id, {
        timeBegin: TIME_BEGIN + DAY,
        timeEnd: TIME_END + DAY,
      });

      expect(res.status).to.equal(201);
      expect(res.body).to.include({ id, timeBegin: TIME_BEGIN + DAY });
      const stored = h.stored(id);
      expect(stateOf(stored)).to.equal("confirmed");
      expect(stored.attachments.map((att) => att.type)).to.deep.equal([
        "receipt",
      ]);
      expect(h.takeEffects()).to.deep.equal([
        "store.save B1 confirmed [receipt]",
        "access.update B1",
      ]);
    });

    it("changes a request: the hold is taken back and made anew", async function () {
      const id = await bookingIn("requested");

      const res = await update(id, { comment: "Bitte Beamer" });

      expect(res.status).to.equal(201);
      expect(h.stored(id).comment).to.equal("Bitte Beamer");
      expect(h.takeEffects()).to.deep.equal([
        "store.save B1 requested",
        "access.revoke B1",
        "access.hold B1",
      ]);
    });

    it("drops an open cancellation request: the form does not carry the hooks, the write does not keep them", async function () {
      const id = await bookingIn("confirmed");
      await requestReject(id, { reason: "" });
      expect(h.stored(id).hooks).to.have.length(1);

      await update(id, { comment: "geändert" });

      expect(h.stored(id).hooks).to.deep.equal([]);
    });

    it("flipping isCommitted confirms after the content write, then holds anew", async function () {
      const id = await bookingIn("requested");

      const res = await update(id, { isCommitted: true });

      expect(res.status).to.equal(201);
      expect(stateOf(h.stored(id))).to.equal("payment_due");
      expect(h.takeEffects()).to.deep.equal([
        "store.save B1 payment_due",
        "workflow.onCommit B1",
        "store.save B1 payment_due",
        "payment.paymentRequest B1",
        "access.revoke B1",
        "access.hold B1",
      ]);
    });

    it("flipping isCommitted and isPayed at once confirms as if free, then pays: two grants, a free-booking mail and the receipt mail", async function () {
      const id = await bookingIn("requested");

      const res = await update(id, { isCommitted: true, isPayed: true });

      expect(res.status).to.equal(201);
      expect(stateOf(h.stored(id))).to.equal("confirmed");
      expect(h.takeEffects()).to.deep.equal([
        "store.save B1 confirmed",
        "workflow.onCommit B1",
        "store.save B1 confirmed",
        "access.provision B1",
        // The booking is paid when `commitBooking` reads it, so it goes the
        // "no payment required" way of a free booking.
        "mail.sendFreeBookingConfirmation B1",
        "store.save B1 confirmed",
        "workflow.onPay B1",
        "access.provision B1",
        "documents.receipt B1",
        "store.save B1 confirmed [receipt]",
        "mail.sendBookingConfirmation B1 [RE-1.pdf]",
        "access.update B1",
      ]);
    });

    it("flipping isRejected cancels as the system, with a full refund", async function () {
      const id = await bookingIn("confirmed");

      const res = await update(id, {
        isRejected: true,
        rejectionReason: "Doppelbuchung",
      });

      expect(res.status).to.equal(201);
      const stored = h.stored(id);
      expect(stateOf(stored)).to.equal("cancelled");
      expect(stored.cancellationRefund).to.include({
        origin: "system",
        appliedRefundPercentage: 100,
      });
      expect(h.takeEffects()).to.deep.equal([
        "store.save B1 cancelled [receipt]",
        "documents.cancellation B1",
        "store.save B1 cancelled [receipt,cancellation]",
        "workflow.onReject B1",
        "access.revoke B1",
        "mail.sendBookingCancel B1 [ST-1.pdf]",
      ]);
    });

    it("clearing isRejected reinstates: price and items of before, no refund, a new grant, no mail", async function () {
      const id = await bookingIn("confirmed");
      await reject(id, { reason: "Irrtum", refundPercentage: 50 });
      expect(h.stored(id).cancellationRefund).to.include({
        appliedRefundPercentage: 50,
      });
      h.clearEffects();

      const res = await update(id, { isRejected: false });

      expect(res.status).to.equal(201);
      const stored = h.stored(id);
      expect(stateOf(stored)).to.equal("confirmed");
      expect(stored).to.include({ priceEur: 40, rejectionReason: "" });
      expect(stored.cancellationRefund).to.equal(undefined);
      expect(stored.attachments.map((att) => att.type)).to.deep.equal([
        "receipt",
        "cancellation",
      ]);
      expect(h.takeEffects()).to.deep.equal([
        "store.save B1 confirmed [receipt,cancellation]",
        "access.provision B1",
      ]);
    });

    it("a failed flip restores the old booking but leaves the refund behind, and the mails are out (ticket 7)", async function () {
      const id = await bookingIn("confirmed");
      h.failing.add("mail.sendBookingCancel");

      const res = await update(id, { isRejected: true });

      // 500, but not the error handler's JSON: the service's `BaseError`
      // carries its params where the status code goes, the handler fails
      // on `res.status(...)`, and express answers its bare 500.
      expect(res.status).to.equal(500);
      expect(res.body).to.deep.equal({});
      const stored = h.stored(id);
      expect(stateOf(stored)).to.equal("confirmed");
      expect(stored.cancellationRefund).to.include({ origin: "system" });
      expect(stored.attachments.map((att) => att.type)).to.deep.equal([
        "receipt",
      ]);
      expect(h.takeEffects()).to.deep.equal([
        "store.save B1 cancelled [receipt]",
        "documents.cancellation B1",
        "store.save B1 cancelled [receipt,cancellation]",
        "workflow.onReject B1",
        "access.revoke B1",
        "mail.sendBookingCancel B1 [ST-1.pdf] FAILED",
        "store.save B1 confirmed [receipt]",
      ]);
    });

    it("stores any flag combination: paid without confirmed is written as sent (ticket 7: 400 invalid_status_change)", async function () {
      const id = await bookingIn("confirmed");

      const res = await update(id, { isCommitted: false, isPayed: true });

      expect(res.status).to.equal(201);
      expect(stateOf(h.stored(id))).to.equal("paid_unconfirmed");
      expect(h.takeEffects()).to.deep.equal([
        "store.save B1 paid_unconfirmed [receipt]",
        "access.revoke B1",
        "access.hold B1",
      ]);
    });
  });

  // -----------------------------------------------------------------------

  describe("reprint: POST /bookings/:id/receipt and /invoice", function () {
    it("reprints the receipt of a paid booking as a further attachment and answers the booking", async function () {
      const id = await bookingIn("confirmed");

      const res = await api()
        .post(`/api/${TENANT}/bookings/${id}/receipt`)
        .set(h.as(ADMIN));

      expect(res.status).to.equal(200);
      expect(res.body.success).to.equal(true);
      expect(
        res.body.data.attachments.map((att) => att.receiptId),
      ).to.deep.equal(["RE-1", "RE-2"]);
      expect(h.takeEffects()).to.deep.equal([
        "documents.receipt B1",
        "store.save B1 confirmed [receipt,receipt]",
      ]);
    });

    it("refuses the receipt of an unpaid booking as a consistency error, 200", async function () {
      const id = await bookingIn("payment_due");

      const res = await api()
        .post(`/api/${TENANT}/bookings/${id}/receipt`)
        .set(h.as(ADMIN));

      expect(res.status).to.equal(200);
      expect(res.body.success).to.equal(false);
      expect(res.body.errors.map((error) => error.code)).to.deep.equal([
        "PAYED_STATUS",
      ]);
      expect(h.takeEffects()).to.deep.equal([]);
    });

    it("issues an invoice on demand and mails it unless told not to", async function () {
      const id = await bookingIn("payment_due");

      const silent = await api()
        .post(`/api/${TENANT}/bookings/${id}/invoice?sendEmail=false`)
        .set(h.as(ADMIN));

      expect(silent.status).to.equal(200);
      expect(silent.body).to.include({ success: true, emailSent: false });
      expect(silent.body.invoice).to.deep.equal({
        name: "RG-1.pdf",
        invoiceId: "RG-1",
        revision: 1,
      });
      expect(h.takeEffects()).to.deep.equal([
        "documents.invoice B1",
        "store.save B1 payment_due [invoice]",
      ]);

      const mailed = await api()
        .post(`/api/${TENANT}/bookings/${id}/invoice`)
        .set(h.as(ADMIN));

      expect(mailed.status).to.equal(200);
      expect(mailed.body).to.include({ emailSent: true });
      expect(h.takeEffects()).to.deep.equal([
        "documents.invoice B1",
        "store.save B1 payment_due [invoice,invoice]",
        "mail.sendInvoice B1 [RG-2.pdf]",
      ]);
    });

    it("refuses the invoice when the invoice app is inactive, 400", async function () {
      const id = await bookingIn("payment_due");
      h.tenant.applications.find((app) => app.id === "invoice").active = false;

      const res = await api()
        .post(`/api/${TENANT}/bookings/${id}/invoice`)
        .set(h.as(ADMIN));

      expect(res.status).to.equal(400);
      expect(h.takeEffects()).to.deep.equal([]);
    });
  });

  // -----------------------------------------------------------------------

  describe("the workflow action calls the transitions without their workflow event", function () {
    const run = (bookingStatus, id) =>
      new BookingStatusAction({ bookingStatus }, id, TENANT).execute();

    it("commit", async function () {
      const id = await bookingIn("requested");

      await run(["commit"], id);

      expect(stateOf(h.stored(id))).to.equal("payment_due");
      expect(h.takeEffects()).to.deep.equal([
        "store.save B1 payment_due",
        "payment.paymentRequest B1",
      ]);
    });

    it("paid", async function () {
      const id = await bookingIn("payment_due");

      await run(["paid"], id);

      expect(stateOf(h.stored(id))).to.equal("confirmed");
      expect(h.takeEffects()).to.deep.equal([
        "store.save B1 confirmed",
        "access.provision B1",
        "documents.receipt B1",
        "store.save B1 confirmed [receipt]",
        "mail.sendBookingConfirmation B1 [RE-1.pdf]",
      ]);
    });

    it("reject, as the system with a full refund and the document", async function () {
      const id = await bookingIn("confirmed");

      await run(["reject"], id);

      expect(stateOf(h.stored(id))).to.equal("cancelled");
      expect(h.stored(id).cancellationRefund).to.include({
        origin: "system",
        appliedRefundPercentage: 100,
      });
      expect(h.takeEffects()).to.deep.equal([
        "documents.cancellation B1",
        "store.save B1 cancelled [receipt,cancellation]",
        "access.revoke B1",
        "mail.sendBookingCancel B1 [ST-1.pdf]",
      ]);
    });
  });
});
