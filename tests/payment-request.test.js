/**
 * The payment request (glossary "Zahlungsaufforderung") as a value
 * (mail-stack spec, section 4): `paymentRequest()` of a payment provider
 * answers `{ form: "link" | "invoice" | "pending", paymentUrl?, files? }`
 * and mails nothing - the notify step of the booking lifecycle sends the
 * notice of that form. A provider with a payment page answers the link to
 * the storefront's redirection; the invoice provider issues the invoice
 * and answers it as a file, or announces one the administration creates.
 */

const { expect } = require("chai");
const sinon = require("sinon");

const PaymentService = require("../src/commons/services/payment/providers/payment-service");
const PmPaymentService = require("../src/commons/services/payment/providers/PmPaymentService");
const GiroCockpitPaymentService = require("../src/commons/services/payment/providers/GiroCockpitPaymentService");
const EPayBLPaymentService = require("../src/commons/services/payment/providers/EPayBLPaymentService");
const InvoicePaymentService = require("../src/commons/services/payment/providers/InvoicePaymentService");
const TenantManager = require("../src/commons/data-managers/tenant-manager");
const BookingManager = require("../src/commons/data-managers/booking-manager");
const issuance = require("../src/commons/services/documents/document-issuance");
const mailModule = require("../src/commons/mail-service");

const TENANT = "stadthalle";
const FRONTEND_URL = "https://buchung.example.test";

describe("the payment request as a value", function () {
  let env;

  beforeEach(function () {
    env = process.env.FRONTEND_URL;
    process.env.FRONTEND_URL = FRONTEND_URL;
  });

  afterEach(function () {
    sinon.restore();
    process.env.FRONTEND_URL = env;
  });

  describe("a provider with a payment page", function () {
    it("answers the link to the storefront's redirection for the booking", async function () {
      const service = new PaymentService(TENANT, "B-1");

      expect(await service.paymentRequest()).to.deep.equal({
        form: "link",
        paymentUrl: `${FRONTEND_URL}/payment/redirection?ids=B-1&tenant=${TENANT}&aggregated=false`,
      });
    });

    it("answers one link for every member of a group", async function () {
      const service = new PaymentService(TENANT, ["G-1", "G-2", "G-3"], {
        aggregated: true,
        groupBookingId: "G",
      });

      expect(await service.paymentRequest()).to.deep.equal({
        form: "link",
        paymentUrl: `${FRONTEND_URL}/payment/redirection?ids=G-1,G-2,G-3&tenant=${TENANT}&aggregated=true`,
      });
    });

    it("is what pmPayment, GiroCockpit and ePayBL answer", async function () {
      for (const Provider of [
        PmPaymentService,
        GiroCockpitPaymentService,
        EPayBLPaymentService,
      ]) {
        const answer = await new Provider(TENANT, "B-1").paymentRequest();
        expect(answer.form, Provider.name).to.equal("link");
        expect(answer.paymentUrl, Provider.name).to.include("ids=B-1");
      }
    });
  });

  describe("the invoice provider", function () {
    const file = { name: "RG-1.pdf", buffer: Buffer.from("%PDF") };
    const attachment = { name: "RG-1.pdf", invoiceId: "RG-1", revision: 1 };
    const booking = { id: "B-1", tenantId: TENANT, mail: "erika@example.test" };

    function given({ manualCreation = false } = {}) {
      sinon
        .stub(TenantManager, "getTenantApp")
        .resolves({ id: "invoice", active: true, manualCreation });
      sinon.stub(BookingManager, "getBookings").resolves([booking]);
      sinon.stub(BookingManager, "getBooking").resolves(booking);
      sinon.stub(issuance, "issue").resolves({ attachment, file });
      sinon.stub(issuance, "groupBookingIdOf").resolves("G");
      sinon.stub(mailModule, "compose").resolves([]);
      sinon.stub(mailModule, "send").resolves({ status: "sent" });
    }

    it("announces an invoice the administration creates later, issuing nothing and sending nothing", async function () {
      given({ manualCreation: true });

      const answer = await new InvoicePaymentService(
        TENANT,
        "B-1",
      ).paymentRequest();

      expect(answer).to.deep.equal({ form: "pending" });
      expect(issuance.issue.called).to.equal(false);
      expect(mailModule.compose.called).to.equal(false);
      expect(mailModule.send.called).to.equal(false);
    });

    it("issues the invoice and answers it as a file, sending nothing itself", async function () {
      given();

      const answer = await new InvoicePaymentService(
        TENANT,
        "B-1",
      ).paymentRequest();

      expect(answer).to.deep.equal({ form: "invoice", files: [file] });
      expect(issuance.issue.firstCall.args[0]).to.deep.equal({
        tenantId: TENANT,
        bookingIds: ["B-1"],
        type: "invoice",
        groupBookingId: null,
        bookings: [booking],
      });
      expect(mailModule.compose.called).to.equal(false);
      expect(mailModule.send.called).to.equal(false);
    });

    it("issues one aggregated invoice for a group", async function () {
      given();

      const answer = await new InvoicePaymentService(TENANT, ["G-1", "G-2"], {
        aggregated: true,
        groupBookingId: "G",
      }).paymentRequest();

      expect(answer).to.deep.equal({ form: "invoice", files: [file] });
      expect(issuance.issue.firstCall.args[0]).to.include({
        groupBookingId: "G",
      });
      expect(issuance.issue.firstCall.args[0].bookingIds).to.deep.equal([
        "G-1",
        "G-2",
      ]);
    });

    it("the checkout's invoice payment (createPayment) still issues and mails the invoice, over compose + send", async function () {
      given();
      const value = { type: "INVOICE", to: "erika@example.test" };
      mailModule.compose.resolves([value]);

      const answer = await new InvoicePaymentService(
        TENANT,
        "B-1",
      ).createPayment();

      expect(answer).to.deep.equal([
        { bookingId: "B-1", name: "RG-1.pdf", invoiceId: "RG-1", revision: 1 },
      ]);
      expect(mailModule.compose.firstCall.args).to.deep.equal([
        "INVOICE",
        {
          tenantId: TENANT,
          bookingIds: ["B-1"],
          groupBookingId: null,
          attachments: [file],
        },
      ]);
      expect(mailModule.send.calledOnceWith(value)).to.equal(true);
    });

    it("the checkout's aggregated invoice payment mails one aggregated invoice", async function () {
      given();

      const answer = await new InvoicePaymentService(TENANT, ["G-1", "G-2"], {
        aggregated: true,
        groupBookingId: "G",
      }).createPayment();

      expect(answer).to.deep.equal({
        bookingIds: ["G-1", "G-2"],
        name: "RG-1.pdf",
        invoiceId: "RG-1",
        revision: 1,
      });
      expect(mailModule.compose.firstCall.args).to.deep.equal([
        "INVOICE",
        {
          tenantId: TENANT,
          bookingIds: ["G-1", "G-2"],
          groupBookingId: "G",
          attachments: [file],
        },
      ]);
    });

    it("the checkout's invoice payment announces the invoice to follow where the administration creates it", async function () {
      given({ manualCreation: true });

      const answer = await new InvoicePaymentService(
        TENANT,
        "B-1",
      ).createPayment();

      expect(answer).to.deep.equal({
        manualCreation: true,
        bookingIds: ["B-1"],
      });
      expect(mailModule.compose.firstCall.args).to.deep.equal([
        "BOOKING_CONFIRMED_INVOICE_PENDING",
        { tenantId: TENANT, bookingIds: ["B-1"], groupBookingId: null },
      ]);
    });

    it("a mail that fails at the checkout's invoice payment is logged, the invoice stands", async function () {
      given();
      mailModule.compose.rejects(new Error("smtp down"));

      const answer = await new InvoicePaymentService(
        TENANT,
        "B-1",
      ).createPayment();

      expect(answer).to.have.length(1);
    });
  });
});
