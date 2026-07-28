const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const Handlebars = require("handlebars");

const snippetCache = new Map();
const SNIPPETS_DIR = path.join(__dirname, "snippets");
const MAX_SNIPPET_CACHE_SIZE = 200;
const WRAPPER_TEMPLATE = Handlebars.compile(`
  <div style="font-family: inherit;">
    {{{body}}}
    {{#if showFooter}}
      {{> mailFooter email=supportEmail}}
    {{/if}}
  </div>
`);

/**
 * Snippet/body HTML often hardcodes font-family (e.g. sans-serif or a system
 * stack). That overrides the tenant mail theme font. Strip it so content
 * inherits from the theme shell.
 */
function stripHardcodedFontFamily(html) {
  if (typeof html !== "string" || html.length === 0) return html;
  return html.replace(/font-family\s*:\s*[^;"]*;?\s*/gi, "");
}

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

  const bodyHtml = stripHardcodedFontFamily(template(data));
  return WRAPPER_TEMPLATE({ ...data, body: bodyHtml });
}

module.exports = { loadSnippet, renderSnippet };
