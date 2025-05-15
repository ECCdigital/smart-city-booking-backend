function transformPlaceholders(obj, now) {
  if (Array.isArray(obj)) {
    return obj.map((o) => transformPlaceholders(o, now));
  }
  if (obj === "$$NOW") return now;
  if (obj && typeof obj === "object") {
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
