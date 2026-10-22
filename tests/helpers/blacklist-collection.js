const sinon = require("sinon");

const BlacklistManager = require("../../src/commons/data-managers/blacklist-manager");

/**
 * The blacklist in memory, behind `BlacklistManager` (glossary
 * „Blacklist“, ECCdigital/tickets#625): every method of the manager over an
 * array, a value unique as the index on `value` keeps it. Answers the
 * array, so a test reads back what is stored.
 */
function installBlacklistCollection(documents = []) {
  const docs = documents.map((doc) => ({ ...doc }));
  const copy = (doc) => doc && JSON.parse(JSON.stringify(doc));

  sinon
    .stub(BlacklistManager, "getEntries")
    .callsFake(async () =>
      [...docs].sort((a, b) => b.createdAt - a.createdAt).map(copy),
    );
  sinon
    .stub(BlacklistManager, "getEntry")
    .callsFake(async (id) => copy(docs.find((doc) => doc.id === id)) ?? null);
  sinon
    .stub(BlacklistManager, "getEntryByValue")
    .callsFake(
      async (value) => copy(docs.find((doc) => doc.value === value)) ?? null,
    );
  sinon.stub(BlacklistManager, "insertEntry").callsFake(async (entry) => {
    if (docs.some((doc) => doc.value === entry.value)) {
      const error = new Error(
        `E11000 duplicate key error dup key: { value: "${entry.value}" }`,
      );
      error.code = 11000;
      throw error;
    }
    docs.push(copy(entry));
    return copy(entry);
  });
  sinon.stub(BlacklistManager, "updateEntry").callsFake(async (id, fields) => {
    const doc = docs.find((candidate) => candidate.id === id);
    if (!doc) return null;
    Object.assign(doc, copy(fields));
    return copy(doc);
  });
  sinon.stub(BlacklistManager, "removeEntry").callsFake(async (id) => {
    const index = docs.findIndex((doc) => doc.id === id);
    if (index !== -1) docs.splice(index, 1);
  });

  return docs;
}

module.exports = { installBlacklistCollection };
