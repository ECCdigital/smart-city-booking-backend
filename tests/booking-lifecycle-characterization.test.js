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
 * routers, controllers, the checkout and the lifecycle over an in-memory
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
        "access.hold B1",
        "workflow.onCreate B1",
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
        "access.hold B1",
        "workflow.onCreate B1",
        // The customer at the storefront is asked to pay by the checkout's
        // answer, the payment page; no payment request goes out by mail.
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
        "access.hold B1",
        "access.provision B1",
        "workflow.onCreate B1",
        "mail.sendFreeBookingConfirmation B1",
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
        "access.hold B1",
        "workflow.onCreate B1",
        "mail.sendBookingRequestConfirmation B1",
        "mail.sendIncomingBooking B1",
        "supervisor.notify B1",
      ]);
    });

    it("a manual booking, confirmed and paid, is granted, receipted and confirmed by mail; the answer carries the receipt", async function () {
      const booking = await h.manualBooking("room", {
        isCommitted: true,
        isPayed: true,
      });

      expect(booking.attachments.map((att) => att.type)).to.deep.equal([
        "receipt",
      ]);
      expect(booking.assignedUserId).to.equal(CUSTOMER);
      const stored = h.stored(booking.id);
      expect(stateOf(stored)).to.equal("confirmed");
      expect(stored.attachments.map((att) => att.type)).to.deep.equal([
        "receipt",
      ]);
      expect(h.takeEffects()).to.deep.equal([
        "store.save B1 confirmed",
        "access.hold B1",
        "access.provision B1",
        "documents.receipt B1",
        "store.attach B1 receipt",
        "workflow.onCreate B1",
        "mail.sendBookingConfirmation B1 [RE-1.pdf]",
        "mail.sendIncomingBooking B1",
        "supervisor.notify B1",
      ]);
    });

    it("a manual booking, confirmed but unpaid, is held and asked to pay: nobody is at the screen to be handed the payment page", async function () {
      const booking = await h.manualBooking("room", { isCommitted: true });

      expect(stateOf(h.stored(booking.id))).to.equal("payment_due");
      expect(h.takeEffects()).to.deep.equal([
        "store.save B1 payment_due",
        "access.hold B1",
        "workflow.onCreate B1",
        "payment.paymentRequest B1",
        "mail.sendIncomingBooking B1",
        "supervisor.notify B1",
      ]);
    });

    it("a manual booking without flags arrives as requested", async function () {
      const booking = await h.manualBooking("room");

      expect(stateOf(h.stored(booking.id))).to.equal("requested");
      expect(h.takeEffects()).to.deep.equal([
        "store.save B1 requested",
        "access.hold B1",
        "workflow.onCreate B1",
        "mail.sendBookingRequestConfirmation B1",
        "mail.sendIncomingBooking B1",
        "supervisor.notify B1",
      ]);
    });

    it("a manual booking paid but unconfirmed is refused with 400 invalid_status before anything is written: no state stands for it", async function () {
      const res = await api()
        .put(`/api/${TENANT}/bookings`)
        .set(h.as(ADMIN))
        .send({ tenantId: TENANT, ...checkoutBody("room"), isPayed: true });

      expect(res.status).to.equal(400);
      expect(res.body.code).to.equal("invalid_status");
      expect(h.store.size).to.equal(0);
      expect(h.takeEffects()).to.deep.equal([]);
    });

    it("a hold that fails rolls the booking back: it never existed, and the checkout answers what the hold threw", async function () {
      h.failing.add("access.hold");

      const body = await checkout("room");

      expect(body.success).to.equal(false);
      expect(h.store.size).to.equal(0);
      expect(h.takeEffects()).to.deep.equal([
        "store.save B1 requested",
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
        "access.hold B1",
        "workflow.onCreate B1",
        "mail.sendBookingRequestConfirmation B1 FAILED",
        "mail.sendIncomingBooking B1",
        "supervisor.notify B1",
      ]);
    });
  });

  // -----------------------------------------------------------------------

  describe("confirmation: GET /bookings/:id/commit", function () {
    // Since ticket 5 the confirmation is the lifecycle transition
    // `confirm` (spec part 2, section 8): the state write first, the
    // workflow event after it, then the payment request (glossary
    // "Zahlungsaufforderung") or, for a free booking, grant and the free
    // booking confirmation.
    it("confirms a priced request: state write to payment due, then the workflow event and the payment request", async function () {
      const id = await bookingIn("requested");

      const res = await commit(id);

      expect(res.status).to.equal(200);
      expect(res.body).to.deep.equal({ success: true, data: null, errors: [] });
      expect(stateOf(h.stored(id))).to.equal("payment_due");
      expect(h.takeEffects()).to.deep.equal([
        "store.save B1 payment_due",
        "workflow.onCommit B1",
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
        "store.save B1 confirmed",
        "access.provision B1",
        "workflow.onCommit B1",
        "mail.sendFreeBookingConfirmation B1",
      ]);
    });

    it("confirms a priced request of a tenant without a payment service: the payment request is skipped, 200 (was a 500 from an undefined return)", async function () {
      const id = await bookingIn("requested");
      h.payment.available = false;

      const res = await commit(id);

      expect(res.status).to.equal(200);
      expect(res.body).to.deep.equal({ success: true, data: null, errors: [] });
      expect(stateOf(h.stored(id))).to.equal("payment_due");
      expect(h.takeEffects()).to.deep.equal([
        "store.save B1 payment_due",
        "workflow.onCommit B1",
      ]);
    });

    it("mails the organizer of a ticket booking on confirmation, reading the ticket off the bookable used (the block was dead before)", async function () {
      const booking = await h.manualBooking("ticket");
      expect(booking.bookableItems[0]._bookableUsed.type).to.equal("ticket");
      h.clearEffects();

      const res = await commit(booking.id);

      expect(res.status).to.equal(200);
      expect(h.takeEffects()).to.deep.equal([
        "store.save B1 payment_due",
        "workflow.onCommit B1",
        "payment.paymentRequest B1",
        "mail.sendNewBooking B1",
      ]);

      // The payment tells the organizer once more, as before.
      await pay(booking.id);
      expect(h.takeEffects()).to.include("mail.sendNewBooking B1");
    });

    it("a grant that fails on a free confirmation is recorded: the booking is confirmed, the mail goes out, 200 (was a 500 with the snapshot restored)", async function () {
      const { booking } = (await checkout("free-request-room")).data;
      h.clearEffects();
      h.failing.add("access.provision");

      const res = await commit(booking.id);

      expect(res.status).to.equal(200);
      expect(stateOf(h.stored(booking.id))).to.equal("confirmed");
      expect(h.takeEffects()).to.deep.equal([
        "store.save B1 confirmed",
        "access.provision B1 FAILED",
        "workflow.onCommit B1",
        "mail.sendFreeBookingConfirmation B1",
      ]);
    });

    it("a payment request that fails is recorded: the booking awaits payment, 200 (was a 500)", async function () {
      const id = await bookingIn("requested");
      h.failing.add("payment.paymentRequest");

      const res = await commit(id);

      expect(res.status).to.equal(200);
      expect(stateOf(h.stored(id))).to.equal("payment_due");
      expect(h.takeEffects()).to.deep.equal([
        "store.save B1 payment_due",
        "workflow.onCommit B1",
        "payment.paymentRequest B1 FAILED",
      ]);
    });

    it("refuses to confirm a booking awaiting payment again: 409 invalid_transition, no second payment request (was a 200 with one)", async function () {
      const id = await bookingIn("payment_due");

      const res = await commit(id);

      expect(res.status).to.equal(409);
      expect(res.body).to.include({ code: "invalid_transition" });
      expect(res.body.params).to.deep.equal({
        bookingId: id,
        status: "payment_due",
        transition: "confirm",
      });
      expect(stateOf(h.stored(id))).to.equal("payment_due");
      expect(h.takeEffects()).to.deep.equal([]);
    });

    it("refuses to confirm a confirmed booking: 409 invalid_transition without effect", async function () {
      const id = await bookingIn("confirmed");

      const res = await commit(id);

      expect(res.status).to.equal(409);
      expect(res.body.params).to.include({
        status: "confirmed",
        transition: "confirm",
      });
      expect(h.takeEffects()).to.deep.equal([]);
    });

    it("answers 404 for a booking it does not know", async function () {
      const res = await commit("no-such-booking");

      expect(res.status).to.equal(404);
      expect(res.body).to.include({ code: "booking_not_found" });
    });

    it("a state write that fails aborts the confirmation: 500, nothing else runs, the booking stays a request", async function () {
      const id = await bookingIn("requested");
      h.failing.add("store.save");

      const res = await commit(id);

      expect(res.status).to.equal(500);
      expect(res.text).to.equal("Could not commit booking");
      expect(stateOf(h.stored(id))).to.equal("requested");
      expect(h.takeEffects()).to.deep.equal(["store.save B1 FAILED"]);
    });
  });

  // -----------------------------------------------------------------------

  describe("payment: POST /bookings/:id/pay and the payment webhook", function () {
    // Since ticket 4 the payment is the lifecycle transition `pay` (spec
    // part 2, section 8): persist, provision, document, then notify - the
    // workflow event is the first notify step, after the receipt.
    it("the administration marks a booking paid: state write, grant, receipt as a second write, workflow event, confirmation with the receipt", async function () {
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
        "access.provision B1",
        "documents.receipt B1",
        "store.attach B1 receipt",
        "workflow.onPay B1",
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
        "access.provision B1",
        "documents.receipt B1",
        "store.attach B1 receipt",
        "workflow.onPay B1",
        "mail.sendBookingConfirmation B1 [RE-1.pdf]",
      ]);
    });

    it("a second webhook for a paid booking is a 409 invalid_transition without effect", async function () {
      const id = await bookingIn("confirmed");

      const res = await h.webhook(`id=${id}`);

      expect(res.status).to.equal(409);
      expect(res.body).to.include({ code: "invalid_transition" });
      expect(h.stored(id).attachments).to.have.length(1);
      expect(h.takeEffects()).to.deep.equal([]);
    });

    it("refuses to pay a request that was never confirmed: 409 invalid_transition, the guard fires before any effect", async function () {
      const id = await bookingIn("requested");

      const res = await pay(id);

      expect(res.status).to.equal(409);
      expect(res.body).to.include({ code: "invalid_transition" });
      expect(res.body.params).to.deep.equal({
        bookingId: id,
        status: "requested",
        transition: "pay",
      });
      expect(stateOf(h.stored(id))).to.equal("requested");
      expect(h.takeEffects()).to.deep.equal([]);
    });

    it("answers 404 for a booking it does not know", async function () {
      const res = await pay("no-such-booking");

      expect(res.status).to.equal(404);
      expect(res.body).to.include({ code: "booking_not_found" });
    });

    it("refuses to pay a paid booking again: 409 invalid_transition, no second receipt", async function () {
      const id = await bookingIn("confirmed");

      const res = await pay(id);

      expect(res.status).to.equal(409);
      expect(res.body.params).to.include({
        status: "confirmed",
        transition: "pay",
      });
      expect(
        h.stored(id).attachments.map((att) => [att.receiptId, att.revision]),
      ).to.deep.equal([["RE-1", 1]]);
      expect(h.takeEffects()).to.deep.equal([]);
    });

    it("a grant that fails leaves the booking paid; receipt and mail follow", async function () {
      const id = await bookingIn("payment_due");
      h.failing.add("access.provision");

      const res = await pay(id);

      expect(res.status).to.equal(200);
      expect(stateOf(h.stored(id))).to.equal("confirmed");
      expect(h.takeEffects()).to.deep.equal([
        "store.save B1 confirmed",
        "access.provision B1 FAILED",
        "documents.receipt B1",
        "store.attach B1 receipt",
        "workflow.onPay B1",
        "mail.sendBookingConfirmation B1 [RE-1.pdf]",
      ]);
    });

    it("a receipt that fails is recorded: the booking is paid without a receipt, the mail goes out without it, 200", async function () {
      const id = await bookingIn("payment_due");
      h.failing.add("documents.receipt");

      const res = await pay(id);

      expect(res.status).to.equal(200);
      expect(stateOf(h.stored(id))).to.equal("confirmed");
      expect(h.stored(id).attachments).to.deep.equal([]);
      expect(h.takeEffects()).to.deep.equal([
        "store.save B1 confirmed",
        "access.provision B1",
        "documents.receipt B1 FAILED",
        "workflow.onPay B1",
        "mail.sendBookingConfirmation B1",
      ]);
    });

    it("a state write that fails aborts the payment: 500, nothing else runs, the booking awaits payment", async function () {
      const id = await bookingIn("payment_due");
      h.failing.add("store.save");

      const res = await pay(id);

      expect(res.status).to.equal(500);
      expect(res.text).to.equal("Could not set booking as paid");
      expect(stateOf(h.stored(id))).to.equal("payment_due");
      expect(h.takeEffects()).to.deep.equal(["store.save B1 FAILED"]);
    });

    it("a mail that fails after the receipt is logged; the answer is 200", async function () {
      const id = await bookingIn("payment_due");
      h.failing.add("mail.sendBookingConfirmation");

      const res = await pay(id);

      expect(res.status).to.equal(200);
      expect(h.takeEffects()).to.deep.equal([
        "store.save B1 confirmed",
        "access.provision B1",
        "documents.receipt B1",
        "store.attach B1 receipt",
        "workflow.onPay B1",
        "mail.sendBookingConfirmation B1 [RE-1.pdf] FAILED",
      ]);
    });

    it("refuses to pay a free booking: it is confirmed already, 409", async function () {
      const id = await bookingIn("confirmed_free");

      const res = await pay(id);

      expect(res.status).to.equal(409);
      expect(res.body.params).to.include({ status: "confirmed" });
      expect(h.takeEffects()).to.deep.equal([]);
    });

    it("the receipt joins the `mailAttach` documents, at the admission of a paid manual booking as on payment", async function () {
      // Awaiting payment, the customer gets no mail at the checkout: the
      // payment page is the answer.
      const unpaid = await checkout("room-with-doc");
      expect(
        h.takeEffects().filter((row) => row.startsWith("mail.sendBooking")),
      ).to.deep.equal([]);

      // Paid at once, the receipt goes out with the document of the room.
      await h.manualBooking("room-with-doc", {
        isCommitted: true,
        isPayed: true,
      });
      expect(h.takeEffects()).to.include(
        "mail.sendBookingConfirmation B2 [RE-1.pdf,Hausordnung.pdf]",
      );

      // And the payment of the unpaid one carries the receipt and the document.
      await pay(unpaid.data.booking.id);
      expect(h.takeEffects()).to.include(
        "mail.sendBookingConfirmation B1 [RE-2.pdf,Hausordnung.pdf]",
      );
    });
  });

  // -----------------------------------------------------------------------

  describe("cancellation: POST /bookings/:id/reject", function () {
    it("cancels a paid booking: the state write with the refund audit, revoke, the cancellation document, workflow event, the cancel mail with the document", async function () {
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
        "store.save B1 cancelled [receipt]",
        "access.revoke B1",
        "documents.cancellation B1",
        "store.attach B1 cancellation",
        "workflow.onReject B1",
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
        "access.revoke B1",
        "workflow.onReject B1",
        "mail.sendBookingCancel B1",
      ]);
    });

    it("rejects a priced request with a cancellation document and the rejection mail", async function () {
      const id = await bookingIn("requested");

      const res = await reject(id, { reason: "Kein Platz" });

      expect(res.status).to.equal(200);
      expect(stateOf(h.stored(id))).to.equal("rejected");
      expect(h.takeEffects()).to.deep.equal([
        "store.save B1 rejected",
        "access.revoke B1",
        "documents.cancellation B1",
        "store.attach B1 cancellation",
        "workflow.onReject B1",
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
        "access.revoke B1",
        "workflow.onReject B1",
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

    it("refuses to cancel a cancelled booking again: 409 invalid_transition, no second document", async function () {
      const id = await bookingIn("confirmed");
      await reject(id, { reason: "einmal" });
      h.clearEffects();

      const res = await reject(id, { reason: "zweimal" });

      expect(res.status).to.equal(409);
      expect(res.body).to.include({ code: "invalid_transition" });
      expect(res.body.params).to.include({
        status: "cancelled",
        transition: "cancel",
      });
      expect(h.stored(id).rejectionReason).to.equal("einmal");
      expect(
        h
          .stored(id)
          .attachments.filter((att) => att.type === "cancellation")
          .map((att) => [att.cancellationId, att.revision]),
      ).to.deep.equal([["ST-1", 1]]);
      expect(h.takeEffects()).to.deep.equal([]);
    });

    it("answers 404 for a booking it does not know", async function () {
      const res = await reject("no-such-booking", { reason: "" });

      expect(res.status).to.equal(404);
      expect(res.body).to.include({ code: "booking_not_found" });
      expect(h.takeEffects()).to.deep.equal([]);
    });

    it("a cancel mail that fails is recorded: the booking is cancelled, 200", async function () {
      const id = await bookingIn("confirmed");
      h.failing.add("mail.sendBookingCancel");

      const res = await reject(id, { reason: "" });

      expect(res.status).to.equal(200);
      expect(stateOf(h.stored(id))).to.equal("cancelled");
      expect(h.takeEffects()).to.deep.equal([
        "store.save B1 cancelled [receipt]",
        "access.revoke B1",
        "documents.cancellation B1",
        "store.attach B1 cancellation",
        "workflow.onReject B1",
        "mail.sendBookingCancel B1 [ST-1.pdf] FAILED",
      ]);
    });

    it("a revoke that fails is logged; the mail goes out", async function () {
      const id = await bookingIn("confirmed");
      h.failing.add("access.revoke");

      const res = await reject(id, { reason: "" });

      expect(res.status).to.equal(200);
      expect(h.takeEffects()).to.deep.equal([
        "store.save B1 cancelled [receipt]",
        "access.revoke B1 FAILED",
        "documents.cancellation B1",
        "store.attach B1 cancellation",
        "workflow.onReject B1",
        "mail.sendBookingCancel B1 [ST-1.pdf]",
      ]);
    });

    it("a cancellation document that fails is recorded: the booking is cancelled without it, the mail goes out without attachment, 200", async function () {
      const id = await bookingIn("confirmed");
      h.failing.add("documents.cancellation");

      const res = await reject(id, { reason: "" });

      expect(res.status).to.equal(200);
      expect(stateOf(h.stored(id))).to.equal("cancelled");
      expect(h.stored(id).cancellationRefund).to.include({ origin: "admin" });
      expect(h.stored(id).attachments.map((att) => att.type)).to.deep.equal([
        "receipt",
      ]);
      expect(h.takeEffects()).to.deep.equal([
        "store.save B1 cancelled [receipt]",
        "access.revoke B1",
        "documents.cancellation B1 FAILED",
        "workflow.onReject B1",
        "mail.sendBookingCancel B1",
      ]);
    });

    it("a state write that fails aborts before any effect, 500", async function () {
      const id = await bookingIn("confirmed");
      h.failing.add("store.save");

      const res = await reject(id, { reason: "" });

      expect(res.status).to.equal(500);
      expect(res.text).to.equal("Could not reject booking");
      expect(stateOf(h.stored(id))).to.equal("confirmed");
      expect(h.stored(id).cancellationRefund).to.equal(undefined);
      expect(h.takeEffects()).to.deep.equal(["store.save B1 FAILED"]);
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
      expect(res.body).to.deep.equal({
        code: "booking_user_cancellation_disabled",
        message: "booking_user_cancellation_disabled",
      });
      expect(h.takeEffects()).to.deep.equal([]);
    });

    it("a verification mail that fails is recorded: the hook stands, 201", async function () {
      const id = await bookingIn("confirmed");
      h.failing.add("mail.sendVerifyBookingRejection");

      const res = await requestReject(id, { reason: "" });

      expect(res.status).to.equal(201);
      expect(h.stored(id).hooks).to.have.length(1);
      expect(h.takeEffects()).to.deep.equal([
        "store.save B1 confirmed [receipt]",
        "mail.sendVerifyBookingRejection B1 FAILED",
      ]);
    });

    it("refuses a cancellation request for a cancelled booking: 409 invalid_transition", async function () {
      const id = await bookingIn("confirmed");
      await reject(id, { reason: "" });
      h.clearEffects();

      const res = await requestReject(id, { reason: "" });

      expect(res.status).to.equal(409);
      expect(res.body).to.include({ code: "invalid_transition" });
      expect(h.stored(id).hooks).to.deep.equal([]);
      expect(h.takeEffects()).to.deep.equal([]);
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
        "store.save B1 cancelled [receipt]",
        "access.revoke B1",
        "documents.cancellation B1",
        "store.attach B1 cancellation",
        "workflow.onReject B1",
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
        "store.save B1 rejected",
        "access.revoke B1",
        "documents.cancellation B1",
        "store.attach B1 cancellation",
        "workflow.onReject B1",
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

    it("changes a request: the compartments are held anew, then what is granted taken back", async function () {
      const id = await bookingIn("requested");

      const res = await update(id, { comment: "Bitte Beamer" });

      expect(res.status).to.equal(201);
      expect(h.stored(id).comment).to.equal("Bitte Beamer");
      expect(h.takeEffects()).to.deep.equal([
        "store.save B1 requested",
        "access.hold B1",
        "access.revoke B1",
      ]);
    });

    it("keeps an open cancellation request: the form does not carry the hooks, the content write carries the stored ones (the request was lost before)", async function () {
      const id = await bookingIn("confirmed");
      await requestReject(id, { reason: "" });
      const [hook] = h.stored(id).hooks;

      await update(id, { comment: "geändert" });

      expect(h.stored(id).comment).to.equal("geändert");
      expect(h.stored(id).hooks.map((stored) => stored.id)).to.deep.equal([
        hook.id,
      ]);
    });

    // The PUT is the plan of spec part 1, section 6 (`update-plan.js`):
    // `amend` first, the content write in the state the booking is in with
    // the access following the content, then the transitions the flags ask
    // for, each atomic for itself.
    it("flipping isCommitted is the plan [amend, confirm]: the content write as a request with the hold anew, then the confirmation with the payment request", async function () {
      const id = await bookingIn("requested");

      const res = await update(id, { isCommitted: true });

      expect(res.status).to.equal(201);
      expect(stateOf(h.stored(id))).to.equal("payment_due");
      expect(h.takeEffects()).to.deep.equal([
        "store.save B1 requested",
        "access.hold B1",
        "access.revoke B1",
        "store.save B1 payment_due",
        "workflow.onCommit B1",
        "payment.paymentRequest B1",
      ]);
    });

    it("flipping isCommitted and isPayed at once is the plan [amend, confirm, pay]: the confirmation with the payment request, then the payment with grant, receipt and the receipt mail", async function () {
      const id = await bookingIn("requested");

      const res = await update(id, { isCommitted: true, isPayed: true });

      expect(res.status).to.equal(201);
      expect(stateOf(h.stored(id))).to.equal("confirmed");
      expect(h.takeEffects()).to.deep.equal([
        "store.save B1 requested",
        "access.hold B1",
        "access.revoke B1",
        "store.save B1 payment_due",
        "workflow.onCommit B1",
        "payment.paymentRequest B1",
        "store.save B1 confirmed",
        "access.provision B1",
        "documents.receipt B1",
        "store.attach B1 receipt",
        "workflow.onPay B1",
        "mail.sendBookingConfirmation B1 [RE-1.pdf]",
      ]);
    });

    it("a transition that fails leaves the ones before it standing: a reinstatement whose hold fails answers 500, the content is written and the booking stays cancelled", async function () {
      const id = await bookingIn("payment_due");
      await reject(id, { reason: "Irrtum" });
      h.clearEffects();
      h.failing.add("access.hold");

      const res = await update(id, {
        isRejected: false,
        comment: "wieder da",
      });

      expect(res.status).to.equal(500);
      const stored = h.stored(id);
      expect(stateOf(stored)).to.equal("cancelled");
      expect(stored.comment).to.equal("wieder da");
      expect(stored.cancellationRefund).to.include({
        cancelledFrom: "payment_due",
      });
      expect(h.takeEffects()).to.deep.equal([
        "store.save B1 cancelled [cancellation]",
        "store.save B1 payment_due [cancellation]",
        "access.hold B1 FAILED",
        "store.restore B1 cancelled",
      ]);
    });

    it("flipping isRejected is the plan [amend, cancel]: cancelled by the administration with a full refund", async function () {
      const id = await bookingIn("confirmed");

      const res = await update(id, {
        isRejected: true,
        rejectionReason: "Doppelbuchung",
      });

      expect(res.status).to.equal(201);
      const stored = h.stored(id);
      expect(stateOf(stored)).to.equal("cancelled");
      expect(stored.cancellationRefund).to.include({
        origin: "admin",
        appliedRefundPercentage: 100,
        cancelledByUserId: ADMIN,
      });
      expect(h.takeEffects()).to.deep.equal([
        "store.save B1 confirmed [receipt]",
        "access.update B1",
        "store.save B1 cancelled [receipt]",
        "access.revoke B1",
        "documents.cancellation B1",
        "store.attach B1 cancellation",
        "workflow.onReject B1",
        "mail.sendBookingCancel B1 [ST-1.pdf]",
      ]);
    });

    it("amending a cancelled booking without a flip keeps its refund audit", async function () {
      const id = await bookingIn("confirmed");
      await reject(id, { reason: "Irrtum", refundPercentage: 50 });
      h.clearEffects();

      const res = await update(id, { comment: "moved" });

      expect(res.status).to.equal(201);
      const stored = h.stored(id);
      expect(stateOf(stored)).to.equal("cancelled");
      expect(stored).to.include({ comment: "moved", isPayed: true });
      expect(stored.cancellationRefund).to.include({
        appliedRefundPercentage: 50,
        origin: "admin",
        cancelledFrom: "confirmed",
      });
      expect(h.takeEffects()).to.deep.equal([
        "store.save B1 cancelled [receipt,cancellation]",
      ]);
    });

    it("clearing isRejected reinstates: the content write, then the reinstatement with price and items of before, no refund, a new grant, no mail", async function () {
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
        "store.save B1 cancelled [receipt,cancellation]",
        "store.save B1 confirmed [receipt,cancellation]",
        "access.provision B1",
      ]);
    });

    it("clearing isRejected on a booking cancelled before payment: awaiting payment again, the compartments held", async function () {
      const id = await bookingIn("payment_due");
      await reject(id, { reason: "Irrtum" });
      expect(h.stored(id).cancellationRefund).to.include({
        cancelledFrom: "payment_due",
      });
      h.clearEffects();

      const res = await update(id, { isRejected: false });

      expect(res.status).to.equal(201);
      expect(stateOf(h.stored(id))).to.equal("payment_due");
      expect(h.stored(id).cancellationRefund).to.equal(undefined);
      expect(h.takeEffects()).to.deep.equal([
        "store.save B1 cancelled [cancellation]",
        "store.save B1 payment_due [cancellation]",
        "access.hold B1",
      ]);
    });

    it("clearing isRejected on a rejected request: a request again, the compartments held", async function () {
      const id = await bookingIn("requested");
      await reject(id, { reason: "Kein Platz" });
      h.clearEffects();

      const res = await update(id, { isRejected: false });

      expect(res.status).to.equal(201);
      expect(stateOf(h.stored(id))).to.equal("requested");
      expect(h.stored(id)).to.include({ rejectionReason: "" });
      expect(h.takeEffects()).to.deep.equal([
        "store.save B1 rejected [cancellation]",
        "store.save B1 requested [cancellation]",
        "access.hold B1",
      ]);
    });

    it("a cancel mail that fails on the flip is recorded: the booking is cancelled, 201", async function () {
      const id = await bookingIn("confirmed");
      h.failing.add("mail.sendBookingCancel");

      const res = await update(id, { isRejected: true });

      expect(res.status).to.equal(201);
      const stored = h.stored(id);
      expect(stateOf(stored)).to.equal("cancelled");
      expect(stored.cancellationRefund).to.include({ origin: "admin" });
      expect(stored.attachments.map((att) => att.type)).to.deep.equal([
        "receipt",
        "cancellation",
      ]);
      expect(h.takeEffects()).to.deep.equal([
        "store.save B1 confirmed [receipt]",
        "access.update B1",
        "store.save B1 cancelled [receipt]",
        "access.revoke B1",
        "documents.cancellation B1",
        "store.attach B1 cancellation",
        "workflow.onReject B1",
        "mail.sendBookingCancel B1 [ST-1.pdf] FAILED",
      ]);
    });

    it("flags no sequence of transitions reaches are refused with 400 invalid_status_change before anything is written: paid without confirmed", async function () {
      const id = await bookingIn("confirmed");

      const res = await update(id, { isCommitted: false, isPayed: true });

      expect(res.status).to.equal(400);
      expect(res.body.code).to.equal("invalid_status_change");
      expect(res.body.params).to.deep.equal({
        status: "confirmed",
        requested: { isCommitted: false, isPayed: true, isRejected: false },
      });
      expect(stateOf(h.stored(id))).to.equal("confirmed");
      expect(h.takeEffects()).to.deep.equal([]);
    });

    it("flags no sequence of transitions reaches are refused with 400: a confirmed booking cannot become a request again", async function () {
      const id = await bookingIn("confirmed");

      const res = await update(id, { isCommitted: false, isPayed: false });

      expect(res.status).to.equal(400);
      expect(res.body.code).to.equal("invalid_status_change");
      expect(stateOf(h.stored(id))).to.equal("confirmed");
      expect(h.takeEffects()).to.deep.equal([]);
    });
  });

  // -----------------------------------------------------------------------

  describe("reprint: POST /bookings/:id/receipt and /invoice", function () {
    it("reprints the receipt of a paid booking as a revision under the same number and answers the booking", async function () {
      const id = await bookingIn("confirmed");

      const res = await api()
        .post(`/api/${TENANT}/bookings/${id}/receipt`)
        .set(h.as(ADMIN));

      expect(res.status).to.equal(200);
      expect(res.body.success).to.equal(true);
      expect(
        res.body.data.attachments.map((att) => [att.receiptId, att.revision]),
      ).to.deep.equal([
        ["RE-1", 1],
        ["RE-1", 2],
      ]);
      expect(h.takeEffects()).to.deep.equal([
        "documents.receipt B1",
        "store.attach B1 receipt",
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
        "store.attach B1 invoice",
      ]);

      const mailed = await api()
        .post(`/api/${TENANT}/bookings/${id}/invoice`)
        .set(h.as(ADMIN));

      expect(mailed.status).to.equal(200);
      expect(mailed.body).to.include({ emailSent: true });
      expect(h.takeEffects()).to.deep.equal([
        "documents.invoice B1",
        "store.attach B1 invoice",
        "mail.sendInvoice B1 [RG-1-r2.pdf]",
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
        "store.attach B1 receipt",
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
        "store.save B1 cancelled [receipt]",
        "access.revoke B1",
        "documents.cancellation B1",
        "store.attach B1 cancellation",
        "mail.sendBookingCancel B1 [ST-1.pdf]",
      ]);
    });
  });
});
