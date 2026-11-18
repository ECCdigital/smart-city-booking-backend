const assert = require("assert");
const sinon = require("sinon");
const {
  BookableManager,
} = require("../src/commons/data-managers/bookable-manager");
const BookableModel = require("../src/commons/data-managers/models/bookableModel");

describe("BookableManager.removeBookable", () => {
  afterEach(() => {
    sinon.restore();
  });

  it("deletes the bookable within its tenant", async () => {
    const deleteOneStub = sinon.stub(BookableModel, "deleteOne").resolves();
    sinon.stub(BookableModel, "updateMany").resolves();

    await BookableManager.removeBookable("B", "t1");

    assert.strictEqual(deleteOneStub.calledOnce, true);
    assert.deepStrictEqual(deleteOneStub.firstCall.args[0], {
      id: "B",
      tenantId: "t1",
    });
  });

  it("pulls references to the bookable from checkoutBookableIds of the tenant's bookables", async () => {
    const deleteOneStub = sinon.stub(BookableModel, "deleteOne").resolves();
    const updateManyStub = sinon.stub(BookableModel, "updateMany").resolves();

    await BookableManager.removeBookable("B", "t1");

    assert.strictEqual(updateManyStub.calledOnce, true);
    assert.ok(updateManyStub.calledAfter(deleteOneStub));
    assert.deepStrictEqual(updateManyStub.firstCall.args[0], {
      tenantId: "t1",
      "checkoutBookableIds.bookableId": "B",
    });
    // Matches optional and mandatory entries alike; other entries stay.
    assert.deepStrictEqual(updateManyStub.firstCall.args[1], {
      $pull: { checkoutBookableIds: { bookableId: "B" } },
    });
  });
});
