const mock = require("mock-require");
const { expect } = require("chai");
const sinon = require("sinon");

describe("OfferBookmarkService", () => {
  let sandbox;
  let OfferBookmarkManager;
  let OfferManager;
  let OfferService;
  let Service;

  beforeEach(() => {
    sandbox = sinon.createSandbox();
    OfferBookmarkManager = {
      getByUser: sandbox.stub().resolves([]),
      add: sandbox.stub().resolves(),
      setNote: sandbox.stub().resolves(),
      remove: sandbox.stub().resolves(),
    };
    OfferManager = { getOffer: sandbox.stub().resolves(null) };
    OfferService = { getPublicOffersByIds: sandbox.stub().resolves([]) };
    mock(
      "../../src/commons/data-managers/offer-bookmark-manager",
      OfferBookmarkManager,
    );
    mock("../../src/commons/data-managers/offer-manager", OfferManager);
    mock("../../src/commons/services/company/offer-service", OfferService);
    Service = mock.reRequire(
      "../../src/commons/services/student/offer-bookmark-service",
    );
  });

  afterEach(() => {
    sandbox.restore();
    mock.stopAll();
  });

  const reject = async (fn) => {
    let err;
    try {
      await fn();
    } catch (e) {
      err = e;
    }
    return err;
  };

  it("listBookmarks hydrates available offers, flags unavailable ones and carries the note", async () => {
    OfferBookmarkManager.getByUser.resolves([
      { offerId: "o1", created: 200, note: "Frist im Blick behalten" },
      { offerId: "o2", created: 100 },
    ]);
    OfferService.getPublicOffersByIds.resolves([
      { id: "o1", title: "Praktikum A", status: "Online" },
    ]);
    const list = await Service.listBookmarks("kielregion", "u@x.de");
    expect(
      OfferBookmarkManager.getByUser.calledWith("kielregion", "u@x.de"),
    ).to.equal(true);
    expect(list).to.have.length(2);
    expect(list[0]).to.deep.equal({
      offerId: "o1",
      savedAt: 200,
      note: "Frist im Blick behalten",
      available: true,
      offer: { id: "o1", title: "Praktikum A", status: "Online" },
    });
    expect(list[1]).to.deep.equal({
      offerId: "o2",
      savedAt: 100,
      note: "",
      available: false,
      offer: null,
    });
  });

  it("addBookmark adds an Online offer (idempotent via the manager)", async () => {
    OfferManager.getOffer.resolves({ id: "o1", status: "Online" });
    const res = await Service.addBookmark("kielregion", "u@x.de", "o1");
    expect(
      OfferBookmarkManager.add.calledWith("kielregion", "u@x.de", "o1"),
    ).to.equal(true);
    expect(OfferBookmarkManager.setNote.called).to.equal(false);
    expect(res).to.deep.equal({ offerId: "o1" });
  });

  it("addBookmark with a note upserts the bookmark and stores the trimmed note", async () => {
    OfferManager.getOffer.resolves({ id: "o1", status: "Online" });
    const res = await Service.addBookmark(
      "kielregion",
      "u@x.de",
      "o1",
      "  bald bewerben  ",
    );
    expect(
      OfferBookmarkManager.setNote.calledWith(
        "kielregion",
        "u@x.de",
        "o1",
        "bald bewerben",
      ),
    ).to.equal(true);
    expect(OfferBookmarkManager.add.called).to.equal(false);
    expect(res).to.deep.equal({ offerId: "o1", note: "bald bewerben" });
  });

  it("addBookmark → 400 when the note exceeds the length limit", async () => {
    OfferManager.getOffer.resolves({ id: "o1", status: "Online" });
    const err = await reject(() =>
      Service.addBookmark("kg", "u@x.de", "o1", "x".repeat(2001)),
    );
    expect(err.status).to.equal(400);
    expect(OfferBookmarkManager.setNote.called).to.equal(false);
  });

  it("setNote upserts the note for an Online offer (owner-scoped)", async () => {
    OfferManager.getOffer.resolves({ id: "o1", status: "Online" });
    const res = await Service.setNote(
      "kielregion",
      "u@x.de",
      "o1",
      "  Termin merken  ",
    );
    expect(
      OfferBookmarkManager.setNote.calledWith(
        "kielregion",
        "u@x.de",
        "o1",
        "Termin merken",
      ),
    ).to.equal(true);
    expect(res).to.deep.equal({ offerId: "o1", note: "Termin merken" });
  });

  it("setNote → 404 when the offer is unknown or not Online", async () => {
    OfferManager.getOffer.resolves(null);
    expect(
      (await reject(() => Service.setNote("kg", "u@x.de", "o1", "x"))).status,
    ).to.equal(404);
    expect(OfferBookmarkManager.setNote.called).to.equal(false);
  });

  it("setNote → 400 when the note exceeds the length limit", async () => {
    OfferManager.getOffer.resolves({ id: "o1", status: "Online" });
    const err = await reject(() =>
      Service.setNote("kg", "u@x.de", "o1", "x".repeat(2001)),
    );
    expect(err.status).to.equal(400);
    expect(OfferBookmarkManager.setNote.called).to.equal(false);
  });

  it("addBookmark → 404 when the offer is unknown or not Online", async () => {
    OfferManager.getOffer.resolves(null);
    expect(
      (await reject(() => Service.addBookmark("kg", "u@x.de", "o1"))).status,
    ).to.equal(404);
    OfferManager.getOffer.resolves({ id: "o2", status: "Archiv" });
    expect(
      (await reject(() => Service.addBookmark("kg", "u@x.de", "o2"))).status,
    ).to.equal(404);
    expect(OfferBookmarkManager.add.called).to.equal(false);
  });

  it("addBookmark → 400 when offerId is missing", async () => {
    expect(
      (await reject(() => Service.addBookmark("kg", "u@x.de", ""))).status,
    ).to.equal(400);
  });

  it("addBookmark coerces a non-string offerId (no NoSQL injection)", async () => {
    const err = await reject(() =>
      Service.addBookmark("kg", "u@x.de", { $ne: null }),
    );
    expect(err.status).to.equal(404);
    expect(OfferManager.getOffer.firstCall.args[1]).to.be.a("string");
  });

  it("removeBookmark removes the user's bookmark", async () => {
    const res = await Service.removeBookmark("kielregion", "u@x.de", "o1");
    expect(
      OfferBookmarkManager.remove.calledWith("kielregion", "u@x.de", "o1"),
    ).to.equal(true);
    expect(res).to.deep.equal({ removed: "o1" });
  });
});

describe("StudentController — bookmarks", () => {
  let sandbox;
  let OfferBookmarkService;
  let StudentController;

  const res = () => ({
    statusCode: null,
    body: undefined,
    status(c) {
      this.statusCode = c;
      return this;
    },
    send(b) {
      this.body = b;
      return this;
    },
  });

  beforeEach(() => {
    sandbox = sinon.createSandbox();
    OfferBookmarkService = {
      listBookmarks: sandbox.stub().resolves([]),
      addBookmark: sandbox.stub().resolves({ offerId: "o1" }),
      setNote: sandbox.stub().resolves({ offerId: "o1", note: "n" }),
      removeBookmark: sandbox.stub().resolves({ removed: "o1" }),
    };
    mock(
      "../../src/commons/services/student/offer-bookmark-service",
      OfferBookmarkService,
    );
    mock("../../src/commons/services/student/student-service", {});
    StudentController = mock.reRequire(
      "../../src/platform/api/controllers/student-controller",
    );
  });

  afterEach(() => {
    sandbox.restore();
    mock.stopAll();
  });

  it("getBookmarks returns 200 for the acting user", async () => {
    const r = res();
    await StudentController.getBookmarks(
      { params: { tenant: "kielregion" }, user: { id: "u@x.de" } },
      r,
    );
    expect(r.statusCode).to.equal(200);
    expect(
      OfferBookmarkService.listBookmarks.calledWith("kielregion", "u@x.de"),
    ).to.equal(true);
  });

  it("addBookmark returns 201 with the JWT user id and forwards the note", async () => {
    const r = res();
    await StudentController.addBookmark(
      {
        params: { tenant: "kielregion" },
        user: { id: "u@x.de" },
        body: { offerId: "o1", note: "bald bewerben" },
      },
      r,
    );
    expect(r.statusCode).to.equal(201);
    expect(
      OfferBookmarkService.addBookmark.calledWith(
        "kielregion",
        "u@x.de",
        "o1",
        "bald bewerben",
      ),
    ).to.equal(true);
  });

  it("setBookmarkNote returns 200 and scopes the note to the JWT user id", async () => {
    const r = res();
    await StudentController.setBookmarkNote(
      {
        params: { tenant: "kielregion", offerId: "o1" },
        user: { id: "u@x.de" },
        body: { note: "Termin merken", userId: "attacker@x.de" },
      },
      r,
    );
    expect(r.statusCode).to.equal(200);
    expect(
      OfferBookmarkService.setNote.calledWith(
        "kielregion",
        "u@x.de",
        "o1",
        "Termin merken",
      ),
    ).to.equal(true);
  });

  it("removeBookmark returns 200 using the JWT user id + path offerId", async () => {
    const r = res();
    await StudentController.removeBookmark(
      {
        params: { tenant: "kielregion", offerId: "o1" },
        user: { id: "u@x.de" },
      },
      r,
    );
    expect(r.statusCode).to.equal(200);
    expect(
      OfferBookmarkService.removeBookmark.calledWith(
        "kielregion",
        "u@x.de",
        "o1",
      ),
    ).to.equal(true);
  });

  it("maps a service error to its status", async () => {
    OfferBookmarkService.addBookmark.rejects({
      message: "Offer not found",
      status: 404,
    });
    const r = res();
    await StudentController.addBookmark(
      { params: { tenant: "kielregion" }, user: { id: "u@x.de" }, body: {} },
      r,
    );
    expect(r.statusCode).to.equal(404);
  });
});

describe("OfferBookmarkManager — removeByOffer", () => {
  let sandbox;
  let captured;
  let Manager;

  beforeEach(() => {
    sandbox = sinon.createSandbox();
    captured = {};
    const FakeModel = {
      deleteMany(query) {
        captured.query = query;
        return Promise.resolve();
      },
    };
    mock(
      "../../src/commons/data-managers/models/offerBookmarkModel",
      FakeModel,
    );
    Manager = mock.reRequire(
      "../../src/commons/data-managers/offer-bookmark-manager",
    );
  });

  afterEach(() => {
    sandbox.restore();
    mock.stopAll();
  });

  it("deletes every bookmark for the offer, scoped to the tenant", async () => {
    await Manager.removeByOffer("kielregion", "o1");
    expect(captured.query).to.deep.equal({
      tenantId: "kielregion",
      offerId: "o1",
    });
  });
});
