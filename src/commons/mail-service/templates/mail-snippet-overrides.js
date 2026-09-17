const crypto = require("crypto");
const Handlebars = require("handlebars");
const { MAIL_HELPER_NAMES } = require("./mail-helpers");
const { bookingStatusUrl, cancellationUrl } = require("../mail-links");
const { BadRequestError } = require("../../../errors/BaseError");

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

const BOOKING_CANCEL_SNIPPETS = Object.freeze(["booking-cancel"]);
const SAMPLE_BOOKING_ID = "BK-987654";
const SAMPLE_CUSTOMER_NAME = "Max Mustermann";
const SAMPLE_BOOKING = Object.freeze({
  id: SAMPLE_BOOKING_ID,
  name: SAMPLE_CUSTOMER_NAME,
});
const SAMPLE_GROUP_BOOKING_IDS = Object.freeze([
  SAMPLE_BOOKING_ID,
  "BK-987655",
]);

/**
 * The Variablenkatalog (glossary): the one list of Mail-Variablen the admin
 * UI reads for its picker and preview, in picker order. `label`,
 * `description` and `requires.text` are German strings; `expr` is the
 * ready-made expression where `{{name}}` is not the whole story; `sample`
 * (and `sampleAggregated` for the aggregated preview) feed the client-side
 * preview; `snippets` restricts an entry to the snippets it applies to;
 * `requires` names the precondition the editor warns about.
 *
 * The catalog is per tenant: the sample URLs carry the real `FRONTEND_URL`
 * and the tenant's id, built by `mail-links.js` as `render.js` builds them
 * at send time.
 *
 * @param {{tenantId: string}} scope
 * @returns {Array<Object>} A fresh array; every call builds the entries anew
 */
function templateVariableCatalog({ tenantId }) {
  const frontendUrl = process.env.FRONTEND_URL;

  return [
    {
      name: "tenantName",
      label: "Mandant",
      description: "Name des Mandanten",
      kind: "text",
      sample: "Beispiel-Mandant",
    },
    {
      name: "supportEmail",
      label: "Support-E-Mail",
      description: "Support-E-Mail-Adresse des Mandanten",
      kind: "text",
      sample: "support@beispiel.de",
    },
    {
      name: "customerName",
      label: "Kundenname",
      description: "Name des Kunden aus der Buchung",
      kind: "text",
      sample: SAMPLE_CUSTOMER_NAME,
    },
    {
      name: "customerContact",
      label: "Kundenkontakt",
      description:
        "Kontaktdaten des Kunden als HTML-Block (Name, Firma, E-Mail, Telefon, Adresse)",
      kind: "html",
      expr: "{{{customerContact}}}",
      sample:
        "<strong>Name:</strong> Max Mustermann<br />" +
        "<strong>Firma:</strong> Beispiel GmbH<br />" +
        "<strong>E-Mail:</strong> max.mustermann@beispiel.de<br />" +
        "<strong>Telefon:</strong> 0123 4567890<br />" +
        "<strong>Adresse:</strong> Musterstraße 1, 12345 Musterstadt",
    },
    {
      name: "currentDate",
      label: "Aktuelles Datum",
      description: "Aktuelles Versanddatum im Format TT.MM.JJJJ",
      kind: "text",
      sample: "24.05.2026",
    },
    {
      name: "hasRefundPreview",
      label: "Erstattung vorhanden",
      description:
        "Wahr, wenn die Buchung einen Erstattungsbetrag größer 0 € hat",
      kind: "flag",
      expr: "{{#if hasRefundPreview}}...{{/if}}",
      sample: true,
      snippets: BOOKING_CANCEL_SNIPPETS,
    },
    {
      name: "refundAmountEur",
      label: "Erstattungsbetrag",
      description:
        "Erstattungsbetrag als Zahl (mit Helper priceFormatted nutzbar)",
      kind: "number",
      expr: "{{priceFormatted refundAmountEur}}",
      sample: 60,
      snippets: BOOKING_CANCEL_SNIPPETS,
    },
    {
      name: "cancellationFeeEur",
      label: "Einbehalt",
      description: "Einbehaltener Betrag als Zahl",
      kind: "number",
      expr: "{{priceFormatted cancellationFeeEur}}",
      sample: 60,
      snippets: BOOKING_CANCEL_SNIPPETS,
    },
    {
      name: "originalAmountEur",
      label: "Ursprungsbetrag",
      description: "Ursprungsbetrag der Buchung als Zahl",
      kind: "number",
      expr: "{{priceFormatted originalAmountEur}}",
      sample: 120,
      snippets: BOOKING_CANCEL_SNIPPETS,
    },
    {
      name: "refundPercentage",
      label: "Erstattungsprozent",
      description: "Angewandter Erstattungsprozentsatz (0–100)",
      kind: "number",
      sample: 50,
      snippets: BOOKING_CANCEL_SNIPPETS,
    },
    {
      name: "hasCancellationFee",
      label: "Einbehalt vorhanden",
      description: "Wahr, wenn ein Einbehalt größer 0 € anfällt",
      kind: "flag",
      expr: "{{#if hasCancellationFee}}...{{/if}}",
      sample: true,
      snippets: BOOKING_CANCEL_SNIPPETS,
    },
    {
      name: "daysBeforeStart",
      label: "Tage bis Beginn",
      description:
        "Kalendertage bis zum Buchungsbeginn zum Berechnungszeitpunkt",
      kind: "number",
      sample: 10,
      snippets: BOOKING_CANCEL_SNIPPETS,
    },
    {
      name: "bookingId",
      label: "Buchungsnummer",
      description: "Nummer der Buchung; leer in einer Sammelmitteilung",
      kind: "text",
      sample: SAMPLE_BOOKING_ID,
      sampleAggregated: "",
    },
    {
      name: "groupBookingId",
      label: "Gruppennummer",
      description:
        "Nummer der Buchungsgruppe; nur in einer Sammelmitteilung gefüllt",
      kind: "text",
      sample: "",
      sampleAggregated: "GB-123456",
    },
    {
      name: "isAggregated",
      label: "Sammelmitteilung",
      description:
        "Wahr, wenn die Mitteilung eine Buchungsgruppe betrifft; für einen Block, der nur dann erscheint",
      kind: "flag",
      expr: "{{#if isAggregated}}...{{/if}}",
      sample: false,
      sampleAggregated: true,
    },
    {
      name: "tenantId",
      label: "Mandanten-Kennung",
      description: "Technische Kennung des Mandanten, für eigene Links",
      kind: "text",
      sample: tenantId,
    },
    {
      name: "bookingStatusUrl",
      label: "Link zur Status-Seite",
      description:
        "Öffentliche Status-Seite der Buchung; leer ohne öffentliche Status-Seite oder in einer Sammelmitteilung, darum in einem {{#if bookingStatusUrl}}...{{/if}}-Block einsetzen",
      kind: "url",
      sample: bookingStatusUrl(SAMPLE_BOOKING, tenantId),
      sampleAggregated: "",
      requires: {
        text: "leer, wenn die öffentliche Status-Seite deaktiviert ist",
        tenantSetting: {
          key: "enablePublicStatusView",
          label: "Öffentliche Status-Seite",
        },
      },
    },
    {
      name: "cancellationUrl",
      label: "Storno-Link",
      description:
        "Storno-Anfrage des Kunden; leer, wenn die Buchung nicht vom Kunden stornierbar oder nicht mehr live ist, oder in einer Sammelmitteilung, darum in einem {{#if cancellationUrl}}...{{/if}}-Block einsetzen",
      kind: "url",
      sample: cancellationUrl(SAMPLE_BOOKING, tenantId),
      sampleAggregated: "",
      requires: {
        text: "leer, wenn die Buchung nicht vom Kunden stornierbar ist oder nicht mehr läuft",
      },
    },
    {
      name: "paymentUrl",
      label: "Zahlungslink",
      description:
        "Link zur Zahlung; bei einer Gruppe ein Link für alle Buchungen. Nur im Zahlungslink-Snippet gefüllt, darum in einem {{#if paymentUrl}}...{{/if}}-Block einsetzen",
      kind: "url",
      sample: `${frontendUrl}/payment/redirection?ids=${SAMPLE_BOOKING_ID}&tenant=${tenantId}&aggregated=false`,
      sampleAggregated: `${frontendUrl}/payment/redirection?ids=${SAMPLE_GROUP_BOOKING_IDS.join(",")}&tenant=${tenantId}&aggregated=true`,
      snippets: Object.freeze(["payment-link-after-approval"]),
    },
  ];
}

const AFTER_SNIPPET_SUFFIX = "__after";

// Every helper a template may call: the platform's own plus the Handlebars
// built-ins. Compiling with `knownHelpersOnly` turns a typo into a save-time
// error instead of a runtime failure when the notice is sent.
const HANDLEBARS_BUILTIN_HELPERS = Object.freeze([
  "if",
  "each",
  "unless",
  "with",
  "lookup",
  "log",
]);
const KNOWN_HELPERS = Object.freeze(
  Object.fromEntries(
    [...MAIL_HELPER_NAMES, ...HANDLEBARS_BUILTIN_HELPERS].map((name) => [
      name,
      true,
    ]),
  ),
);
const UNKNOWN_HELPER_PATTERN = /unknown helper (\S+)/;

function compileForValidation(overrideKind, name, source) {
  try {
    Handlebars.precompile(source, {
      knownHelpers: KNOWN_HELPERS,
      knownHelpersOnly: true,
    });
  } catch (error) {
    const helper = UNKNOWN_HELPER_PATTERN.exec(error?.message)?.[1];
    if (!helper) throw error;
    throw new BadRequestError(
      `Mail ${overrideKind} override ${name} uses unknown helper "${helper}".`,
    );
  }
}

const overridableSnippetSet = new Set(OVERRIDABLE_SNIPPETS);

function afterSnippetKey(snippetName) {
  return `${snippetName}${AFTER_SNIPPET_SUFFIX}`;
}

function isOverridableSnippetKey(name) {
  if (overridableSnippetSet.has(name)) {
    return true;
  }
  if (typeof name === "string" && name.endsWith(AFTER_SNIPPET_SUFFIX)) {
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

    compileForValidation("snippet", name, source);
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

    compileForValidation("subject", name, source);
  });
}

module.exports = {
  OVERRIDABLE_SNIPPETS,
  templateVariableCatalog,
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
