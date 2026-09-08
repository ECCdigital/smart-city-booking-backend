/**
 * A Pareva locker API without the network: the real `ParevaApiClient` with
 * its HTTP transport replaced by an in-memory locker system of sizes and
 * rentals. The client's own logic - the rental body it builds, the paths
 * it speaks - stays production code.
 *
 * What the fake models of Pareva, as far as the platform has learned it:
 * - `GET /locker/{lockerId}/available` lists the sizes.
 * - `POST /locker/{lockerId}/rental/available?v=2` answers one
 *   `ProductAssignment` per compartment of the product that is free in the
 *   window: what the product has (`free`) less the open rentals that
 *   overlap the window. A product Pareva does not have is a 404.
 * - `POST /locker/{lockerId}/rental/{productId}/open` starts a rental and
 *   answers its `processId`; Pareva mails the access code itself, so the
 *   fake records the rental and nothing else.
 * - `POST /locker/{lockerId}/process/{processId}/cancel` cancels a rental
 *   with `{ success: true }`; a process Pareva does not have is a 404.
 *
 * Anything the fake does not model throws, so it can never quietly answer a
 * request the real API would not.
 */

const ParevaApiClient = require("../../src/commons/services/access/clients/pareva-api-client");

/**
 * An error the way axios raises one for an HTTP failure: the adapters and
 * their error mapping read `response.status`, not a message.
 */
function parevaHttpError(status, data = {}) {
  return Object.assign(new Error(`Request failed with status code ${status}`), {
    isAxiosError: true,
    response: { status, data },
  });
}

class FakeParevaApiClient extends ParevaApiClient {
  /**
   * @param {Object} [options]
   * @param {string} [options.lockerId="locker-1"] The locker system
   * @param {(string|Object)[]} [options.sizes] The products it rents, each
   *   a product id or a record `{ size, free, ... }` - `size` the id the
   *   rental and the availability check address, `free` how many
   *   compartments of it are free (none when absent)
   */
  constructor({ lockerId = "locker-1", sizes = [] } = {}) {
    super("https://pareva.fake", lockerId, "user", "password");
    this.sizes = sizes.map((size) =>
      typeof size === "string"
        ? { size }
        : { ...size, size: String(size.size) },
    );
    /** @type {Object[]} The bodies of every availability check asked */
    this.availabilityRequests = [];
    /**
     * @type {Map<string, Object>} processId -> rental:
     *   `{ processId, size, state, ...the body the rental was started
     *   with }`, state one of open, cancelled
     */
    this.rentals = new Map();
    this._nextId = 1;
  }

  /** The rentals in the given state, e.g. what Pareva still has open. */
  rentalsInState(state) {
    return [...this.rentals.values()].filter(
      (rental) => rental.state === state,
    );
  }

  async _request(method, path, data = null) {
    const route = `${method.toUpperCase()} ${path}`;
    let match;

    if (route === `GET /locker/${this.lockerId}/available`) {
      return { availableSizes: this.sizes.map((size) => ({ ...size })) };
    }

    if (
      (match = path.match(/^\/locker\/([^/]+)\/rental\/available\?v=2$/)) &&
      method === "post"
    ) {
      this._lockerSystem(match[1]);
      const request = JSON.parse(data);
      this.availabilityRequests.push(request);
      const product = this.sizes.find(
        (candidate) => candidate.size === String(request.productId),
      );
      if (!product) {
        throw parevaHttpError(404, { reason: "product not found" });
      }
      const rented = this.rentalsInState("open").filter(
        (rental) =>
          rental.size === product.size &&
          Number(rental.plannedBegin) < request.end &&
          Number(rental.plannedBegin) + Number(rental.date_estimate_delivery) >
            request.begin,
      ).length;
      const free = Math.max(0, (product.free || 0) - rented);
      return Array.from({ length: free }, (_, index) => ({
        id: `${product.size}-${index + 1}`,
        lockerId: this.lockerId,
        stock: 1,
      }));
    }

    if (
      (match = path.match(/^\/locker\/([^/]+)\/rental\/([^/]+)\/open$/)) &&
      method === "post"
    ) {
      this._lockerSystem(match[1]);
      const size = this.sizes.find((candidate) => candidate.size === match[2]);
      if (!size) {
        throw parevaHttpError(404, { reason: "size not found" });
      }
      const processId = `process-${this._nextId++}`;
      this.rentals.set(processId, {
        processId,
        size: size.size,
        state: "open",
        ...JSON.parse(data),
      });
      return { processId };
    }

    if (
      (match = path.match(/^\/locker\/([^/]+)\/process\/([^/]+)\/cancel$/)) &&
      method === "post"
    ) {
      this._lockerSystem(match[1]);
      const rental = this.rentals.get(match[2]);
      if (!rental || rental.state !== "open") {
        throw parevaHttpError(404, { reason: "process not found" });
      }
      rental.state = "cancelled";
      return { success: true };
    }

    throw new Error(`fake-pareva-api-client: unexpected request ${route}`);
  }

  _lockerSystem(lockerId) {
    if (lockerId !== this.lockerId) {
      throw parevaHttpError(404, { reason: "locker not found" });
    }
  }
}

/** A Pareva client whose every request fails with the given error. */
function brokenParevaApiClient(error = parevaHttpError(500)) {
  const client = new FakeParevaApiClient();
  client._request = async () => {
    throw error;
  };
  return client;
}

module.exports = {
  FakeParevaApiClient,
  brokenParevaApiClient,
  parevaHttpError,
};
