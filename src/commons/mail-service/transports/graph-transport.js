const nodemailer = require("nodemailer");
const axios = require("axios");
const { ConfidentialClientApplication } = require("@azure/msal-node");

/**
 * Normalizes the recipients input.
 *
 * @param {string|Array} input - The input recipients, either as a comma-separated string or an array.
 * @returns {Array} - An array of trimmed recipient strings.
 */
function normalizeRecipients(input) {
  if (!input) return [];
  if (Array.isArray(input)) return input;
  return input.split(",").map((s) => s.trim());
}

/**
 * Converts attachments to base64 encoded format.
 *
 * @param {Array} attachments - An array of attachment objects.
 * @returns {Array} - An array of base64 encoded attachment objects.
 */
function base64Attachments(attachments) {
  if (!attachments || !Array.isArray(attachments)) return [];
  return attachments.map((att) => {
    return {
      "@odata.type": "#microsoft.graph.fileAttachment",
      name: att.filename || "attachment",
      contentType: att.contentType || "application/octet-stream",
      contentBytes: att.content.toString("base64"),
      contentId: att.cid,
      isInline: !!att.cid,
    };
  });
}

/**
 * The nodemailer custom transport that posts a mail to Microsoft Graph's
 * `sendMail` as the no-reply user, authenticated with MSAL client
 * credentials.
 *
 * @param {Object} options - The configuration options for the transport.
 * @param {string} options.tenantId - The tenant ID for the Microsoft Graph API.
 * @param {string} options.clientId - The client ID for the Microsoft Graph API.
 * @param {string} options.clientSecret - The client secret for the Microsoft Graph API.
 * @param {Object} options.from - The sender's information.
 * @param {string} options.from.name - The sender's name.
 * @param {string} options.from.address - The sender's email address.
 * @returns {Object} - The transport object with a send method.
 */
function graphTransport({ tenantId, clientId, clientSecret, from }) {
  const cca = new ConfidentialClientApplication({
    auth: {
      clientId,
      authority: `https://login.microsoftonline.com/${tenantId}`,
      clientSecret,
    },
  });

  return {
    name: "GraphTransport",
    version: "1.0.0",
    async send(mail, callback) {
      try {
        const mailData = mail.data;

        const toRecipients = normalizeRecipients(mailData.to);
        const ccRecipients = normalizeRecipients(mailData.cc);
        const bccRecipients = normalizeRecipients(mailData.bcc);
        const attachments = base64Attachments(mailData.attachments);

        const tokenResponse = await cca.acquireTokenByClientCredential({
          scopes: ["https://graph.microsoft.com/.default"],
        });
        if (!tokenResponse || !tokenResponse.accessToken) {
          throw new Error("Graph sendMail failed: No access token received");
        }
        const accessToken = tokenResponse.accessToken;

        const graphBody = {
          message: {
            from: {
              emailAddress: { name: from.name, address: from.address },
            },
            subject: mailData.subject || "",
            body: {
              contentType: mailData.html ? "HTML" : "Text",
              content: mailData.html || mailData.text || "",
            },
            toRecipients: toRecipients.map((addr) => ({
              emailAddress: { address: addr },
            })),
            ccRecipients: ccRecipients.map((addr) => ({
              emailAddress: { address: addr },
            })),
            bccRecipients: bccRecipients.map((addr) => ({
              emailAddress: { address: addr },
            })),
            attachments: attachments,
          },
          saveToSentItems: "false",
        };

        const url = `https://graph.microsoft.com/v1.0/users/${encodeURIComponent(from.address)}/sendMail`;
        await axios.post(url, JSON.stringify(graphBody), {
          headers: {
            Authorization: `Bearer ${accessToken}`,
            "Content-Type": "application/json",
          },
        });

        callback(null, {
          accepted: toRecipients,
          rejected: [],
          response: "E-Mail via Graph API sent",
        });
      } catch (error) {
        callback(error);
      }
    },
  };
}

/**
 * The Microsoft Graph adapter of the transport (glossary "Versandweg"): a
 * nodemailer transporter over the Graph custom transport, so the caller
 * sends the same nodemailer mail options as over SMTP.
 *
 * @param {Object} mailConfig The no-reply account: `noreplyGraphTenantId`,
 *   `noreplyGraphClientId`, `noreplyGraphClientSecret`, `noreplyDisplayName`,
 *   `noreplyMail`
 * @returns {import("nodemailer").Transporter}
 */
function createGraphTransport(mailConfig) {
  return nodemailer.createTransport(
    graphTransport({
      tenantId: mailConfig.noreplyGraphTenantId,
      clientId: mailConfig.noreplyGraphClientId,
      clientSecret: mailConfig.noreplyGraphClientSecret,
      from: {
        name: mailConfig.noreplyDisplayName,
        address: mailConfig.noreplyMail,
      },
    }),
  );
}

module.exports = { createGraphTransport };
