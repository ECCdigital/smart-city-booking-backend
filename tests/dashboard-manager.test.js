const assert = require("assert");
const sinon = require("sinon");
const DashboardManager = require("../src/commons/data-managers/dashboard-manager");
const BookingModel = require("../src/commons/data-managers/models/bookingModel");

describe("DashboardManager.aggregateRevenueByTenant", function () {
  let sandbox;

  beforeEach(function () {
    sandbox = sinon.createSandbox();
  });

  afterEach(function () {
    sandbox.restore();
  });

  it("returns invoice revenue and catalog/full regular revenue", async function () {
    const exec = sandbox
      .stub()
      .resolves([{ _id: "demo", revenueEur: 80, regularRevenueEur: 119 }]);
    const aggregate = sandbox.stub(BookingModel, "aggregate").returns({ exec });

    const result = await DashboardManager.aggregateRevenueByTenant({
      tenantIds: ["demo"],
    });

    const pipeline = aggregate.firstCall.args[0];
    const addFields = pipeline.find((stage) => stage.$addFields);
    const group = pipeline.find((stage) => stage.$group);
    assert.ok(addFields.$addFields._regularGrossEur);
    assert.deepStrictEqual(group.$group.regularRevenueEur, {
      $sum: "$_regularGrossEur",
    });
    assert.deepStrictEqual(
      [...result],
      [["demo", { revenueEur: 80, regularRevenueEur: 119 }]],
    );
  });
});
