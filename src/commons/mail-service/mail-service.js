const crypto = require("crypto");
const Handlebars = require("handlebars");
const bunyan = require("bunyan");
const TenantManager = require("../data-managers/tenant-manager");
const InstanceManager = require("../data-managers/instance-manager");
const { retry } = require("../utilities/retry");
const { embedMediaImages } = require("../services/media/mail-media");
const { createSmtpTransport } = require("./transports/smtp-transport");
const { createGraphTransport } = require("./transports/graph-transport");

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

/** The fields of a no-reply account, at the instance and at a tenant. */
const MAIL_CONFIG_FIELDS = [
  "noreplyUseGraphApi",
  "noreplyHost",
  "noreplyPort",
  "noreplyUser",
  "noreplyPassword",
  "noreplyStarttls",
  "noreplyMail",
  "noreplyDisplayName",
  "noreplyGraphTenantId",
  "noreplyGraphClientId",
  "noreplyGraphClientSecret",
];

const templateCache = new Map();
const transporterPool = new Map();
/** The tenant configurations the fallback to the instance was warned about. */
const warnedFallbacks = new Set();

/** The no-reply account of an instance or a tenant, nothing else. */
function mailConfigOf(source) {
  return Object.fromEntries(
    MAIL_CONFIG_FIELDS.map((field) => [field, source[field]]),
  );
}

/**
 * Whether a tenant's no-reply account is complete: the Graph set or the
 * SMTP set, all or nothing (spec section 3).
 */
function isCompleteTenantMailConfig(tenant) {
  const account = tenant.noreplyUseGraphApi
    ? [
        tenant.noreplyGraphTenantId,
        tenant.noreplyGraphClientId,
        tenant.noreplyGraphClientSecret,
      ]
    : [
        tenant.noreplyHost,
        tenant.noreplyPort,
        tenant.noreplyUser,
        tenant.noreplyPassword,
      ];
  return [...account, tenant.noreplyDisplayName, tenant.noreplyMail].every(
    Boolean,
  );
}

/**
 * The transport (glossary "Versandweg") of the mail stack: `send(mail)`
 * takes a mail value, chooses between the instance's and the tenant's
 * no-reply account and delivers over a pooled transporter with three
 * attempts. `renderHtml` renders a shell template into a finished body
 * for the rule engine, which builds its mail value itself from the rule's
 * body; every other notice is composed by `compose`.
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
      graphClientSecret: config.noreplyGraphClientSecret,
    };
    return crypto
      .createHash("md5")
      .update(JSON.stringify(relevantFields))
      .digest("hex");
  }

  /**
   * The adapter for a no-reply account: Microsoft Graph or SMTP. The seam
   * tests put the in-memory adapter in at.
   *
   * @param {Object} mailConfig The no-reply account
   * @returns {{ sendMail: function(Object): Promise<Object>, close?: function }}
   */
  static createTransporter(mailConfig) {
    return mailConfig.noreplyUseGraphApi
      ? createGraphTransport(mailConfig)
      : createSmtpTransport(mailConfig);
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
      transporterPool.set(configHash, {
        transporter: MailerService.createTransporter(mailConfig),
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
   * The html of a mail: the shell template rendered with its model, media
   * images embedded last, on the finished body - they can come from a
   * snippet, a tenant template or a bookable note, and this is the one
   * place all three have already been rendered into.
   *
   * @param {Object} options
   * @param {string} options.mailTemplate The shell template (Handlebars)
   * @param {Object} options.model What the template renders
   * @param {string|null} [options.tenantId] The tenant whose media may be
   *   embedded; null for an instance mail
   * @returns {Promise<string>}
   */
  static async renderHtml({ mailTemplate, model, tenantId = null }) {
    return embedMediaImages(
      await MailerService.processTemplate(mailTemplate, model),
      tenantId,
    );
  }

  /**
   * Chooses the transport of a mail (spec section 3): the instance's
   * account for an instance mail or a tenant that uses the instance mail,
   * the tenant's where it does not and its configuration is complete, the
   * instance's otherwise - warned about once per tenant configuration.
   *
   * @param {Object} instance The instance as the store answers it
   * @param {string|null} tenantId The tenant of the mail
   * @returns {Promise<{ transport: "instance" | "tenant", mailConfig: Object }>}
   */
  static async chooseTransport(instance, tenantId) {
    const viaInstance = {
      transport: "instance",
      mailConfig: mailConfigOf(instance),
    };
    if (!tenantId) {
      return viaInstance;
    }

    const tenant = await TenantManager.getTenant(tenantId);
    if (tenant && tenant.useInstanceMail !== false) {
      return viaInstance;
    }
    if (tenant && isCompleteTenantMailConfig(tenant)) {
      return { transport: "tenant", mailConfig: mailConfigOf(tenant) };
    }

    const warnKey = crypto
      .createHash("md5")
      .update(JSON.stringify([tenantId, tenant ? mailConfigOf(tenant) : null]))
      .digest("hex");
    if (!warnedFallbacks.has(warnKey)) {
      warnedFallbacks.add(warnKey);
      logger.warn(
        { tenantId },
        `tenant mail config incomplete, falling back to instance (tenant ${tenantId})`,
      );
    }
    return viaInstance;
  }

  /**
   * Sends a mail value (glossary "Mitteilung", spec section 2.1) over the
   * transport it chooses.
   *
   * @param {Object} mail
   * @param {string} mail.type The notice type, for the log
   * @param {string|null} [mail.tenantId] The tenant; null for an instance mail
   * @param {string} mail.to The one recipient
   * @param {string} [mail.bcc] A copy
   * @param {string} mail.subject
   * @param {string} mail.html The finished body
   * @param {Object[]} [mail.attachments] Nodemailer attachments, loaded
   * @returns {Promise<{ status: "sent", transport: "instance" | "tenant", messageId?: string }
   *   | { status: "skipped", reason: "mail_disabled" | "no_recipient" }>}
   * @throws {Error} What the transport threw after three attempts
   */
  static async send({
    type,
    tenantId = null,
    to,
    bcc,
    subject,
    html,
    attachments = [],
  }) {
    const context = tenantId ? `for tenant ${tenantId}` : "Instance";
    try {
      const instance = await InstanceManager.getInstance(false);

      if (instance.mailEnabled === false) {
        logger.info(
          `${context} -- mail disabled, skipping ${type} to ${to} with subject ${subject}`,
        );
        return { status: "skipped", reason: "mail_disabled" };
      }

      if (!to) {
        logger.warn(
          `${context} -- no recipient for ${type} with subject ${subject}`,
        );
        return { status: "skipped", reason: "no_recipient" };
      }

      const { transport, mailConfig } = await MailerService.chooseTransport(
        instance,
        tenantId,
      );

      logger.info(
        `${context} -- sending ${type} to ${to} with subject ${subject} via ${transport}`,
      );

      const transporter = MailerService.getTransporter(mailConfig);
      const info = await retry(
        () =>
          transporter.sendMail({
            from: `${mailConfig.noreplyDisplayName} <${mailConfig.noreplyMail}>`,
            to,
            subject,
            html,
            bcc,
            attachments,
          }),
        { attempts: 3 },
      );
      logger.info(`${context} -- Mail sent successfully to ${to}`);

      return {
        status: "sent",
        transport,
        ...(info?.messageId && { messageId: info.messageId }),
      };
    } catch (error) {
      logger.error(`Error sending mail to ${to}: ${error.message}`);
      throw error;
    }
  }
}

module.exports = MailerService;
