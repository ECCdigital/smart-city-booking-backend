const bunyan = require("bunyan");
const BaseCheckoutProvider = require("./base-checkout-provider");
const {
  compartmentsAt,
} = require("../../../entities/bookable/access-point-amounts");

const logger = bunyan.createLogger({
  name: "pareva-checkout-provider.js",
  level: process.env.LOG_LEVEL,
});

const PROVIDER_ID = "pareva";

/**
 * The Pareva Anlagen of a bookable at the checkout. A Pareva Anlage is a
 * product of the tenant's locker system; its stock is Pareva's, the
 * platform keeps no number for it. So the check asks Pareva live, once per
 * product and window: `rental/available` answers one entry per free
 * compartment, and the booking fits when there are at least as many as it
 * needs at that Anlage (`compartmentsAt`).
 *
 * The check narrows the platform's own count against `bookable.amount`, it
 * never replaces it - both have to pass. And it never refuses because
 * Pareva is down: a Pareva that cannot answer (timeout, a non-2xx answer,
 * an unreadable body) makes the check `unknown`, and the platform count
 * decides alone.
 *
 * The context's `unit.accessPoints` are the bookable's Pareva rows, read by
 * the seam that resolves the provider; there is no `externalProviders`
 * entry for Pareva, the Produkt-ID reaches the checkout through the
 * bookable's access point assignment.
 */
class ParevaCheckoutProvider extends BaseCheckoutProvider {
  constructor(client, context) {
    super(client, context);
    this.accessPoints = context.unit?.accessPoints || [];
  }

  get handlesPricing() {
    return false;
  }

  get handlesAvailability() {
    return true;
  }

  get narrowsAvailability() {
    return true;
  }

  get handlesMaxAmount() {
    return false;
  }

  /**
   * @returns {Promise<Object>} `{ available: true }` with `remaining` and
   *   `needed` of the product when every Anlage has room; `{ available:
   *   false, ... }` naming the first product without; `{ available: null,
   *   unknown: true, message }` when Pareva could not be asked
   */
  async checkAvailability() {
    const begin = new Date(this.timeBegin).getTime();
    const end = new Date(this.timeEnd).getTime();
    let answer = { available: true, externalSource: PROVIDER_ID };

    for (const accessPoint of this.accessPoints) {
      const productId = String(accessPoint.externalId);
      const needed = compartmentsAt(this.bookable, accessPoint.id, this.amount);

      let entries;
      try {
        entries = await this._sharedCached(
          `pareva:${this.client.lockerId}:${productId}:${begin}-${end}`,
          () => this.client.getAvailableAssignments(productId, begin, end),
        );
      } catch (err) {
        return this._unknown(accessPoint, err);
      }

      const remaining = entries.length;
      answer = {
        available: remaining >= needed,
        remaining,
        needed,
        externalSource: PROVIDER_ID,
        productId,
      };

      if (!answer.available) {
        return {
          ...answer,
          message: `Das Objekt ${this.bookable.title} ist für den gewählten Zeitraum nicht verfügbar.`,
        };
      }
    }

    return answer;
  }

  /**
   * The answer when Pareva could not be asked: not a refusal, the platform
   * count decides. A 404 or 400 for the product id most likely means the
   * Anlage stores a size code (`S`) where the product's 24-hex id belongs -
   * the log names the row, so an admin can put the Produkt-ID right.
   * @private
   */
  _unknown(accessPoint, err) {
    const status = err?.response?.status;
    const message =
      status === 404 || status === 400
        ? `Pareva kennt die Produkt-ID '${accessPoint.externalId}' der Anlage ${accessPoint.id} nicht (HTTP ${status}).`
        : `Pareva-Verfügbarkeitsprüfung fehlgeschlagen: ${err?.message || err}`;

    logger.warn(
      `Pareva availability of bookable ${this.bookable?.id} in tenant ${this.tenantId} is unknown: access point ${accessPoint.id} with externalId '${accessPoint.externalId}' - ${message}`,
    );

    return {
      available: null,
      unknown: true,
      externalSource: PROVIDER_ID,
      productId: String(accessPoint.externalId),
      message,
    };
  }

  async getPriceEur() {
    return 0;
  }

  async getGrossPriceEur() {
    return 0;
  }
}

module.exports = ParevaCheckoutProvider;
