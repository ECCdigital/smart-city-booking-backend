/**
 * The vocabulary of a „Realm prüfen“ answer: a finding (`status`, `reason`,
 * optional `details`) becomes a row (with its `id`) or a part of a row (with
 * its `label`). The reasons and details are codes and observed values only;
 * the Admin UI formulates every sentence. The binding list of rows, reasons
 * and details is the contract of ECCdigital/tickets#80
 * (`POST /api/instances/keycloak/check`).
 */

/** The four statuses of a row or part. */
const STATUS = Object.freeze({
  OK: "ok",
  FAIL: "fail",
  NA: "na",
  INFO: "info",
});

/** Worst first: a row with parts carries the worst status of its parts. */
const STATUS_ORDER = Object.freeze([
  STATUS.FAIL,
  STATUS.NA,
  STATUS.INFO,
  STATUS.OK,
]);

/** The reasons any row or part may carry, always with `na`. */
const GENERIC_REASONS = Object.freeze({
  UNEXPECTED_RESPONSE: "unexpected_response",
  TIMEOUT: "timeout",
  UNREACHABLE: "unreachable",
  REALM_UNAVAILABLE: "realm_unavailable",
});

/**
 * A finding, with `details` only when there is something to say.
 *
 * @param {string} status One of `STATUS`
 * @param {string} reason The reason code
 * @param {Object} [details] Observed values
 * @returns {{status: string, reason: string, details?: Object}} The finding
 */
function finding(status, reason, details) {
  return details && Object.keys(details).length > 0
    ? { status, reason, details }
    : { status, reason };
}

/**
 * A row from a finding.
 *
 * @param {number} id The row id of the contract
 * @param {Object} found The finding
 * @returns {Object} The row
 */
function rowOf(id, found) {
  return { id, ...found };
}

/**
 * A part of a row from a finding.
 *
 * @param {string} label What the part probed: a URI, an origin or a probe key
 * @param {Object} found The finding
 * @returns {Object} The part
 */
function partOf(label, found) {
  return { label, ...found };
}

/**
 * A row made of parts: the worst status of its parts (`fail` > `na` >
 * `info` > `ok`) and the reason of the first part with that status.
 *
 * @param {number} id The row id of the contract
 * @param {Object[]} parts The parts, at least one
 * @returns {Object} The row
 */
function rowOfParts(id, parts) {
  const worst = STATUS_ORDER.find((status) =>
    parts.some((part) => part.status === status),
  );
  const first = parts.find((part) => part.status === worst);
  return { id, status: worst, reason: first.reason, parts };
}

/**
 * Origin and path of a URL, without query and fragment: what a detail may
 * show of an address.
 *
 * @param {string} url An absolute URL
 * @param {string} [base] The URL a relative one is resolved against
 * @returns {string} `<origin><path>`
 */
function originAndPath(url, base) {
  const parsed = new URL(url, base);
  return `${parsed.origin}${parsed.pathname}`;
}

/**
 * The `Location` of an answer resolved against the probed address, `null`
 * without one or for one that is no URL.
 *
 * @param {Object} result The probe result of an answer
 * @returns {?URL} The location
 */
function locationOf(result) {
  const location = result.headers.location;
  if (!location) return null;
  try {
    return new URL(location, result.url);
  } catch {
    return null;
  }
}

/**
 * The `na` finding for a probe whose result matches no known case of its
 * row: no answer in time, no connection, or an answer the row does not
 * know. Of an answer it names the status, the `error` code (JSON body or
 * `Location` parameter) and origin and path of the `Location`; a
 * `Location` that is no URL names nothing.
 *
 * @param {Object} result The probe result (`probe-client.js`)
 * @returns {Object} The finding
 */
function notCheckable(result) {
  if (result.outcome === "timeout") {
    return finding(STATUS.NA, GENERIC_REASONS.TIMEOUT, { url: result.url });
  }
  if (result.outcome === "unreachable") {
    return finding(STATUS.NA, GENERIC_REASONS.UNREACHABLE, {
      url: result.url,
      code: result.code,
    });
  }

  const details = { httpStatus: result.status };
  const locationUrl = locationOf(result);
  const error =
    typeof result.data?.error === "string"
      ? result.data.error
      : locationUrl?.searchParams.get("error");
  if (error) details.error = error;
  if (locationUrl) details.location = originAndPath(locationUrl.href);
  return finding(STATUS.NA, GENERIC_REASONS.UNEXPECTED_RESPONSE, details);
}

module.exports = {
  STATUS,
  GENERIC_REASONS,
  finding,
  rowOf,
  partOf,
  rowOfParts,
  originAndPath,
  notCheckable,
};
