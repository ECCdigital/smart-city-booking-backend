/**
 * A tiny in-memory stand-in for a mongoose connection, just large enough for
 * the operations the migration scripts use. Anything else throws, so the fake
 * can never quietly pretend to support an operation it does not.
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

        throw new Error(
          `fake-mongoose: unsupported query operator ${operator}`,
        );
      });
    }
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

function applyUpdate(document, update, { inserted = false } = {}) {
  for (const [operator, fields] of Object.entries(update)) {
    if (operator === "$set") {
      for (const [path, value] of Object.entries(fields)) {
        setPath(document, path, value);
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
    } else {
      throw new Error(`fake-mongoose: unsupported update operator ${operator}`);
    }
  }
}

function createQuery(documents) {
  const query = {
    sort: () => query,
    lean: () => Promise.resolve(clone(documents)),
    then: (onFulfilled, onRejected) =>
      Promise.resolve(clone(documents)).then(onFulfilled, onRejected),
  };

  return query;
}

function createCollection(documents, indexes) {
  return {
    async updateOne(filter, update) {
      const document = documents.find((candidate) =>
        matches(candidate, filter),
      );
      if (document) applyUpdate(document, update);
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

function createModel(name, documents, indexes) {
  return {
    modelName: name,
    documents: documents,
    indexes: indexes,
    collection: createCollection(documents, indexes),

    find(filter = {}) {
      return createQuery(documents.filter((doc) => matches(doc, filter)));
    },

    async updateOne(filter, update, options = {}) {
      const document = documents.find((candidate) =>
        matches(candidate, filter),
      );

      if (document) {
        applyUpdate(document, update);
        return;
      }

      if (!options.upsert) return;

      const inserted = {};
      for (const [path, condition] of Object.entries(filter)) {
        if (!isPlainObject(condition)) setPath(inserted, path, condition);
      }
      applyUpdate(inserted, update, { inserted: true });
      documents.push(inserted);
    },

    async createCollection() {},
    async syncIndexes() {},
  };
}

/**
 * Build a fake mongoose connection over the given collections.
 *
 * @param {Object<string, Object[]>} collections Documents per model name
 * @returns {{model: function(string): Object, snapshot: function(): Object}}
 *   A connection that resolves models by name plus a deep copy of all
 *   documents and indexes for comparing states
 */
function createFakeMongoose(collections = {}) {
  const models = new Map();

  for (const [name, documents] of Object.entries(collections)) {
    models.set(name, createModel(name, documents, new Map()));
  }

  return {
    model(name) {
      if (!models.has(name)) {
        models.set(name, createModel(name, [], new Map()));
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
