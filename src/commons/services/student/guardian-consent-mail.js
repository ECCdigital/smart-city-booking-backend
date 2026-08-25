const MailerService = require("../../mail-service/mail-service");
const InstanceManager = require("../../data-managers/instance-manager");
const {
  renderSnippet,
} = require("../../mail-service/templates/template-loader");

const GUARDIAN_CONSENT_SNIPPET = `
<p>Guten Tag,</p>

<p>
  {{childName}} hat sich auf der Praktikumsbörse KielRegion registriert. Da
  {{childName}} das 16. Lebensjahr noch nicht vollendet hat, benötigen wir Ihre
  Einwilligung als erziehungsberechtigte Person, bevor das Konto genutzt werden
  kann.
</p>

<p>
  Bitte klicken Sie auf den nachfolgenden Button, um die Einwilligung zu
  erteilen:
</p>

<p style="text-align: center;">
  <a
    href="{{{consentUrl}}}"
    style="background-color: #0055a5; color: #ffffff; padding: 12px 24px; border-radius: 4px; text-decoration: none; font-weight: bold; display: inline-block;"
  >
    Einwilligung erteilen
  </a>
</p>

<p>
  Wenn Sie nicht möchten, dass {{childFirstName}} die Praktikumsbörse nutzt,
  ignorieren Sie diese E-Mail einfach. Ohne Ihre Einwilligung bleibt das Konto
  gesperrt und kann nicht verwendet werden.
</p>

<p>Diese E-Mail wurde automatisch versendet. Sie brauchen nicht zu antworten.</p>
`;

async function sendGuardianConsentRequest({
  sendTo,
  firstName,
  lastName,
  token,
}) {
  const instance = await InstanceManager.getInstance(false);
  const childFirstName = String(firstName || "").trim() || "Ihr Kind";
  const childName = `${firstName || ""} ${lastName || ""}`.trim() || "Ihr Kind";
  const consentUrl = `${process.env.FRONTEND_URL}/eltern-einwilligung?token=${encodeURIComponent(token)}`;
  const content = renderSnippet(
    "guardian-consent",
    { childName, childFirstName, consentUrl },
    { overrideSource: GUARDIAN_CONSENT_SNIPPET },
  );
  await MailerService.send({
    address: sendTo,
    subject: "Einwilligung für die Praktikumsbörse KielRegion erforderlich",
    mailTemplate: instance.mailTemplate,
    model: {
      title: "Einwilligung der Erziehungsberechtigten",
      content,
    },
  });
}

module.exports = { sendGuardianConsentRequest };
