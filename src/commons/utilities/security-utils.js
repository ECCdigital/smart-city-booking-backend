const crypto = require("crypto");
const ALGORITHM = "aes-256-cbc"; //Using AES encryption
const KEY_LENGTH = 32;

/**
 * The key of AES-256: `CRYPTO_SECRET`, 32 bytes. Without it nothing is
 * encrypted, so nothing is written in plain text by mistake.
 *
 * @returns {Buffer}
 * @throws {Error} When `CRYPTO_SECRET` is missing or not 32 bytes long
 */
function key() {
  const secret = process.env.CRYPTO_SECRET;
  const buffer = secret ? Buffer.from(secret) : null;
  if (!buffer || buffer.length !== KEY_LENGTH) {
    throw new Error(`CRYPTO_SECRET is missing or not ${KEY_LENGTH} bytes long`);
  }
  return buffer;
}

class SecurityUtils {
  /**
   * Whether a value is what {@link SecurityUtils.encrypt} answers.
   *
   * @param {*} value
   * @returns {boolean}
   */
  static isEncrypted(value) {
    return (
      value !== null &&
      typeof value === "object" &&
      typeof value.iv === "string" &&
      typeof value.data === "string"
    );
  }

  static encrypt(text) {
    let t = text || "";
    const iv = crypto.randomBytes(16);
    let cipher = crypto.createCipheriv(ALGORITHM, key(), iv);
    let encrypted = cipher.update(t);
    encrypted = Buffer.concat([encrypted, cipher.final()]);
    return { iv: iv.toString("hex"), data: encrypted.toString("hex") };
  }

  static decrypt(encryptedTextObject) {
    if (!encryptedTextObject || typeof encryptedTextObject !== "object")
      return null;

    let iv = Buffer.from(encryptedTextObject.iv, "hex");
    let encryptedText = Buffer.from(encryptedTextObject.data, "hex");
    let decipher = crypto.createDecipheriv(ALGORITHM, key(), iv);
    let decrypted = decipher.update(encryptedText);
    decrypted = Buffer.concat([decrypted, decipher.final()]);
    return decrypted.toString();
  }

  static encryptObject(object, keys) {
    const encryptedObject = Object.assign({}, object);
    for (const key of keys) {
      if (encryptedObject.hasOwnProperty(key)) {
        encryptedObject[key] = SecurityUtils.encrypt(encryptedObject[key]);
      }
    }
    return encryptedObject;
  }

  static decryptObject(object, keys) {
    const decryptedObject = { ...object };
    for (const key of keys) {
      if (
        decryptedObject[key]?.iv != null &&
        decryptedObject[key]?.data != null
      ) {
        decryptedObject[key] = SecurityUtils.decrypt(object[key]);
      }
    }
    return decryptedObject;
  }
}

module.exports = SecurityUtils;
