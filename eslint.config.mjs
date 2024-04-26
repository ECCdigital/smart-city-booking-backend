import prettier from "eslint-plugin-prettier";
import prettierConfig from "./prettier.config.js";

export default {
  languageOptions: {
    ecmaVersion: 2022,
    sourceType: "module",
  },
  plugins: {
    prettier: prettier,
  },
  rules: {
    "no-unused-vars": "warn",
    "no-constant-condition": "warn",
    "no-empty": "error",
    "prettier/prettier": ["error", prettierConfig],
  },
};
