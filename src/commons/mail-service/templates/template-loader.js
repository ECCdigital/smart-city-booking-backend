const fs = require("fs");
const path = require("path");
const Handlebars = require("handlebars");

const snippetCache = new Map();
const SNIPPETS_DIR = path.join(__dirname, "snippets");

function loadSnippet(name) {
  if (snippetCache.has(name)) return snippetCache.get(name);

  const filePath = path.join(SNIPPETS_DIR, `${name}.hbs`);
  const source = fs.readFileSync(filePath, "utf-8");
  const compiled = Handlebars.compile(source);

  snippetCache.set(name, compiled);
  return compiled;
}

function renderSnippet(name, data = {}) {
  const template = loadSnippet(name);

  // Wrap in the standard layout with optional footer
  const wrappedSource = `
    <div style="font-family: sans-serif;">
      {{{body}}}
      {{#if showFooter}}
        {{> mailFooter email=supportEmail}}
      {{/if}}
    </div>
  `;
  const wrapperTemplate = Handlebars.compile(wrappedSource);

  const bodyHtml = template(data);
  return wrapperTemplate({ ...data, body: bodyHtml });
}

module.exports = { loadSnippet, renderSnippet };
