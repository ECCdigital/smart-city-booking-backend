const BaseCheckoutProvider = require("./base-checkout-provider");
const bunyan = require("bunyan");

const logger = bunyan.createLogger({
  name: "ifbs-checkout-provider.js",
  level: process.env.LOG_LEVEL,
});

const IFBS_ERROR_MAP = {
  1001: "API-Schlüssel fehlt.",
  1002: "Ungültiger API-Schlüssel.",
  1003: "Ungültiger API-Schlüssel (Datenbank-Fehler).",
  1204: "Ungültiges Format für das Startdatum.",
  1205: "Das Startdatum liegt zu weit in der Vergangenheit.",
  1206: "Das Startdatum liegt zu weit in der Zukunft.",
  1207: "Ungültiges Format für das Enddatum.",
  1208: "Das Enddatum liegt zu weit in der Vergangenheit.",
  1209: "Das Enddatum liegt zu weit in der Zukunft.",
  1210: "Der Startzeitpunkt muss vor dem Endzeitpunkt liegen.",
  1211: "Benutzer-ID fehlt.",
  1212: "Für den gewählten Zeitraum ist kein Fach verfügbar.",
  1213: "Der gewählte Zeitraum beginnt in der Vergangenheit.",
  1214: "Die Mindestnutzungsdauer wurde nicht erreicht.",
  1215: "Standort-ID fehlt oder ungültig.",
  1216: "Der Standort ist nicht mehr aktiv.",
};

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

  get handlesMaxAmount() {
    return true;
  }

  /**
   * Fetches raw IFBS data. Cached across all segments for the same
   * locationId within one calendar availability check.
   */
  async _fetchLocationData() {
    return this._sharedCached(
      `ifbs:locationData:${this.locationId}`,
      async () => {
        const [boxes, location] = await Promise.all([
          this.client.getBookings(this.locationId),
          this.client.getLocationsStat(this.locationId),
        ]);
        return { boxes, location };
      },
    );
  }

  async checkAvailability() {
    try {
      const { boxes, location } = await this._fetchLocationData();

      if (!location) {
        return {
          available: false,
          message: `IFBS Standort ${this.locationId} nicht gefunden.`,
        };
      }

      const bufferMs = (Number(location.LocationBuffer) || 0) * 60 * 1000;

      const requestedStart = new Date(this.timeBegin).getTime();
      const requestedEnd = new Date(this.timeEnd).getTime();

      const activeBoxes = boxes.filter((box) => box.BoxState === 0);

      const freeBoxes = activeBoxes.filter((box) => {
        return !box.bookings.some((booking) => {
          const bookingStart =
            parseBerlinDate(booking.ValidFrom).getTime() - bufferMs;
          const bookingEnd =
            parseBerlinDate(booking.ValidTo).getTime() + bufferMs;

          return requestedStart < bookingEnd && requestedEnd > bookingStart;
        });
      });

      return {
        available: freeBoxes.length >= this.amount,
        totalCapacity: activeBoxes.length,
        booked: activeBoxes.length - freeBoxes.length,
        remaining: freeBoxes.length,
        freeBoxIds: freeBoxes.map((b) => b.BoxID),
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
  }

  async getPriceEur() {
    return this._cached("getPriceEur", async () => {
      const startDate = formatTimestamp(this.timeBegin);
      const endDate = formatTimestamp(this.timeEnd);

      try {
        const boxPrice = await this.client.getPrice(this.locationId);

        return calculatePriceFromTiers(boxPrice, startDate, endDate);

        /**
        const boxInfo = await this.client.getBox(
          this.locationId,
          startDate,
          endDate,
          this.userID,
        );

        console.log(
          `Received box info for location ${this.locationId}:`,
          boxInfo,
        );
        console.log(
          `Price calculation for location ${this.locationId} took ${
            new Date() - time
          } ms`,
        );
        return Math.round((Number(boxInfo.price) || 0) * 100) / 100;
          */
      } catch (err) {
        logger.error(
          `IFBS price fetch failed: ${this.locationId} - ${err.message}`,
        );
        throw new Error(mapIfbsError(err));
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

  async checkMaxAmount(amount) {
    if (amount > 1) {
      return {
        available: false,
        message: "Es kann nur 1 Fahrradbox pro Buchung reserviert werden.",
      };
    }
    return { available: true };
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

function mapIfbsError(err) {
  if (err.errNo && IFBS_ERROR_MAP[err.errNo]) {
    return IFBS_ERROR_MAP[err.errNo];
  }
  return "IFBS-Preisabfrage fehlgeschlagen. Bitte versuchen Sie es später erneut.";
}

function calculatePriceFromTiers(priceData, startDate, endDate) {
  const start = new Date(startDate);
  const end = new Date(endDate);
  const durationMins = (end - start) / (1000 * 60);

  if (durationMins <= 0) return 0;

  const serviceFee = Number(priceData["Preis_Servicegebühr"]) || 0;

  const tiers = [
    { key: "Preis_1y", unit: "year" },
    { key: "Preis_1m", unit: "month" },
    { key: "Preis_1w", mins: 7 * 24 * 60 },
    { key: "Preis_1d", mins: 24 * 60 },
    { key: "Preis_1h", mins: 60 },
    { key: "Preis_1 Minute", mins: 1 },
  ]
    .filter((t) => Number(priceData[t.key]) > 0)
    .map((t) => ({ ...t, price: Number(priceData[t.key]) }));

  function advanceDate(date, tier) {
    const d = new Date(date);
    if (tier.unit === "year") {
      d.setFullYear(d.getFullYear() + 1);
    } else if (tier.unit === "month") {
      d.setMonth(d.getMonth() + 1);
    } else {
      return new Date(d.getTime() + tier.mins * 60 * 1000);
    }
    return d;
  }

  const memo = new Map();

  function findBest(currentStart, currentEnd, tierIndex) {
    const remainingMs = currentEnd - currentStart;
    if (remainingMs <= 0) return 0;
    if (tierIndex >= tiers.length) return Infinity;

    const key = `${currentStart.getTime()}:${tierIndex}`;
    if (memo.has(key)) return memo.get(key);

    const tier = tiers[tierIndex];

    let best = findBest(currentStart, currentEnd, tierIndex + 1);

    if (!tier.unit) {
      const remainingMins = remainingMs / (1000 * 60);
      const maxUnits = Math.ceil(remainingMins / tier.mins);

      for (const units of [maxUnits, Math.floor(remainingMins / tier.mins)]) {
        if (units <= 0) continue;
        const covered = units * tier.mins * 60 * 1000;
        const newStart = new Date(currentStart.getTime() + covered);
        const cost = units * tier.price;
        const remainder =
          newStart >= currentEnd
            ? 0
            : findBest(newStart, currentEnd, tierIndex + 1);
        best = Math.min(best, cost + remainder);
      }
    } else {
      let cursor = new Date(currentStart);
      let units = 0;
      while (cursor < currentEnd) {
        cursor = advanceDate(cursor, tier);
        units++;
        const cost = units * tier.price;
        const remainder =
          cursor >= currentEnd
            ? 0
            : findBest(cursor, currentEnd, tierIndex + 1);
        best = Math.min(best, cost + remainder);
      }
    }

    memo.set(key, best);
    return best;
  }

  const best = findBest(start, end, 0);
  return Math.round((best + serviceFee) * 100) / 100;
}
/**
 * Parses a naive datetime string (e.g. "2026-03-13 14:00:00")
 * that represents Europe/Berlin time and returns a UTC Date.
 */
function parseBerlinDate(dateStr) {
  const isoStr = dateStr.replace(" ", "T");
  // Treat the string as UTC initially
  const asUtc = new Date(isoStr + "Z");
  // Determine Berlin's offset at that moment
  const inBerlin = new Date(
    asUtc.toLocaleString("en-US", { timeZone: "Europe/Berlin" }),
  );
  const offsetMs = inBerlin.getTime() - asUtc.getTime();
  // Subtract offset to get actual UTC timestamp
  return new Date(asUtc.getTime() - offsetMs);
}
module.exports = IfbsCheckoutProvider;
