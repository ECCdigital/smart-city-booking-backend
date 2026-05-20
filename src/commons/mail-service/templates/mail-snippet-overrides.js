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
]);

const overridableSnippetSet = new Set(OVERRIDABLE_SNIPPETS);

const subjectTemplateCache = new Map();

function getSnippetOverride(tenant, snippetName) {
  if (!overridableSnippetSet.has(snippetName)) {
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
    if (!overridableSnippetSet.has(name)) {
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
  MAX_SUBJECT_OVERRIDE_LENGTH,
  getSnippetOverride,
  getSubjectOverride,
  renderSubjectOverride,
  validateMailSnippets,
  validateMailSubjects,
};
