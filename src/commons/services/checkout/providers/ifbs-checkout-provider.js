const BaseCheckoutProvider = require("./base-checkout-provider");
const bunyan = require("bunyan");

const logger = bunyan.createLogger({
  name: "ifbs-checkout-provider.js",
  level: process.env.LOG_LEVEL,
});

class IfbsCheckoutProvider extends BaseCheckoutProvider {
  constructor(client, context) {
    super(client, context);
    this.locationId = context.unit.locationId;
  }

  get handlesPricing() {
    return true;
  }

  get handlesAvailability() {
    return true;
  }

  async checkAvailability() {
    return this._cached("checkAvailability", async () => {
      try {
        const cities = await this.client.getLocationsStat();

        const location = cities
          .find((city) =>
            city.locations.find(
              (loc) => loc.LocationID === this.locationId,
            ),
          )
          ?.locations.find(
            (loc) => loc.LocationID === this.locationId,
          );

        if (!location) {
          return {
            available: false,
            message: `IFBS Standort ${this.locationId} nicht gefunden.`,
          };
        }

        const availableUnits =
          Number(location.LocationTotal) -
          Number(location.LocationBooked) || 0;

        return {
          available: availableUnits >= this.amount,
          totalCapacity: Number(location.LocationTotal) || null,
          booked:
            (Number(location.LocationTotal) || 0) - availableUnits,
          remaining: availableUnits,
          externalSource: "ifbs",
          locationId: this.locationId,
        };
      } catch (err) {
        logger.error(
          `IFBS availability check failed: ${this.locationId} - ${err.message}`,
        );
        throw {
          checkType: "availability",
          available: false,
          message: `IFBS-Verfügbarkeitsprüfung fehlgeschlagen: ${err.message}`,
        };
      }
    });
  }

  async getPriceEur() {
    return this._cached("getPriceEur", async () => {
      const startDate = formatTimestamp(this.timeBegin);
      const endDate = formatTimestamp(this.timeEnd);

      try {
        const boxInfo = await this.client.getBox(
          this.locationId,
          startDate,
          endDate,
          this.userID,
        );
        return Math.round((Number(boxInfo.price) || 0) * 100) / 100;
      } catch (err) {
        logger.error(
          `IFBS price fetch failed: ${this.locationId} - ${err.message}`,
        );
        throw new Error(
          `IFBS-Preisabfrage fehlgeschlagen: ${err.message}`,
        );
      }
    });
  }

  async getGrossPriceEur() {
    return this._cached("getGrossPriceEur", async () => {
      const vat = (this.bookable.priceValueAddedTax || 0) / 100;
      const net = await this.getPriceEur(); // Cache-Hit!
      return Math.round(net * (1 + vat) * 100) / 100;
    });
  }
}

function formatTimestamp(timestamp) {
  const d = new Date(timestamp);
  const pad = (n) => String(n).padStart(2, "0");

  return (
    `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}` +
    ` ${pad(d.getHours())}:${pad(d.getMinutes())}`
  );
}

module.exports = IfbsCheckoutProvider;
