/**
 * The level change of a tenant (tenant supervision spec §2, §6.2, §8):
 * validated, written conditionally, followed by one history row and one
 * notification occasion - and a no-op when the level is already effective.
 * The managers are the database boundary and are stubbed.
 */

const { expect } = require("chai");
const sinon = require("sinon");

const TenantManager = require("../src/commons/data-managers/tenant-manager");
const SupervisionHistoryManager = require("../src/commons/data-managers/supervision-history-manager");
const SupervisionNotificationManager = require("../src/commons/data-managers/supervision-notification-manager");
const {
  BookableManager,
} = require("../src/commons/data-managers/bookable-manager");
const EventManager = require("../src/commons/data-managers/event-manager");
const SupervisionService = require("../src/commons/services/supervision/supervision-service");
const {
  BadRequestError,
  NotFoundError,
  ConflictError,
} = require("../src/errors/BaseError");

const NOW = new Date("2026-09-21T10:00:00.000Z");

/** The error a promise rejects with; fails when it resolves. */
async function rejection(promise) {
  try {
    await promise;
  } catch (err) {
    return err;
  }
  throw new Error("expected a rejection");
}

describe("SupervisionService.changeTenantLevel", function () {
  let history;
  let outbox;
  let tenant;
  /** The offers of the tenant, by type; the manager fakes filter them. */
  let bookables;
  let events;

  const byStatus = (offers) => async (tenantId, status) =>
    tenantId === "t1"
      ? offers.filter((offer) => offer.review.status === status)
      : [];

  beforeEach(function () {
    tenant = { id: "t1", name: "Verein", supervisionLevel: "free" };
    bookables = [];
    events = [];
    sinon
      .stub(BookableManager, "getOffersByReviewStatus")
      .callsFake((...args) => byStatus(bookables)(...args));
    sinon
      .stub(EventManager, "getOffersByReviewStatus")
      .callsFake((...args) => byStatus(events)(...args));
    sinon.stub(TenantManager, "getTenant").callsFake(async () => tenant);
    sinon
      .stub(TenantManager, "updateSupervisionLevel")
      .callsFake(async ({ tenantId, from, to, changedAt }) => {
        // As the manager does it: a missing level is `free`.
        const current = tenant.supervisionLevel ?? "free";
        if (tenant.id !== tenantId || current !== from) {
          return null;
        }
        tenant = {
          ...tenant,
          supervisionLevel: to,
          supervisionChangedAt: changedAt,
        };
        return tenant;
      });
    history = sinon
      .stub(SupervisionHistoryManager, "insert")
      .callsFake(async (row) => ({ id: "h1", ...row }));
    outbox = sinon
      .stub(SupervisionNotificationManager, "record")
      .callsFake(async (row) => ({ id: "n1", ...row }));
  });

  afterEach(function () {
    sinon.restore();
  });

  it("sets a free tenant pending, with a history row and a notification occasion", async function () {
    const result = await SupervisionService.changeTenantLevel({
      tenantId: "t1",
      level: "pending",
      reason: "Spam",
      actorUserId: "owner@example.test",
      now: NOW,
    });

    expect(result).to.deep.equal({
      supervisionLevel: "pending",
      supervisionChangedAt: NOW,
    });
    expect(history.calledOnce).to.be.true;
    expect(history.firstCall.args[0]).to.include({
      tenantId: "t1",
      eventType: "tenant.levelChanged",
      from: "free",
      to: "pending",
      reason: "Spam",
      origin: "api",
    });
    expect(history.firstCall.args[0].actor).to.deep.equal({
      type: "user",
      userId: "owner@example.test",
    });
    expect(history.firstCall.args[0].occurredAt).to.equal(NOW);
    expect(outbox.calledOnce).to.be.true;
    expect(outbox.firstCall.args[0]).to.include({
      type: "tenant.levelChanged",
      tenantId: "t1",
    });
    expect(outbox.firstCall.args[0].payload).to.include({
      from: "free",
      to: "pending",
      reason: "Spam",
      actorUserId: "owner@example.test",
    });
  });

  it("accepts supervised as a level", async function () {
    const result = await SupervisionService.changeTenantLevel({
      tenantId: "t1",
      level: "supervised",
      actorUserId: "owner@example.test",
      now: NOW,
    });

    expect(result.supervisionLevel).to.equal("supervised");
    expect(history.firstCall.args[0].reason).to.equal(null);
  });

  describe("the queue entry of the offers already pending", function () {
    const SUBMITTED = new Date("2026-09-10T08:00:00.000Z");
    const LATER = new Date("2026-09-12T08:00:00.000Z");
    const review = (status, submittedAt = null) => ({
      status,
      submittedAt,
      decidedAt: null,
      decidedBy: null,
      reason: null,
    });
    const queueRows = () =>
      outbox
        .getCalls()
        .map((call) => call.args[0])
        .filter((row) => row.type === "review.queueEntered");

    beforeEach(function () {
      bookables = [
        {
          id: "b1",
          title: "Saal",
          isPublic: true,
          review: review("pending", SUBMITTED),
        },
        { id: "b2", title: "Halle", isPublic: true, review: review(null) },
        {
          id: "b3",
          title: "Platz",
          isPublic: true,
          review: review("rejected", SUBMITTED),
        },
        {
          id: "b4",
          title: "Raum",
          isPublic: true,
          review: review("approved", SUBMITTED),
        },
      ];
      events = [
        {
          id: "e1",
          information: { name: "Konzert" },
          isPublic: false,
          review: review("pending", LATER),
        },
      ];
    });

    it("a switch to supervised announces every pending offer of both types in one occasion", async function () {
      await SupervisionService.changeTenantLevel({
        tenantId: "t1",
        level: "supervised",
        actorUserId: "owner@example.test",
        now: NOW,
      });

      expect(queueRows()).to.have.length(1);
      const [row] = queueRows();
      expect(row.tenantId).to.equal("t1");
      expect(row.createdAt).to.equal(NOW);
      expect(row.payload).to.deep.equal({
        tenantName: "Verein",
        cause: "tenant.levelChanged",
        offers: [
          {
            offerType: "bookable",
            offerId: "b1",
            title: "Saal",
            submittedAt: SUBMITTED,
            isPublic: true,
          },
          {
            offerType: "event",
            offerId: "e1",
            title: "Konzert",
            submittedAt: LATER,
            isPublic: false,
          },
        ],
      });
      // The level change keeps its own occasion.
      expect(outbox.callCount).to.equal(2);
    });

    it("comes from pending as well", async function () {
      tenant.supervisionLevel = "pending";

      await SupervisionService.changeTenantLevel({
        tenantId: "t1",
        level: "supervised",
        actorUserId: "owner@example.test",
        now: NOW,
      });

      expect(queueRows()).to.have.length(1);
    });

    it("records none when the tenant has no pending offer", async function () {
      bookables = bookables.filter((b) => b.review.status !== "pending");
      events = [];

      await SupervisionService.changeTenantLevel({
        tenantId: "t1",
        level: "supervised",
        actorUserId: "owner@example.test",
        now: NOW,
      });

      expect(queueRows()).to.have.length(0);
      expect(outbox.callCount).to.equal(1);
    });

    it("a switch away from supervised records none", async function () {
      for (const level of ["free", "pending"]) {
        tenant = { ...tenant, supervisionLevel: "supervised" };
        outbox.resetHistory();

        await SupervisionService.changeTenantLevel({
          tenantId: "t1",
          level,
          actorUserId: "owner@example.test",
          now: NOW,
        });

        expect(queueRows()).to.have.length(0);
        expect(outbox.callCount).to.equal(1);
      }
    });

    it("a switch between free and pending records none", async function () {
      await SupervisionService.changeTenantLevel({
        tenantId: "t1",
        level: "pending",
        actorUserId: "owner@example.test",
        now: NOW,
      });

      expect(queueRows()).to.have.length(0);
    });

    it("a repeated switch to supervised records nothing", async function () {
      tenant.supervisionLevel = "supervised";

      await SupervisionService.changeTenantLevel({
        tenantId: "t1",
        level: "supervised",
        actorUserId: "owner@example.test",
        now: NOW,
      });

      expect(outbox.called).to.be.false;
      expect(history.called).to.be.false;
    });

    it("keeps the change when the pending offers cannot be read", async function () {
      BookableManager.getOffersByReviewStatus.callsFake(async () => {
        throw new Error("mongo down");
      });

      const result = await SupervisionService.changeTenantLevel({
        tenantId: "t1",
        level: "supervised",
        actorUserId: "owner@example.test",
        now: NOW,
      });

      expect(result.supervisionLevel).to.equal("supervised");
      expect(history.calledOnce).to.be.true;
      expect(queueRows()).to.have.length(0);
    });

    it("never writes a review", async function () {
      const updateBookable = sinon.stub(BookableManager, "updateReview");
      const updateEvent = sinon.stub(EventManager, "updateReview");

      for (const level of ["supervised", "pending", "free"]) {
        await SupervisionService.changeTenantLevel({
          tenantId: "t1",
          level,
          actorUserId: "owner@example.test",
          now: NOW,
        });
      }

      expect(updateBookable.called).to.be.false;
      expect(updateEvent.called).to.be.false;
    });
  });

  it("is a no-op when the level is already effective", async function () {
    tenant.supervisionLevel = "pending";
    tenant.supervisionChangedAt = new Date("2026-01-01T00:00:00.000Z");

    const result = await SupervisionService.changeTenantLevel({
      tenantId: "t1",
      level: "pending",
      actorUserId: "owner@example.test",
      now: NOW,
    });

    expect(result).to.deep.equal({
      supervisionLevel: "pending",
      supervisionChangedAt: tenant.supervisionChangedAt,
    });
    expect(history.called).to.be.false;
    expect(outbox.called).to.be.false;
  });

  it("reads a tenant without a stored level as free", async function () {
    delete tenant.supervisionLevel;

    await SupervisionService.changeTenantLevel({
      tenantId: "t1",
      level: "pending",
      actorUserId: "owner@example.test",
      now: NOW,
    });

    expect(history.firstCall.args[0].from).to.equal("free");
  });

  it("refuses an unknown level", async function () {
    expect(
      await rejection(
        SupervisionService.changeTenantLevel({
          tenantId: "t1",
          level: "banned",
          actorUserId: "owner@example.test",
        }),
      ),
    ).to.be.instanceOf(BadRequestError);
    expect(history.called).to.be.false;
  });

  it("answers not found for an unknown tenant", async function () {
    tenant = null;

    expect(
      await rejection(
        SupervisionService.changeTenantLevel({
          tenantId: "nope",
          level: "pending",
          actorUserId: "owner@example.test",
        }),
      ),
    ).to.be.instanceOf(NotFoundError);
  });

  it("answers a conflict when the level changed underneath", async function () {
    TenantManager.updateSupervisionLevel.callsFake(async () => null);

    expect(
      await rejection(
        SupervisionService.changeTenantLevel({
          tenantId: "t1",
          level: "pending",
          actorUserId: "owner@example.test",
        }),
      ),
    ).to.be.instanceOf(ConflictError);
    expect(history.called).to.be.false;
    expect(outbox.called).to.be.false;
  });
});

describe("SupervisionService.initialLevelForCreation", function () {
  it("gives an instance owner a free tenant, whatever the instance says", function () {
    expect(
      SupervisionService.initialLevelForCreation({
        instance: { tenantInitialSupervisionLevel: "pending" },
        creatorIsInstanceOwner: true,
      }),
    ).to.equal("free");
  });

  it("gives a self-creation the instance's initial level", function () {
    expect(
      SupervisionService.initialLevelForCreation({
        instance: { tenantInitialSupervisionLevel: "supervised" },
        creatorIsInstanceOwner: false,
      }),
    ).to.equal("supervised");
  });

  it("never starts a tenant declined: a stored declined initial level reads as free", function () {
    expect(
      SupervisionService.initialLevelForCreation({
        instance: { tenantInitialSupervisionLevel: "declined" },
        creatorIsInstanceOwner: false,
      }),
    ).to.equal("free");
  });

  it("defaults to free without an instance setting", function () {
    expect(
      SupervisionService.initialLevelForCreation({
        instance: {},
        creatorIsInstanceOwner: false,
      }),
    ).to.equal("free");
    expect(
      SupervisionService.initialLevelForCreation({
        instance: null,
        creatorIsInstanceOwner: false,
      }),
    ).to.equal("free");
  });
});
