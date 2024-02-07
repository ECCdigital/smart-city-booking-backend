const nodemailer = require("nodemailer");
const fs = require("fs");
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
   * @param {string} templateName Filename of the template in subdirectory templates, e.g. "reset-password.temp".
   * @param {string} model An object containing attributes that should be replaced in the mail template.
   * @returns Promise <HTML output of the mail>
   */
  static processTemplate(templateName, model) {
    return new Promise((resolve, reject) => {
      const filename = __dirname + "/templates/" + templateName + ".html";
      logger.debug(
        "Processing E-Mail Template from " +
          filename +
          "with model " +
          JSON.stringify(model),
      );

      fs.readFile(filename, "utf-8", (err, template) => {
        if (err) {
          logger.error(err);
          reject(err);
        }

        const output = Mustache.render(template, model);
        resolve(output);
      });
    });
  }

  /**
   * Send a mail using a template file and dynamic attributes.
   *
   * @param {string} tenant The tenant used for mail configuration.
   * @param {string} address The mail address of the receiver.
   * @param {string} subject The subject of the mail.
   * @param {string} templateName File of the template, see #processTemplate
   * @param {object} model An object containing attributes, see #processTemplate
   * @returns Promise <>
   */
  static send(
    tenantId,
    address,
    subject,
    templateName,
    model,
    attachments,
    bcc,
  ) {
    return new Promise((resolve, reject) => {
      model.baseUrl = process.env.BACKEND_URL;

      TenantManager.getTenant(tenantId).then((tenant) => {
        MailerService.processTemplate(templateName, model)
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
                `${tenantId} -- sending mail to ${address} with subject ${subject} and template ${templateName}`,
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

              logger.debug(
                `${tenantId} -- using mail configuration ${JSON.stringify(
                  config,
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
}

module.exports = MailerService;
