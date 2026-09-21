/**
 * The review at the event manager (tenant supervision spec §3, §4): the
 * conditional write of a transition, and a whole-event write that carries
 * the review on insert only.
 */

const { expect } = require("chai");
const sinon = require("sinon");

const EventManager = require("../src/commons/data-managers/event-manager");
const EventModel = require("../src/commons/data-managers/models/eventModel");
const { Event } = require("../src/commons/entities/event/event");

const pending = {
  status: "pending",
  submittedAt: new Date("2026-09-21T10:00:00.000Z"),
  decidedAt: null,
  decidedBy: null,
  reason: null,
};

describe("EventManager: the review", function () {
  afterEach(function () {
    sinon.restore();
  });

  it("gives a new event an empty review", function () {
    expect(new Event({ id: "e1" }).review).to.deep.equal({
      status: null,
      submittedAt: null,
      decidedAt: null,
      decidedBy: null,
      reason: null,
    });
  });

  it("writes the review only onto the expected status of the tenant's event", async function () {
    const find = sinon.stub(EventModel, "findOneAndUpdate").resolves({
      toEntity: () => new Event({ id: "e1", tenantId: "t1", review: pending }),
    });

    const updated = await EventManager.updateReview({
      tenantId: "t1",
      id: "e1",
      expectedStatus: null,
      review: pending,
    });

    expect(find.firstCall.args[0]).to.deep.equal({
      id: "e1",
      tenantId: "t1",
      "review.status": null,
    });
    expect(find.firstCall.args[1]).to.deep.equal({ $set: { review: pending } });
    expect(updated.review.status).to.equal("pending");
  });

  it("answers null when the status moved underneath", async function () {
    sinon.stub(EventModel, "findOneAndUpdate").resolves(null);

    expect(
      await EventManager.updateReview({
        tenantId: "t1",
        id: "e1",
        expectedStatus: "approved",
        review: pending,
      }),
    ).to.equal(null);
  });

  describe("storeEvent", function () {
    const store = async (existing) => {
      sinon.stub(EventModel, "exists").resolves(existing);
      const updateOne = sinon.stub(EventModel, "updateOne").resolves({});
      await EventManager.storeEvent(
        new Event({
          id: "e1",
          tenantId: "t1",
          information: { name: "Konzert" },
          review: { ...pending, status: "approved" },
        }),
      );
      return updateOne.firstCall.args[1];
    };

    it("leaves the review of an existing event alone", async function () {
      const update = await store({ _id: "x" });

      expect(update).to.not.have.property("review");
      expect(update.information.name).to.equal("Konzert");
    });

    it("carries the review on insert", async function () {
      const update = await store(null);

      expect(update.review.status).to.equal("approved");
    });
  });
});
