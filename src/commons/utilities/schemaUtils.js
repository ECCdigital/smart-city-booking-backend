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

    Object.keys(schemaDefinition).forEach((key) => {
      const field = schemaDefinition[key];
      const value = obj[key];

      if (
        field.required &&
        (value === undefined || value === null || value === "")
      ) {
        errors.push(`${key} is required`);
      }
    });

    if (errors.length > 0) {
      throw new Error(errors.join(", "));
    }

    return true;
  }
}

module.exports = SchemaUtils;
