/**
 * The production adapters of the booking lifecycle seam where they do more
 * than pass a call on: the store's conditional write against the database
 * (spec part 2, section 5) and the mail adapter joining the `mailAttach`
 * documents of a booking to the issued documents (section 10).
 */

const { expect } = require("chai");
const sinon = require("sinon");

const BookingManager = require("../src/commons/data-managers/booking-manager");
const BookingModel = require("../src/commons/data-managers/models/bookingModel");
const MailController = require("../src/commons/mail-service/mail-controller");
const { Booking } = require("../src/commons/entities/booking/booking");
const { ConflictError, NotFoundError } = require("../src/errors/BaseError");
const store = require("../src/commons/services/booking-lifecycle/adapters/store");
const mail = require("../src/commons/services/booking-lifecycle/adapters/mail");
const mailAttachments = require("../src/commons/services/booking-lifecycle/mail-attachments");

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
    it("sends the booking confirmation with the issued documents first, then the mailAttach documents of the booking", async function () {
      const send = sinon
        .stub(MailController, "sendBookingConfirmation")
        .resolves();
      sinon.stub(mailAttachments, "prepareMailAttachments").resolves([
        {
          filename: "Hausordnung.pdf",
          content: Buffer.from("house"),
          contentType: "application/pdf",
        },
      ]);
      const entity = booking({
        attachments: [
          {
            id: "att-1",
            title: "Hausordnung",
            type: "file",
            reference: { source: "media", mediaId: "M1" },
            mailAttach: true,
          },
        ],
      });

      await mail.sendBookingConfirmation([entity], {
        attachments: [{ name: "RE-1.pdf", buffer: Buffer.from("%PDF") }],
      });

      const [address, bookingId, tenantId, attachments, aggregated] =
        send.firstCall.args;
      expect(address).to.equal("erika@example.test");
      expect(bookingId).to.equal("B-1");
      expect(tenantId).to.equal(TENANT);
      expect(attachments.map((att) => att.filename)).to.deep.equal([
        "RE-1.pdf",
        "Hausordnung.pdf",
      ]);
      expect(aggregated).to.equal(false);
      expect(
        mailAttachments.prepareMailAttachments.calledOnceWith(
          entity.attachments,
          TENANT,
        ),
      ).to.equal(true);
    });

    it("names the bookings of an aggregated confirmation as a list", async function () {
      const send = sinon
        .stub(MailController, "sendBookingConfirmation")
        .resolves();
      sinon.stub(mailAttachments, "prepareMailAttachments").resolves([]);

      await mail.sendBookingConfirmation(
        [booking({ id: "B-1" }), booking({ id: "B-2" })],
        { attachments: [], aggregated: true },
      );

      const [, bookingIds, , , aggregated] = send.firstCall.args;
      expect(bookingIds).to.deep.equal(["B-1", "B-2"]);
      expect(aggregated).to.equal(true);
    });
  });
});
