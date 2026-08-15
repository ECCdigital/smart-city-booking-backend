/**
 * Catalog of everything the frontend needs to build rules without prior
 * knowledge of the data model: available resources and their fields, the
 * operators usable in queries/conditions, placeholders and the action
 * definitions (including their parameters).
 *
 * This module is the single source of truth for the allowed resources.
 */

// ---------------------------------------------------------------------------
// Resources & fields
// ---------------------------------------------------------------------------

const RESOURCE_CATALOG = {
  Booking: {
    label: "Buchungen",
    fields: [
      { name: "id", label: "Buchungs-ID", type: "string" },
      { name: "tenantId", label: "Mandant", type: "string" },
      { name: "assignedUserId", label: "Zugewiesener Nutzer", type: "string" },
      { name: "name", label: "Name", type: "string" },
      { name: "company", label: "Firma", type: "string" },
      { name: "mail", label: "E-Mail", type: "string" },
      { name: "phone", label: "Telefon", type: "string" },
      { name: "location", label: "Ort", type: "string" },
      { name: "street", label: "Straße", type: "string" },
      { name: "zipCode", label: "PLZ", type: "string" },
      { name: "comment", label: "Kommentar", type: "string" },
      { name: "rejectionReason", label: "Ablehnungsgrund", type: "string" },
      { name: "couponCode", label: "Gutscheincode", type: "string" },
      { name: "paymentMethod", label: "Zahlungsart", type: "string" },
      { name: "paymentProvider", label: "Zahlungsanbieter", type: "string" },
      { name: "isCommitted", label: "Bestätigt", type: "boolean" },
      { name: "isPayed", label: "Bezahlt", type: "boolean" },
      { name: "isRejected", label: "Abgelehnt", type: "boolean" },
      { name: "priceEur", label: "Preis (EUR)", type: "number" },
      {
        name: "timeBegin",
        label: "Buchungsbeginn",
        type: "datetime",
        note: "Epoch-Millisekunden",
      },
      {
        name: "timeEnd",
        label: "Buchungsende",
        type: "datetime",
        note: "Epoch-Millisekunden",
      },
      {
        name: "timeCreated",
        label: "Erstellt am",
        type: "datetime",
        note: "Epoch-Millisekunden",
      },
      {
        name: "timePaid",
        label: "Bezahlt am",
        type: "datetime",
        note: "Epoch-Millisekunden",
      },
    ],
  },
};

// Extra values that are only available inside `conditions` (JSON-Logic facts),
// because they are computed at runtime and are not stored fields.
const COMPUTED_FACTS = [
  { name: "now", label: "Jetzt", type: "datetime" },
  {
    name: "ageInHours",
    label: "Alter in Stunden",
    type: "number",
    note: "Benötigt ein createdAt-Feld am Dokument",
  },
];

// ---------------------------------------------------------------------------
// Operators
// ---------------------------------------------------------------------------

// JSON-Logic operators usable in `conditions`.
const CONDITION_OPERATORS = [
  { operator: "var", label: "Feldwert", arity: "field" },
  { operator: "==", label: "gleich", arity: 2 },
  { operator: "!=", label: "ungleich", arity: 2 },
  { operator: ">", label: "größer als", arity: 2 },
  { operator: ">=", label: "größer/gleich", arity: 2 },
  { operator: "<", label: "kleiner als", arity: 2 },
  { operator: "<=", label: "kleiner/gleich", arity: 2 },
  { operator: "in", label: "enthalten in", arity: 2 },
  { operator: "!", label: "nicht", arity: 1 },
  { operator: "and", label: "und", arity: "n" },
  { operator: "or", label: "oder", arity: "n" },
];

// MongoDB operators usable in `query`.
const QUERY_OPERATORS = [
  { operator: "$eq", label: "gleich" },
  { operator: "$ne", label: "ungleich" },
  { operator: "$gt", label: "größer als" },
  { operator: "$gte", label: "größer/gleich" },
  { operator: "$lt", label: "kleiner als" },
  { operator: "$lte", label: "kleiner/gleich" },
  { operator: "$in", label: "enthalten in" },
  { operator: "$nin", label: "nicht enthalten in" },
  { operator: "$exists", label: "Feld existiert" },
  { operator: "$regex", label: "regulärer Ausdruck" },
  { operator: "$expr", label: "Aggregations-Ausdruck (erweitert)" },
];

// Units usable in the relative date placeholders.
const RELATIVE_DATE_UNITS = [
  "second",
  "minute",
  "hour",
  "day",
  "week",
  "month",
  "year",
];

// Placeholders that get replaced before the query runs.
const PLACEHOLDERS = [
  {
    token: "$$NOW",
    label: "Aktueller Zeitpunkt",
    description:
      "Wird zur Laufzeit durch den aktuellen Zeitpunkt ersetzt. Nutzbar in query.",
  },
  {
    token: "$$DATE_SUBTRACT",
    label: "Jetzt minus Zeitspanne",
    description:
      'Objekt-Platzhalter. Wird zur Laufzeit zu (jetzt − amount × unit) aufgelöst. Standardmäßig als Epoch-Millisekunden, mit "as": "date" als Datum.',
    valueShape: { unit: "day", amount: 14, as: "millis" },
    units: RELATIVE_DATE_UNITS,
    example: {
      timeCreated: { $lt: { $$DATE_SUBTRACT: { unit: "day", amount: 14 } } },
    },
  },
  {
    token: "$$DATE_ADD",
    label: "Jetzt plus Zeitspanne",
    description:
      'Objekt-Platzhalter. Wird zur Laufzeit zu (jetzt + amount × unit) aufgelöst. Standardmäßig als Epoch-Millisekunden, mit "as": "date" als Datum.',
    valueShape: { unit: "day", amount: 7, as: "millis" },
    units: RELATIVE_DATE_UNITS,
    example: {
      timeBegin: { $gte: { $$DATE_ADD: { unit: "day", amount: 7 } } },
    },
  },
  {
    token: "$$TENANT_MAIL",
    label: "E-Mail des Mandanten",
    description:
      "String-Platzhalter für Action-Parameter (nicht für query). Wird zur Laufzeit durch die E-Mail-Adresse des Mandanten des jeweiligen Dokuments ersetzt. Typisch im Feld 'to' einer E-Mail-Action.",
    context: "actionParams",
  },
];

// ---------------------------------------------------------------------------
// Actions
// ---------------------------------------------------------------------------

const ACTION_CATALOG = {
  test: {
    label: "Test",
    description: "Test-Action ohne Nebenwirkung. Nützlich zum Ausprobieren.",
    params: [],
  },
  cancelBooking: {
    label: "Buchung ablehnen",
    description:
      "Lehnt die getroffene Buchung ab (intern rejectBooking) und benachrichtigt den Gast.",
    params: [
      {
        name: "reason",
        label: "Ablehnungsgrund",
        type: "string",
        required: false,
      },
    ],
  },
  sendEmail: {
    label: "E-Mail versenden",
    description:
      "Versendet eine individuelle E-Mail je getroffenem Dokument. Betreff und Inhalt werden in der Regel definiert. Im Inhalt können Felder des Dokuments per {{feld}} eingesetzt werden (z. B. {{name}}, {{mail}}).",
    params: [
      {
        name: "to",
        label: "Empfänger",
        type: "string",
        required: false,
        note: "Optional. Standardmäßig die E-Mail des Dokuments. Platzhalter $$TENANT_MAIL möglich.",
      },
      {
        name: "subject",
        label: "Betreff",
        type: "string",
        required: true,
      },
      {
        name: "body",
        label: "Inhalt (HTML, Handlebars)",
        type: "text",
        required: true,
        note: "Platzhalter wie {{name}} oder {{mail}} werden aus dem Dokument befüllt.",
      },
      {
        name: "useInstanceMail",
        label: "Instanz-Mailkonto verwenden",
        type: "boolean",
        required: false,
      },
    ],
  },
  sendAggregatedEmail: {
    label: "Sammel-E-Mail versenden",
    aggregate: true,
    description:
      "Versendet EINE E-Mail pro Mandant mit allen getroffenen Dokumenten. Im Inhalt steht die Liste als {{#each bookings}} … {{/each}} zur Verfügung (auch {{count}}).",
    params: [
      {
        name: "to",
        label: "Empfänger",
        type: "string",
        required: false,
        note: "Optional. Standard: E-Mail des Mandanten. Platzhalter $$TENANT_MAIL möglich.",
      },
      {
        name: "subject",
        label: "Betreff",
        type: "string",
        required: true,
      },
      {
        name: "body",
        label: "Inhalt (HTML, Handlebars)",
        type: "text",
        required: true,
        note: "Liste der Treffer per {{#each bookings}}…{{/each}}; Anzahl via {{count}}.",
      },
      {
        name: "useInstanceMail",
        label: "Instanz-Mailkonto verwenden",
        type: "boolean",
        required: false,
      },
    ],
  },
};

function getResources() {
  return Object.entries(RESOURCE_CATALOG).map(([name, resource]) => ({
    name,
    label: resource.label,
    fields: resource.fields,
  }));
}

/**
 * Returns action definitions for the given runtime action types. Types that
 * exist in the registry but not in the catalog still get a minimal entry, so
 * the frontend never references an action it cannot describe.
 */
function getActions(actionTypes) {
  return actionTypes.map((type) => {
    const definition = ACTION_CATALOG[type];
    return {
      type,
      label: definition?.label || type,
      description: definition?.description || "",
      aggregate: definition?.aggregate === true,
      params: definition?.params || [],
    };
  });
}

module.exports = {
  RESOURCE_CATALOG,
  COMPUTED_FACTS,
  CONDITION_OPERATORS,
  QUERY_OPERATORS,
  PLACEHOLDERS,
  RELATIVE_DATE_UNITS,
  ACTION_CATALOG,
  getResources,
  getActions,
};
