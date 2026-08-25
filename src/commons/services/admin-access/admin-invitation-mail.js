const MailerService = require("../../mail-service/mail-service");
const InstanceManager = require("../../data-managers/instance-manager");
const {
  renderSnippet,
} = require("../../mail-service/templates/template-loader");

const ADMIN_INVITATION_SNIPPET = `
<p>Sie wurden als Administrator*in für die KielRegion Praktikumsbörse eingeladen.</p>

<p>
  Bitte klicken Sie auf den nachfolgenden Button, um die Einladung anzunehmen
  und Ihr Passwort festzulegen:
</p>

<p style="text-align: center;">
  <a
    href="{{invitationUrl}}"
    style="background-color: #003064; color: #ffffff; padding: 12px 24px; border-radius: 6px; text-decoration: none; font-weight: bold; display: inline-block;"
  >
    Einladung annehmen
  </a>
</p>
`;

const SUBJECT = "Einladung ins Admin-Team der KielRegion Praktikumsbörse";

async function sendAdminInvitation({ sendTo, token }) {
  const instance = await InstanceManager.getInstance(false);
  const invitationUrl = `${process.env.FRONTEND_URL}/admin-einladung?token=${token}`;
  const content = renderSnippet(
    "admin-invitation",
    { invitationUrl },
    { overrideSource: ADMIN_INVITATION_SNIPPET },
  );
  await MailerService.send({
    address: sendTo,
    subject: SUBJECT,
    mailTemplate: instance.mailTemplate,
    model: { title: SUBJECT, content },
  });
}

module.exports = { sendAdminInvitation };
