/**
 * The user collection in memory, below `UserManager` at the model, so the
 * query `UserManager` builds is the one answered. Shared by the tests of the
 * public authentication routes (ECCdigital/tickets#259, #320).
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
 * `$options` - and refuses every other filter, so a lookup it does not know
 * fails loudly instead of matching by accident.
 */
function installUserCollection(documents) {
  const docs = documents.map((doc) => ({ ...doc }));

  const matchesId = (stored, condition) => {
    if (typeof condition === "string") return stored === condition;
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
    docs.push(plain(user));
    return asDocument(docs[docs.length - 1]);
  });
  sinon.stub(UserModel, "findOneAndUpdate").callsFake(async (filter, user) => {
    const index = docs.findIndex((doc) => matches(doc, filter));
    if (index === -1) docs.push(plain(user));
    else docs[index] = plain(user);
    return asDocument(plain(user));
  });

  return docs;
}

module.exports = { account, installUserCollection };
