const { ValidationError } = require("../../errors/ValidationError");

const FORMAT_VALIDATORS = {
  email: (value) => {
    const { isEmail } = require("validator");
    return isEmail(value);
  },
  multiEmail: (value) => {
    const { isEmail } = require("validator");
    const emails = value
      .split(/[,\n]+/)
      .map((e) => e.trim())
      .filter(Boolean);
    return emails.length > 0 && emails.every((e) => isEmail(e));
  },
};

const ERROR_CODES = {
  required: "required",
  type_number: "invalid_type_number",
  type_string: "invalid_type_string",
  type_array: "invalid_type_array",
  min: "min_value",
  max: "max_value",
  minItems: "min_items",
  maxItems: "max_items",
  format: "invalid_format",
  greaterThan: "greater_than",
  greaterEqualThan: "greater_equal_than",
  validate: "invalid_custom",
};

function isMongooseSubdocumentSchema(type) {
  return (
    type &&
    typeof type === "object" &&
    type.constructor?.name === "Schema" &&
    typeof type.paths === "object"
  );
}

class SchemaUtils {
  static createDefaults(schemaDefinition) {
    const defaults = {};

    Object.keys(schemaDefinition).forEach((key) => {
      const field = schemaDefinition[key];

      if (Array.isArray(field)) {
        defaults[key] = [];
      } else if (field.default !== undefined) {
        defaults[key] =
          typeof field.default === "function" ? field.default() : field.default;
      } else if (field.type === Array) {
        defaults[key] = [];
      } else if (isMongooseSubdocumentSchema(field.type)) {
        // Optional embedded subdocuments must stay unset, not "".
      } else if (field.type === Object) {
        defaults[key] = {};
      } else if (field.type === Boolean) {
        defaults[key] = false;
      } else if (field.type === Number) {
        defaults[key] = null;
      } else {
        defaults[key] = "";
      }
    });

    return defaults;
  }

  static validate(obj, schemaDefinition) {
    const errors = [];

    const addError = (field, codeKey, params = {}) => {
      console.error(`Validation error on field "${field}": ${codeKey}`, params);
      errors.push({
        field,
        code: ERROR_CODES[codeKey],
        params,
      });
    };

    Object.keys(schemaDefinition).forEach((key) => {
      const field = schemaDefinition[key];
      let value = obj[key];
      const isEmpty = value === undefined || value === null || value === "";

      // --- Required ---
      if (field.required && isEmpty) {
        addError(key, "required");
        return;
      }

      // --- Custom validator ---
      if (typeof field.validate === "function") {
        const result = field.validate(value, obj);
        if (result !== true) {
          // `false` is the Mongoose-compatible failure signal; map it to the
          // SchemaUtils error code used by shared schema definitions.
          addError(key, result === false ? "validate" : result);
        }
      }

      if (isEmpty) return;

      if (field.type === Number && typeof value === "string") {
        const coerced = Number(value);
        if (!isNaN(coerced)) {
          obj[key] = coerced;
          value = coerced;
        }
      }

      // --- Type checks ---
      if (field.type === Number && typeof value !== "number") {
        addError(key, "type_number", { expected: "number" });
        return;
      }

      if (field.type === String && typeof value !== "string") {
        addError(key, "type_string", { expected: "string" });
        return;
      }

      if (Array.isArray(field.type) && !Array.isArray(value)) {
        addError(key, "type_array", { expected: "array" });
        return;
      }

      // --- min / max ---
      if (field.min !== undefined && typeof value === "number") {
        if (value < field.min) {
          addError(key, "min", { min: field.min });
        }
      }

      if (field.max !== undefined && typeof value === "number") {
        if (value > field.max) {
          addError(key, "max", { max: field.max });
        }
      }

      // --- minItems / maxItems ---
      if (field.minItems !== undefined && Array.isArray(value)) {
        if (value.length < field.minItems) {
          addError(key, "minItems", { minItems: field.minItems });
        }
      }

      if (field.maxItems !== undefined && Array.isArray(value)) {
        if (value.length > field.maxItems) {
          addError(key, "maxItems", { maxItems: field.maxItems });
        }
      }

      // --- format ---
      if (field.format && typeof value === "string") {
        const validator = FORMAT_VALIDATORS[field.format];
        if (validator && !validator(value)) {
          addError(key, "format", { format: field.format });
        }
      }

      // --- greaterThan ---
      if (field.greaterThan) {
        const otherValue = obj[field.greaterThan];
        if (
          otherValue !== undefined &&
          otherValue !== null &&
          value <= otherValue
        ) {
          addError(key, "greaterThan", {
            otherField: field.greaterThan,
          });
        }
      }

      if (field.greaterEqualThan) {
        const otherValue = obj[field.greaterEqualThan];
        if (
          otherValue !== undefined &&
          otherValue !== null &&
          value < otherValue
        ) {
          addError(key, "greaterEqualThan", {
            otherField: field.greaterEqualThan,
          });
        }
      }
    });

    if (errors.length > 0) {
      throw new ValidationError(errors);
    }

    return true;
  }
}

module.exports = SchemaUtils;
