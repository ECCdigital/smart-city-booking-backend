class CustomFieldService {
  /**
   * Normalize a single field definition's usageOptions so that filter and
   * detail-display settings stay consistent.
   * - A field is only filterable when it has a catalogFilterType.
   * - When not filterable, catalog filter settings are cleared.
   * - showInMail only exists on checkout fields; it is cleared otherwise.
   * @param {Object} definition Custom field definition
   * @returns {Object} The (mutated) definition
   */
  static normalizeUsageOptions(definition) {
    if (!definition || typeof definition !== "object") {
      return definition;
    }

    const usage = definition.usageOptions || (definition.usageOptions = {});

    if (usage.filterable && !usage.catalogFilterType) {
      usage.filterable = false;
    }

    if (!usage.filterable) {
      usage.catalogFilterType = null;
    }

    const allowedDetailPositions = [
      "none",
      "badge",
      "belowDescription",
      "moreInfo",
    ];
    if (!allowedDetailPositions.includes(usage.detailDisplayPosition)) {
      usage.detailDisplayPosition = "none";
    }

    usage.showInMail =
      usage.context === "checkout" && usage.showInMail === true;

    return definition;
  }

  /**
   * Normalize a list of field definitions in place.
   * @param {Array} definitions Custom field definitions
   * @returns {Array} The normalized definitions
   */
  static normalizeDefinitions(definitions = []) {
    return definitions.map((def) => this.normalizeUsageOptions(def));
  }

  /**
   * Returns field IDs that exist in previousDefinitions but not in nextDefinitions.
   * @param {Array} previousDefinitions
   * @param {Array} nextDefinitions
   * @returns {string[]}
   */
  static getRemovedFieldIds(previousDefinitions = [], nextDefinitions = []) {
    const nextIds = new Set(
      nextDefinitions.map((definition) => definition?.id).filter(Boolean),
    );

    return [
      ...new Set(
        previousDefinitions
          .map((definition) => definition?.id)
          .filter((id) => id && !nextIds.has(id)),
      ),
    ];
  }

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

  static filterCheckoutDefinitions(mergedDefinitions = []) {
    return mergedDefinitions.filter(
      (def) => def.usageOptions?.context === "checkout",
    );
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
