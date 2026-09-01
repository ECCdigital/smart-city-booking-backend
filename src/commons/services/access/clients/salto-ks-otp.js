const crypto = require("crypto");

/**
 * The Salto-OTP ("ClayCode") a remote command at an IQ with `otp_enabled`
 * expects: the first 5 hex characters of
 * `MD5(UTC "YYYYmmDDHHMMSS" + secret + pin)`, stamped on the whole UTC second.
 * Valid for 3 minutes and reusable within that window; proven at the door on
 * 2026-08-25 (docs/research/salto-ks-remote-open-door-proof.md).
 *
 * @param {string} secret The 16-character first secret of the IQ activation
 * @param {string} pin The 4-digit IQ-PIN of the activation
 * @param {Date} [date] Moment to stamp; defaults to now
 * @returns {string} The 5-character OTP
 */
function computeSaltoOtp(secret, pin, date = new Date()) {
  const stamp = [
    date.getUTCFullYear(),
    String(date.getUTCMonth() + 1).padStart(2, "0"),
    String(date.getUTCDate()).padStart(2, "0"),
    String(date.getUTCHours()).padStart(2, "0"),
    String(date.getUTCMinutes()).padStart(2, "0"),
    String(date.getUTCSeconds()).padStart(2, "0"),
  ].join("");

  return crypto
    .createHash("md5")
    .update(`${stamp}${secret}${pin}`)
    .digest("hex")
    .slice(0, 5);
}

module.exports = { computeSaltoOtp };
