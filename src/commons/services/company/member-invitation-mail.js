const MailerService = require("../../mail-service/mail-service");
const InstanceManager = require("../../data-managers/instance-manager");
const {
  renderSnippet,
} = require("../../mail-service/templates/template-loader");

const MEMBER_INVITATION_SNIPPET = `
<p>Sie wurden eingeladen, dem Team von {{companyName}} auf der KielRegion Praktikumsbörse beizutreten.</p>

<p>
  Bitte klicken Sie auf den nachfolgenden Button, um die Einladung anzunehmen
  und Ihr Passwort festzulegen:
</p>

<p style="text-align: center;">
  <a
    href="{{{invitationUrl}}}"
    style="background-color: #0055a5; color: #ffffff; padding: 12px 24px; border-radius: 4px; text-decoration: none; font-weight: bold; display: inline-block;"
  >
    Einladung annehmen
  </a>
</p>
`;

async function sendMemberInvitation({ sendTo, companyName, token }) {
  const instance = await InstanceManager.getInstance(false);
  const invitationUrl = `${process.env.FRONTEND_URL}/einladung?token=${token}`;
  const content = renderSnippet(
    "member-invitation",
    { companyName, invitationUrl },
    { overrideSource: MEMBER_INVITATION_SNIPPET },
  );
  await MailerService.send({
    address: sendTo,
    subject: `Einladung in das Team von ${companyName}`,
    mailTemplate: instance.mailTemplate,
    model: { title: `Einladung in das Team von ${companyName}`, content },
  });
}

module.exports = { sendMemberInvitation };
