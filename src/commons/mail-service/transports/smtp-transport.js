const nodemailer = require("nodemailer");

/**
 * The SMTP adapter of the transport (glossary "Versandweg"): a pooled
 * nodemailer transporter for the no-reply account of the configuration.
 *
 * STARTTLS keeps the legacy ciphers without certificate verification - an
 * own ticket outside the mail-stack chain (spec section 3).
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
    ...(mailConfig.noreplyStarttls && {
      tls: { ciphers: "SSLv3", rejectUnauthorized: false },
    }),
  });
}

module.exports = { createSmtpTransport };
