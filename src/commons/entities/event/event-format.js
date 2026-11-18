/**
 * The format of an event (`event.format`) and its participation link
 * (`eventLocation.url`), ECCdigital/tickets#180. Plain functions over the
 * stored fields, so they serve an `Event` and a plain document alike.
 *
 * Who sees the link: the bookers of a confirmed booking always - in the
 * booking-bound mails, the calendar file and the customer view - and the
 * public only without registration (the public projection removes it).
 */

const { STATUS } = require("../../services/booking-lifecycle/booking-state");

const EVENT_FORMAT = Object.freeze({
  PRESENCE: 0,
  HYBRID: 1,
  ONLINE: 2,
});

const FORMAT_LABELS = Object.freeze({
  [EVENT_FORMAT.PRESENCE]: "Präsenz",
  [EVENT_FORMAT.HYBRID]: "Hybrid",
  [EVENT_FORMAT.ONLINE]: "Online",
});

/**
 * The format of an event; an unknown or missing one counts as presence, the
 * schema's default.
 *
 * @param {Object} event
 * @returns {number} One of `EVENT_FORMAT`
 */
function formatOf(event) {
  return Object.hasOwn(FORMAT_LABELS, event?.format)
    ? event.format
    : EVENT_FORMAT.PRESENCE;
}

/**
 * @param {Object} event
 * @returns {string} "Präsenz", "Hybrid" or "Online"
 */
function formatLabel(event) {
  return FORMAT_LABELS[formatOf(event)];
}

/**
 * The participation link of an online or hybrid event: the stored address
 * when it is an http(s) URL, else none - a link left over in an event in
 * presence is no link, and nothing else goes into a mail or a calendar.
 *
 * @param {Object} event
 * @returns {string|null}
 */
function participationLink(event) {
  if (formatOf(event) === EVENT_FORMAT.PRESENCE) return null;
  const url = event?.eventLocation?.url?.trim();
  if (!url) return null;
  try {
    const { protocol } = new URL(url);
    return protocol === "https:" || protocol === "http:" ? url : null;
  } catch {
    return null;
  }
}

/**
 * The participation link as the booker of a booking sees it: only once the
 * booking is confirmed.
 *
 * @param {Object} event
 * @param {Object} booking
 * @returns {string|null}
 */
function participationLinkForBooking(event, booking) {
  return booking?.status === STATUS.CONFIRMED ? participationLink(event) : null;
}

module.exports = {
  EVENT_FORMAT,
  formatOf,
  formatLabel,
  participationLink,
  participationLinkForBooking,
};
