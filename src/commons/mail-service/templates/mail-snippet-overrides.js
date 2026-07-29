const crypto = require("crypto");
const Handlebars = require("handlebars");

const MAX_SNIPPET_OVERRIDE_LENGTH = 50 * 1024;
const MAX_SUBJECT_OVERRIDE_LENGTH = 500;
const MAX_SUBJECT_CACHE_SIZE = 200;

const OVERRIDABLE_SNIPPETS = Object.freeze([
  "booking-cancel",
  "booking-confirmation",
  "booking-confirmed-invoice-pending",
  "booking-rejection",
  "booking-request-confirmation",
  "free-booking-confirmation",
  "invoice",
  "invoice-after-approval",
  "payment-link-after-approval",
  "supervisor-booking-notification",
]);

const OVERRIDE_TEMPLATE_VARIABLES = Object.freeze([
  {
    name: "tenantName",
    description: "Name des Mandanten",
  },
  {
    name: "supportEmail",
    description: "Support-E-Mail-Adresse des Mandanten",
  },
  {
    name: "customerName",
    description: "Name des Kunden aus der Buchung",
  },
  {
    name: "customerContact",
    description:
      "Kontaktdaten des Kunden als HTML-Block (Name, Firma, E-Mail, Telefon, Adresse)",
  },
  {
    name: "currentDate",
    description: "Aktuelles Versanddatum im Format TT.MM.JJJJ",
  },
  {
    name: "hasRefundPreview",
    description:
      "Wahr, wenn die Buchung einen Erstattungsbetrag größer 0 € hat",
  },
  {
    name: "refundAmountEur",
    description:
      "Erstattungsbetrag als Zahl (mit Helper priceFormatted nutzbar)",
  },
  {
    name: "cancellationFeeEur",
    description: "Einbehaltener Betrag als Zahl",
  },
  {
    name: "originalAmountEur",
    description: "Ursprungsbetrag der Buchung als Zahl",
  },
  {
    name: "refundPercentage",
    description: "Angewandter Erstattungsprozentsatz (0–100)",
  },
  {
    name: "hasCancellationFee",
    description: "Wahr, wenn ein Einbehalt größer 0 € anfällt",
  },
  {
    name: "daysBeforeStart",
    description: "Kalendertage bis zum Buchungsbeginn zum Berechnungszeitpunkt",
  },
]);

const AFTER_SNIPPET_SUFFIX = "__after";

const overridableSnippetSet = new Set(OVERRIDABLE_SNIPPETS);

function afterSnippetKey(snippetName) {
  return `${snippetName}${AFTER_SNIPPET_SUFFIX}`;
}

function isOverridableSnippetKey(name) {
  if (overridableSnippetSet.has(name)) {
    return true;
  }
  if (
    typeof name === "string" &&
    name.endsWith(AFTER_SNIPPET_SUFFIX)
  ) {
    const baseName = name.slice(0, -AFTER_SNIPPET_SUFFIX.length);
    return overridableSnippetSet.has(baseName);
  }
  return false;
}

const subjectTemplateCache = new Map();

function getSnippetOverride(tenant, snippetName) {
  if (!isOverridableSnippetKey(snippetName)) {
    return null;
  }

  const override = tenant?.mailSnippets?.[snippetName];
  if (typeof override !== "string" || override.trim() === "") {
    return null;
  }
  return override;
}

function getSubjectOverride(tenant, snippetName) {
  if (!overridableSnippetSet.has(snippetName)) {
    return null;
  }

  const override = tenant?.mailSubjects?.[snippetName];
  if (typeof override !== "string" || override.trim() === "") {
    return null;
  }
  return override;
}

function setSubjectCache(key, compiled) {
  if (subjectTemplateCache.size >= MAX_SUBJECT_CACHE_SIZE) {
    const firstKey = subjectTemplateCache.keys().next().value;
    subjectTemplateCache.delete(firstKey);
  }
  subjectTemplateCache.set(key, compiled);
}

function compileSubjectTemplate(source) {
  const cacheKey = crypto.createHash("sha1").update(source).digest("hex");
  if (subjectTemplateCache.has(cacheKey)) {
    return subjectTemplateCache.get(cacheKey);
  }
  const compiled = Handlebars.compile(source, { noEscape: true });
  setSubjectCache(cacheKey, compiled);
  return compiled;
}

function renderSubjectOverride(source, data = {}) {
  const template = compileSubjectTemplate(source);
  return template(data);
}

function validateMailSnippets(mailSnippets = {}) {
  if (
    mailSnippets === null ||
    Array.isArray(mailSnippets) ||
    typeof mailSnippets !== "object"
  ) {
    throw new Error("mailSnippets must be an object.");
  }

  Object.entries(mailSnippets).forEach(([name, source]) => {
    if (!isOverridableSnippetKey(name)) {
      throw new Error(`Unsupported mail snippet override: ${name}`);
    }

    if (typeof source !== "string") {
      throw new Error(`Mail snippet override ${name} must be a string.`);
    }

    if (source.length > MAX_SNIPPET_OVERRIDE_LENGTH) {
      throw new Error(`Mail snippet override ${name} is too large.`);
    }

    Handlebars.precompile(source);
  });
}

function validateMailSubjects(mailSubjects = {}) {
  if (
    mailSubjects === null ||
    Array.isArray(mailSubjects) ||
    typeof mailSubjects !== "object"
  ) {
    throw new Error("mailSubjects must be an object.");
  }

  Object.entries(mailSubjects).forEach(([name, source]) => {
    if (!overridableSnippetSet.has(name)) {
      throw new Error(`Unsupported mail subject override: ${name}`);
    }

    if (typeof source !== "string") {
      throw new Error(`Mail subject override ${name} must be a string.`);
    }

    if (source.length > MAX_SUBJECT_OVERRIDE_LENGTH) {
      throw new Error(`Mail subject override ${name} is too large.`);
    }

    Handlebars.precompile(source);
  });
}

module.exports = {
  OVERRIDABLE_SNIPPETS,
  OVERRIDE_TEMPLATE_VARIABLES,
  MAX_SUBJECT_OVERRIDE_LENGTH,
  AFTER_SNIPPET_SUFFIX,
  afterSnippetKey,
  isOverridableSnippetKey,
  getSnippetOverride,
  getSubjectOverride,
  renderSubjectOverride,
  validateMailSnippets,
  validateMailSubjects,
};
