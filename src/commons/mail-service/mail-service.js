const nodemailer = require("nodemailer");
const Mustache = require("mustache");
const bunyan = require("bunyan");
const TenantManager = require("../data-managers/tenant-manager");
const axios = require("axios");
const { ConfidentialClientApplication } = require("@azure/msal-node");

const logger = bunyan.createLogger({
  name: "mail-service.js",
  level: process.env.LOG_LEVEL,
});

/**
 * This class handles E-Mail templates and transportation.
 */
class MailerService {
  /**
   * Read a template from file and replace dynamic attributes.
   *
   * @param emailTemplate The HTML file containing the mail template.
   * @param {string} model An object containing attributes that should be replaced in the mail template.
   * @returns Promise <HTML output of the mail>
   */
  static async processTemplate(emailTemplate, model) {
    logger.debug(
      `Processing mail template ${emailTemplate} with model ${JSON.stringify(
        model,
      )}`,
    );

    try {
      return Mustache.render(emailTemplate, model);
    } catch (err) {
      throw err;
    }
  }

  /**
   * Sends an email using the specified template and model.
   *
   * @param {string} tenantId - The ID of the tenant.
   * @param {string} address - The recipient's email address.
   * @param {string} subject - The subject of the email.
   * @param {string} mailTemplate - The HTML file containing the mail template.
   * @param {Object} model - An object containing attributes that should be replaced in the mail template.
   * @param {Array} attachments - An array of attachments to include in the email.
   * @param {string} bcc - Blind carbon copy recipients.
   * @returns {Promise<void>} - A promise that resolves when the email is sent.
   * @throws {Error} - Throws an error if sending the email fails.
   */
  static async send(
    tenantId,
    address,
    subject,
    mailTemplate,
    model,
    attachments,
    bcc,
  ) {
    try {
      const tenant = await TenantManager.getTenant(tenantId);
      const output = await MailerService.processTemplate(mailTemplate, model);

      if (process.env.MAIL_ENABLED !== "true") {
        return;
      }

      logger.info(
        `${tenantId} -- sending mail to ${address} with subject ${subject}`,
      );

      let transporterConfig;
      if (!tenant.noreplyUseGraphApi) {
        // SMTP Transport
        transporterConfig = {
          pool: true,
          host: tenant.noreplyHost,
          port: tenant.noreplyPort,
          secure: !tenant.noreplyStarttls,
          auth: {
            user: tenant.noreplyUser,
            pass: tenant.noreplyPassword,
          },
        };

        if (tenant.noreplyStarttls) {
          transporterConfig.tls = {
            ciphers: "SSLv3",
            rejectUnauthorized: false,
          };
        }
      } else {
        // Graph Transport
        transporterConfig = this.createGraphTransport({
          tenantId: tenant.noreplyGraphTenantId,
          clientId: tenant.noreplyGraphClientId,
          clientSecret: tenant.noreplyGraphClientSecret,
          from: {
            name: tenant.noreplyDisplayName,
            address: tenant.noreplyMail,
          },
        });
      }

      const safeLogConfig = JSON.parse(JSON.stringify(transporterConfig));
      if (safeLogConfig.auth && safeLogConfig.auth.pass) {
        safeLogConfig.auth.pass = "********";
      }
      logger.debug(
        `${tenantId} -- using mail configuration ${JSON.stringify(safeLogConfig)}`,
      );

      const transporter = nodemailer.createTransport(transporterConfig);

      const mailOptions = {
        from: `${tenant.noreplyDisplayName} <${tenant.noreplyMail}>`,
        to: address,
        subject: subject,
        html: output,
        bcc,
        attachments,
      };

      await transporter.sendMail(mailOptions);
      logger.info(`${tenantId} -- Mail sent successfully to ${address}`);
    } catch (error) {
      logger.error(error);
      throw error;
    }
  }

  /**
   * Creates a transport object for sending emails via Microsoft Graph API.
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
  static createGraphTransport(options) {
    const { tenantId, clientId, clientSecret, from } = options;

    const msalConfig = {
      auth: {
        clientId,
        authority: `https://login.microsoftonline.com/${tenantId}`,
        clientSecret,
      },
    };
    const cca = new ConfidentialClientApplication(msalConfig);

    return {
      name: "GraphTransport",
      version: "1.0.0",
      async send(mail, callback) {
        try {
          const mailData = mail.data;

          const toRecipients = MailerService._normalizeRecipients(mailData.to);
          const ccRecipients = MailerService._normalizeRecipients(mailData.cc);
          const bccRecipients = MailerService._normalizeRecipients(
            mailData.bcc,
          );
          const attachments = MailerService._base64Attachment(
            mailData.attachments,
          );

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
          const response = await axios.post(url, JSON.stringify(graphBody), {
            headers: {
              Authorization: `Bearer ${accessToken}`,
              "Content-Type": "application/json",
            },
          });

          if (!response.ok) {
            const errText = await response.text();
            throw new Error(
              `Graph sendMail failed: ${response.status} - ${errText}`,
            );
          }

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
   * Normalizes the recipients input.
   *
   * @param {string|Array} input - The input recipients, either as a comma-separated string or an array.
   * @returns {Array} - An array of trimmed recipient strings.
   */
  static _normalizeRecipients(input) {
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
  static _base64Attachment(attachments) {
    if (!attachments && !Array.isArray(attachments)) return [];
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
}

module.exports = MailerService;
