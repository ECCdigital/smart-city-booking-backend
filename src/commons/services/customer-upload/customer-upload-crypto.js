const crypto = require("crypto");

/**
 * Encryption at rest of customer uploads:
 * whatever the storage provider does on its own, the bytes of a customer
 * upload only ever reach it encrypted with AES-256-GCM. The key is derived
 * from `CRYPTO_SECRET`, which already guards the bank details, under a
 * purpose of its own, so the two never share a key.
 *
 * A stored blob is `iv (12 bytes) | auth tag (16 bytes) | ciphertext`.
 */

const ALGORITHM = "aes-256-gcm";
const IV_BYTES = 12;
const TAG_BYTES = 16;
const PURPOSE = "biletado:customer-upload:v1";

function key() {
  const secret = process.env.CRYPTO_SECRET;
  if (!secret) {
    throw new Error(
      "CRYPTO_SECRET is not set; customer uploads cannot be encrypted",
    );
  }
  return crypto.createHash("sha256").update(`${PURPOSE}:${secret}`).digest();
}

/**
 * @param {Buffer} data The plain bytes
 * @returns {Buffer} The blob to store
 */
function encryptUpload(data) {
  const iv = crypto.randomBytes(IV_BYTES);
  const cipher = crypto.createCipheriv(ALGORITHM, key(), iv);
  const ciphertext = Buffer.concat([cipher.update(data), cipher.final()]);
  return Buffer.concat([iv, cipher.getAuthTag(), ciphertext]);
}

/**
 * @param {Buffer} blob A blob of {@link encryptUpload}
 * @returns {Buffer} The plain bytes
 * @throws {Error} When the blob was altered or the key is another
 */
function decryptUpload(blob) {
  const iv = blob.subarray(0, IV_BYTES);
  const tag = blob.subarray(IV_BYTES, IV_BYTES + TAG_BYTES);
  const decipher = crypto.createDecipheriv(ALGORITHM, key(), iv);
  decipher.setAuthTag(tag);
  return Buffer.concat([
    decipher.update(blob.subarray(IV_BYTES + TAG_BYTES)),
    decipher.final(),
  ]);
}

module.exports = { ENCRYPTION: ALGORITHM, decryptUpload, encryptUpload };
