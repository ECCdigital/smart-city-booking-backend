const DEFAULT_MAIL_SNIPPETS = Object.freeze(
  require("./default-mail-snippets.json"),
);

function mergeDefaultMailSnippets(existing = {}) {
  const merged = { ...(existing || {}) };

  Object.entries(DEFAULT_MAIL_SNIPPETS).forEach(([name, defaultSource]) => {
    const current = merged[name];
    if (typeof current !== "string" || current.trim() === "") {
      merged[name] = defaultSource;
    }
  });

  return merged;
}

module.exports = {
  DEFAULT_MAIL_SNIPPETS,
  mergeDefaultMailSnippets,
};
