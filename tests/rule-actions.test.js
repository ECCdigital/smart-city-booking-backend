const mock = require("mock-require");
const { expect } = require("chai");
const sinon = require("sinon");

const MailerService = require("../src/commons/mail-service/mail-service");

/**
 * The rule engine builds the mail value itself - the body of the rule
 * rendered against the matched document - and hands it to `send`; the
 * transport is stubbed at that seam, the rendering is real.
 */
describe("rule-engine actionRegistry", () => {
  let sandbox;
  let actionRegistry;
  let send;
  let fakeLifecycle;

  beforeEach(() => {
    sandbox = sinon.createSandbox();

    send = sandbox
      .stub(MailerService, "send")
      .resolves({ status: "sent", transport: "instance" });
    fakeLifecycle = {
      bookingLifecycle: { cancel: sandbox.stub().resolves() },
      TRIGGER: { SYSTEM: "system" },
    };

    mock("../src/commons/services/booking-lifecycle", fakeLifecycle);

    actionRegistry = mock.reRequire("../src/rule-engine/actionRegistry");
  });

  afterEach(() => {
    sandbox.restore();
    mock.stopAll();
  });

  describe("sendEmail", () => {
    it("sends the mail value to the doc's mail: the rule's subject as is, the body rendered against the doc, over the tenant's transport", async () => {
      const doc = { id: "b1", tenantId: "t1", mail: "guest@example.com" };

      await actionRegistry.sendEmail(doc, {
        subject: "Hallo {{name}}",
        body: "<p>Hi {{mail}}</p>",
      });

      expect(send.calledOnce).to.be.true;
      const mailValue = send.firstCall.args[0];
      expect(mailValue.type).to.equal("rule-email");
      expect(mailValue.tenantId).to.equal("t1");
      expect(mailValue.to).to.equal("guest@example.com");
      expect(mailValue.subject).to.equal("Hallo {{name}}");
      expect(mailValue.html).to.equal("<p>Hi guest@example.com</p>");
    });

    it("sends as the instance where the rule says useInstanceMail", async () => {
      const doc = { id: "b1", tenantId: "t1", mail: "guest@example.com" };

      await actionRegistry.sendEmail(doc, {
        subject: "s",
        body: "b",
        useInstanceMail: true,
      });

      expect(send.firstCall.args[0].tenantId).to.equal(null);
    });

    it("prefers an explicit recipient from params", async () => {
      const doc = { id: "b1", tenantId: "t1", mail: "guest@example.com" };

      await actionRegistry.sendEmail(doc, {
        to: "admin@example.com",
        subject: "Test",
        body: "Body",
      });

      expect(send.firstCall.args[0].to).to.equal("admin@example.com");
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
      expect(send.called).to.be.false;
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
        fakeLifecycle.bookingLifecycle.cancel.calledOnceWith("t1", "b1", {
          trigger: "system",
          reason: "inaktive",
        }),
      ).to.be.true;
    });
  });
});

describe("rule-engine aggregateActionRegistry", () => {
  let sandbox;
  let aggregateActionRegistry;
  let send;
  let fakeTenantManager;

  beforeEach(() => {
    sandbox = sinon.createSandbox();
    send = sandbox
      .stub(MailerService, "send")
      .resolves({ status: "sent", transport: "instance" });
    fakeTenantManager = {
      getTenant: sandbox.stub().resolves({ id: "t1", name: "Test Tenant" }),
    };
    mock("../src/commons/data-managers/tenant-manager", fakeTenantManager);
    aggregateActionRegistry = mock.reRequire(
      "../src/rule-engine/aggregateActionRegistry",
    );
  });

  afterEach(() => {
    sandbox.restore();
    mock.stopAll();
  });

  it("sends one mail value per tenant group: the body rendered over the docs as bookings, their count and the tenant's name", async () => {
    const docs = [
      { id: "b1", tenantId: "t1" },
      { id: "b2", tenantId: "t1" },
    ];

    await aggregateActionRegistry.sendAggregatedEmail(
      docs,
      {
        subject: "Offene Buchungen",
        body: "{{count}} bei {{tenant}}: {{#each bookings}}{{id}} {{/each}}",
      },
      { tenantId: "t1", tenantMail: "admin@example.com" },
    );

    expect(send.calledOnce).to.be.true;
    const mailValue = send.firstCall.args[0];
    expect(mailValue.type).to.equal("rule-aggregated-email");
    expect(mailValue.tenantId).to.equal("t1");
    expect(mailValue.to).to.equal("admin@example.com");
    expect(mailValue.subject).to.equal("Offene Buchungen");
    expect(mailValue.html).to.equal("2 bei Test Tenant: b1 b2 ");
  });

  it("prefers params.to over the context tenant mail", async () => {
    await aggregateActionRegistry.sendAggregatedEmail(
      [{ id: "b1", tenantId: "t1" }],
      { to: "override@example.com", subject: "s", body: "b" },
      { tenantId: "t1", tenantMail: "admin@example.com" },
    );

    expect(send.firstCall.args[0].to).to.equal("override@example.com");
  });

  it("does nothing for an empty doc set", async () => {
    await aggregateActionRegistry.sendAggregatedEmail(
      [],
      { subject: "s", body: "b" },
      {},
    );
    expect(send.called).to.be.false;
  });

  it("throws when no recipient is available", async () => {
    let error;
    try {
      await aggregateActionRegistry.sendAggregatedEmail(
        [{ id: "b1", tenantId: "t1" }],
        { subject: "s", body: "b" },
        { tenantId: "t1" },
      );
    } catch (err) {
      error = err;
    }
    expect(error).to.be.an("error");
  });
});
