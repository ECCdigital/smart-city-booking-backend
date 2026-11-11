/**
 * The instance's settings of customer uploads: whether tenants may use them
 * at all, and the limits below the ceilings of the environment. Stored by
 * the instance owner, refused out of range, kept where a write does not
 * name them; the public instance carries the limits and the ceilings.
 */

const { expect } = require("chai");
const sinon = require("sinon");

const InstanceManager = require("../src/commons/data-managers/instance-manager");
const InstanceModel = require("../src/commons/data-managers/models/instanceModel");
const TenantModel = require("../src/commons/data-managers/models/tenantModel");
const {
  customerUploadCeilings,
  customerUploadLimits,
  effectiveCustomerUploadSettings,
  getInstanceCustomerUploadsError,
  normalizeInstanceCustomerUploads,
} = require("../src/commons/services/customer-upload/customer-upload-rules");

const ENV = [
  "CUSTOMER_UPLOAD_MAX_FILE_SIZE_MB",
  "CUSTOMER_UPLOAD_MAX_FILES_PER_BOOKING",
  "CUSTOMER_UPLOAD_MAX_TOTAL_SIZE_MB_PER_BOOKING",
];

describe("the instance's settings of customer uploads", function () {
  const env = {};

  beforeEach(function () {
    for (const name of ENV) {
      env[name] = process.env[name];
      delete process.env[name];
    }
  });

  afterEach(function () {
    for (const name of ENV) {
      if (env[name] === undefined) delete process.env[name];
      else process.env[name] = env[name];
    }
  });

  describe("the limits", function () {
    it("are the ceilings where the instance sets none", function () {
      expect(customerUploadLimits(null)).to.deep.equal(
        customerUploadCeilings(),
      );
      expect(
        customerUploadLimits(normalizeInstanceCustomerUploads({})),
      ).to.deep.equal({
        maxFileSizeMb: 10,
        maxFilesPerBooking: 20,
        maxTotalSizeMbPerBooking: 100,
      });
    });

    it("are the instance's below the ceilings, the ceilings above them", function () {
      process.env.CUSTOMER_UPLOAD_MAX_FILES_PER_BOOKING = "8";

      expect(
        customerUploadLimits({
          maxFileSizeMb: 4,
          maxFilesPerBooking: 12,
          maxTotalSizeMbPerBooking: null,
        }),
      ).to.deep.equal({
        maxFileSizeMb: 4,
        maxFilesPerBooking: 8,
        maxTotalSizeMbPerBooking: 100,
      });
    });
  });

  describe("the switch", function () {
    const tenantOn = { enabled: true, formats: ["pdf"] };

    it("holds the tenant's off while the instance has them off", function () {
      expect(
        effectiveCustomerUploadSettings(tenantOn, { enabled: false }).enabled,
      ).to.equal(false);
      expect(effectiveCustomerUploadSettings(tenantOn, null).enabled).to.equal(
        false,
      );
    });

    it("leaves the tenant's settings as they are while the instance has them on", function () {
      const settings = effectiveCustomerUploadSettings(tenantOn, {
        enabled: true,
      });
      expect(settings).to.include({ enabled: true });
      expect(settings.formats).to.deep.equal(["pdf"]);
    });
  });

  describe("the checks", function () {
    const valid = {
      enabled: true,
      maxFileSizeMb: null,
      maxFilesPerBooking: null,
      maxTotalSizeMbPerBooking: null,
    };

    it("pass the defaults and limits up to the ceiling", function () {
      expect(
        getInstanceCustomerUploadsError(normalizeInstanceCustomerUploads({})),
      ).to.equal(null);
      expect(
        getInstanceCustomerUploadsError({
          ...valid,
          maxFileSizeMb: 10,
          maxFilesPerBooking: 1,
          maxTotalSizeMbPerBooking: 100,
        }),
      ).to.equal(null);
    });

    it("refuse a switch that is not a yes or no", function () {
      const error = getInstanceCustomerUploadsError({
        ...valid,
        enabled: "yes",
      });
      expect(error.statusCode).to.equal(400);
    });

    for (const value of [0, -1, 1.5, "5", 11]) {
      it(`refuse ${JSON.stringify(value)} as the largest file`, function () {
        const error = getInstanceCustomerUploadsError({
          ...valid,
          maxFileSizeMb: value,
        });
        expect(error.statusCode).to.equal(400);
        expect(error.message).to.equal("customer_upload_limit_out_of_range");
      });
    }

    it("refuse a limit above a lowered ceiling", function () {
      process.env.CUSTOMER_UPLOAD_MAX_FILES_PER_BOOKING = "3";
      expect(
        getInstanceCustomerUploadsError({ ...valid, maxFilesPerBooking: 4 }),
      ).to.not.equal(null);
    });

    it("drop what is not a setting", function () {
      expect(
        normalizeInstanceCustomerUploads({ enabled: true, other: 1 }),
      ).to.deep.equal(valid);
    });
  });

  describe("on the way in", function () {
    let update;
    let stored;

    beforeEach(function () {
      update = null;
      stored = {
        bookableCustomFields: [],
        customerUploads: {
          ...normalizeInstanceCustomerUploads({}),
          enabled: true,
          maxFileSizeMb: 5,
        },
      };
      const raw = () => ({ ...stored, toEntity: () => ({ ...stored }) });
      sinon.stub(InstanceModel, "findOne").callsFake(async () => raw());
      sinon
        .stub(InstanceModel, "findOneAndUpdate")
        .callsFake(async (filter, written) => {
          update = written;
          return raw();
        });
      sinon.stub(InstanceModel.collection, "updateOne").resolves();
      for (const name of ["updateOne", "updateMany", "findOneAndUpdate"]) {
        sinon.stub(TenantModel, name).resolves(null);
      }
    });

    afterEach(function () {
      sinon.restore();
    });

    it("stores the settings as given over the defaults", async function () {
      await InstanceManager.updateInstance({
        customerUploads: { enabled: true, maxFilesPerBooking: 4 },
      });

      expect(update.$set.customerUploads).to.deep.equal({
        enabled: true,
        maxFileSizeMb: null,
        maxFilesPerBooking: 4,
        maxTotalSizeMbPerBooking: null,
      });
    });

    it("keeps the stored settings where a write does not name them", async function () {
      await InstanceManager.updateInstance({});

      expect(update.$set.customerUploads).to.deep.equal(stored.customerUploads);
    });

    it("refuses a limit out of range and writes nothing", async function () {
      let refused = null;
      try {
        await InstanceManager.updateInstance({
          customerUploads: { enabled: true, maxFileSizeMb: 11 },
        });
      } catch (error) {
        refused = error;
      }

      expect(refused?.message).to.equal("customer_upload_limit_out_of_range");
      expect(update).to.equal(null);
    });
  });
});
