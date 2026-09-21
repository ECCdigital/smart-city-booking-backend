/**
 * The supervision notification outbox in memory: puts an array behind
 * `SupervisionNotificationManager`, with the guarantees of the collection
 * the sender relies on - the unique `dedupeKey`, the claim that only one
 * dispatch of a row wins, the deliveries kept per recipient. Restored by
 * `sinon.restore()`.
 */

const sinon = require("sinon");
const SupervisionNotificationManager = require("../../src/commons/data-managers/supervision-notification-manager");

const clone = (row) => (row ? structuredClone(row) : null);

/**
 * @returns {Object[]} The rows of the outbox, in the order recorded
 */
function installSupervisionOutboxStore() {
  const rows = [];
  let nextId = 1;
  const find = (id) => rows.find((row) => row.id === id) ?? null;

  // Over a world that stubbed the manager already (`route-world.js`).
  for (const name of Object.getOwnPropertyNames(
    SupervisionNotificationManager,
  )) {
    SupervisionNotificationManager[name]?.restore?.();
  }

  sinon
    .stub(SupervisionNotificationManager, "record")
    .callsFake(
      async ({ type, tenantId, payload = {}, createdAt, dedupeKey }) => {
        if (dedupeKey && rows.some((row) => row.dedupeKey === dedupeKey)) {
          const error = new Error(`E11000 duplicate key error: ${dedupeKey}`);
          error.code = 11000;
          throw error;
        }
        const row = {
          id: `N-${nextId++}`,
          type,
          tenantId,
          payload: structuredClone(payload),
          status: "pending",
          attempts: 0,
          lastError: null,
          createdAt: createdAt ?? new Date(),
          sentAt: null,
          deliveries: [],
          dispatchingSince: null,
          dedupeKey,
        };
        rows.push(row);
        return clone(row);
      },
    );
  sinon
    .stub(SupervisionNotificationManager, "get")
    .callsFake(async (id) => clone(find(id)));
  sinon
    .stub(SupervisionNotificationManager, "claimForDispatch")
    .callsFake(async (id, { now, leaseMs }) => {
      const row = find(id);
      const leased =
        row?.dispatchingSince &&
        now.getTime() - row.dispatchingSince.getTime() < leaseMs;
      if (!row || row.status === "sent" || leased) {
        return null;
      }
      row.dispatchingSince = now;
      row.attempts += 1;
      return clone(row);
    });
  sinon
    .stub(SupervisionNotificationManager, "markDelivered")
    .callsFake(async (id, delivery) => {
      find(id).deliveries.push({ ...delivery });
    });
  sinon
    .stub(SupervisionNotificationManager, "markSent")
    .callsFake(async (id, sentAt) => {
      Object.assign(find(id), {
        status: "sent",
        sentAt,
        lastError: null,
        dispatchingSince: null,
      });
      return clone(find(id));
    });
  sinon
    .stub(SupervisionNotificationManager, "markFailed")
    .callsFake(async (id, lastError) => {
      Object.assign(find(id), {
        status: "failed",
        lastError,
        dispatchingSince: null,
      });
      return clone(find(id));
    });
  sinon
    .stub(SupervisionNotificationManager, "list")
    .callsFake(async ({ status, page = 1, pageSize = 50 } = {}) => {
      const safePage = Math.max(1, Number(page) || 1);
      const safePageSize = Math.max(1, Number(pageSize) || 50);
      const matching = rows
        .filter((row) => !status || row.status === status)
        .sort((a, b) => b.createdAt - a.createdAt);
      return {
        items: matching
          .slice((safePage - 1) * safePageSize, safePage * safePageSize)
          .map(clone),
        total: matching.length,
        page: safePage,
        pageSize: safePageSize,
      };
    });

  return rows;
}

module.exports = { installSupervisionOutboxStore };
