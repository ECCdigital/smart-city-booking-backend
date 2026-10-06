/**
 * The supervision notices end to end (tenant supervision spec §8): a
 * submission, a decision and a level change - of a bookable and of an
 * event - over the real services, the in-memory outbox, the mail fixture
 * and the in-memory transport. What is asserted is who gets a mail, that a
 * free, pending or declined tenant and a repeated action cause none, and that a
 * failed send leaves the decision and the history alone.
 */

const { expect } = require("chai");
const sinon = require("sinon");

const ReviewService = require("../src/commons/services/supervision/review-service");
const SupervisionService = require("../src/commons/services/supervision/supervision-service");
const SupervisionNotificationService = require("../src/commons/services/supervision/supervision-notification-service");
const TenantManager = require("../src/commons/data-managers/tenant-manager");
const {
  BookableManager,
} = require("../src/commons/data-managers/bookable-manager");
const EventManager = require("../src/commons/data-managers/event-manager");
const MembershipManager = require("../src/commons/data-managers/membership-manager");
const UserManager = require("../src/commons/data-managers/user-manager");
const SupervisionHistoryManager = require("../src/commons/data-managers/supervision-history-manager");
const {
  installInMemoryMailTransport,
} = require("./helpers/in-memory-mail-transport");
const {
  installSupervisionOutboxStore,
} = require("./helpers/supervision-outbox-store");
const {
  TENANT,
  FRONTEND_URL,
  tenant: tenantFixture,
  instance,
  room,
  concert,
  installMailStackStore,
} = require("./helpers/mail-stack-fixtures");

const INSTANCE_OWNER = "anna@plattform.example.test";
const TENANT_OWNER = "olga@stadthalle.example.test";

const review = (status, overrides = {}) => ({
  status,
  submittedAt: null,
  decidedAt: null,
  decidedBy: null,
  reason: null,
  ...overrides,
});

describe("supervision notices: from the action to the mail", function () {
  let sent;
  let rows;
  let history;
  let tenant;
  let bookables;
  let events;
  let env;

  /** The conditional review write of a manager, over a list. */
  const updateReviewIn =
    (list) =>
    async ({ id, expectedStatus, review: next }) => {
      const offer = list.find((entry) => entry.id === id);
      if (!offer || (offer.review?.status ?? null) !== expectedStatus) {
        return null;
      }
      offer.review = next;
      return structuredClone(offer);
    };
  const byReviewStatus = (list) => async (tenantId, status) =>
    list
      .filter((offer) => (offer.review?.status ?? null) === status)
      .map((offer) => structuredClone(offer));

  function given({ level = "supervised", instanceOptions = {} } = {}) {
    tenant = tenantFixture({ supervisionLevel: level });
    bookables = [room({ isPublic: true, review: review(null) })];
    events = [concert({ review: review(null) })];
    installMailStackStore({
      tenant,
      bookables,
      events,
      instance: instance({
        ownerUserIds: [INSTANCE_OWNER],
        ...instanceOptions,
      }),
    });
    sinon
      .stub(BookableManager, "updateReview")
      .callsFake(updateReviewIn(bookables));
    sinon
      .stub(BookableManager, "getOffersByReviewStatus")
      .callsFake(byReviewStatus(bookables));
    sinon.stub(EventManager, "updateReview").callsFake(updateReviewIn(events));
    sinon
      .stub(EventManager, "getOffersByReviewStatus")
      .callsFake(byReviewStatus(events));
    sinon
      .stub(TenantManager, "updateSupervisionLevel")
      .callsFake(async ({ from, to, changedAt }) => {
        if (tenant.supervisionLevel !== from) return null;
        tenant.supervisionLevel = to;
        tenant.supervisionChangedAt = changedAt;
        return tenant;
      });
    sinon
      .stub(UserManager, "getUsersById")
      .callsFake(async (ids) => ids.map((id) => ({ id })));
    sinon
      .stub(MembershipManager, "getOwnerMembershipsByTenantID")
      .resolves([{ tenantId: TENANT, userId: TENANT_OWNER, owner: true }]);
    history = sinon
      .stub(SupervisionHistoryManager, "insert")
      .callsFake(async (row) => row);
    sent = installInMemoryMailTransport();
    rows = installSupervisionOutboxStore();
  }

  const submit = (offerType, offerId) =>
    ReviewService.submit({
      offerType,
      tenantId: TENANT,
      offerId,
      actorUserId: TENANT_OWNER,
    });
  const decide = (offerType, offerId, action, reason) =>
    ReviewService.decide({
      offerType,
      tenantId: TENANT,
      offerId,
      action,
      reason,
      actorUserId: INSTANCE_OWNER,
    });
  const changeLevel = (level) =>
    SupervisionService.changeTenantLevel({
      tenantId: TENANT,
      level,
      actorUserId: INSTANCE_OWNER,
    });
  const idle = () => SupervisionNotificationService.whenIdle();
  const mails = () => sent.map((mail) => [mail.to, mail.subject]);

  beforeEach(function () {
    env = process.env.FRONTEND_URL;
    process.env.FRONTEND_URL = FRONTEND_URL;
  });

  afterEach(async function () {
    await idle();
    sinon.restore();
    process.env.FRONTEND_URL = env;
  });

  for (const [offerType, offerId, title, label] of [
    ["bookable", "room", "Großer Saal", "Buchungsobjekt"],
    ["event", "concert", "Herbstkonzert", "Veranstaltung"],
  ]) {
    describe(`of a supervised tenant's ${offerType}`, function () {
      it("the submission tells the instance owner, the decision the tenant owner", async function () {
        given();

        await submit(offerType, offerId);
        await idle();
        await decide(offerType, offerId, "approve");
        await idle();

        expect(mails()).to.deep.equal([
          [INSTANCE_OWNER, "Neues Angebot zur Prüfung: Stadthalle Musterstadt"],
          [TENANT_OWNER, `Freigabe: ${label} „${title}“`],
        ]);
        expect(sent[0].html).to.include(title);
        expect(rows.map((row) => row.status)).to.deep.equal(["sent", "sent"]);
      });

      it("a repeated submission of the pending offer causes no new mail", async function () {
        given();
        await submit(offerType, offerId);
        await idle();

        await submit(offerType, offerId);
        await idle();

        expect(rows).to.have.length(1);
        expect(sent).to.have.length(1);
      });
    });
  }

  it("a resubmission after a rejection, without a wish to be published, tells the instance owner again", async function () {
    given();
    bookables[0].isPublic = false;
    await submit("bookable", "room");
    await decide("bookable", "room", "reject", "Unvollständig");
    await idle();
    sent.length = 0;

    await submit("bookable", "room");
    await idle();

    expect(mails()).to.deep.equal([
      [INSTANCE_OWNER, "Neues Angebot zur Prüfung: Stadthalle Musterstadt"],
    ]);
    expect(sent[0].html).to.include("ohne");
    expect(rows).to.have.length(3);
  });

  for (const level of ["free", "pending", "declined"]) {
    it(`a submission at a ${level} tenant records no occasion and sends no review mail`, async function () {
      given({ level });

      await submit("bookable", "room");
      await submit("event", "concert");
      await idle();

      expect(bookables[0].review.status).to.equal("pending");
      expect(rows).to.have.length(0);
      expect(sent).to.have.length(0);
    });
  }

  it("the switch to supervised is one mail to the tenant owner and one collective review mail", async function () {
    given({ level: "free" });
    await submit("bookable", "room");
    await submit("event", "concert");
    await idle();

    await changeLevel("supervised");
    await idle();

    expect(mails()).to.deep.equal([
      [
        TENANT_OWNER,
        "Freigabestufe Ihres Mandanten Stadthalle Musterstadt wurde geändert",
      ],
      [INSTANCE_OWNER, "2 neue Angebote zur Prüfung: Stadthalle Musterstadt"],
    ]);
    expect(sent[1].html).to.include("Großer Saal");
    expect(sent[1].html).to.include("Herbstkonzert");
  });

  it("a repeated level change causes no new mail", async function () {
    given({ level: "free" });
    await changeLevel("pending");
    await idle();

    await changeLevel("pending");
    await idle();

    expect(rows).to.have.length(1);
    expect(sent).to.have.length(1);
  });

  it("a failed send leaves the decision and the history alone, and the retry writes neither", async function () {
    // The transport retries with backoff before it gives up.
    this.timeout(20000);
    given({ instanceOptions: { noreplyHost: "broken" } });
    bookables[0].review = review("pending", { submittedAt: new Date() });

    const decision = await decide(
      "bookable",
      "room",
      "reject",
      "Unvollständig",
    );
    await idle();

    expect(decision.status).to.equal("rejected");
    expect(bookables[0].review.status).to.equal("rejected");
    expect(rows[0].status).to.equal("failed");
    expect(rows[0].lastError).to.include("connection refused");
    expect(history.callCount).to.equal(1);

    await SupervisionNotificationService.retry(rows[0].id);

    expect(history.callCount).to.equal(1);
    expect(rows).to.have.length(1);
    expect(rows[0].attempts).to.equal(2);
    expect(bookables[0].review.status).to.equal("rejected");
  });
});
