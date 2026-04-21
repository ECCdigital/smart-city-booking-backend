class CustomFieldService {
  static mergeDefinitions({
    instanceFields = [],
    tenantFields = [],
    bookableFields = [],
  }) {
    const fieldMap = new Map();

    for (const field of instanceFields) {
      fieldMap.set(field.id, {
        ...field,
        _origin: "instance",
      });
    }

    for (const field of tenantFields) {
      const existing = fieldMap.get(field.id);

      if (!existing) {
        fieldMap.set(field.id, {
          ...field,
          _origin: existing ? "tenant-override" : "tenant",
        });
      }
    }

    for (const field of bookableFields) {
      const existing = fieldMap.get(field.id);

      if (!existing) {
        fieldMap.set(field.id, {
          ...field,
          _origin: existing ? "bookable-override" : "bookable",
        });
      }
    }

    return Array.from(fieldMap.values());
  }

  static resolveFieldsWithValues(mergedDefinitions, customFieldValues = []) {
    const valueMap = new Map(
      customFieldValues.map((v) => [v.fieldId, v.value]),
    );

    return mergedDefinitions.map((def) => ({
      ...def,
      value: valueMap.has(def.id) ? valueMap.get(def.id) : null,
      hasValue: valueMap.has(def.id),
    }));
  }

  static validateValues(mergedDefinitions, customFieldValues = []) {
    const errors = [];
    const defMap = new Map(mergedDefinitions.map((d) => [d.id, d]));

    for (const { fieldId, value } of customFieldValues) {
      const def = defMap.get(fieldId);

      if (!def) {
        errors.push(`Unknown field: ${fieldId}`);
        continue;
      }

      if (def.inputType === "numeric" && value != null) {
        if (typeof value !== "number" || isNaN(value)) {
          errors.push(`${def.caption}: must be a number`);
        }
      }

      if (def.inputType === "boolean" && value != null) {
        if (typeof value !== "boolean") {
          errors.push(`${def.caption}: must be a boolean`);
        }
      }

      if (def.inputType === "select" && value != null) {
        const validValues = def.options.map((o) =>
          typeof o === "string" ? o : o.value,
        );
        if (!validValues.includes(value)) {
          errors.push(`${def.caption}: invalid option "${value}"`);
        }
      }
    }

    for (const def of mergedDefinitions) {
      if (def.usageOptions?.requiredInCheckout) {
        const val = customFieldValues.find((v) => v.fieldId === def.id);
        if (!val || val.value == null || val.value === "") {
          errors.push(`${def.caption}: required`);
        }
      }
    }

    return { valid: errors.length === 0, errors };
  }
}

module.exports = { CustomFieldService };
