/**
 * The production adapters of the booking lifecycle seam where they do more
 * than pass a call on: the store's conditional write against the database
 * (spec part 2, section 5) and the mail adapter sending every mail of a
 * composed notice (section 10; mail-stack spec, section 4).
 */

const { expect } = require("chai");
const sinon = require("sinon");

const BookingManager = require("../src/commons/data-managers/booking-manager");
const BookingModel = require("../src/commons/data-managers/models/bookingModel");
const mailModule = require("../src/commons/mail-service");
const {
  SKIPPED,
} = require("../src/commons/services/booking-lifecycle/pipeline");
const { Booking } = require("../src/commons/entities/booking/booking");
const { ConflictError, NotFoundError } = require("../src/errors/BaseError");
const store = require("../src/commons/services/booking-lifecycle/adapters/store");
const mail = require("../src/commons/services/booking-lifecycle/adapters/mail");

const TENANT = "tenant-1";

function booking(overrides = {}) {
  return new Booking({
    id: "B-1",
    tenantId: TENANT,
    status: "payment_due",
    priceEur: 40,
    mail: "erika@example.test",
    name: "Erika Muster",
    timeBegin: Date.UTC(2027, 5, 21, 10),
    timeEnd: Date.UTC(2027, 5, 21, 12),
    paymentProvider: "giroCockpit",
    attachments: [],
    bookableItems: [{ bookableId: "room", amount: 1 }],
    ...overrides,
  });
}

describe("booking lifecycle adapters", function () {
  afterEach(function () {
    sinon.restore();
  });

  describe("BookingManager.storeBookingIfStatus", function () {
    it("writes the booking only where the stored state is the expected one and answers the previous document", async function () {
      const previous = {
        _id: "x",
        id: "B-1",
        tenantId: TENANT,
        status: "payment_due",
      };
      const lean = sinon.stub().resolves(previous);
      const findOneAndUpdate = sinon
        .stub(BookingModel, "findOneAndUpdate")
        .returns({ lean });
      const entity = booking({ status: "confirmed" });

      const result = await BookingManager.storeBookingIfStatus(
        entity,
        "payment_due",
      );

      expect(result).to.equal(previous);
      const [filter, update, options] = findOneAndUpdate.firstCall.args;
      expect(filter).to.deep.equal({
        id: "B-1",
        tenantId: TENANT,
        status: "payment_due",
      });
      expect(update).to.equal(entity);
      expect(options).to.include({ upsert: false, new: false });
    });

    it("removes the fields it is told to with the write, as a $set and a $unset", async function () {
      const lean = sinon.stub().resolves({ id: "B-1" });
      const findOneAndUpdate = sinon
        .stub(BookingModel, "findOneAndUpdate")
        .returns({ lean });
      const entity = booking({
        status: "confirmed",
        cancellationRefund: { cancelledFrom: "confirmed" },
      });

      await BookingManager.storeBookingIfStatus(entity, "cancelled", {
        unset: ["cancellationRefund"],
      });

      const [, update] = findOneAndUpdate.firstCall.args;
      expect(update.$set).to.equal(entity);
      expect(update.$set).to.not.have.property("cancellationRefund");
      expect(update.$unset).to.deep.equal({ cancellationRefund: "" });
    });

    it("answers null where no booking is in the expected state", async function () {
      sinon
        .stub(BookingModel, "findOneAndUpdate")
        .returns({ lean: sinon.stub().resolves(null) });

      const result = await BookingManager.storeBookingIfStatus(
        booking({ status: "confirmed" }),
        "payment_due",
      );

      expect(result).to.equal(null);
    });
  });

  describe("BookingManager.replaceBooking", function () {
    it("puts a previous document back as a whole, without the database's own fields", async function () {
      const replaceOne = sinon.stub(BookingModel, "replaceOne").resolves({});

      await BookingManager.replaceBooking({
        _id: "x",
        __v: 3,
        id: "B-1",
        tenantId: TENANT,
        status: "payment_due",
        name: "Erika",
      });

      const [filter, document] = replaceOne.firstCall.args;
      expect(filter).to.deep.equal({ id: "B-1", tenantId: TENANT });
      expect(document).to.deep.equal({
        id: "B-1",
        tenantId: TENANT,
        status: "payment_due",
        name: "Erika",
      });
    });
  });

  describe("the store adapter", function () {
    it("save answers the previous document of a conditional write", async function () {
      const previous = { id: "B-1", tenantId: TENANT, status: "payment_due" };
      sinon.stub(BookingManager, "storeBookingIfStatus").resolves(previous);

      const result = await store.save(booking({ status: "confirmed" }), {
        expectStatus: "payment_due",
        transition: "pay",
      });

      expect(result).to.equal(previous);
      expect(
        BookingManager.storeBookingIfStatus.calledOnceWith(
          sinon.match.instanceOf(Booking),
          "payment_due",
        ),
      ).to.equal(true);
    });

    it("save passes the fields to remove on to the conditional write", async function () {
      const storeBookingIfStatus = sinon
        .stub(BookingManager, "storeBookingIfStatus")
        .resolves({ id: "B-1" });

      await store.save(booking({ status: "confirmed" }), {
        expectStatus: "cancelled",
        transition: "reinstate",
        unset: ["cancellationRefund"],
      });

      expect(storeBookingIfStatus.firstCall.args[2]).to.deep.equal({
        unset: ["cancellationRefund"],
      });
    });

    it("getTenant answers the tenant of the manager", async function () {
      const TenantManager = require("../src/commons/data-managers/tenant-manager");
      sinon.stub(TenantManager, "getTenant").resolves({ id: TENANT });

      expect(await store.getTenant(TENANT)).to.deep.equal({ id: TENANT });
    });

    it("save throws the guard's ConflictError with the state it read where the write found no match", async function () {
      sinon.stub(BookingManager, "storeBookingIfStatus").resolves(null);
      sinon
        .stub(BookingManager, "getBooking")
        .resolves(booking({ status: "confirmed" }));

      let error;
      try {
        await store.save(booking({ status: "confirmed" }), {
          expectStatus: "payment_due",
          transition: "pay",
        });
      } catch (err) {
        error = err;
      }

      expect(error).to.be.instanceOf(ConflictError);
      expect(error.code).to.equal("invalid_transition");
      expect(error.params).to.deep.equal({
        bookingId: "B-1",
        status: "confirmed",
        transition: "pay",
      });
    });

    it("save answers booking_not_found where the booking is gone", async function () {
      sinon.stub(BookingManager, "storeBookingIfStatus").resolves(null);
      sinon.stub(BookingManager, "getBooking").resolves(null);

      let error;
      try {
        await store.save(booking(), {
          expectStatus: "payment_due",
          transition: "pay",
        });
      } catch (err) {
        error = err;
      }

      expect(error).to.be.instanceOf(NotFoundError);
    });

    it("save demands the expected state: the lifecycle never writes unconditionally", async function () {
      let error;
      try {
        await store.save(booking(), { transition: "pay" });
      } catch (err) {
        error = err;
      }

      expect(error).to.be.an("error");
      expect(error.message).to.match(/expectStatus/);
    });

    it("restore replaces the document", async function () {
      const replaceBooking = sinon
        .stub(BookingManager, "replaceBooking")
        .resolves();
      const previous = { id: "B-1", tenantId: TENANT, status: "payment_due" };

      await store.restore(previous);

      expect(replaceBooking.calledOnceWith(previous)).to.equal(true);
    });
  });

  describe("the mail adapter", function () {
    const value = (to) => ({
      type: "BOOKING_CONFIRMATION",
      tenantId: TENANT,
      to,
      subject: "s",
      html: "<p/>",
      attachments: [],
    });

    it("sends every mail the notice composes and answers the outcomes", async function () {
      sinon
        .stub(mailModule, "compose")
        .resolves([value("a@example.test"), value("b@example.test")]);
      const send = sinon
        .stub(mailModule, "send")
        .resolves({ status: "sent", transport: "instance" });

      const answer = await mail.send("BOOKING_CONFIRMATION", {
        tenantId: TENANT,
        bookingIds: ["B-1"],
      });

      expect(send.args.map(([sent]) => sent.to)).to.deep.equal([
        "a@example.test",
        "b@example.test",
      ]);
      expect(answer).to.deep.equal([
        { status: "sent", transport: "instance" },
        { status: "sent", transport: "instance" },
      ]);
    });

    it("answers skipped where the notice has no recipient", async function () {
      sinon.stub(mailModule, "compose").resolves([]);
      const send = sinon.stub(mailModule, "send");

      const answer = await mail.send("INCOMING_BOOKING", {
        tenantId: TENANT,
        bookingIds: ["B-1"],
      });

      expect(answer).to.equal(SKIPPED);
      expect(send.called).to.equal(false);
    });

    it("answers skipped where the transport skipped every mail, the outcomes where it sent one", async function () {
      sinon
        .stub(mailModule, "compose")
        .resolves([value("a@example.test"), value("b@example.test")]);
      const send = sinon.stub(mailModule, "send");
      send.resolves({ status: "skipped", reason: "mail_disabled" });

      expect(
        await mail.send("BOOKING_CONFIRMATION", {
          tenantId: TENANT,
          bookingIds: ["B-1"],
        }),
      ).to.equal(SKIPPED);

      send
        .withArgs(sinon.match({ to: "b@example.test" }))
        .resolves({ status: "sent", transport: "instance" });
      expect(
        await mail.send("BOOKING_CONFIRMATION", {
          tenantId: TENANT,
          bookingIds: ["B-1"],
        }),
      ).to.deep.equal([
        { status: "skipped", reason: "mail_disabled" },
        { status: "sent", transport: "instance" },
      ]);
    });

    it("still sends the remaining mails when one fails, then throws that failure", async function () {
      sinon
        .stub(mailModule, "compose")
        .resolves([value("a@example.test"), value("b@example.test")]);
      const send = sinon.stub(mailModule, "send");
      send.onFirstCall().rejects(new Error("smtp down"));
      send.onSecondCall().resolves({ status: "sent", transport: "instance" });

      let error;
      try {
        await mail.send("BOOKING_CONFIRMATION", {
          tenantId: TENANT,
          bookingIds: ["B-1"],
        });
      } catch (err) {
        error = err;
      }

      expect(error.message).to.equal("smtp down");
      expect(send.callCount).to.equal(2);
    });
  });
});

describe("booking lifecycle payment adapter", function () {
  const PaymentUtils = require("../src/commons/utilities/payment-utils");
  const payment = require("../src/commons/services/booking-lifecycle/adapters/payment");
  const {
    SKIPPED,
  } = require("../src/commons/services/booking-lifecycle/pipeline");

  afterEach(function () {
    sinon.restore();
  });

  it("answers skipped for a booking without a payment provider, without asking the payment seam", async function () {
    const getPaymentService = sinon.stub(PaymentUtils, "getPaymentService");

    const answer = await payment.requestPayment({
      tenantId: TENANT,
      bookingIds: ["B-1"],
      paymentProvider: undefined,
      groupBookingId: null,
    });

    expect(answer).to.equal(SKIPPED);
    expect(getPaymentService.called).to.equal(false);
  });

  it("answers skipped where the tenant has no payment service for the provider", async function () {
    sinon.stub(PaymentUtils, "getPaymentService").resolves(null);

    const answer = await payment.requestPayment({
      tenantId: TENANT,
      bookingIds: ["B-1"],
      paymentProvider: "unknown",
      groupBookingId: null,
    });

    expect(answer).to.equal(SKIPPED);
  });
});
