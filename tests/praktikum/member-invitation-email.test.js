const mock = require("mock-require");
const { expect } = require("chai");
const sinon = require("sinon");

describe("Member invitation email", () => {
  let sandbox;
  let MailerService;
  let InstanceManager;
  let MemberInvitationMail;
  let originalFrontendUrl;

  beforeEach(() => {
    sandbox = sinon.createSandbox();
    originalFrontendUrl = process.env.FRONTEND_URL;
    process.env.FRONTEND_URL = "https://app.kielregion.de";
    MailerService = { send: sandbox.stub().resolves() };
    InstanceManager = {
      getInstance: sandbox
        .stub()
        .resolves({ mailTemplate: "INSTANCE_TEMPLATE" }),
    };
    mock("../../src/commons/mail-service/mail-service", MailerService);
    mock("../../src/commons/data-managers/instance-manager", InstanceManager);
    MemberInvitationMail = mock.reRequire(
      "../../src/commons/services/company/member-invitation-mail",
    );
  });

  afterEach(() => {
    sandbox.restore();
    mock.stopAll();
    process.env.FRONTEND_URL = originalFrontendUrl;
  });

  it("sends real HTML via the INSTANCE template with the company name, button and a RAW token URL", async () => {
    await MemberInvitationMail.sendMemberInvitation({
      sendTo: "neu@team.de",
      companyName: "Muster GmbH",
      token: "abc123",
    });
    expect(MailerService.send.calledOnce).to.equal(true);
    const arg = MailerService.send.firstCall.args[0];
    expect(arg.address).to.equal("neu@team.de");
    expect(arg.mailTemplate).to.equal("INSTANCE_TEMPLATE");
    expect(arg.subject).to.contain("Muster GmbH");
    expect(arg.model.content).to.contain("Muster GmbH");
    expect(arg.model.content).to.contain("Einladung annehmen");
    expect(arg.model.content).to.contain(
      'href="https://app.kielregion.de/einladung?token=abc123"',
    );
    // regression guard: the "=" must stay raw, not be HTML-escaped to &#x3D;
    expect(arg.model.content).to.not.contain("&#x3D;");
  });
});
