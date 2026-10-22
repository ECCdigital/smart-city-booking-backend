/**
 * The user collection in memory, below `UserManager` at the model, so the
 * query `UserManager` builds is the one answered. Shared by the tests of the
 * public authentication routes (ECCdigital/tickets#259, #320) and of the
 * writes over the account id (ECCdigital/tickets#322).
 */

const sinon = require("sinon");
const UserModel = require("../../src/commons/data-managers/models/userModel");
const { User } = require("../../src/commons/entities/user/user");

/** A stored account as a plain document. */
function account(id, password, fields = {}) {
  const user = new User({
    id,
    firstName: "Konto",
    lastName: id.split("@")[0],
    isVerified: true,
    hooks: [],
    ...fields,
  });
  if (fields.authType === undefined || fields.authType === "local") {
    user.setPassword(password);
  }
  return JSON.parse(JSON.stringify(user));
}

/**
 * The user collection in memory, behind `UserModel`. It answers the two
 * forms of an id condition MongoDB would - an exact value and `$regex` with
 * `$options` - the document key `_id`, the empty filter and `isSuspended`,
 * and refuses every other filter,
 * so a lookup it does not know fails loudly instead of matching by accident.
 * A write sets the fields it names (`$set`, or a plain object as Mongoose
 * reads one), inserts only on `upsert` and keeps `keycloakId` unique, as the
 * index `keycloakId_unique_idx` does.
 */
function installUserCollection(documents) {
  let nextKey = 0;
  const docs = documents.map((doc) => ({
    _id: `user-${++nextKey}`,
    ...doc,
  }));

  const matchesId = (stored, condition) => {
    if (typeof condition === "string") return stored === condition;
    // The lookup of several accounts at once (`getUsersById`).
    if (Array.isArray(condition?.$in)) return condition.$in.includes(stored);
    if (
      condition &&
      typeof condition === "object" &&
      Object.keys(condition).every((key) =>
        ["$regex", "$options"].includes(key),
      )
    ) {
      return new RegExp(condition.$regex, condition.$options).test(stored);
    }
    throw new Error(`user collection: unsupported id condition ${condition}`);
  };
  const matches = (doc, filter) => {
    const keys = Object.keys(filter);
    if (keys.length === 0) {
      return true;
    }
    if (keys.length === 1 && keys[0] === "_id") {
      return doc._id === filter._id;
    }
    // The list of the suspended (ECCdigital/tickets#624).
    if (keys.length === 1 && keys[0] === "isSuspended") {
      return (doc.isSuspended ?? false) === filter.isSuspended;
    }
    if (keys.length !== 1 || keys[0] !== "id") {
      throw new Error(
        `user collection: unsupported filter ${JSON.stringify(filter)}`,
      );
    }
    return matchesId(doc.id, filter.id);
  };
  const asDocument = (doc) =>
    doc && {
      ...doc,
      toObject: () => JSON.parse(JSON.stringify(doc)),
      toEntity: () => new User(JSON.parse(JSON.stringify(doc))),
    };
  const plain = (user) => JSON.parse(JSON.stringify(user));
  const assertKeycloakIdUnique = (doc) => {
    if (
      typeof doc.keycloakId === "string" &&
      doc.keycloakId !== "" &&
      docs.some((other) => other !== doc && other.keycloakId === doc.keycloakId)
    ) {
      const error = new Error(
        `E11000 duplicate key error index: keycloakId_unique_idx dup key: { keycloakId: "${doc.keycloakId}" }`,
      );
      error.code = 11000;
      throw error;
    }
  };
  const fieldsOf = (update) => plain(update.$set ?? update);

  sinon
    .stub(UserModel, "find")
    .callsFake(async (filter) =>
      docs.filter((doc) => matches(doc, filter)).map(asDocument),
    );
  // `findOne` answers what `find` answers, and the hook lookup of the
  // verification by `hooks.id`.
  sinon.stub(UserModel, "findOne").callsFake(async (filter) => {
    if (Object.keys(filter).length === 1 && "hooks.id" in filter) {
      return asDocument(
        docs.find((doc) =>
          (doc.hooks ?? []).some((hook) => hook.id === filter["hooks.id"]),
        ),
      );
    }
    return asDocument(docs.find((doc) => matches(doc, filter)));
  });
  sinon.stub(UserModel, "create").callsFake(async (user) => {
    const doc = { _id: `user-${++nextKey}`, ...plain(user) };
    assertKeycloakIdUnique(doc);
    docs.push(doc);
    return asDocument(doc);
  });
  // As MongoDB: the fields of the update over the document found, a new
  // document only on `upsert`, the document before the write unless `new`.
  sinon
    .stub(UserModel, "findOneAndUpdate")
    .callsFake(async (filter, update, options = {}) => {
      const index = docs.findIndex((doc) => matches(doc, filter));
      if (index === -1) {
        if (!options.upsert) return null;
        const doc = {
          _id: `user-${++nextKey}`,
          ...plain(filter),
          ...fieldsOf(update),
        };
        assertKeycloakIdUnique(doc);
        docs.push(doc);
        return options.new ? asDocument(doc) : null;
      }
      const before = docs[index];
      const after = { ...before, ...fieldsOf(update) };
      docs[index] = after;
      try {
        assertKeycloakIdUnique(after);
      } catch (error) {
        docs[index] = before;
        throw error;
      }
      return asDocument(options.new ? after : before);
    });
  // The write of the user id change, by the document key.
  sinon.stub(UserModel, "updateOne").callsFake(async (filter, update) => {
    const index = docs.findIndex((doc) => matches(doc, filter));
    if (index === -1) return { matchedCount: 0, modifiedCount: 0 };
    docs[index] = { ...docs[index], ...fieldsOf(update) };
    return { matchedCount: 1, modifiedCount: 1 };
  });
  sinon.stub(UserModel, "deleteOne").callsFake(async (filter) => {
    const index = docs.findIndex((doc) => matches(doc, filter));
    if (index === -1) return { deletedCount: 0 };
    docs.splice(index, 1);
    return { deletedCount: 1 };
  });

  return docs;
}

module.exports = { account, installUserCollection };
