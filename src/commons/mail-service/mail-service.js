const nodemailer = require("nodemailer");
const crypto = require("crypto");
const Handlebars = require("handlebars");
const bunyan = require("bunyan");
const TenantManager = require("../data-managers/tenant-manager");
const InstanceManger = require("../data-managers/instance-manager");
const axios = require("axios");
const { ConfidentialClientApplication } = require("@azure/msal-node");
const { retry } = require("../utilities/retry");

const dateTimeFormatter = new Intl.DateTimeFormat("de-DE", {
  day: "2-digit",
  month: "2-digit",
  year: "numeric",
  hour: "2-digit",
  minute: "2-digit",
  timeZone: "Europe/Berlin",
});

const dateFormatter = new Intl.DateTimeFormat("de-DE", {
  day: "2-digit",
  month: "2-digit",
  year: "numeric",
});

const currencyFormatter = new Intl.NumberFormat("de-DE", {
  style: "currency",
  currency: "EUR",
});

Handlebars.registerHelper("formatDateTime", (value) => {
  if (!value) return "–";
  return dateTimeFormatter.format(new Date(value));
});

Handlebars.registerHelper("formatDate", (value) => {
  if (!value) return "–";
  return dateFormatter.format(new Date(value));
});

Handlebars.registerHelper("priceFormatted", (value) => {
  if (typeof value !== "number") return "–";
  return currencyFormatter.format(value);
});

Handlebars.registerHelper("sanitizeString", function (value) {
  if (typeof value === "string" && value.trim() !== "") {
    return value.replace(/<[^>]*>?/gm, "");
  }
  return value;
});
Handlebars.registerHelper("gt", function (a, b, options) {
  return a > b ? options.fn(this) : options.inverse(this);
});

Handlebars.registerPartial(
  "contactSnippet",
  `
    <strong>Firma:</strong> {{#if booking.company}}{{booking.company}}{{else}}–{{/if}}<br>
    <strong>Name:</strong> {{#if booking.name}}{{booking.name}}{{else}}–{{/if}}<br>
    <strong>Adresse:</strong> 
      {{#if booking.street}}{{booking.street}}{{else}} – {{/if}},
      {{#if booking.zipCode}}{{booking.zipCode}}{{else}} – {{/if}}
      {{#if booking.location}}{{booking.location}}{{else}} – {{/if}}<br>
    <strong>Telefon:</strong> {{#if booking.phone}}{{booking.phone}}{{else}}–{{/if}}<br>
    <strong>E-Mail:</strong> {{#if booking.mail}}{{booking.mail}}{{else}}–{{/if}}
`,
);

Handlebars.registerPartial(
  "mailFooter",
  `
  <hr />
  <p style="font-size: 0.9em; color: #555;">
    Falls Sie Fragen haben, können Sie uns gerne 
    <a href="mailto:{{supportEmail}}">kontaktieren</a>.
  </p>
`,
);

const logger = bunyan.createLogger({
  name: "mail-service.js",
  level: process.env.LOG_LEVEL,
});

const TRANSPORTER_MAX_AGE = 30 * 60 * 1000;
const MAX_TEMPLATE_CACHE_SIZE = 100;

const templateCache = new Map();
const transporterPool = new Map();

/**
 * This class handles E-Mail templates and transportation.
 */
class MailerService {
  static getConfigHash(config) {
    const relevantFields = {
      host: config.noreplyHost,
      port: config.noreplyPort,
      user: config.noreplyUser,
      password: config.noreplyPassword,
      starttls: config.noreplyStarttls,
      useGraphApi: config.noreplyUseGraphApi,
      graphTenantId: config.noreplyGraphTenantId,
      graphClientId: config.noreplyGraphClientId,
    };
    return crypto
      .createHash("md5")
      .update(JSON.stringify(relevantFields))
      .digest("hex");
  }

  static getTransporter(mailConfig) {
    const configHash = this.getConfigHash(mailConfig);
    const now = Date.now();

    for (const [hash, entry] of transporterPool) {
      if (now - entry.lastUsed > TRANSPORTER_MAX_AGE) {
        entry.transporter.close?.();
        transporterPool.delete(hash);
      }
    }

    if (!transporterPool.has(configHash)) {
      const transporterConfig = mailConfig.noreplyUseGraphApi
        ? this.createGraphTransport({
            tenantId: mailConfig.noreplyGraphTenantId,
            clientId: mailConfig.noreplyGraphClientId,
            clientSecret: mailConfig.noreplyGraphClientSecret,
            from: {
              name: mailConfig.noreplyDisplayName,
              address: mailConfig.noreplyMail,
            },
          })
        : {
            pool: true,
            host: mailConfig.noreplyHost,
            port: mailConfig.noreplyPort,
            secure: !mailConfig.noreplyStarttls,
            auth: {
              user: mailConfig.noreplyUser,
              pass: mailConfig.noreplyPassword,
            },
            ...(mailConfig.noreplyStarttls && {
              tls: { ciphers: "SSLv3", rejectUnauthorized: false },
            }),
          };

      transporterPool.set(configHash, {
        transporter: nodemailer.createTransport(transporterConfig),
        lastUsed: now,
      });
    }

    const entry = transporterPool.get(configHash);
    entry.lastUsed = now;
    return entry.transporter;
  }

  /**
   * Font stacks previously used double quotes (e.g. "Segoe UI") inside HTML
   * style="..." attributes, which truncates the attribute. Normalize to single
   * quotes so theme typography applies consistently.
   */
  static sanitizeMailHtmlFonts(html) {
    if (typeof html !== "string" || html.length === 0) return html;
    return html.replace(
      /"(Segoe UI|Times New Roman|Work Sans|Helvetica Neue|Courier New)"/g,
      "'$1'",
    );
  }

  /**
   * Read a template from file and replace dynamic attributes.
   *
   * @param emailTemplate The HTML file containing the mail template.
   * @param {string} model An object containing attributes that should be replaced in the mail template.
   * @returns Promise <HTML output of the mail>
   */
  static async processTemplate(emailTemplate, model) {
    let compiledTemplate = templateCache.get(emailTemplate);

    if (!compiledTemplate) {
      if (templateCache.size >= MAX_TEMPLATE_CACHE_SIZE) {
        const firstKey = templateCache.keys().next().value;
        templateCache.delete(firstKey);
      }

      compiledTemplate = Handlebars.compile(emailTemplate);
      templateCache.set(emailTemplate, compiledTemplate);
    }

    return MailerService.sanitizeMailHtmlFonts(compiledTemplate(model));
  }

  /**
   * Sends an email using the specified template and model.
   *
   * @param {null} tenantId - The ID of the tenant.
   * @param {string} address - The recipient's email address.
   * @param {string} subject - The subject of the email.
   * @param {string} mailTemplate - The HTML file containing the mail template.
   * @param {Object} model - An object containing attributes that should be replaced in the mail template.
   * @param {Array} attachments - An array of attachments to include in the email.
   * @param {null} bcc - Blind carbon copy recipients.
   * @param {boolean} useInstanceMail - Whether to use the instance mail configuration.
   * @returns {Promise<void>} - A promise that resolves when the email is sent.
   * @throws {Error} - Throws an error if sending the email fails.
   */
  static async send({
    tenantId = null,
    address,
    subject,
    mailTemplate,
    model,
    attachments = [],
    bcc = null,
    useInstanceMail = false,
  }) {
    try {
      const instance = await InstanceManger.getInstance(false);

      if (instance.mailEnabled === false && address) {
        return;
      }

      const mailConfig = {
        noreplyUseGraphApi: instance.noreplyUseGraphApi,
        noreplyHost: instance.noreplyHost,
        noreplyPort: instance.noreplyPort,
        noreplyUser: instance.noreplyUser,
        noreplyPassword: instance.noreplyPassword,
        noreplyStarttls: instance.noreplyStarttls,
        noreplyMail: instance.noreplyMail,
        noreplyDisplayName: instance.noreplyDisplayName,
        noreplyGraphTenantId: instance.noreplyGraphTenantId,
        noreplyGraphClientId: instance.noreplyGraphClientId,
        noreplyGraphClientSecret: instance.noreplyGraphClientSecret,
      };
      if (tenantId && !useInstanceMail) {
        const tenant = await TenantManager.getTenant(tenantId);
        if (
          tenant.noreplyUseGraphApi &&
          tenant.noreplyGraphTenantId &&
          tenant.noreplyGraphClientId &&
          tenant.noreplyGraphClientSecret &&
          tenant.noreplyDisplayName &&
          tenant.noreplyMail
        ) {
          mailConfig.noreplyUseGraphApi = tenant.noreplyUseGraphApi;
          mailConfig.noreplyGraphTenantId = tenant.noreplyGraphTenantId;
          mailConfig.noreplyGraphClientId = tenant.noreplyGraphClientId;
          mailConfig.noreplyGraphClientSecret = tenant.noreplyGraphClientSecret;
          mailConfig.noreplyDisplayName = tenant.noreplyDisplayName;
          mailConfig.noreplyMail = tenant.noreplyMail;
        } else if (
          !tenant.noreplyUseGraphApi &&
          tenant.noreplyHost &&
          tenant.noreplyPort &&
          tenant.noreplyUser &&
          tenant.noreplyPassword &&
          tenant.noreplyDisplayName &&
          tenant.noreplyMail
        ) {
          mailConfig.noreplyUseGraphApi = tenant.noreplyUseGraphApi;
          mailConfig.noreplyHost = tenant.noreplyHost;
          mailConfig.noreplyPort = tenant.noreplyPort;
          mailConfig.noreplyUser = tenant.noreplyUser;
          mailConfig.noreplyPassword = tenant.noreplyPassword;
          mailConfig.noreplyStarttls = tenant.noreplyStarttls;
          mailConfig.noreplyDisplayName = tenant.noreplyDisplayName;
          mailConfig.noreplyMail = tenant.noreplyMail;
        }
      }

      const output = await MailerService.processTemplate(mailTemplate, model);

      const context = tenantId ? ` for tenant ${tenantId}` : "Instance";

      logger.info(
        `${context} -- sending mail to ${address} with subject ${subject}`,
      );

      const transporter = MailerService.getTransporter(mailConfig);

      const mailOptions = {
        from: `${mailConfig.noreplyDisplayName} <${mailConfig.noreplyMail}>`,
        to: address,
        subject: subject,
        html: output,
        bcc: bcc,
        attachments: attachments,
      };

      if (address) {
        await retry(() => transporter.sendMail(mailOptions), { attempts: 3 });
        logger.info(`${context} -- Mail sent successfully to ${address}`);
      } else {
        logger.error(`${context} -- No recipient address provided`);
      }
    } catch (error) {
      logger.error(`Error sending mail to ${address}: ${error.message}`);
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
}

module.exports = MailerService;
