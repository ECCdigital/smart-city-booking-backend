/**
 * The migration that renames `location.address.post_code` to
 * `location.address.postcode` on events and bookables
 * (ECCdigital/tickets#373). Runs over stubbed models, no database.
 */

const { expect } = require("chai");
const sinon = require("sinon");

const migration = require("../migrations/scripts/09-10-2026-rename-location-postcode");

describe("09-10-2026-rename-location-postcode migration", function () {
  afterEach(function () {
    sinon.restore();
  });

  function model() {
    return { updateMany: sinon.stub().resolves({ modifiedCount: 1 }) };
  }

  function fakeMongoose() {
    const models = { Event: model(), Bookable: model() };
    return { models, model: (name) => models[name] };
  }

  describe("up", function () {
    for (const name of ["Event", "Bookable"]) {
      it(`drops post_code on ${name}s that already carry a postcode`, async function () {
        const mongoose = fakeMongoose();

        await migration.up(mongoose);

        expect(mongoose.models[name].updateMany.firstCall.args).to.deep.equal([
          {
            "location.address.post_code": { $exists: true },
            "location.address.postcode": { $nin: [null, ""] },
          },
          { $unset: { "location.address.post_code": "" } },
          { strict: false },
        ]);
      });

      it(`then renames post_code to postcode on ${name}s`, async function () {
        const mongoose = fakeMongoose();

        await migration.up(mongoose);

        expect(mongoose.models[name].updateMany.secondCall.args).to.deep.equal([
          { "location.address.post_code": { $exists: true } },
          {
            $rename: {
              "location.address.post_code": "location.address.postcode",
            },
          },
          { strict: false },
        ]);
      });
    }
  });

  describe("down", function () {
    for (const name of ["Event", "Bookable"]) {
      it(`renames postcode back to post_code on ${name}s`, async function () {
        const mongoose = fakeMongoose();

        await migration.down(mongoose);

        expect(mongoose.models[name].updateMany.firstCall.args).to.deep.equal([
          { "location.address.postcode": { $exists: true } },
          {
            $rename: {
              "location.address.postcode": "location.address.post_code",
            },
          },
          { strict: false },
        ]);
      });
    }
  });
});
