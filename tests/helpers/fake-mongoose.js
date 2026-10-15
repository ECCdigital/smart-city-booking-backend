/**
 * A tiny in-memory stand-in for a mongoose connection, just large enough for
 * the operations the migration scripts and the targeted updates of the
 * Salto IQ activations use. Anything else throws, so the fake can never
 * quietly pretend to support an operation it does not.
 */

function isPlainObject(value) {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

/**
 * All values a (dotted) path resolves to, traversing arrays like MongoDB does.
 *
 * @param {Object} document The document to read from
 * @param {string} path A field path, e.g. `accessInfo.accessPointId`
 * @returns {Array} Every value found under that path
 */
function resolveValues(document, path) {
  return path.split(".").reduce(
    (values, key) => {
      const next = [];

      for (const value of values) {
        if (Array.isArray(value)) {
          if (/^\d+$/.test(key)) {
            next.push(value[Number(key)]);
          } else {
            for (const item of value) {
              if (isPlainObject(item)) next.push(item[key]);
            }
          }
        } else if (isPlainObject(value)) {
          next.push(value[key]);
        }
      }

      return next;
    },
    [document],
  );
}

function comparable(value) {
  return value instanceof Date ? value.toISOString() : value;
}

function matchesCondition(values, condition) {
  if (isPlainObject(condition)) {
    const operators = Object.keys(condition).filter((key) =>
      key.startsWith("$"),
    );

    if (operators.length > 0) {
      return operators.every((operator) => {
        if (operator === "$exists") {
          const exists = values.some((value) => value !== undefined);
          return exists === condition.$exists;
        }

        if (operator === "$in") {
          return values.some((value) =>
            Array.isArray(value)
              ? value.some((entry) => condition.$in.includes(entry))
              : condition.$in.includes(value),
          );
        }

        if (operator === "$elemMatch") {
          return values.some(
            (value) =>
              Array.isArray(value) &&
              value.some(
                (element) =>
                  isPlainObject(element) &&
                  matches(element, condition.$elemMatch),
              ),
          );
        }

        if (operator === "$not") {
          return !matchesCondition(values, condition.$not);
        }

        if (operator === "$gte") {
          const limit = comparable(condition.$gte);
          return values.some(
            (value) => value != null && comparable(value) >= limit,
          );
        }

        if (operator === "$lte") {
          // Documents hold dates as ISO strings (see `clone`), which order
          // like the dates they stand for.
          const limit = comparable(condition.$lte);
          return values.some(
            (value) => value != null && comparable(value) <= limit,
          );
        }

        throw new Error(
          `fake-mongoose: unsupported query operator ${operator}`,
        );
      });
    }
  }

  // `{ field: null }` matches a null and a missing field alike, as in MongoDB.
  if (condition === null) {
    return values.length === 0 || values.some((value) => value == null);
  }

  return values.some((value) =>
    Array.isArray(value) ? value.includes(condition) : value === condition,
  );
}

function matches(document, filter = {}) {
  return Object.entries(filter).every(([path, condition]) =>
    matchesCondition(resolveValues(document, path), condition),
  );
}

function setPath(document, path, value) {
  const keys = path.split(".");
  const lastKey = keys.pop();
  const parent = keys.reduce((target, key) => {
    if (!isPlainObject(target[key])) target[key] = {};
    return target[key];
  }, document);

  parent[lastKey] = clone(value);
}

function unsetPath(document, path) {
  const keys = path.split(".");
  const lastKey = keys.pop();
  const parent = keys.reduce(
    (target, key) => (isPlainObject(target) ? target[key] : undefined),
    document,
  );

  if (isPlainObject(parent)) delete parent[lastKey];
}

/**
 * The places a path names in a document, as `[parent, key]` pairs. A filtered
 * positional segment `$[name]` stands for every element of the array there
 * that its array filter (`name.<field>` conditions) matches, as in MongoDB.
 */
function targetsOf(document, path, arrayFilters = []) {
  const keys = path.split(".");
  let parents = [document];

  keys.slice(0, -1).forEach((key, index) => {
    const next = [];
    for (const parent of parents) {
      const positional = key.match(/^\$\[(\w+)\]$/);
      if (positional) {
        if (!Array.isArray(parent)) continue;
        next.push(
          ...parent.filter((el) =>
            elementMatches(el, positional[1], arrayFilters),
          ),
        );
      } else {
        if (!isPlainObject(parent[key]) && !Array.isArray(parent[key])) {
          // A plain path creates what is missing, a positional one does not.
          if (keys.slice(index + 1).some((k) => k.startsWith("$["))) continue;
          parent[key] = {};
        }
        next.push(parent[key]);
      }
    }
    parents = next;
  });

  const lastKey = keys[keys.length - 1];
  if (lastKey.startsWith("$[")) {
    throw new Error(`fake-mongoose: unsupported path ${path}`);
  }
  return parents.map((parent) => [parent, lastKey]);
}

function elementMatches(element, name, arrayFilters) {
  const filter = arrayFilters.find((candidate) =>
    Object.keys(candidate).some((key) => key.startsWith(`${name}.`)),
  );
  if (!filter) {
    throw new Error(`fake-mongoose: no array filter for $[${name}]`);
  }

  const condition = Object.fromEntries(
    Object.entries(filter).map(([key, value]) => [
      key.slice(name.length + 1),
      value,
    ]),
  );
  return isPlainObject(element) && matches(element, condition);
}

function applyUpdate(
  document,
  update,
  { inserted = false, arrayFilters = [] } = {},
) {
  const each = (path, apply) => {
    if (!path.includes("$")) {
      apply(...targetsOf(document, path)[0]);
      return;
    }
    targetsOf(document, path, arrayFilters).forEach(([parent, key]) =>
      apply(parent, key),
    );
  };

  for (const [operator, fields] of Object.entries(update)) {
    if (operator === "$set") {
      // As in MongoDB, the array filters pick their elements from the
      // document before the update: every filtered place is found first.
      const filtered = Object.entries(fields)
        .filter(([path]) => path.includes("$"))
        .flatMap(([path, value]) =>
          targetsOf(document, path, arrayFilters).map((target) => [
            target,
            value,
          ]),
        );
      for (const [[parent, key], value] of filtered) {
        parent[key] = clone(value);
      }
      for (const [path, value] of Object.entries(fields)) {
        if (!path.includes("$")) setPath(document, path, value);
      }
    } else if (operator === "$unset") {
      for (const path of Object.keys(fields)) {
        unsetPath(document, path);
      }
    } else if (operator === "$setOnInsert") {
      if (!inserted) continue;
      for (const [path, value] of Object.entries(fields)) {
        setPath(document, path, value);
      }
    } else if (operator === "$inc") {
      for (const [path, amount] of Object.entries(fields)) {
        each(path, (parent, key) => {
          parent[key] = (parent[key] ?? 0) + amount;
        });
      }
    } else if (operator === "$push") {
      for (const [path, value] of Object.entries(fields)) {
        each(path, (parent, key) => {
          if (parent[key] === undefined) parent[key] = [];
          parent[key].push(clone(value));
        });
      }
    } else if (operator === "$pull") {
      for (const [path, condition] of Object.entries(fields)) {
        each(path, (parent, key) => {
          if (!Array.isArray(parent[key])) return;
          parent[key] = parent[key].filter(
            (element) =>
              !(isPlainObject(element) && matches(element, condition)),
          );
        });
      }
    } else {
      throw new Error(`fake-mongoose: unsupported update operator ${operator}`);
    }
  }
}

/**
 * Applies an update to the first matching document and answers like the
 * driver: how many documents matched and how many changed.
 */
function updateFirst(documents, filter, update, options = {}) {
  const document = documents.find((candidate) => matches(candidate, filter));
  if (!document) return { matchedCount: 0, modifiedCount: 0 };

  const before = JSON.stringify(document);
  applyUpdate(document, update, { arrayFilters: options.arrayFilters });
  return {
    matchedCount: 1,
    modifiedCount: JSON.stringify(document) === before ? 0 : 1,
  };
}

function createQuery(documents) {
  const query = {
    sort: () => query,
    select: () => query,
    lean: () => Promise.resolve(clone(documents)),
    then: (onFulfilled, onRejected) =>
      Promise.resolve(clone(documents)).then(onFulfilled, onRejected),
  };

  return query;
}

function createCollection(documents, indexes) {
  return {
    async updateOne(filter, update, options = {}) {
      return updateFirst(documents, filter, update, options);
    },

    /** `updateOne` operations only, with their `arrayFilters`. */
    async bulkWrite(operations) {
      // The driver refuses an empty batch.
      if (operations.length === 0) {
        throw new Error("Invalid BulkOperation, Batch cannot be empty");
      }

      let matchedCount = 0;
      let modifiedCount = 0;
      for (const operation of operations) {
        const [kind] = Object.keys(operation);
        if (kind !== "updateOne") {
          throw new Error(`fake-mongoose: unsupported bulk operation ${kind}`);
        }

        const { filter, update, arrayFilters } = operation.updateOne;
        const result = updateFirst(documents, filter, update, { arrayFilters });
        matchedCount += result.matchedCount;
        modifiedCount += result.modifiedCount;
      }
      return { matchedCount, modifiedCount };
    },

    async updateMany(filter, update) {
      documents
        .filter((candidate) => matches(candidate, filter))
        .forEach((document) => applyUpdate(document, update));
    },

    async createIndex(keys, options = {}) {
      indexes.set(options.name, { keys: clone(keys), options: clone(options) });
    },

    async dropIndex(name) {
      if (!indexes.has(name)) {
        throw Object.assign(new Error(`index not found with name [${name}]`), {
          codeName: "IndexNotFound",
        });
      }
      indexes.delete(name);
    },

    async deleteMany(filter = {}) {
      for (let i = documents.length - 1; i >= 0; i -= 1) {
        if (matches(documents[i], filter)) documents.splice(i, 1);
      }
    },

    async drop() {
      documents.length = 0;
    },
  };
}

function duplicateKeyError(writeErrors) {
  return Object.assign(new Error("E11000 duplicate key error"), {
    code: 11000,
    writeErrors,
  });
}

function createModel(name, documents, indexes, uniqueFields = []) {
  const breaksUnique = (row) =>
    uniqueFields.some(
      (field) =>
        row[field] !== undefined &&
        documents.some((document) => document[field] === row[field]),
    );

  return {
    modelName: name,
    documents: documents,
    indexes: indexes,
    collection: createCollection(documents, indexes),

    find(filter = {}) {
      return createQuery(documents.filter((doc) => matches(doc, filter)));
    },

    findOne(filter = {}) {
      const found = documents.find((doc) => matches(doc, filter)) ?? null;
      const answer = () => Promise.resolve(found && clone(found));
      return {
        lean: answer,
        then: (onFulfilled, onRejected) =>
          answer().then(onFulfilled, onRejected),
      };
    },

    async updateOne(filter, update, options = {}) {
      const result = updateFirst(documents, filter, update, options);
      if (result.matchedCount > 0 || !options.upsert) return result;

      const inserted = {};
      for (const [path, condition] of Object.entries(filter)) {
        if (!isPlainObject(condition)) setPath(inserted, path, condition);
      }
      applyUpdate(inserted, update, { inserted: true });
      documents.push(inserted);
    },

    async updateMany(filter, update) {
      documents
        .filter((candidate) => matches(candidate, filter))
        .forEach((document) => applyUpdate(document, update));
    },

    async create(row) {
      if (breaksUnique(row)) throw duplicateKeyError([]);
      documents.push(clone(row));
      return clone(row);
    },

    /**
     * The atomic read-and-write of the driver: the matching document is
     * updated; without one an upsert inserts - and fails on a unique field
     * another document holds already, as the unique index makes it.
     */
    async findOneAndUpdate(filter, update, options = {}) {
      const document = documents.find((candidate) =>
        matches(candidate, filter),
      );

      if (document) {
        applyUpdate(document, update);
        return clone(document);
      }

      if (!options.upsert) return null;

      const inserted = {};
      for (const [path, condition] of Object.entries(filter)) {
        if (!isPlainObject(condition)) setPath(inserted, path, condition);
      }
      applyUpdate(inserted, update, { inserted: true });
      if (breaksUnique(inserted)) throw duplicateKeyError([]);
      documents.push(inserted);
      return clone(inserted);
    },

    async deleteOne(filter = {}) {
      const index = documents.findIndex((candidate) =>
        matches(candidate, filter),
      );
      if (index >= 0) documents.splice(index, 1);
    },

    /**
     * Unordered insert: every row that breaks no unique field is stored, the
     * others are reported in one duplicate-key error, as the driver does.
     */
    async insertMany(rows, options = {}) {
      if (options.ordered !== false) {
        throw new Error(
          "fake-mongoose: insertMany supports ordered:false only",
        );
      }

      const writeErrors = [];

      rows.forEach((row, index) => {
        const duplicate = breaksUnique(row);

        // The shape mongoose hands on: the driver's error sits under `err`.
        if (duplicate) writeErrors.push({ index, err: { code: 11000 } });
        else documents.push(clone(row));
      });

      if (writeErrors.length > 0) throw duplicateKeyError(writeErrors);
    },

    async bulkWrite(operations) {
      for (const operation of operations) {
        const [kind] = Object.keys(operation);
        if (kind !== "updateOne") {
          throw new Error(`fake-mongoose: unsupported bulk operation ${kind}`);
        }

        const { filter, update } = operation.updateOne;
        const document = documents.find((candidate) =>
          matches(candidate, filter),
        );
        if (document) applyUpdate(document, update);
      }
    },

    async createCollection() {},
    async syncIndexes() {},
  };
}

/**
 * Build a fake mongoose connection over the given collections.
 *
 * @param {Object<string, Object[]>} collections Documents per model name
 * @param {Object} [options]
 * @param {Object<string, string[]>} [options.unique] Unique fields per model
 *   name, enforced by `insertMany`
 * @returns {{model: function(string): Object, snapshot: function(): Object}}
 *   A connection that resolves models by name plus a deep copy of all
 *   documents and indexes for comparing states
 */
function createFakeMongoose(collections = {}, { unique = {} } = {}) {
  const models = new Map();

  for (const [name, documents] of Object.entries(collections)) {
    models.set(name, createModel(name, documents, new Map(), unique[name]));
  }

  return {
    model(name) {
      if (!models.has(name)) {
        models.set(name, createModel(name, [], new Map(), unique[name]));
      }
      return models.get(name);
    },

    snapshot() {
      const state = {};
      for (const [name, model] of models) {
        state[name] = {
          documents: clone(model.documents),
          indexes: clone([...model.indexes.entries()]),
        };
      }
      return state;
    },
  };
}

module.exports = { createFakeMongoose };
