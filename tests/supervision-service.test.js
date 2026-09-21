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

  beforeEach(function () {
    tenant = { id: "t1", name: "Verein", supervisionLevel: "free" };
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

  it("blocks a free tenant, with a history row and a notification occasion", async function () {
    const result = await SupervisionService.changeTenantLevel({
      tenantId: "t1",
      level: "blocked",
      reason: "Spam",
      actorUserId: "owner@example.test",
      now: NOW,
    });

    expect(result).to.deep.equal({
      supervisionLevel: "blocked",
      supervisionChangedAt: NOW,
    });
    expect(history.calledOnce).to.be.true;
    expect(history.firstCall.args[0]).to.include({
      tenantId: "t1",
      eventType: "tenant.levelChanged",
      from: "free",
      to: "blocked",
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
      to: "blocked",
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

  it("is a no-op when the level is already effective", async function () {
    tenant.supervisionLevel = "blocked";
    tenant.supervisionChangedAt = new Date("2026-01-01T00:00:00.000Z");

    const result = await SupervisionService.changeTenantLevel({
      tenantId: "t1",
      level: "blocked",
      actorUserId: "owner@example.test",
      now: NOW,
    });

    expect(result).to.deep.equal({
      supervisionLevel: "blocked",
      supervisionChangedAt: tenant.supervisionChangedAt,
    });
    expect(history.called).to.be.false;
    expect(outbox.called).to.be.false;
  });

  it("reads a tenant without a stored level as free", async function () {
    delete tenant.supervisionLevel;

    await SupervisionService.changeTenantLevel({
      tenantId: "t1",
      level: "blocked",
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
          level: "blocked",
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
          level: "blocked",
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
        instance: { tenantInitialSupervisionLevel: "blocked" },
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
