/**
 * A ticket an event is created with carries a publication wish: it is
 * submitted for review like any bookable stored with one (tenant
 * supervision spec §4, §6.1).
 */

const { expect } = require("chai");
const sinon = require("sinon");

const EventService = require("../src/commons/services/event-service");
const EventManager = require("../src/commons/data-managers/event-manager");
const {
  BookableManager,
} = require("../src/commons/data-managers/bookable-manager");
const ReviewService = require("../src/commons/services/supervision/review-service");

describe("EventService.createEvent: the ticket's review", function () {
  afterEach(function () {
    sinon.restore();
  });

  it("submits the ticket it creates", async function () {
    sinon.stub(EventManager, "storeEvent").resolves();
    const store = sinon.stub(BookableManager, "storeBookable").resolves();
    const submit = sinon.stub(ReviewService, "submit").resolves({});

    await EventService.createEvent(
      "t1",
      { information: { name: "Konzert", teaserText: "" } },
      { id: "owner@example.test" },
      true,
    );

    const ticket = store.firstCall.args[0];
    expect(submit.calledOnce).to.be.true;
    expect(submit.firstCall.args[0]).to.include({
      offerType: "bookable",
      tenantId: "t1",
      offerId: ticket.id,
      actorUserId: "owner@example.test",
    });
  });
});
