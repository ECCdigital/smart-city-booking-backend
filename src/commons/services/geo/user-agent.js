/**
 * The platform's User-Agent towards the geo services, the one identity that
 * goes out with every call (usage policy of Photon and the BKG):
 *
 *   smart-city-booking-backend/<version> (+<FRONTEND_URL>; <GEOCODER_CONTACT_EMAIL>)
 *
 * Read at call time, so a changed environment counts at once. A missing
 * part is left out; without a contact mail the backend still starts and
 * warns once (`warnIfContactMissing`, at boot).
 */

const bunyan = require("bunyan");

const { version } = require("../../../../package.json");

const logger = bunyan.createLogger({
  name: "geo-user-agent.js",
  level: process.env.LOG_LEVEL,
});

const contactMail = () => (process.env.GEOCODER_CONTACT_EMAIL || "").trim();

/**
 * @returns {string} The User-Agent of the platform
 */
function geoUserAgent() {
  const contact = [
    process.env.FRONTEND_URL ? `+${process.env.FRONTEND_URL}` : "",
    contactMail(),
  ].filter(Boolean);
  const product = `smart-city-booking-backend/${version}`;
  return contact.length ? `${product} (${contact.join("; ")})` : product;
}

/**
 * Warns when `GEOCODER_CONTACT_EMAIL` is not set: the geo services work,
 * but cannot reach the operator. Called once at boot.
 *
 * @returns {boolean} Whether it warned
 */
function warnIfContactMissing() {
  if (contactMail()) return false;
  logger.warn(
    "GEOCODER_CONTACT_EMAIL is not set: the geo services are called without a contact mail in the User-Agent",
  );
  return true;
}

module.exports = { geoUserAgent, warnIfContactMissing };
