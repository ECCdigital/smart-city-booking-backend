const assert = require("assert");
const sinon = require("sinon");
const {
  BookableManager,
} = require("../src/commons/data-managers/bookable-manager");
const BookableModel = require("../src/commons/data-managers/models/bookableModel");

describe("BookableManager.getAncestorBookables", () => {
  afterEach(() => {
    sinon.restore();
  });

  it("returns all ancestors recursively without duplicates or self", async () => {
    const aggregateStub = sinon.stub(BookableModel, "aggregate").returns({
      exec: async () => [
        {
          allAncestors: [
            { id: "parent-1", title: "Parent 1" },
            { id: "grandparent-1", title: "Grandparent 1" },
            { id: "parent-1", title: "Parent 1 Duplicate" },
            { id: "child-1", title: "Child Self" },
          ],
        },
      ],
    });

    sinon
      .stub(BookableModel, "hydrate")
      .callsFake((doc) => ({ toEntity: () => doc }));

    const ancestors = await BookableManager.getAncestorBookables(
      "child-1",
      "tenant-1",
    );

    assert.strictEqual(aggregateStub.calledOnce, true);
    assert.deepStrictEqual(ancestors.map((bookable) => bookable.id).sort(), [
      "grandparent-1",
      "parent-1",
    ]);
  });
});
