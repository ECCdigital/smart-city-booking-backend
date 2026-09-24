/**
 * The two routes of the supervision notification outbox (tenant
 * supervision spec §8) over the lifecycle harness: the instance owner
 * lists the occasions - the failed ones to see what did not go out - and
 * dispatches one again. Nobody else reaches either.
 */

const { expect } = require("chai");
const sinon = require("sinon");

const {
  installHarness,
  bookable,
  TENANT,
  ADMIN,
  OWNER,
  ROLE_HOLDER,
} = require("./helpers/booking-lifecycle-harness");
const { installRouteWorld, FIXTURE_ID } = require("./helpers/route-world");
const {
  installSupervisionOutboxStore,
} = require("./helpers/supervision-outbox-store");
const SupervisionNotificationManager = require("../src/commons/data-managers/supervision-notification-manager");
const SupervisionNotificationService = require("../src/commons/services/supervision/supervision-notification-service");
const SupervisionHistoryManager = require("../src/commons/data-managers/supervision-history-manager");

const LIST = "/instances/supervision/notifications";

describe("supervision notification routes", function () {
  this.timeout(20000);

  let h;
  let rows;

  before(async function () {
    h = await installHarness({
      bookables: {
        [FIXTURE_ID]: bookable({
          id: FIXTURE_ID,
          title: "Fixture",
          ownerUserId: ROLE_HOLDER,
        }),
      },
    });
    installRouteWorld({
      tenantId: TENANT,
      tenant: h.tenant,
      ownerUserId: ROLE_HOLDER,
      bookables: h.bookables,
    });
  });

  after(async function () {
    sinon.restore();
    await h.close();
  });

  /** Three occasions: the oldest sent, the middle one failed, the newest pending. */
  beforeEach(async function () {
    rows = installSupervisionOutboxStore();
    for (const [day, status, lastError] of [
      [1, "sent", null],
      [2, "failed", "otto@example.test: connection refused"],
      [3, "pending", null],
    ]) {
      await SupervisionNotificationManager.record({
        type: "tenant.levelChanged",
        tenantId: TENANT,
        payload: { tenantName: "Verein", from: "free", to: "pending" },
        createdAt: new Date(Date.UTC(2026, 8, day)),
      });
      Object.assign(rows.at(-1), { status, lastError });
    }
    SupervisionHistoryManager.insert.resetHistory();
  });

  const call = (method, path, userId) => {
    let req = h.api()[method](`/api${path}`);
    if (userId) req = req.set(h.as(userId));
    return req;
  };

  describe(`GET /api${LIST}`, function () {
    it("answers the occasions to the instance owner, newest first, paginated", async function () {
      const res = await call("get", `${LIST}?page=1&pageSize=2`, ADMIN);

      expect(res.status).to.equal(200);
      expect(res.body).to.include({ total: 3, page: 1, pageSize: 2 });
      expect(res.body.items.map((row) => row.status)).to.deep.equal([
        "pending",
        "failed",
      ]);
    });

    it("narrows to the failed ones with their error", async function () {
      const res = await call("get", `${LIST}?status=failed`, ADMIN);

      expect(res.status).to.equal(200);
      expect(res.body.total).to.equal(1);
      expect(res.body.items[0]).to.include({
        id: "N-2",
        status: "failed",
        lastError: "otto@example.test: connection refused",
      });
    });

    it("refuses an unknown status", async function () {
      const res = await call("get", `${LIST}?status=lost`, ADMIN);

      expect(res.status).to.equal(400);
    });

    it("refuses the tenant owner, a role holder and the anonymous", async function () {
      expect((await call("get", LIST, OWNER)).status).to.equal(403);
      expect((await call("get", LIST, ROLE_HOLDER)).status).to.equal(403);
      expect((await call("get", LIST, null)).status).to.equal(401);
    });
  });

  describe(`POST /api${LIST}/:id/retry`, function () {
    it("dispatches a failed row again and answers it, without any history", async function () {
      const retry = sinon
        .stub(SupervisionNotificationService, "dispatch")
        .callsFake(async (id) => {
          const row = rows.find((entry) => entry.id === id);
          Object.assign(row, { status: "sent", lastError: null });
          return { ...row };
        });

      const res = await call("post", `${LIST}/N-2/retry`, ADMIN);
      retry.restore();

      expect(res.status).to.equal(200);
      expect(res.body).to.include({ id: "N-2", status: "sent" });
      expect(rows).to.have.length(3);
      expect(SupervisionHistoryManager.insert.called).to.be.false;
    });

    it("answers 409 for a row already sent and 404 for an unknown one", async function () {
      expect((await call("post", `${LIST}/N-1/retry`, ADMIN)).status).to.equal(
        409,
      );
      expect((await call("post", `${LIST}/N-9/retry`, ADMIN)).status).to.equal(
        404,
      );
    });

    it("refuses the tenant owner, a role holder and the anonymous", async function () {
      const path = `${LIST}/N-2/retry`;
      expect((await call("post", path, OWNER)).status).to.equal(403);
      expect((await call("post", path, ROLE_HOLDER)).status).to.equal(403);
      expect((await call("post", path, null)).status).to.equal(401);
      expect(rows[1].status).to.equal("failed");
    });
  });
});
