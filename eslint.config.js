const eslintPluginPrettierRecommended = require("eslint-plugin-prettier/recommended");

module.exports = [
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
