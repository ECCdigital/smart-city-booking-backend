const eslintPluginPrettierRecommended = require("eslint-plugin-prettier/recommended");

module.exports = [
  {
    // Local-only scratchpads and agent state, mirroring .prettierignore.
    // `.claude/worktrees` in particular holds whole second copies of the repo.
    ignores: [".scratch/**", ".claude/**"],
  },
  {
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: "module",
    },
    rules: {
      "no-unused-vars": "warn",
      "no-constant-condition": "warn",
      "no-empty": "error",
    },
  },
  eslintPluginPrettierRecommended,
];
