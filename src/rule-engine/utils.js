// Fixed-length units (calendar units month/year are handled separately).
const UNIT_IN_MS = {
  second: 1000,
  minute: 60 * 1000,
  hour: 60 * 60 * 1000,
  day: 24 * 60 * 60 * 1000,
  week: 7 * 24 * 60 * 60 * 1000,
};

const RELATIVE_DATE_TOKENS = {
  $$DATE_SUBTRACT: -1,
  $$DATE_ADD: 1,
};

/**
 * Resolves a relative date placeholder spec ({ unit, amount, as }) against
 * `now` and returns either epoch millis (default) or a Date.
 */
function resolveRelativeDate(now, spec, sign) {
  if (!spec || typeof spec !== "object") {
    throw new Error("Relative date placeholder requires an object value");
  }

  const { unit, amount } = spec;
  const numericAmount = Number(amount);

  if (!unit || !Number.isFinite(numericAmount)) {
    throw new Error(
      'Relative date placeholder requires "unit" and a numeric "amount"',
    );
  }

  const date = new Date(now);
  const offset = sign * numericAmount;

  if (unit === "month") {
    date.setMonth(date.getMonth() + offset);
  } else if (unit === "year") {
    date.setFullYear(date.getFullYear() + offset);
  } else if (UNIT_IN_MS[unit]) {
    date.setTime(date.getTime() + offset * UNIT_IN_MS[unit]);
  } else {
    throw new Error(`Unsupported relative date unit "${unit}"`);
  }

  // Booking time fields are stored as epoch millis, so default to a number.
  return spec.as === "date" ? date : date.getTime();
}

function transformPlaceholders(obj, now) {
  if (Array.isArray(obj)) {
    return obj.map((o) => transformPlaceholders(o, now));
  }
  if (obj === "$$NOW") return now;
  if (obj && typeof obj === "object") {
    const keys = Object.keys(obj);
    if (keys.length === 1 && RELATIVE_DATE_TOKENS[keys[0]] !== undefined) {
      return resolveRelativeDate(
        now,
        obj[keys[0]],
        RELATIVE_DATE_TOKENS[keys[0]],
      );
    }

    const res = {};
    for (const [key, val] of Object.entries(obj)) {
      res[key] = transformPlaceholders(val, now);
    }
    return res;
  }
  return obj;
}

function buildFacts(doc, now) {
  const facts = { ...doc, now };
  facts.ageInHours = (now - new Date(doc.createdAt)) / 1000 / 3600;
  facts.diffInDays = (d1, d2) => {
    const ms = new Date(d1) - new Date(d2);
    return Math.floor(ms / 86400000);
  };
  return facts;
}

module.exports = { transformPlaceholders, buildFacts };
