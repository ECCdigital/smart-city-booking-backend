/**
 * An iFBS bike box API without the network: the real `IfbsApiClient` with
 * its HTTP transport replaced by an in-memory set of locations, boxes,
 * bookings and open-box processes. The client's own logic - stripping
 * `success`, raising `IfbsApiError` for a `success: "false"` answer, the
 * date format and the checksum - stays production code.
 *
 * What the fake models of iFBS, as far as the platform has learned it:
 * - `getBox` holds the first free box of a location for two minutes and
 *   answers its `Booking_ID` and box number (`nummer`); a location without
 *   a free box is refused. Free means no unexpired hold and no booking on
 *   the box - the fake models capacity, not the calendar.
 * - `bookIt` confirms a held box, if the hold has not lapsed and the
 *   checksum over box number, time and the secret phrase holds.
 * - `cancelUsage` gives a booked box back while the usage has not begun;
 *   once it has, iFBS refuses and the usage is ended with `endUsage`.
 * - `openBox` starts an open-box process for a booked box, which the box
 *   confirms later (`waitForOpenBox`).
 *
 * Anything the fake does not model throws, so it can never quietly answer a
 * request the real API would not. The error numbers of refusals are the
 * fake's own; the adapters do not branch on them.
 */

const IfbsApiClient = require("../../src/commons/services/access/clients/ifbs-api-client");
const IfbsApiError = require("../../src/commons/services/access/clients/ifbs-api-error");

// The error number the adapter reads on a poll of an unknown process.
const ERR_NO_WAIT_PROCESS_NOT_FOUND = 1902;

const FAKE_SECRET_PHRASE = "secret-phrase";
const HOLD_TTL_MS = 2 * 60 * 1000;

/** A network failure as axios raises it - no response at all. */
function ifbsNetworkError(code = "ECONNREFUSED") {
  return Object.assign(new Error(`connect ${code}`), {
    isAxiosError: true,
    code,
  });
}

/** "YYYY-MM-DD HH:mm" (local time, as iFBS takes it) back to epoch ms. */
function parseIfbsDate(value) {
  return new Date(String(value).replace(" ", "T")).getTime();
}

class FakeIfbsApiClient extends IfbsApiClient {
  /**
   * @param {Object} [options]
   * @param {Object[]} [options.locations] Locations iFBS knows, each
   *   `{ LocationID, Name?, boxes: string[] }` with the numbers of its boxes
   * @param {string[]} [options.bookingIds] iFBS booking ids that exist as
   *   booked already and whose box can be opened
   * @param {boolean} [options.confirmsOnWait=true] Whether the box confirms
   *   the open while `waitForOpenBox` waits for it
   */
  constructor({ locations = [], bookingIds = [], confirmsOnWait = true } = {}) {
    super("https://ifbs.fake", "api-key", FAKE_SECRET_PHRASE);
    /** @type {Map<string, Object>} LocationID -> location with its boxes */
    this.locations = new Map(
      locations.map((location) => [
        String(location.LocationID),
        {
          ...location,
          LocationID: String(location.LocationID),
          boxes: (location.boxes || []).map(String),
        },
      ]),
    );
    /**
     * @type {Map<string, Object>} Booking_ID -> booking:
     *   `{ Booking_ID, Box_ID, nummer, LocationID, from, to, price, userId,
     *   state, heldAt, endedAt }`, state one of held, booked, cancelled,
     *   ended
     */
    this.bookings = new Map(
      bookingIds.map((id) => [
        String(id),
        {
          Booking_ID: String(id),
          Box_ID: `box-${id}`,
          nummer: String(id),
          LocationID: null,
          from: null,
          to: null,
          price: "1.50",
          userId: null,
          state: "booked",
        },
      ]),
    );
    /** @type {Map<string, Object>} OpenBox_ID -> process record */
    this.openProcesses = new Map();
    this.confirmsOnWait = confirmsOnWait;
    this._nextId = 1;
    this._nextBookingId = 100;
  }

  /** Lets the box confirm an open process, as the hardware would. */
  confirm(openBoxId, confirmedAt = "2026-09-02 10:00:02") {
    const process = this.openProcesses.get(String(openBoxId));
    process.BoxControlConfirmed = "true";
    process.BoxControlConfirmedDateTime = confirmedAt;
  }

  /** The bookings in the given state, e.g. what iFBS still holds or has booked. */
  bookingsInState(state) {
    return [...this.bookings.values()].filter(
      (booking) => booking.state === state,
    );
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
      case "getLocations.php":
        return {
          success: "true",
          cities: [
            {
              CityID: "35",
              locations: [...this.locations.values()].map((location) => {
                const listed = { ...location };
                delete listed.boxes;
                return listed;
              }),
            },
          ],
        };

      case "getBox.php":
        return this._getBox(params);

      case "bookIt.php":
        return this._bookIt(params);

      case "cancelUsage.php":
        return this._cancelUsage(params);

      case "endUsage.php":
        return this._endUsage(params);

      case "openBox.php": {
        const bookingId = String(params.ID);
        if (this.bookings.get(bookingId)?.state !== "booked") {
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

  _getBox(params) {
    const location = this.locations.get(String(params.location));
    if (!location) {
      return { success: "false", ErrNo: 1101, ErrMsg: "Location not found" };
    }

    const nummer = location.boxes.find((box) => this._isBoxFree(box));
    if (!nummer) {
      return { success: "false", ErrNo: 1201, ErrMsg: "No box available" };
    }

    const bookingId = String(this._nextBookingId++);
    this.bookings.set(bookingId, {
      Booking_ID: bookingId,
      Box_ID: `box-${nummer}`,
      nummer,
      LocationID: location.LocationID,
      from: params.DATEfrom,
      to: params.DATEto,
      price: "1.50",
      userId: params.User_ID,
      state: "held",
      heldAt: Date.now(),
    });

    return {
      success: "true",
      Booking_ID: bookingId,
      Box_ID: `box-${nummer}`,
      nummer,
      price: "1.50",
    };
  }

  _bookIt(params) {
    const booking = this.bookings.get(String(params.ID));
    if (booking?.state !== "held") {
      return { success: "false", ErrNo: 1301, ErrMsg: "Reservation not found" };
    }
    if (this._isHoldExpired(booking)) {
      return { success: "false", ErrNo: 1302, ErrMsg: "Reservation expired" };
    }
    const expected = IfbsApiClient.checksum(
      booking.nummer,
      booking.from,
      booking.to,
      FAKE_SECRET_PHRASE,
    );
    if (params.c !== expected) {
      return { success: "false", ErrNo: 1303, ErrMsg: "Invalid checksum" };
    }
    booking.state = "booked";
    delete booking.heldAt;
    return { success: "true", Booking_ID: booking.Booking_ID };
  }

  _cancelUsage(params) {
    const booking = this.bookings.get(String(params.ID));
    if (booking?.state !== "booked") {
      return { success: "false", ErrNo: 1401, ErrMsg: "Booking not found" };
    }
    if (this._hasBegun(booking)) {
      return {
        success: "false",
        ErrNo: 1402,
        ErrMsg: "Usage already started",
      };
    }
    booking.state = "cancelled";
    return { success: "true", Booking_ID: booking.Booking_ID };
  }

  _endUsage(params) {
    const booking = this.bookings.get(String(params.ID));
    if (booking?.state !== "booked") {
      return { success: "false", ErrNo: 1501, ErrMsg: "Booking not found" };
    }
    booking.state = "ended";
    booking.endedAt = params.DATEto || null;
    return { success: "true", Booking_ID: booking.Booking_ID };
  }

  _isBoxFree(nummer) {
    return ![...this.bookings.values()].some(
      (booking) =>
        booking.nummer === nummer &&
        (booking.state === "booked" ||
          (booking.state === "held" && !this._isHoldExpired(booking))),
    );
  }

  _isHoldExpired(booking) {
    return Date.now() - booking.heldAt >= HOLD_TTL_MS;
  }

  _hasBegun(booking) {
    return booking.from != null && parseIfbsDate(booking.from) <= Date.now();
  }
}

/** An iFBS client whose every request fails with the given error. */
function brokenIfbsApiClient(error = ifbsNetworkError()) {
  const client = new FakeIfbsApiClient();
  client._get = async () => {
    throw error;
  };
  return client;
}

module.exports = {
  FakeIfbsApiClient,
  brokenIfbsApiClient,
  ifbsNetworkError,
  FAKE_SECRET_PHRASE,
  ERR_NO_WAIT_PROCESS_NOT_FOUND,
};
