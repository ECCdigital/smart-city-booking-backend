const assert = require("assert");
const sinon = require("sinon");
const EventController = require("../src/platform/api/controllers/event-controller");
const EventManager = require("../src/commons/data-managers/event-manager");
const {
  BookableManager,
} = require("../src/commons/data-managers/bookable-manager");

function responseStub() {
  return {
    status: sinon.stub().returnsThis(),
    send: sinon.stub(),
    sendStatus: sinon.stub(),
  };
}

describe("EventController.getPublicEventTickets", () => {
  afterEach(() => {
    sinon.restore();
  });

  it("returns a bounded page of public event tickets", async () => {
    sinon.stub(EventManager, "getEvent").resolves({ isPublic: true });
    const tickets = [{ id: "ticket-1" }];
    const pageStub = sinon
      .stub(BookableManager, "getPublicEventBookablesPage")
      .resolves({ tickets, total: 11 });
    const response = responseStub();

    await EventController.getPublicEventTickets(
      {
        params: { tenant: "tenant-1", id: "event-1" },
        query: { offset: "5", limit: "100" },
      },
      response,
    );

    assert.deepStrictEqual(pageStub.firstCall.args, [
      "tenant-1",
      "event-1",
      { offset: 5, limit: 50 },
    ]);
    assert.strictEqual(response.status.firstCall.args[0], 200);
    assert.deepStrictEqual(response.send.firstCall.args[0], {
      tickets,
      pagination: { offset: 5, limit: 50, total: 11, hasMore: true },
    });
  });

  it("does not expose tickets for a non-public event", async () => {
    sinon.stub(EventManager, "getEvent").resolves({ isPublic: false });
    const pageStub = sinon.stub(BookableManager, "getPublicEventBookablesPage");
    const response = responseStub();

    await EventController.getPublicEventTickets(
      { params: { tenant: "tenant-1", id: "event-1" }, query: {} },
      response,
    );

    assert.strictEqual(response.sendStatus.firstCall.args[0], 404);
    assert.strictEqual(pageStub.called, false);
  });
});
