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
    Zum Unternehmensdashboard
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

const COMPANY_AWAITING_VERIFICATION_SNIPPET = `
<p>Guten Tag,</p>

<p>
  das Unternehmen {{companyName}} hat sich auf der Praktikumsbörse registriert
  und wartet auf die Freigabe.
</p>

<p>
  Ansprechperson: {{contactName}}<br />
  E-Mail: {{contactEmail}}
</p>

<p style="text-align: center; margin: 30px 0;">
  <a
    href="{{reviewUrl}}"
    style="background-color: #003064; color: #ffffff; padding: 12px 24px; border-radius: 6px; text-decoration: none; font-weight: bold; display: inline-block;"
  >
    Unternehmen prüfen
  </a>
</p>
`;

function moderationRecipients() {
  return String(process.env.MODERATION_MAIL || "")
    .split(",")
    .map((address) => address.trim())
    .filter(Boolean);
}

async function sendCompanyAwaitingVerification({
  companyName,
  companyId,
  contactName,
  contactEmail,
}) {
  const recipients = moderationRecipients();
  if (recipients.length === 0) {
    return;
  }
  const instance = await InstanceManager.getInstance(false);
  const reviewUrl = `${process.env.FRONTEND_URL}/admin/unternehmen/${companyId}`;
  const content = renderSnippet(
    "company-awaiting-verification",
    {
      companyName,
      contactName: contactName || "—",
      contactEmail: contactEmail || "—",
      reviewUrl,
    },
    { overrideSource: COMPANY_AWAITING_VERIFICATION_SNIPPET },
  );
  const subject = `Neues Unternehmen wartet auf Freigabe: ${companyName}`;
  for (const address of recipients) {
    await MailerService.send({
      address,
      subject,
      mailTemplate: instance.mailTemplate,
      model: { title: "Neues Unternehmen wartet auf Freigabe", content },
    });
  }
}

module.exports = { sendCompanyVerified, sendCompanyAwaitingVerification };
