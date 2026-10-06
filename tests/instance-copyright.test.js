const { expect } = require("chai");
const sinon = require("sinon");

const InstanceManager = require("../src/commons/data-managers/instance-manager");
const InstanceModel = require("../src/commons/data-managers/models/instanceModel");
const Instance = require("../src/commons/entities/instance/instance");

const RIGHTS_HOLDER = "Stadt Musterstadt";

describe("the Copyright-Vermerk of the instance", function () {
  describe("on the way in", function () {
    let update;

    beforeEach(function () {
      update = null;

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
      sinon.stub(InstanceModel.collection, "updateOne").resolves();
    });

    afterEach(function () {
      sinon.restore();
    });

    it("stores the rights holder trimmed", async function () {
      await InstanceManager.updateInstance({
        copyright: "  Stadt Musterstadt ",
      });

      expect(update.$set.copyright).to.equal(RIGHTS_HOLDER);
    });

    it("stores an emptied Copyright-Vermerk as the empty string", async function () {
      await InstanceManager.updateInstance({ copyright: "" });

      expect(update.$set.copyright).to.equal("");
    });

    async function refused(body) {
      try {
        await InstanceManager.updateInstance(body);
      } catch (error) {
        expect(error.name).to.equal("ValidationError");
        expect(error.statusCode).to.equal(400);
        return error.toJSON();
      }
      throw new Error("expected the instance write to be refused");
    }

    it("refuses 201 characters after trimming as max_length", async function () {
      const refusal = await refused({ copyright: "a".repeat(201) });

      expect(refusal.message).to.equal("validation_failed");
      expect(refusal.details[0].field).to.equal("copyright");
      expect(refusal.details[0].code).to.equal("max_length");
      expect(update).to.equal(null);
    });

    it("accepts 201 characters whose trailing whitespace trims to 200", async function () {
      await InstanceManager.updateInstance({
        copyright: "a".repeat(200) + " ",
      });

      expect(update.$set.copyright).to.equal("a".repeat(200));
    });

    it("refuses a line feed as invalid_format", async function () {
      const refusal = await refused({ copyright: "Stadt\nMusterstadt" });

      expect(refusal.details[0].field).to.equal("copyright");
      expect(refusal.details[0].code).to.equal("invalid_format");
    });

    it("refuses a carriage return as invalid_format", async function () {
      const refusal = await refused({ copyright: "Stadt\rMusterstadt" });

      expect(refusal.details[0].field).to.equal("copyright");
      expect(refusal.details[0].code).to.equal("invalid_format");
    });

    it("refuses a number as invalid_type_string", async function () {
      const refusal = await refused({ copyright: 2026 });

      expect(refusal.details[0].field).to.equal("copyright");
      expect(refusal.details[0].code).to.equal("invalid_type_string");
    });

    it("refuses null as invalid_type_string and never stores it", async function () {
      const refusal = await refused({ copyright: null });

      expect(refusal.details[0].field).to.equal("copyright");
      expect(refusal.details[0].code).to.equal("invalid_type_string");
      expect(update).to.equal(null);
    });
  });

  describe("on the way out", function () {
    it("carries the rights holder in the public export", function () {
      const instance = new Instance({
        copyright: RIGHTS_HOLDER,
        ownerUserIds: ["owner"],
      });

      instance.removePrivateData();
      const exported = instance.exportWithMedia();

      expect(exported.copyright).to.equal(RIGHTS_HOLDER);
      expect(exported.ownerUserIds).to.equal(undefined);
    });

    it("reads an instance stored before the field existed as an empty Copyright-Vermerk", function () {
      const instance = new Instance({ contactUrl: "https://example.org" });

      instance.removePrivateData();
      const exported = instance.exportWithMedia();

      expect(exported.copyright).to.equal("");
    });
  });
});
