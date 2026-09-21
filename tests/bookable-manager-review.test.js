/**
 * The review at the bookable manager (tenant supervision spec §3, §4):
 * the conditional write of a transition, and a whole-bookable write that
 * carries the review on insert only.
 */

const { expect } = require("chai");
const sinon = require("sinon");

const {
  BookableManager,
} = require("../src/commons/data-managers/bookable-manager");
const BookableModel = require("../src/commons/data-managers/models/bookableModel");
const { Bookable } = require("../src/commons/entities/bookable/bookable");

const pending = {
  status: "pending",
  submittedAt: new Date("2026-09-21T10:00:00.000Z"),
  decidedAt: null,
  decidedBy: null,
  reason: null,
};

describe("BookableManager: the review", function () {
  afterEach(function () {
    sinon.restore();
  });

  it("writes the review only onto the expected status of the tenant's bookable", async function () {
    const find = sinon.stub(BookableModel, "findOneAndUpdate").resolves({
      toEntity: () =>
        new Bookable({ id: "b1", tenantId: "t1", review: pending }),
    });

    const updated = await BookableManager.updateReview({
      tenantId: "t1",
      id: "b1",
      expectedStatus: null,
      review: pending,
    });

    expect(find.firstCall.args[0]).to.deep.equal({
      id: "b1",
      tenantId: "t1",
      "review.status": null,
    });
    expect(find.firstCall.args[1]).to.deep.equal({ $set: { review: pending } });
    expect(updated.review.status).to.equal("pending");
  });

  it("answers null when the status moved underneath", async function () {
    sinon.stub(BookableModel, "findOneAndUpdate").resolves(null);

    expect(
      await BookableManager.updateReview({
        tenantId: "t1",
        id: "b1",
        expectedStatus: "approved",
        review: pending,
      }),
    ).to.equal(null);
  });

  it("lists the tenant's offers at one review status, longest waiting first", async function () {
    const sort = sinon.stub().resolves([
      {
        toEntity: () =>
          new Bookable({
            id: "b1",
            tenantId: "t1",
            title: "Saal",
            type: "room",
            review: pending,
          }),
      },
    ]);
    const find = sinon.stub(BookableModel, "find").returns({ sort });

    const offers = await BookableManager.getOffersByReviewStatus(
      "t1",
      "pending",
    );

    expect(find.firstCall.args[0]).to.deep.equal({
      tenantId: "t1",
      "review.status": "pending",
    });
    expect(sort.firstCall.args[0]).to.deep.equal({
      "review.submittedAt": 1,
      id: 1,
    });
    expect(offers.map((offer) => offer.id)).to.deep.equal(["b1"]);
    expect(offers[0]).to.be.instanceOf(Bookable);
  });

  describe("storeBookable", function () {
    let updateOne;

    const store = async (existing) => {
      sinon
        .stub(BookableModel, "findOne")
        .returns({ lean: async () => existing });
      updateOne = sinon.stub(BookableModel, "updateOne").resolves({});
      await BookableManager.storeBookable(
        new Bookable({
          id: "b1",
          tenantId: "t1",
          title: "Saal",
          type: "room",
          review: { ...pending, status: "approved" },
        }),
      );
      return updateOne.firstCall.args[1];
    };

    it("leaves the review of an existing bookable alone", async function () {
      const update = await store({ customFieldDefinitions: [] });

      expect(update).to.not.have.property("review");
      expect(update.title).to.equal("Saal");
    });

    it("carries the review on insert", async function () {
      const update = await store(null);

      expect(update.review.status).to.equal("approved");
    });
  });
});
