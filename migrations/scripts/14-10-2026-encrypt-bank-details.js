/**
 * Encrypts the bank details stored in plain text (ECCdigital/tickets#16):
 * those of the customer in a cancellation request
 * (`booking.hooks[].payload.bankDetails`) and the tenant's bank account in
 * the invoice application (`tenant.applications[]`, id `invoice`), with
 * `CRYPTO_SECRET` like the tenants' secrets.
 *
 * Only a field still in plain text is written, so the migration can run
 * again. It writes through the collections, past the models' middleware:
 * the tenant model would decrypt and encrypt every application on the way.
 * Where a value is still in plain text and `CRYPTO_SECRET` is missing or
 * invalid, it fails before writing that value, and the instance stays out
 * of traffic.
 */

const SecurityUtils = require("../../src/commons/utilities/security-utils");
const {
  BANK_DETAIL_FIELDS,
} = require("../../src/commons/utilities/bank-details");

const {
  ACCOUNT_FIELDS: INVOICE_ACCOUNT_FIELDS,
} = require("../../src/commons/entities/application/payment/invoiceApplication");

/** The cipher of a non-empty text; nothing for any other value. */
const encryptPlain = (value) =>
  typeof value === "string" && value !== ""
    ? SecurityUtils.encrypt(value)
    : undefined;

/**
 * The `$set` of the fields of an object that a value in plain text asks to
 * encrypt, by path; empty when none does.
 *
 * @param {Object|undefined} object The bank details or the application
 * @param {string[]} fields The fields to look at
 * @param {string} prefix The path of the object in the document
 * @returns {Object} The `$set`
 */
function encryptionsOf(object, fields, prefix) {
  const set = {};
  for (const field of fields) {
    const next = encryptPlain(object?.[field]);
    if (next !== undefined) {
      set[`${prefix}.${field}`] = next;
    }
  }
  return set;
}

async function encryptPlainBankDetails(mongoose) {
  const bookings = mongoose.model("Booking").collection;
  for await (const booking of bookings.find(
    { "hooks.payload.bankDetails": { $exists: true } },
    { projection: { hooks: 1 } },
  )) {
    const set = {};
    (booking.hooks || []).forEach((hook, index) => {
      Object.assign(
        set,
        encryptionsOf(
          hook?.payload?.bankDetails,
          BANK_DETAIL_FIELDS,
          `hooks.${index}.payload.bankDetails`,
        ),
      );
    });
    if (Object.keys(set).length > 0) {
      await bookings.updateOne({ _id: booking._id }, { $set: set });
    }
  }

  const tenants = mongoose.model("Tenant").collection;
  for await (const tenant of tenants.find(
    { applications: { $elemMatch: { type: "payment", id: "invoice" } } },
    { projection: { applications: 1 } },
  )) {
    const set = {};
    (tenant.applications || []).forEach((app, index) => {
      if (app?.type !== "payment" || app?.id !== "invoice") return;
      Object.assign(
        set,
        encryptionsOf(app, INVOICE_ACCOUNT_FIELDS, `applications.${index}`),
      );
    });
    if (Object.keys(set).length > 0) {
      await tenants.updateOne({ _id: tenant._id }, { $set: set });
    }
  }
}

module.exports = {
  name: "14-10-2026-encrypt-bank-details",

  up: async function (mongoose) {
    await encryptPlainBankDetails(mongoose);
  },

  down: async function () {
    // Not reversed: the bank details are not to lie in plain text again.
  },
};
