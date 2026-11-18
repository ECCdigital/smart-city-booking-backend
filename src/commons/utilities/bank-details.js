/**
 * The customer's bank details of a cancellation request at rest and on the
 * wire (ECCdigital/tickets#16): stored, each field is encrypted with
 * `CRYPTO_SECRET`; read, a field still in plain text - from before the
 * migration - is taken as it is; answered by the API, only masked.
 */

const SecurityUtils = require("./security-utils");

const BANK_DETAIL_FIELDS = Object.freeze([
  "accountHolder",
  "bankName",
  "iban",
  "bic",
]);

const MASK = "***";
const IBAN_VISIBLE_DIGITS = 4;

/**
 * Applies a function to every bank detail field that is there.
 *
 * @param {Object|null} bankDetails
 * @param {function(*, string): *} fn Of the value and the field name
 * @returns {Object|null} A copy with the fields changed
 */
function mapFields(bankDetails, fn) {
  if (!bankDetails || typeof bankDetails !== "object") {
    return bankDetails ?? null;
  }
  const result = { ...bankDetails };
  for (const field of BANK_DETAIL_FIELDS) {
    if (field in result) {
      result[field] = fn(result[field], field);
    }
  }
  return result;
}

/**
 * Encrypts every field; one already encrypted stays as it is, so it can
 * run twice.
 *
 * @param {Object|null} bankDetails
 * @returns {Object|null}
 * @throws {Error} When `CRYPTO_SECRET` is missing or invalid
 */
function encryptBankDetails(bankDetails) {
  return mapFields(bankDetails, (value) =>
    SecurityUtils.isEncrypted(value) ? value : SecurityUtils.encrypt(value),
  );
}

/**
 * Decrypts every field; one in plain text stays as it is.
 *
 * @param {Object|null} bankDetails
 * @returns {Object|null}
 */
function decryptBankDetails(bankDetails) {
  return mapFields(bankDetails, (value) =>
    SecurityUtils.isEncrypted(value) ? SecurityUtils.decrypt(value) : value,
  );
}

/**
 * The bank details as the API answers them: the last four digits of the
 * IBAN, every other field given only as given. A field that cannot be
 * decrypted is masked whole.
 *
 * @param {Object|null} bankDetails Encrypted or in plain text
 * @returns {Object|null}
 */
function maskBankDetails(bankDetails) {
  return mapFields(bankDetails, (value, field) => {
    let plain;
    try {
      plain = SecurityUtils.isEncrypted(value)
        ? SecurityUtils.decrypt(value)
        : value;
    } catch {
      return MASK;
    }
    if (!plain) {
      return "";
    }
    if (field === "iban") {
      return `****${String(plain).slice(-IBAN_VISIBLE_DIGITS)}`;
    }
    return MASK;
  });
}

module.exports = {
  BANK_DETAIL_FIELDS,
  encryptBankDetails,
  decryptBankDetails,
  maskBankDetails,
};
