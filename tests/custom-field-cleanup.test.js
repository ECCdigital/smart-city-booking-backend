const assert = require("assert");
const sinon = require("sinon");
const {
  CustomFieldService,
} = require("../src/commons/services/custom-field/custom-field-service");
const {
  BookableManager,
} = require("../src/commons/data-managers/bookable-manager");
const BookableModel = require("../src/commons/data-managers/models/bookableModel");
const TenantModel = require("../src/commons/data-managers/models/tenantModel");
const InstanceModel = require("../src/commons/data-managers/models/instanceModel");
const TenantManager = require("../src/commons/data-managers/tenant-manager");
const InstanceManager = require("../src/commons/data-managers/instance-manager");

describe("CustomFieldService.getRemovedFieldIds", () => {
  it("returns IDs removed between definition updates", () => {
    const previous = [{ id: "field-a" }, { id: "field-b" }];
    const next = [{ id: "field-b" }, { id: "field-c" }];

    assert.deepStrictEqual(
      CustomFieldService.getRemovedFieldIds(previous, next),
      ["field-a"],
    );
  });

  it("returns an empty array when nothing was removed", () => {
    const definitions = [{ id: "field-a" }];

    assert.deepStrictEqual(
      CustomFieldService.getRemovedFieldIds(definitions, definitions),
      [],
    );
  });
});

describe("BookableManager.removeCustomFieldValues", () => {
  afterEach(() => {
    sinon.restore();
  });

  it("does nothing when fieldIds is empty", async () => {
    const updateManyStub = sinon.stub(BookableModel, "updateMany");

    await BookableManager.removeCustomFieldValues([]);

    assert.strictEqual(updateManyStub.called, false);
  });

  it("removes values from all bookables when no scope is provided", async () => {
    const updateManyStub = sinon.stub(BookableModel, "updateMany").resolves();

    await BookableManager.removeCustomFieldValues(["field-a", "field-b"]);

    assert.strictEqual(updateManyStub.calledOnce, true);
    assert.deepStrictEqual(updateManyStub.firstCall.args[0], {});
    assert.deepStrictEqual(updateManyStub.firstCall.args[1], {
      $pull: {
        customFieldValues: { fieldId: { $in: ["field-a", "field-b"] } },
      },
    });
  });

  it("scopes cleanup to a tenant", async () => {
    const updateManyStub = sinon.stub(BookableModel, "updateMany").resolves();

    await BookableManager.removeCustomFieldValues(["field-a"], {
      tenantId: "tenant-1",
    });

    assert.deepStrictEqual(updateManyStub.firstCall.args[0], {
      tenantId: "tenant-1",
    });
  });

  it("scopes cleanup to a single bookable", async () => {
    const updateManyStub = sinon.stub(BookableModel, "updateMany").resolves();

    await BookableManager.removeCustomFieldValues(["field-a"], {
      tenantId: "tenant-1",
      bookableId: "bookable-1",
    });

    assert.deepStrictEqual(updateManyStub.firstCall.args[0], {
      tenantId: "tenant-1",
      id: "bookable-1",
    });
  });
});

describe("custom field value cleanup on definition delete", () => {
  afterEach(() => {
    sinon.restore();
  });

  it("cleans up bookable values when tenant custom fields are removed", async () => {
    sinon.stub(TenantModel, "findOne").returns({
      lean: async () => ({
        bookableCustomFields: [{ id: "field-a" }, { id: "field-b" }],
      }),
    });
    sinon.stub(TenantModel, "updateOne").resolves();
    const cleanupStub = sinon
      .stub(BookableManager, "removeCustomFieldValues")
      .resolves();

    await TenantManager.storeTenant({
      id: "tenant-1",
      name: "Tenant 1",
      bookableCustomFields: [{ id: "field-b" }],
    });

    assert.strictEqual(cleanupStub.calledOnce, true);
    assert.deepStrictEqual(cleanupStub.firstCall.args[0], ["field-a"]);
    assert.deepStrictEqual(cleanupStub.firstCall.args[1], {
      tenantId: "tenant-1",
    });
  });

  it("cleans up bookable values when instance custom fields are removed", async () => {
    const rawInstance = {
      bookableCustomFields: [{ id: "field-a" }],
      toEntity: () => ({ bookableCustomFields: [{ id: "field-a" }] }),
    };

    sinon.stub(InstanceModel, "findOne").resolves(rawInstance);
    sinon.stub(InstanceModel, "findOneAndUpdate").resolves(rawInstance);
    const cleanupStub = sinon
      .stub(BookableManager, "removeCustomFieldValues")
      .resolves();

    await InstanceManager.updateInstance({
      bookableCustomFields: [],
    });

    assert.strictEqual(cleanupStub.calledOnce, true);
    assert.deepStrictEqual(cleanupStub.firstCall.args[0], ["field-a"]);
    assert.deepStrictEqual(cleanupStub.firstCall.args[1], undefined);
  });

  it("cleans up values on the same bookable when definitions are removed", async () => {
    sinon.stub(BookableModel, "findOne").returns({
      lean: async () => ({
        customFieldDefinitions: [{ id: "field-a" }],
      }),
    });
    sinon.stub(BookableModel, "updateOne").resolves();
    const cleanupStub = sinon
      .stub(BookableManager, "removeCustomFieldValues")
      .resolves();

    await BookableManager.storeBookable({
      id: "bookable-1",
      tenantId: "tenant-1",
      type: "room",
      title: "Room 1",
      customFieldDefinitions: [],
    });

    assert.strictEqual(cleanupStub.calledOnce, true);
    assert.deepStrictEqual(cleanupStub.firstCall.args[0], ["field-a"]);
    assert.deepStrictEqual(cleanupStub.firstCall.args[1], {
      tenantId: "tenant-1",
      bookableId: "bookable-1",
    });
  });
});
