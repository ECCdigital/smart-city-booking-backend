const nodemailer = require("nodemailer");
const Mustache = require("mustache");
const bunyan = require("bunyan");
const TenantManager = require("../data-managers/tenant-manager");

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

    if (!this.isValidTemplate(emailTemplate)) {
      logger.error(`Email template ${emailTemplate} is invalid`);
      throw new Error("Invalid template");
    }
    try {
      return Mustache.render(emailTemplate, model);
    } catch (err) {
      throw err;
    }
  }

  /**
   * Send a mail using a template file and dynamic attributes.
   *
   * @param {string} tenantId The tenant ID.
   * @param {string} address The mail address of the receiver.
   * @param {string} subject The subject of the mail.
   * @param {string} mailTemplate String with HTML content of the mail template.
   * @param {object} model An object containing attributes, see #processTemplate
   * @param {array} attachments An array of attachments to be sent with the mail.
   * @param bcc
   * @returns Promise <>
   */
  static send(
    tenantId,
    address,
    subject,
    mailTemplate,
    model,
    attachments,
    bcc,
  ) {
    return new Promise((resolve, reject) => {
      model.baseUrl = process.env.BACKEND_URL;

      TenantManager.getTenant(tenantId).then((tenant) => {
        MailerService.processTemplate(mailTemplate, model)
          .then((output) => {
            var message = {
              from: tenant.noreplyDisplayName + " <" + tenant.noreplyMail + ">",
              to: address,
              subject: subject,
              html: output,
              bcc: bcc,
              attachments: attachments,
            };

            if (process.env.MAIL_ENABLED === "true") {
              logger.info(
                `${tenantId} -- sending mail to ${address} with subject ${subject}`,
              );

              const config = {
                pool: true,
                host: tenant.noreplyHost,
                port: tenant.noreplyPort,
                secure: true, // use TLS
                auth: {
                  user: tenant.noreplyUser,
                  pass: tenant.noreplyPassword,
                },
              };

              const logConfig = {
                ...config,
                auth: { ...config.auth, pass: "********" },
              };

              logger.debug(
                `${tenantId} -- using mail configuration ${JSON.stringify(
                  logConfig,
                )}`,
              );

              const transporter = nodemailer.createTransport(config);

              transporter.sendMail(message, (err) => {
                if (err) {
                  console.error(err);
                }

                resolve();
              });
            } else {
              resolve();
            }
          })
          .catch((err) => {
            logger.error(err);
            reject(err);
          });
      });
    });
  }

  static isValidTemplate(template) {
    const patterns = [
      /<!DOCTYPE html>/,
      /<html.*?>/,
      /<\/html>/,
      /<head>/,
      /<\/head>/,
      /<body>/,
      /<\/body>/,
      /<footer.*?>/,
      /<\/footer>/,
      /\{\{ title \}\}/,
      /\{\{\{ content \}\}\}/,
    ];

    const missingElement = patterns.find((pattern) => !pattern.test(template));

    if (missingElement !== undefined) {
      logger.error(
        `Email template is missing required pattern: ${missingElement}`,
      );
    }

    return !missingElement;
  }
}

module.exports = MailerService;
