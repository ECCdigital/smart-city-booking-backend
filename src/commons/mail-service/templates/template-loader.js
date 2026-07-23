const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const Handlebars = require("handlebars");

const snippetCache = new Map();
const SNIPPETS_DIR = path.join(__dirname, "snippets");
const MAX_SNIPPET_CACHE_SIZE = 200;
const WRAPPER_TEMPLATE = Handlebars.compile(`
  <div style="font-family: sans-serif;">
    {{{body}}}
    {{#if showFooter}}
      {{> mailFooter email=supportEmail}}
    {{/if}}
  </div>
`);

function setSnippetCache(key, compiled) {
  if (snippetCache.size >= MAX_SNIPPET_CACHE_SIZE) {
    const firstKey = snippetCache.keys().next().value;
    snippetCache.delete(firstKey);
  }

  snippetCache.set(key, compiled);
}

function getOverrideCacheKey(name, overrideSource) {
  const hash = crypto.createHash("sha1").update(overrideSource).digest("hex");
  return `${name}:override:${hash}`;
}

function loadSnippet(name, options = {}) {
  const { overrideSource } = options;
  const hasOverride =
    typeof overrideSource === "string" && overrideSource.trim() !== "";
  const cacheKey = hasOverride
    ? getOverrideCacheKey(name, overrideSource)
    : `file:${name}`;

  if (snippetCache.has(cacheKey)) return snippetCache.get(cacheKey);

  const source = hasOverride
    ? overrideSource
    : fs.readFileSync(path.join(SNIPPETS_DIR, `${name}.hbs`), "utf-8");
  const compiled = Handlebars.compile(source);

  setSnippetCache(cacheKey, compiled);
  return compiled;
}

function renderSnippet(name, data = {}, options = {}) {
  const template = loadSnippet(name, options);

  const bodyHtml = template(data);
  return WRAPPER_TEMPLATE({ ...data, body: bodyHtml });
}

module.exports = { loadSnippet, renderSnippet };
