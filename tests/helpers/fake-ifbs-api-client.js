/**
 * An iFBS locker API without the network: the real `IfbsApiClient` with its
 * HTTP transport replaced by an in-memory set of bookings and open-box
 * processes. The client's own logic - stripping `success`, raising
 * `IfbsApiError` for a `success: "false"` answer - stays production code.
 *
 * Anything the fake does not model throws, so it can never quietly answer a
 * request the real API would not.
 */

const IfbsApiClient = require("../../src/commons/services/locker/clients/ifbs-api-client");
const IfbsApiError = require("../../src/commons/services/locker/clients/ifbs-api-error");

// The error numbers the adapter treats as "open-box process not found".
const ERR_NO_MONITOR_PROCESS_NOT_FOUND = 1802;
const ERR_NO_WAIT_PROCESS_NOT_FOUND = 1902;

/** A network failure as axios raises it - no response at all. */
function ifbsNetworkError(code = "ECONNREFUSED") {
  return Object.assign(new Error(`connect ${code}`), {
    isAxiosError: true,
    code,
  });
}

class FakeIfbsApiClient extends IfbsApiClient {
  /**
   * @param {Object} [options]
   * @param {string[]} [options.bookingIds] iFBS booking ids that exist and
   *   whose box can be opened
   * @param {boolean} [options.confirmsOnWait=true] Whether the box confirms
   *   the open while `waitForOpenBox` waits for it
   */
  constructor({ bookingIds = [], confirmsOnWait = true } = {}) {
    super("https://ifbs.fake", "api-key", "secret-phrase");
    this.bookingIds = new Set(bookingIds.map(String));
    /** @type {Map<string, Object>} OpenBox_ID -> process record */
    this.openProcesses = new Map();
    this.confirmsOnWait = confirmsOnWait;
    this._nextId = 1;
  }

  /** Lets the box confirm an open process, as the hardware would. */
  confirm(openBoxId, confirmedAt = "2026-09-02 10:00:02") {
    const process = this.openProcesses.get(String(openBoxId));
    process.BoxControlConfirmed = "true";
    process.BoxControlConfirmedDateTime = confirmedAt;
  }

  async _get(endpoint, params = {}) {
    const data = this._respond(endpoint, params);

    // The real transport raises the API's own failure answers as errors.
    if (data.success === "false") {
      throw new IfbsApiError(endpoint, data);
    }

    return data;
  }

  _respond(endpoint, params) {
    switch (endpoint) {
      case "openBox.php": {
        const bookingId = String(params.ID);
        if (!this.bookingIds.has(bookingId)) {
          // Error number chosen by the fake; the adapter does not branch on it.
          return { success: "false", ErrNo: 1701, ErrMsg: "Booking not found" };
        }
        const openBoxId = String(this._nextId++);
        this.openProcesses.set(openBoxId, {
          OpenBox_ID: openBoxId,
          Booking_ID: bookingId,
          BoxControlReceived: "true",
          BoxControlReceivedDateTime: "2026-09-02 10:00:00",
          BoxControlConfirmed: "false",
          BoxControlConfirmedDateTime: null,
        });
        return {
          success: "true",
          Booking_ID: bookingId,
          OpenBox_ID: openBoxId,
        };
      }

      case "monitorOpenBox.php": {
        const process = this.openProcesses.get(String(params.OpenBox_ID));
        if (!process) {
          return {
            success: "false",
            ErrNo: ERR_NO_MONITOR_PROCESS_NOT_FOUND,
            ErrMsg: "OpenBox process not found",
          };
        }
        return { success: "true", ...process };
      }

      case "waitForOpenBox.php": {
        const process = this.openProcesses.get(String(params.OpenBox_ID));
        if (!process) {
          return {
            success: "false",
            ErrNo: ERR_NO_WAIT_PROCESS_NOT_FOUND,
            ErrMsg: "OpenBox process not found",
          };
        }
        if (this.confirmsOnWait) {
          this.confirm(params.OpenBox_ID);
        }
        return { success: "true", ...process, WaitTime: 2 };
      }

      default:
        throw new Error(`fake-ifbs-api-client: unexpected request ${endpoint}`);
    }
  }
}

/** An iFBS client whose every request fails with the given error. */
class BrokenIfbsApiClient extends IfbsApiClient {
  constructor(error = ifbsNetworkError()) {
    super("https://ifbs.fake", "api-key", "secret-phrase");
    this.error = error;
  }

  async _get() {
    throw this.error;
  }
}

module.exports = {
  FakeIfbsApiClient,
  BrokenIfbsApiClient,
  ifbsNetworkError,
  ERR_NO_MONITOR_PROCESS_NOT_FOUND,
  ERR_NO_WAIT_PROCESS_NOT_FOUND,
};
