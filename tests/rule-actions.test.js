const mock = require("mock-require");
const { expect } = require("chai");
const sinon = require("sinon");

describe("rule-engine actionRegistry", () => {
  let sandbox;
  let actionRegistry;
  let fakeMailerService;
  let fakeBookingService;

  beforeEach(() => {
    sandbox = sinon.createSandbox();

    fakeMailerService = { send: sandbox.stub().resolves() };
    fakeBookingService = { rejectBooking: sandbox.stub().resolves() };

    mock("../src/commons/mail-service/mail-service", fakeMailerService);
    mock(
      "../src/commons/services/checkout/booking-service",
      fakeBookingService,
    );

    actionRegistry = mock.reRequire("../src/rule-engine/actionRegistry");
  });

  afterEach(() => {
    sandbox.restore();
    mock.stopAll();
  });

  describe("sendEmail", () => {
    it("sends a custom email using doc mail and rule-defined content", async () => {
      const doc = { id: "b1", tenantId: "t1", mail: "guest@example.com" };

      await actionRegistry.sendEmail(doc, {
        subject: "Hallo {{name}}",
        body: "<p>Hi {{mail}}</p>",
      });

      expect(fakeMailerService.send.calledOnce).to.be.true;
      const args = fakeMailerService.send.firstCall.args[0];
      expect(args.tenantId).to.equal("t1");
      expect(args.address).to.equal("guest@example.com");
      expect(args.subject).to.equal("Hallo {{name}}");
      expect(args.mailTemplate).to.equal("<p>Hi {{mail}}</p>");
      expect(args.model.mail).to.equal("guest@example.com");
    });

    it("prefers an explicit recipient from params", async () => {
      const doc = { id: "b1", tenantId: "t1", mail: "guest@example.com" };

      await actionRegistry.sendEmail(doc, {
        to: "admin@example.com",
        subject: "Test",
        body: "Body",
      });

      expect(fakeMailerService.send.firstCall.args[0].address).to.equal(
        "admin@example.com",
      );
    });

    it("throws when no recipient is available", async () => {
      const doc = { id: "b1", tenantId: "t1" };

      let error;
      try {
        await actionRegistry.sendEmail(doc, { subject: "x", body: "y" });
      } catch (err) {
        error = err;
      }

      expect(error).to.be.an("error");
      expect(fakeMailerService.send.called).to.be.false;
    });

    it("requires subject and body", async () => {
      const doc = { id: "b1", tenantId: "t1", mail: "guest@example.com" };

      let subjectError;
      try {
        await actionRegistry.sendEmail(doc, { body: "y" });
      } catch (err) {
        subjectError = err;
      }
      expect(subjectError).to.be.an("error");

      let bodyError;
      try {
        await actionRegistry.sendEmail(doc, { subject: "x" });
      } catch (err) {
        bodyError = err;
      }
      expect(bodyError).to.be.an("error");
    });
  });

  describe("cancelBooking", () => {
    it("rejects the booking with the given reason", async () => {
      const doc = { id: "b1", tenantId: "t1" };

      await actionRegistry.cancelBooking(doc, { reason: "inaktive" });

      expect(
        fakeBookingService.rejectBooking.calledOnceWith("t1", "b1", "inaktive"),
      ).to.be.true;
    });
  });
});
