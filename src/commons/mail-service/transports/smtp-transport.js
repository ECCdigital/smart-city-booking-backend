const nodemailer = require("nodemailer");

/**
 * The SMTP adapter of the transport (glossary "Versandweg"): a pooled
 * nodemailer transporter for the no-reply account of the configuration.
 *
 * Both paths verify the server certificate and negotiate over the Node
 * defaults: implicit TLS carries no `tls` options, and STARTTLS carries
 * none either.
 *
 * @param {Object} mailConfig The no-reply account: `noreplyHost`,
 *   `noreplyPort`, `noreplyUser`, `noreplyPassword`, `noreplyStarttls`
 * @returns {import("nodemailer").Transporter}
 */
function createSmtpTransport(mailConfig) {
  return nodemailer.createTransport({
    pool: true,
    host: mailConfig.noreplyHost,
    port: mailConfig.noreplyPort,
    secure: !mailConfig.noreplyStarttls,
    auth: {
      user: mailConfig.noreplyUser,
      pass: mailConfig.noreplyPassword,
    },
  });
}

module.exports = { createSmtpTransport };
