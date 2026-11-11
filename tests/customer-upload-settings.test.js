/**
 * Customer uploads, settings and upload fields: the tenant enables them
 * and names its formats, a bookable defines upload fields within them and
 * within the instance limits. Every invalid value
 * is refused with a reason of its own.
 */

const { expect } = require("chai");
const sinon = require("sinon");

const {
  TenantController,
} = require("../src/platform/api/controllers/tenant-controller");
const InstanceController = require("../src/platform/api/controllers/instance-controller");
const TenantManager = require("../src/commons/data-managers/tenant-manager");
const InstanceManager = require("../src/commons/data-managers/instance-manager");
const Tenant = require("../src/commons/entities/tenant/tenant");
const Instance = require("../src/commons/entities/instance/instance");
const { Bookable } = require("../src/commons/entities/bookable/bookable");
const {
  assertUploadFieldsStorable,
} = require("../src/commons/services/customer-upload/upload-field-guard");
const {
  customerUploadLimits,
  getUploadFieldDefinitionsError,
  normalizeCustomerUploadSettings,
  normalizeUploadFieldDefinitions,
} = require("../src/commons/services/customer-upload/customer-upload-rules");

function fakeResponse() {
  const res = {};
  res.status = sinon.stub().returns(res);
  res.send = sinon.stub().returns(res);
  res.sendStatus = sinon.stub().returns(res);
  return res;
}

const LIMITS = {
  maxFileSizeMb: 10,
  maxFilesPerBooking: 20,
  maxTotalSizeMbPerBooking: 100,
};

const field = (overrides = {}) => ({
  id: "field-1",
  label: "Vereinsausweis",
  formats: ["pdf"],
  ...overrides,
});

/** The reason the fields are refused for, or null. */
function refusal(fields, tenantSettings = {}) {
  const error = getUploadFieldDefinitionsError(
    normalizeUploadFieldDefinitions(fields),
    normalizeCustomerUploadSettings(tenantSettings),
    LIMITS,
  );
  return error?.code ?? null;
}

describe("customer uploads: settings and upload fields", function () {
  afterEach(function () {
    sinon.restore();
  });

  describe("the tenant's settings", function () {
    it("are off by default, with every format, 30 days and both mails, to no role yet", function () {
      expect(
        new Tenant({ id: "t", name: "Stadt" }).customerUploads,
      ).to.deep.equal({
        enabled: false,
        formats: ["pdf", "jpeg", "png"],
        retentionDays: 30,
        reminderDaysBeforeDeadline: 3,
        notifyOnSubmitted: true,
        notifyOnOverdue: true,
        notifyRoleIds: [],
      });
    });

    it("go public with switch and formats only", function () {
      const tenant = new Tenant({
        id: "t",
        name: "Stadt",
        customerUploads: {
          enabled: true,
          formats: ["pdf"],
          retentionDays: 7,
          reminderDaysBeforeDeadline: 3,
          notifyOnSubmitted: false,
          notifyOnOverdue: true,
        },
      });

      expect(tenant.exportPublic().customerUploads).to.deep.equal({
        enabled: true,
        formats: ["pdf"],
      });
    });

    function update(customerUploads) {
      const tenant = new Tenant({ id: "tenant-1", name: "Stadt" });
      sinon.stub(TenantManager, "getTenant").resolves(tenant);
      const storeTenant = sinon
        .stub(TenantManager, "storeTenant")
        .callsFake(async (value) => value);
      const res = fakeResponse();
      return TenantController.updateTenant(
        { user: { id: "admin-1" }, body: { id: "tenant-1", customerUploads } },
        res,
      ).then(() => ({ tenant, storeTenant, res }));
    }

    it("stores an enabled tenant with a shorter retention", async function () {
      const { tenant, res } = await update({
        enabled: true,
        formats: ["pdf", "png"],
        retentionDays: 14,
      });

      expect(res.status.calledWith(200)).to.equal(true);
      expect(tenant.customerUploads).to.include({
        enabled: true,
        retentionDays: 14,
        reminderDaysBeforeDeadline: 3,
        notifyOnSubmitted: true,
      });
      expect(tenant.customerUploads.formats).to.deep.equal(["pdf", "png"]);
    });

    it("drops a reminder before the deletion: nobody is reminded any more", async function () {
      const { tenant, res } = await update({
        reviewReminderDaysBeforeDeletion: 31,
      });

      expect(res.status.calledWith(200)).to.equal(true);
      expect(tenant.customerUploads).to.not.have.property(
        "reviewReminderDaysBeforeDeletion",
      );
    });

    it("stores the roles of the staff's notices, each once (ECCdigital/tickets#830)", async function () {
      const { tenant, res } = await update({
        notifyRoleIds: ["role-pruefung", "role-leitung", "role-pruefung"],
      });

      expect(res.status.calledWith(200)).to.equal(true);
      expect(tenant.customerUploads.notifyRoleIds).to.deep.equal([
        "role-pruefung",
        "role-leitung",
      ]);
    });

    const refusals = {
      "a retention over 30 days": [
        { retentionDays: 31 },
        "customer_upload_retention_out_of_range",
      ],
      "a format Biletado does not take": [
        { formats: ["pdf", "heic"] },
        "customer_upload_format_not_supported",
      ],
      "enabling without a format": [
        { enabled: true, formats: [] },
        "customer_upload_formats_empty",
      ],
      "a negative reminder": [
        { reminderDaysBeforeDeadline: -1 },
        "customer_upload_reminder_out_of_range",
      ],
      "roles that are no list": [
        { notifyRoleIds: "role-pruefung" },
        "customer_upload_notify_roles_invalid",
      ],
      "an empty role": [
        { notifyRoleIds: [" "] },
        "customer_upload_notify_roles_invalid",
      ],
      "more than ten roles": [
        { notifyRoleIds: Array.from({ length: 11 }, (_, i) => `role-${i}`) },
        "customer_upload_notify_roles_invalid",
      ],
      "a mail switch that is no boolean": [
        { notifyOnOverdue: "yes" },
        "customer_upload_settings_invalid",
      ],
    };
    for (const [name, [settings, code]] of Object.entries(refusals)) {
      it(`refuses ${name} with 400 ${code}`, async function () {
        const { storeTenant, res } = await update(settings);

        expect(res.status.calledWith(400)).to.equal(true);
        expect(res.send.firstCall.args[0].code).to.equal(code);
        expect(storeTenant.called).to.equal(false);
      });
    }
  });

  describe("an upload field of a bookable", function () {
    it("gets a stable id and its defaults", function () {
      const [stored] = normalizeUploadFieldDefinitions([
        { label: "Ausweis", formats: ["pdf"] },
      ]);

      expect(stored.id).to.be.a("string").and.not.empty;
      expect(stored).to.include({
        hint: "",
        consentText: "",
        required: false,
        maxFileSizeMb: null,
        category: "normal",
        timing: "checkout",
        deadlineDaysBeforeStart: null,
      });
    });

    it("takes one file, whatever number is sent", function () {
      const [stored] = normalizeUploadFieldDefinitions([
        field({ maxFiles: 3 }),
      ]);
      expect(stored).to.not.have.property("maxFiles");
      expect(refusal([stored])).to.equal(null);
    });

    it("keeps an id it already has", function () {
      const [stored] = normalizeUploadFieldDefinitions([field()]);
      expect(stored.id).to.equal("field-1");
    });

    it("has no deadline when uploaded in the checkout", function () {
      const [stored] = normalizeUploadFieldDefinitions([
        field({ timing: "checkout", deadlineDaysBeforeStart: 5 }),
      ]);
      expect(stored.deadlineDaysBeforeStart).to.equal(null);
    });

    it("takes every property of the spec", function () {
      expect(
        refusal([
          field({
            hint: "Vorder- und Rückseite",
            consentText: "Ich willige ein.",
            required: true,
            formats: ["pdf", "jpeg"],
            maxFileSizeMb: 5,
            category: "sensitive",
            timing: "afterConfirmation",
            deadlineDaysBeforeStart: 7,
          }),
        ]),
      ).to.equal(null);
    });

    const refusals = {
      "a format outside the tenant's": [
        [field({ formats: ["png"] })],
        { formats: ["pdf"] },
        "upload_field_format_not_allowed",
      ],
      "a size above the instance limit": [
        [field({ maxFileSizeMb: 11 })],
        {},
        "upload_field_max_size_above_instance",
      ],
      "no format": [[field({ formats: [] })], {}, "upload_field_formats_empty"],
      "no label": [[field({ label: " " })], {}, "upload_field_label_required"],
      "an unknown category": [
        [field({ category: "secret" })],
        {},
        "upload_field_category_invalid",
      ],
      "an unknown timing": [
        [field({ timing: "later" })],
        {},
        "upload_field_timing_invalid",
      ],
      "a negative deadline": [
        [field({ timing: "afterConfirmation", deadlineDaysBeforeStart: -1 })],
        {},
        "upload_field_deadline_invalid",
      ],
      "two fields with one id": [
        [field(), field({ label: "Sozialpass" })],
        {},
        "upload_field_duplicate_id",
      ],
    };
    for (const [name, [fields, settings, code]] of Object.entries(refusals)) {
      it(`refuses ${name} with ${code}`, function () {
        expect(refusal(fields, settings)).to.equal(code);
      });
    }

    it("is refused by the bookable write against the stored tenant", async function () {
      sinon.stub(TenantManager, "getTenant").resolves(
        new Tenant({
          id: "tenant-1",
          name: "Stadt",
          customerUploads: { enabled: true, formats: ["pdf"] },
        }),
      );
      const bookable = new Bookable({
        uploadFieldDefinitions: [field({ formats: ["jpeg"] })],
      });

      let thrown;
      try {
        await assertUploadFieldsStorable(bookable, "tenant-1");
      } catch (error) {
        thrown = error;
      }

      expect(thrown?.statusCode).to.equal(400);
      expect(thrown?.code).to.equal("upload_field_format_not_allowed");
    });

    it("asks no tenant for a bookable without upload fields", async function () {
      const getTenant = sinon.stub(TenantManager, "getTenant");

      await assertUploadFieldsStorable(new Bookable({}), "tenant-1");

      expect(getTenant.called).to.equal(false);
    });
  });

  describe("the instance limits", function () {
    const VARIABLES = [
      "CUSTOMER_UPLOAD_MAX_FILE_SIZE_MB",
      "CUSTOMER_UPLOAD_MAX_FILES_PER_BOOKING",
      "CUSTOMER_UPLOAD_MAX_TOTAL_SIZE_MB_PER_BOOKING",
    ];
    let saved;

    beforeEach(function () {
      saved = Object.fromEntries(VARIABLES.map((v) => [v, process.env[v]]));
      VARIABLES.forEach((v) => delete process.env[v]);
    });

    afterEach(function () {
      VARIABLES.forEach((v) => {
        if (saved[v] === undefined) delete process.env[v];
        else process.env[v] = saved[v];
      });
    });

    it("default to 10 MB a file, 20 files and 100 MB a booking", function () {
      expect(customerUploadLimits()).to.deep.equal(LIMITS);
    });

    it("come from variables of their own, apart from the media limits", function () {
      process.env.CUSTOMER_UPLOAD_MAX_FILE_SIZE_MB = "4";

      expect(customerUploadLimits().maxFileSizeMb).to.equal(4);
    });

    it("are answered by the public instance", async function () {
      sinon
        .stub(InstanceManager, "getInstance")
        .resolves(new Instance({ id: "instance", ownerUserIds: ["admin"] }));
      sinon.stub(TenantManager, "hasTenantWithDigitalKeys").resolves(false);
      const res = fakeResponse();

      await InstanceController.getPublicInstance({}, res);

      expect(res.send.firstCall.args[0].customerUploadLimits).to.deep.equal(
        LIMITS,
      );
    });
  });
});
