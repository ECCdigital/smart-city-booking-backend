const MailerService = require("../../mail-service/mail-service");
const InstanceManager = require("../../data-managers/instance-manager");
const {
  renderSnippet,
} = require("../../mail-service/templates/template-loader");

const APPLICATION_RECEIVED_SNIPPET = `
<p>Guten Tag,</p>

<p>
  für {{companyName}} ist eine neue
  {{#if isUnsolicited}}Initiativbewerbung{{else}}Bewerbung{{/if}} eingegangen.
</p>

<ul style="list-style-type: none; padding-left: 0;">
  <li><strong>Bewerber*in:</strong> {{applicantName}}</li>
  {{#if offerTitle}}<li><strong>Praktikum:</strong> {{offerTitle}}</li>{{/if}}
</ul>

<p>Die vollständige Bewerbung finden Sie in Ihrem Dashboard.</p>

<p style="text-align: center; margin: 30px 0;">
  <a
    href="{{dashboardUrl}}"
    style="background-color: #003064; color: #ffffff; padding: 12px 24px; border-radius: 6px; text-decoration: none; font-weight: bold; display: inline-block;"
  >
    Zum Dashboard
  </a>
</p>
`;

const APPLICATION_STATUS_SNIPPET = `
<p>Guten Tag {{applicantName}},</p>

<p>
  der Status Ihrer
  {{#if offerTitle}}Bewerbung auf „{{offerTitle}}"{{else}}Initiativbewerbung{{/if}}{{#if companyName}}
  bei {{companyName}}{{/if}} hat sich geändert.
</p>

<ul style="list-style-type: none; padding-left: 0;">
  <li><strong>Bisheriger Status:</strong> {{oldStatus}}</li>
  <li><strong>Neuer Status:</strong> {{newStatus}}</li>
</ul>

<p>Ihre Bewerbungen sehen Sie jederzeit in Ihrem Profil.</p>

<p style="text-align: center; margin: 30px 0;">
  <a
    href="{{profileUrl}}"
    style="background-color: #003064; color: #ffffff; padding: 12px 24px; border-radius: 6px; text-decoration: none; font-weight: bold; display: inline-block;"
  >
    Zu meinen Bewerbungen
  </a>
</p>
`;

async function sendApplicationReceived({
  recipients,
  companyName,
  applicantName,
  offerTitle,
  isUnsolicited,
}) {
  if (!Array.isArray(recipients) || recipients.length === 0) {
    return;
  }
  const instance = await InstanceManager.getInstance(false);
  const dashboardUrl = `${process.env.FRONTEND_URL}/dashboard`;
  const content = renderSnippet(
    "application-received",
    { companyName, applicantName, offerTitle, isUnsolicited, dashboardUrl },
    { overrideSource: APPLICATION_RECEIVED_SNIPPET },
  );
  const subject = isUnsolicited
    ? "Neue Initiativbewerbung"
    : offerTitle
      ? `Neue Bewerbung für „${offerTitle}"`
      : "Neue Bewerbung";
  for (const address of recipients) {
    await MailerService.send({
      address,
      subject,
      mailTemplate: instance.mailTemplate,
      model: { title: subject, content },
    });
  }
}

async function sendApplicationStatusChanged({
  to,
  applicantName,
  companyName,
  offerTitle,
  oldStatus,
  newStatus,
}) {
  if (!to) {
    return;
  }
  const instance = await InstanceManager.getInstance(false);
  const profileUrl = `${process.env.FRONTEND_URL}/profil/schueler`;
  const content = renderSnippet(
    "application-status-changed",
    {
      applicantName,
      companyName,
      offerTitle,
      oldStatus,
      newStatus,
      profileUrl,
    },
    { overrideSource: APPLICATION_STATUS_SNIPPET },
  );
  const subject = "Neuer Status Ihrer Bewerbung";
  await MailerService.send({
    address: to,
    subject,
    mailTemplate: instance.mailTemplate,
    model: { title: subject, content },
  });
}

module.exports = { sendApplicationReceived, sendApplicationStatusChanged };
