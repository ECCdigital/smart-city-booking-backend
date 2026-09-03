/**
 * Characterization of the group booking lifecycle as it is today, seen
 * through the HTTP form: admission by the group checkout, confirmation,
 * payment (administration and aggregated webhook), cancellation and the
 * two reprint endpoints of a group. Companion of
 * `booking-lifecycle-characterization.test.js`, written for the same
 * ticket: the group variants and the known defects that belong to them
 * (turned by ticket 8 of the chain).
 *
 * The group runs its transitions member by member without rollback, then
 * issues one document and one mail for the group. Each case lists the
 * effects at the seam in the order they happen today; the member labels
 * B1, B2 follow the order of the first write.
 */

const { expect } = require("chai");
const sinon = require("sinon");

const {
  installHarness,
  stateOf,
  TENANT,
  ADMIN,
  CUSTOMER,
  TIME_BEGIN,
  TIME_END,
  DAY,
} = require("./helpers/booking-lifecycle-harness");
const GroupBookingManager = require("../src/commons/data-managers/group-booking-manager");

describe("group booking lifecycle today: what each state change does at the seam", function () {
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

  /** A customer's group checkout of two slots, a day apart. */
  async function groupCheckout(bookableId, overrides = {}) {
    const res = await api()
      .post(`/api/v2/${TENANT}/checkout/group`)
      .set(h.as(CUSTOMER))
      .send({
        bookableItems: [{ bookableId, amount: 1 }],
        bookingAttempts: [
          { timeBegin: TIME_BEGIN, timeEnd: TIME_END },
          { timeBegin: TIME_BEGIN + DAY, timeEnd: TIME_END + DAY },
        ],
        name: "Erika Muster",
        mail: CUSTOMER,
        paymentProvider: "giroCockpit",
        ...overrides,
      });
    expect(res.status).to.equal(200);
    return res.body;
  }

  /** A stored group over bookings that exist already. */
  async function seedGroup(bookingIds) {
    await GroupBookingManager.storeGroupBooking({
      id: "G-SEED-TEST",
      tenantId: TENANT,
      bookingIds,
      assignedUserId: CUSTOMER,
      mail: CUSTOMER,
    });
    h.clearEffects();
    return "G-SEED-TEST";
  }

  const commit = (id) =>
    api().post(`/api/${TENANT}/group-bookings/${id}/commit`).set(h.as(ADMIN));
  const pay = (id, body = {}) =>
    api()
      .post(`/api/${TENANT}/group-bookings/${id}/pay`)
      .set(h.as(ADMIN))
      .send(body);
  const reject = (id, body = {}) =>
    api()
      .post(`/api/${TENANT}/group-bookings/${id}/reject`)
      .set(h.as(ADMIN))
      .send(body);
  const states = (groupId) => h.members(groupId).map(stateOf);

  /** A group in a given state, with the rows of getting there forgotten. */
  async function groupIn(state) {
    let id;
    switch (state) {
      case "requested":
        id = (await groupCheckout("room")).data.groupBooking.id;
        break;
      case "payment_due":
        id = (await groupCheckout("auto-room")).data.groupBooking.id;
        break;
      case "confirmed":
        id = (await groupCheckout("auto-room")).data.groupBooking.id;
        await pay(id);
        break;
      default:
        throw new Error(`unknown state ${state}`);
    }
    expect(states(id)).to.deep.equal([state, state]);
    h.clearEffects();
    return id;
  }

  // -----------------------------------------------------------------------

  describe("admission: the group checkout stores the members one by one and mails once", function () {
    it("a group of a room to be confirmed arrives requested, one request confirmation for the group", async function () {
      const body = await groupCheckout("room");

      const { groupBooking, payment } = body.data;
      expect(groupBooking.id).to.match(/^G-/);
      expect(groupBooking.bookingIds).to.have.length(2);
      expect(payment).to.equal(null);
      expect(states(groupBooking.id)).to.deep.equal(["requested", "requested"]);
      expect(h.takeEffects()).to.deep.equal([
        "store.save B1 requested",
        "workflow.onCreate B1 without skipBookingStatus",
        "access.hold B1",
        "store.save B2 requested",
        "workflow.onCreate B2 without skipBookingStatus",
        "access.hold B2",
        "mail.sendBookingRequestConfirmation B1,B2",
        "mail.sendIncomingBooking B1,B2",
        "supervisor.notify B1,B2",
      ]);
    });

    it("a group confirmed at once arrives payment due and goes on to the aggregated payment link", async function () {
      const body = await groupCheckout("auto-room");

      const { groupBooking, payment } = body.data;
      expect(payment).to.deep.equal({
        provider: "giroCockpit",
        data: { url: "https://pay.example.test" },
      });
      expect(states(groupBooking.id)).to.deep.equal([
        "payment_due",
        "payment_due",
      ]);
      expect(h.takeEffects()).to.deep.equal([
        "store.save B1 payment_due",
        "workflow.onCreate B1 without skipBookingStatus",
        "access.hold B1",
        "store.save B2 payment_due",
        "workflow.onCreate B2 without skipBookingStatus",
        "access.hold B2",
        "mail.sendBookingConfirmation B1,B2",
        "mail.sendIncomingBooking B1,B2",
        "supervisor.notify B1,B2",
        "access.refreshHolds B1,B2",
        "payment.createPayment B1,B2 aggregated",
      ]);
    });

    it("a free group confirmed at once arrives confirmed and granted", async function () {
      const body = await groupCheckout("free-room");

      const { groupBooking, payment } = body.data;
      expect(payment).to.equal(null);
      expect(states(groupBooking.id)).to.deep.equal(["confirmed", "confirmed"]);
      expect(h.takeEffects()).to.deep.equal([
        "store.save B1 confirmed",
        "workflow.onCreate B1 without skipBookingStatus",
        "access.hold B1",
        "access.provision B1",
        "store.save B2 confirmed",
        "workflow.onCreate B2 without skipBookingStatus",
        "access.hold B2",
        "access.provision B2",
        "mail.sendBookingConfirmation B1,B2",
        "mail.sendIncomingBooking B1,B2",
        "supervisor.notify B1,B2",
      ]);
    });

    it("the legacy group checkout answers the group booking itself and runs the same effects", async function () {
      const slot = (timeBegin, timeEnd) => ({
        timeBegin,
        timeEnd,
        bookableItems: [
          { bookableId: "room", amount: 1, bookable: { id: "room" } },
        ],
      });

      const res = await api()
        .post(`/api/${TENANT}/checkout/group`)
        .set(h.as(CUSTOMER))
        .send({
          bookingAttempts: [
            slot(TIME_BEGIN, TIME_END),
            slot(TIME_BEGIN + DAY, TIME_END + DAY),
          ],
          contactData: { name: "Erika Muster", mail: CUSTOMER },
          paymentProvider: "giroCockpit",
        });

      expect(res.status).to.equal(200);
      expect(res.body.id).to.match(/^G-/);
      expect(res.body.bookings).to.have.length(2);
      expect(states(res.body.id)).to.deep.equal(["requested", "requested"]);
      expect(h.takeEffects()).to.deep.equal([
        "store.save B1 requested",
        "workflow.onCreate B1 without skipBookingStatus",
        "access.hold B1",
        "store.save B2 requested",
        "workflow.onCreate B2 without skipBookingStatus",
        "access.hold B2",
        "mail.sendBookingRequestConfirmation B1,B2",
        "mail.sendIncomingBooking B1,B2",
        "supervisor.notify B1,B2",
      ]);
    });

    it("a hold that fails at the second member rolls that member back and leaves the first without a group (ticket 8)", async function () {
      h.failing.add("access.hold B2");

      const body = await groupCheckout("room");

      expect(body.success).to.equal(false);
      expect(h.store.size).to.equal(1);
      expect(h.groups.size).to.equal(0);
      expect(h.takeEffects()).to.deep.equal([
        "store.save B1 requested",
        "workflow.onCreate B1 without skipBookingStatus",
        "access.hold B1",
        "store.save B2 requested",
        "workflow.onCreate B2 without skipBookingStatus",
        "access.hold B2 FAILED",
        "store.remove B2",
      ]);
    });
  });

  // -----------------------------------------------------------------------

  describe("confirmation: POST /group-bookings/:id/commit", function () {
    it("confirms member by member, workflow after each write, then one aggregated payment request", async function () {
      const id = await groupIn("requested");

      const res = await commit(id);

      expect(res.status).to.equal(200);
      expect(res.body.success).to.equal(true);
      expect(res.body.data.bookings.map((b) => b.isCommitted)).to.deep.equal([
        true,
        true,
      ]);
      expect(states(id)).to.deep.equal(["payment_due", "payment_due"]);
      expect(h.takeEffects()).to.deep.equal([
        "store.save B1 payment_due",
        "workflow.onCommit B1",
        "store.save B2 payment_due",
        "workflow.onCommit B2",
        "payment.paymentRequest B1,B2 aggregated",
      ]);
    });

    it("confirms a free group, grants each member and sends one free booking confirmation", async function () {
      const { groupBooking } = (await groupCheckout("free-request-room")).data;
      expect(states(groupBooking.id)).to.deep.equal(["requested", "requested"]);
      h.clearEffects();

      const res = await commit(groupBooking.id);

      expect(res.status).to.equal(200);
      expect(states(groupBooking.id)).to.deep.equal(["confirmed", "confirmed"]);
      expect(h.takeEffects()).to.deep.equal([
        "store.save B1 confirmed",
        "workflow.onCommit B1",
        "store.save B2 confirmed",
        "workflow.onCommit B2",
        "access.provision B1",
        "access.provision B2",
        "mail.sendFreeBookingConfirmation B1,B2",
      ]);
    });

    it("answers success without a payment service - unlike the single commit (ticket 5)", async function () {
      const id = await groupIn("requested");
      h.payment.available = false;

      const res = await commit(id);

      expect(res.status).to.equal(200);
      expect(res.body.success).to.equal(true);
      expect(h.takeEffects()).to.deep.equal([
        "store.save B1 payment_due",
        "workflow.onCommit B1",
        "store.save B2 payment_due",
        "workflow.onCommit B2",
      ]);
    });

    it("never mails the organizer of a ticket group: the block reads `type` off the item and, for a priced group, sits after the return (tickets 5, 8)", async function () {
      const first = await h.manualBooking("ticket", { isPayed: true });
      const second = await h.manualBooking("ticket", { isPayed: true });
      const paid = await seedGroup([first.id, second.id]);

      const res = await commit(paid);

      expect(res.status).to.equal(200);
      // Paid already, the group takes the free-booking way, where the
      // ticket block is reachable - and still finds no ticket.
      expect(h.takeEffects()).to.deep.equal([
        "store.save B1 confirmed",
        "workflow.onCommit B1",
        "store.save B2 confirmed",
        "workflow.onCommit B2",
        "access.provision B1",
        "access.provision B2",
        "mail.sendFreeBookingConfirmation B1,B2",
      ]);

      // Priced, the commit returns with the payment request, before the
      // ticket block.
      const third = await h.manualBooking("ticket");
      const fourth = await h.manualBooking("ticket");
      await GroupBookingManager.storeGroupBooking({
        id: "G-SEED-PRICED",
        tenantId: TENANT,
        bookingIds: [third.id, fourth.id],
        assignedUserId: CUSTOMER,
        mail: CUSTOMER,
      });
      h.clearEffects();

      const priced = await commit("G-SEED-PRICED");

      expect(priced.status).to.equal(200);
      expect(h.takeEffects()).to.deep.equal([
        "store.save B3 payment_due",
        "workflow.onCommit B3",
        "store.save B4 payment_due",
        "workflow.onCommit B4",
        "payment.paymentRequest B3,B4 aggregated",
      ]);
    });

    it("a write that fails at the second member leaves the first confirmed, 500 (ticket 8: restored)", async function () {
      const id = await groupIn("requested");
      h.failing.add("store.save B2");

      const res = await commit(id);

      expect(res.status).to.equal(500);
      expect(res.body).to.deep.equal({ message: "store.save failed" });
      expect(states(id)).to.deep.equal(["payment_due", "requested"]);
      expect(h.takeEffects()).to.deep.equal([
        "store.save B1 payment_due",
        "workflow.onCommit B1",
        "store.save B2 FAILED",
      ]);
    });

    it("refuses a group whose members differ in state, 200 with the consistency error, without effect", async function () {
      const first = await h.manualBooking("room");
      const second = await h.manualBooking("room", { isCommitted: true });
      const id = await seedGroup([first.id, second.id]);

      const res = await commit(id);

      expect(res.status).to.equal(200);
      expect(res.body.success).to.equal(false);
      expect(res.body.errors.map((error) => error.code)).to.deep.equal([
        "STATUS_MISMATCH",
      ]);
      expect(h.takeEffects()).to.deep.equal([]);
    });
  });

  // -----------------------------------------------------------------------

  describe("payment: POST /group-bookings/:id/pay and the aggregated webhook", function () {
    it("pays member by member, then one aggregated receipt attached to each, one confirmation - and no workflow event (ticket 8)", async function () {
      const id = await groupIn("payment_due");

      const res = await pay(id, { paymentMethod: "CASH" });

      expect(res.status).to.equal(200);
      expect(res.body.success).to.equal(true);
      expect(res.body.data.bookings.map((b) => b.isPayed)).to.deep.equal([
        true,
        true,
      ]);
      expect(states(id)).to.deep.equal(["confirmed", "confirmed"]);
      for (const member of h.members(id)) {
        expect(member.paymentMethod).to.equal("CASH");
        expect(member.attachments.map((att) => att.receiptId)).to.deep.equal([
          "RE-1",
        ]);
      }
      expect(h.takeEffects()).to.deep.equal([
        "store.save B1 confirmed",
        "access.provision B1",
        "store.save B2 confirmed",
        "access.provision B2",
        "documents.aggregatedReceipt B1,B2",
        "store.save B1 confirmed [receipt]",
        "store.save B2 confirmed [receipt]",
        "mail.sendBookingConfirmation B1,B2 [RE-1.pdf]",
      ]);
    });

    it("the aggregated webhook runs the same transition, whether it names the members or the group", async function () {
      const id = await groupIn("payment_due");
      const [first, second] = h.groups.get(id).bookingIds;

      const byMembers = await h.webhook(
        `ids=${first},${second}&aggregated=true`,
      );

      expect(byMembers.status).to.equal(200);
      expect(states(id)).to.deep.equal(["confirmed", "confirmed"]);
      expect(h.members(id).map((m) => m.paymentMethod)).to.deep.equal([
        "CREDIT_CARD",
        "CREDIT_CARD",
      ]);
      expect(h.takeEffects()).to.deep.equal([
        "store.save B1 confirmed",
        "access.provision B1",
        "store.save B2 confirmed",
        "access.provision B2",
        "documents.aggregatedReceipt B1,B2",
        "store.save B1 confirmed [receipt]",
        "store.save B2 confirmed [receipt]",
        "mail.sendBookingConfirmation B1,B2 [RE-1.pdf]",
      ]);

      const other = await groupIn("payment_due");
      const byGroup = await h.webhook(`id=${other}&aggregated=true`);

      expect(byGroup.status).to.equal(200);
      expect(states(other)).to.deep.equal(["confirmed", "confirmed"]);
      expect(h.takeEffects()).to.include(
        "mail.sendBookingConfirmation B3,B4 [RE-2.pdf]",
      );
    });

    it("a receipt that fails answers 500 for a group that is paid (ticket 8: recorded instead)", async function () {
      const id = await groupIn("payment_due");
      h.failing.add("documents.aggregatedReceipt");

      const res = await pay(id);

      expect(res.status).to.equal(500);
      // The service's `BaseError` carries its message as the code; the
      // cause stays in the log.
      expect(res.body).to.deep.equal({
        message: "set_aggregated_booking_payed_failed",
      });
      expect(states(id)).to.deep.equal(["confirmed", "confirmed"]);
      expect(h.takeEffects()).to.deep.equal([
        "store.save B1 confirmed",
        "access.provision B1",
        "store.save B2 confirmed",
        "access.provision B2",
        "documents.aggregatedReceipt B1,B2 FAILED",
      ]);
    });

    it("a grant that fails at one member is logged; the group is paid and mailed", async function () {
      const id = await groupIn("payment_due");
      h.failing.add("access.provision B1");

      const res = await pay(id);

      expect(res.status).to.equal(200);
      expect(h.takeEffects()).to.deep.equal([
        "store.save B1 confirmed",
        "access.provision B1 FAILED",
        "store.save B2 confirmed",
        "access.provision B2",
        "documents.aggregatedReceipt B1,B2",
        "store.save B1 confirmed [receipt]",
        "store.save B2 confirmed [receipt]",
        "mail.sendBookingConfirmation B1,B2 [RE-1.pdf]",
      ]);
    });

    it("the aggregated receipt replaces the `mailAttach` documents in the confirmation instead of joining them (ticket 8)", async function () {
      // Unpaid, the document of the room goes out once for the group.
      const { groupBooking } = (await groupCheckout("room-with-doc")).data;
      expect(h.takeEffects()).to.include(
        "mail.sendBookingConfirmation B1,B2 [Hausordnung.pdf]",
      );

      await pay(groupBooking.id);

      expect(h.takeEffects()).to.include(
        "mail.sendBookingConfirmation B1,B2 [RE-1.pdf]",
      );
    });
  });

  // -----------------------------------------------------------------------

  describe("cancellation: POST /group-bookings/:id/reject", function () {
    it("renders one cancellation document first, cancels member by member with revoke and workflow, then one cancel mail", async function () {
      const id = await groupIn("confirmed");

      const res = await reject(id, { reason: "Halle gesperrt" });

      expect(res.status).to.equal(200);
      expect(res.body.success).to.equal(true);
      expect(states(id)).to.deep.equal(["cancelled", "cancelled"]);
      for (const member of h.members(id)) {
        expect(member.rejectionReason).to.equal("Halle gesperrt");
        expect(member.cancellationRefund).to.include({
          origin: "admin",
          cancelledByUserId: ADMIN,
        });
        expect(member.attachments.map((att) => att.type)).to.deep.equal([
          "receipt",
          "cancellation",
        ]);
      }
      expect(h.takeEffects()).to.deep.equal([
        "documents.aggregatedCancellation B1,B2",
        "store.save B1 cancelled [receipt,cancellation]",
        "access.revoke B1",
        "workflow.onReject B1",
        "store.save B2 cancelled [receipt,cancellation]",
        "access.revoke B2",
        "workflow.onReject B2",
        "mail.sendBookingCancel B1,B2 [ST-1.pdf]",
      ]);
    });

    it("`skipCancellation` leaves the document out", async function () {
      const id = await groupIn("confirmed");

      const res = await reject(id, { reason: "", skipCancellation: true });

      expect(res.status).to.equal(200);
      expect(h.takeEffects()).to.deep.equal([
        "store.save B1 cancelled [receipt]",
        "access.revoke B1",
        "workflow.onReject B1",
        "store.save B2 cancelled [receipt]",
        "access.revoke B2",
        "workflow.onReject B2",
        "mail.sendBookingCancel B1,B2",
      ]);
    });

    it("rejects a requested group with the document and the rejection mail", async function () {
      const id = await groupIn("requested");

      const res = await reject(id, { reason: "Kein Platz" });

      expect(res.status).to.equal(200);
      expect(states(id)).to.deep.equal(["rejected", "rejected"]);
      expect(h.takeEffects()).to.deep.equal([
        "documents.aggregatedCancellation B1,B2",
        "store.save B1 rejected [cancellation]",
        "access.revoke B1",
        "workflow.onReject B1",
        "store.save B2 rejected [cancellation]",
        "access.revoke B2",
        "workflow.onReject B2",
        "mail.sendBookingRejection B1,B2 [ST-1.pdf]",
      ]);
    });

    it("refuses a group whose members differ in state, without effect", async function () {
      const first = await h.manualBooking("room");
      const second = await h.manualBooking("room", { isCommitted: true });
      const id = await seedGroup([first.id, second.id]);

      const res = await reject(id, { reason: "" });

      expect(res.status).to.equal(200);
      expect(res.body.success).to.equal(false);
      expect(res.body.errors.map((error) => error.code)).to.deep.equal([
        "STATUS_MISMATCH",
      ]);
      expect(h.takeEffects()).to.deep.equal([]);
    });

    it("a cancel mail that fails answers 500 for a group that is cancelled (ticket 8: recorded instead)", async function () {
      const id = await groupIn("confirmed");
      h.failing.add("mail.sendBookingCancel");

      const res = await reject(id, { reason: "" });

      expect(res.status).to.equal(500);
      expect(states(id)).to.deep.equal(["cancelled", "cancelled"]);
      expect(h.takeEffects().at(-1)).to.equal(
        "mail.sendBookingCancel B1,B2 [ST-1.pdf] FAILED",
      );
    });

    it("a revoke that fails at one member is logged; the group is cancelled and mailed", async function () {
      const id = await groupIn("confirmed");
      h.failing.add("access.revoke B2");

      const res = await reject(id, { reason: "" });

      expect(res.status).to.equal(200);
      expect(h.takeEffects()).to.deep.equal([
        "documents.aggregatedCancellation B1,B2",
        "store.save B1 cancelled [receipt,cancellation]",
        "access.revoke B1",
        "workflow.onReject B1",
        "store.save B2 cancelled [receipt,cancellation]",
        "access.revoke B2 FAILED",
        "workflow.onReject B2",
        "mail.sendBookingCancel B1,B2 [ST-1.pdf]",
      ]);
    });
  });

  // -----------------------------------------------------------------------

  describe("reprint: POST /group-bookings/:id/receipt and /invoice", function () {
    it("reprints one aggregated receipt attached to every member and answers the group", async function () {
      const id = await groupIn("confirmed");

      const res = await api()
        .post(`/api/${TENANT}/group-bookings/${id}/receipt`)
        .set(h.as(ADMIN));

      expect(res.status).to.equal(200);
      expect(res.body.success).to.equal(true);
      for (const member of res.body.data.bookings) {
        expect(member.attachments.map((att) => att.receiptId)).to.deep.equal([
          "RE-1",
          "RE-2",
        ]);
      }
      expect(h.takeEffects()).to.deep.equal([
        "documents.aggregatedReceipt B1,B2",
        "store.save B1 confirmed [receipt,receipt]",
        "store.save B2 confirmed [receipt,receipt]",
      ]);
    });

    it("refuses the receipt of an unpaid group as a consistency error", async function () {
      const id = await groupIn("payment_due");

      const res = await api()
        .post(`/api/${TENANT}/group-bookings/${id}/receipt`)
        .set(h.as(ADMIN));

      expect(res.status).to.equal(200);
      expect(res.body.success).to.equal(false);
      expect(res.body.errors.map((error) => error.code)).to.deep.equal([
        "PAYED_STATUS",
      ]);
      expect(h.takeEffects()).to.deep.equal([]);
    });

    it("issues one aggregated invoice for a group paying by invoice and mails it unless told not to", async function () {
      const { groupBooking } = (
        await groupCheckout("auto-room", { paymentProvider: "invoice" })
      ).data;
      const id = groupBooking.id;
      h.clearEffects();

      const silent = await api()
        .post(`/api/${TENANT}/group-bookings/${id}/invoice?sendEmail=false`)
        .set(h.as(ADMIN));

      expect(silent.status).to.equal(200);
      expect(silent.body.success).to.equal(true);
      for (const member of silent.body.data.bookings) {
        expect(member.attachments.map((att) => att.invoiceId)).to.deep.equal([
          "RG-1",
        ]);
      }
      expect(h.takeEffects()).to.deep.equal([
        "documents.aggregatedInvoice B1,B2",
        "store.save B1 payment_due [invoice]",
        "store.save B2 payment_due [invoice]",
      ]);

      const mailed = await api()
        .post(`/api/${TENANT}/group-bookings/${id}/invoice`)
        .set(h.as(ADMIN));

      expect(mailed.status).to.equal(200);
      expect(h.takeEffects()).to.deep.equal([
        "documents.aggregatedInvoice B1,B2",
        "store.save B1 payment_due [invoice,invoice]",
        "store.save B2 payment_due [invoice,invoice]",
        "mail.sendInvoice B1,B2 [RG-2.pdf]",
      ]);
    });

    it("refuses the invoice of a group not paying by invoice as a consistency error", async function () {
      const id = await groupIn("payment_due");

      const res = await api()
        .post(`/api/${TENANT}/group-bookings/${id}/invoice`)
        .set(h.as(ADMIN));

      expect(res.status).to.equal(200);
      expect(res.body.success).to.equal(false);
      expect(res.body.errors.map((error) => error.code)).to.deep.equal([
        "INVOICE_PAYMENT_REQUIRED",
      ]);
      expect(h.takeEffects()).to.deep.equal([]);
    });
  });
});
