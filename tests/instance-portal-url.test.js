const { expect } = require("chai");
const sinon = require("sinon");
const castUpdate = require("mongoose/lib/helpers/query/castUpdate");

const InstanceManager = require("../src/commons/data-managers/instance-manager");
const InstanceModel = require("../src/commons/data-managers/models/instanceModel");
const {
  InstanceCache,
} = require("../src/commons/services/instance/instance-cache");

const PORTAL_URL = "https://portal.example.org";
const LEGACY_URL = "https://legacy.example.org";

describe("the Portal-URL and its legacy twin `catalogUrl`", function () {
  describe("on the way in", function () {
    let update;
    let unset;

    beforeEach(function () {
      update = null;
      unset = null;

      const raw = {
        bookableCustomFields: [],
        toEntity: () => ({ bookableCustomFields: [] }),
      };

      sinon.stub(InstanceModel, "findOne").resolves(raw);
      sinon
        .stub(InstanceModel, "findOneAndUpdate")
        .callsFake(async (filter, written) => {
          update = written;
          return raw;
        });
      sinon
        .stub(InstanceModel.collection, "updateOne")
        .callsFake(async (filter, written) => {
          unset = written.$unset;
        });
    });

    afterEach(function () {
      sinon.restore();
    });

    it("keeps an emptied Portal-URL empty and removes the legacy field with it", async function () {
      await InstanceManager.updateInstance({
        portalUrl: "",
        catalogUrl: LEGACY_URL,
      });

      expect(update.$set.portalUrl).to.equal("");
      expect(unset).to.deep.equal({ catalogUrl: "" });
    });

    it("fills an absent Portal-URL from the legacy field", async function () {
      await InstanceManager.updateInstance({ catalogUrl: LEGACY_URL });

      expect(update.$set.portalUrl).to.equal(LEGACY_URL);
      expect(update.$set.catalogUrl).to.equal(LEGACY_URL);
      expect(unset).to.equal(null);
    });

    it("mirrors a Portal-URL into the legacy field", async function () {
      await InstanceManager.updateInstance({
        portalUrl: PORTAL_URL,
        catalogUrl: LEGACY_URL,
      });

      expect(update.$set.portalUrl).to.equal(PORTAL_URL);
      expect(update.$set.catalogUrl).to.equal(PORTAL_URL);
      expect(unset).to.equal(null);
    });

    it("removes the legacy field where the model write cannot reach it", async function () {
      await InstanceManager.updateInstance({
        portalUrl: "",
        catalogUrl: LEGACY_URL,
      });

      // The reason the removal does not travel in the model write: strict mode
      // drops a non-schema path from `$set` and `$unset` alike. Were that ever
      // to change, the separate collection write could go.
      const cast = castUpdate(
        InstanceModel.schema,
        { $set: { portalUrl: "" }, $unset: { catalogUrl: "" } },
        { strict: true },
        InstanceModel,
        {},
      );

      expect(cast.$unset).to.equal(undefined);
      expect(unset).to.deep.equal({ catalogUrl: "" });
    });

    it("leaves a legacy address alone on a write that does not clear it", async function () {
      await InstanceManager.updateInstance({ catalogUrl: LEGACY_URL });

      expect(InstanceModel.collection.updateOne.called).to.equal(false);
    });

    it("leaves the payload it was handed untouched", async function () {
      const body = { portalUrl: "" };

      await InstanceManager.updateInstance(body);

      expect(body).to.deep.equal({ portalUrl: "" });
    });
  });

  describe("on the way out", function () {
    afterEach(function () {
      sinon.restore();
      InstanceCache.invalidate();
    });

    function stubStored(stored) {
      sinon
        .stub(InstanceModel, "findOne")
        .returns({ lean: async () => stored });
    }

    beforeEach(function () {
      InstanceCache.invalidate();
    });

    it("answers an emptied Portal-URL rather than the legacy address", async function () {
      stubStored({
        publicOffersEnabled: true,
        portalUrl: "",
        catalogUrl: LEGACY_URL,
      });

      const portal = await InstanceManager.getPortalConfig();

      expect(portal.portalUrl).to.equal("");
    });

    it("falls back to the legacy address where no Portal-URL was ever stored", async function () {
      stubStored({ enableCatalog: true, catalogUrl: LEGACY_URL });

      const portal = await InstanceManager.getPortalConfig();

      expect(portal.portalUrl).to.equal(LEGACY_URL);
    });
  });
});
