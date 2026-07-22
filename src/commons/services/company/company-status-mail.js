const MailerService = require("../../mail-service/mail-service");
const InstanceManager = require("../../data-managers/instance-manager");
const {
  renderSnippet,
} = require("../../mail-service/templates/template-loader");

const COMPANY_VERIFIED_SNIPPET = `
<p>Guten Tag,</p>

<p>
  Ihr Unternehmen {{companyName}} wurde von der KielRegion geprüft und
  freigeschaltet.
</p>

<p>Sie können jetzt Praktika einstellen und Bewerbungen empfangen.</p>

<p style="text-align: center; margin: 30px 0;">
  <a
    href="{{dashboardUrl}}"
    style="background-color: #003064; color: #ffffff; padding: 12px 24px; border-radius: 6px; text-decoration: none; font-weight: bold; display: inline-block;"
  >
    Zum Dashboard
  </a>
</p>
`;

async function sendCompanyVerified({ recipients, companyName }) {
  if (!Array.isArray(recipients) || recipients.length === 0) {
    return;
  }
  const instance = await InstanceManager.getInstance(false);
  const dashboardUrl = `${process.env.FRONTEND_URL}/dashboard`;
  const content = renderSnippet(
    "company-verified",
    { companyName, dashboardUrl },
    { overrideSource: COMPANY_VERIFIED_SNIPPET },
  );
  const subject = "Ihr Unternehmen wurde freigeschaltet";
  for (const address of recipients) {
    await MailerService.send({
      address,
      subject,
      mailTemplate: instance.mailTemplate,
      model: { title: subject, content },
    });
  }
}

module.exports = { sendCompanyVerified };
