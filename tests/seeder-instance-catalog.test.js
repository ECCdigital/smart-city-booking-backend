/**
 * The seeder creates the instance catalog when it is missing
 * (ECCdigital/tickets#981). A fresh database had none: `GET /api/catalog`
 * answered 404, the Admin UI's tenant list showed the catalog as unavailable,
 * and saving the instance settings failed on the catalog's missing name.
 * Runs over in-memory models, no database.
 */

const { expect } = require("chai");

const seed = require("../seeder/seeder");

/** A model over an array: `findOne` by equal fields, `create` appends. */
function memoryModel(docs = []) {
  return {
    docs,
    async findOne(filter = {}) {
      return (
        docs.find((doc) =>
          Object.entries(filter).every(([key, value]) => doc[key] === value),
        ) || null
      );
    },
    async create(doc) {
      const created = { ...doc, save: async () => created };
      docs.push(created);
      return created;
    },
  };
}

function fakeMongoose({ instances = [], users = [], catalogs = [] } = {}) {
  const models = {
    Instance: memoryModel(instances),
    User: memoryModel(users),
    Catalog: memoryModel(catalogs),
  };
  return { models, model: (name) => models[name] };
}

function instanceCatalogs(mongoose) {
  return mongoose.models.Catalog.docs.filter((doc) => doc.type === "instance");
}

describe("seeder: instance catalog", function () {
  it("creates the instance catalog with the default Portal Name on an empty database", async function () {
    const mongoose = fakeMongoose();

    await seed(mongoose);

    const catalogs = instanceCatalogs(mongoose);
    expect(catalogs).to.have.length(1);
    expect(catalogs[0].name).to.equal("Buchungsportal");
  });

  it("creates it for an initialized instance that has no catalog yet", async function () {
    const mongoose = fakeMongoose({
      instances: [{ isInitialized: true, ownerUserIds: ["admin"] }],
    });

    await seed(mongoose);

    expect(instanceCatalogs(mongoose)).to.have.length(1);
  });

  it("leaves an existing instance catalog alone", async function () {
    const existing = { type: "instance", name: "Raumbuchung Musterstadt" };
    const mongoose = fakeMongoose({
      instances: [{ isInitialized: true, ownerUserIds: ["admin"] }],
      catalogs: [existing],
    });

    await seed(mongoose);

    expect(instanceCatalogs(mongoose)).to.deep.equal([existing]);
  });

  it("does not take a tenant's catalog for the instance's", async function () {
    const mongoose = fakeMongoose({
      catalogs: [{ type: "single", tenantId: "t1", name: "Mandant" }],
    });

    await seed(mongoose);

    expect(instanceCatalogs(mongoose)).to.have.length(1);
    expect(mongoose.models.Catalog.docs).to.have.length(2);
  });
});
