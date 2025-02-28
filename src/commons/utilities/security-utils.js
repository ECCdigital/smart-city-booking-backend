const crypto = require("crypto");
const ALGORITHM = "aes-256-cbc"; //Using AES encryption
class SecurityUtils {
  static encrypt(text) {
    let t = text || "";
    const iv = crypto.randomBytes(16);
    let cipher = crypto.createCipheriv(
      ALGORITHM,
      Buffer.from(process.env.CRYPTO_SECRET),
      iv,
    );
    let encrypted = cipher.update(t);
    encrypted = Buffer.concat([encrypted, cipher.final()]);
    return { iv: iv.toString("hex"), data: encrypted.toString("hex") };
  }

  static decrypt(encryptedTextObject) {
    if (!encryptedTextObject || typeof encryptedTextObject !== "object")
      return null;

    let iv = Buffer.from(encryptedTextObject.iv, "hex");
    let encryptedText = Buffer.from(encryptedTextObject.data, "hex");
    let decipher = crypto.createDecipheriv(
      ALGORITHM,
      Buffer.from(process.env.CRYPTO_SECRET),
      iv,
    );
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
