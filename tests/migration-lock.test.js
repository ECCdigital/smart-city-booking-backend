/**
 * The migration runner and its lock (tenant supervision spec §11): one
 * runner at a time migrates, a second one waits and then finds nothing left
 * to do, a lease nobody renews any more can be taken over, and a failing
 * migration gives the lock back.
 */

const { expect } = require("chai");

const { runMigrations } = require("../migrations/migrationsManager");
const { createFakeMongoose } = require("./helpers/fake-mongoose");

const silent = { info() {}, error() {} };

function world(collections = {}) {
  const connection = createFakeMongoose(
    { Migration: [], MigrationLock: [], ...collections },
    { unique: { Migration: ["name"], MigrationLock: ["_id"] } },
  );

  return {
    connection,
    locks: connection.model("MigrationLock").documents,
    applied: () =>
      connection.model("Migration").documents.map((entry) => entry.name),
    options: (overrides = {}) => ({
      migrationModel: connection.model("Migration"),
      lockModel: connection.model("MigrationLock"),
      leaseMs: 200,
      pollMs: 5,
      waitTimeoutMs: 1000,
      logger: silent,
      ...overrides,
    }),
  };
}

function deferred() {
  let resolve;
  const promise = new Promise((res) => {
    resolve = res;
  });
  return { promise, resolve };
}

describe("migration runner: the lock against parallel runs", function () {
  it("runs the pending migrations under the lock and gives it back", async function () {
    const w = world({ Migration: [{ name: "01-01-2025-done" }] });
    const ran = [];
    let heldWhileRunning;
    const migrations = [
      { name: "01-01-2025-done", up: async () => ran.push("done") },
      {
        name: "02-01-2025-next",
        up: async () => {
          heldWhileRunning = w.locks.map((lock) => lock.owner);
          ran.push("next");
        },
      },
    ];

    await runMigrations(
      w.connection,
      w.options({ migrations, ownerId: "runner-a" }),
    );

    expect(ran).to.deep.equal(["next"]);
    expect(heldWhileRunning).to.deep.equal(["runner-a"]);
    expect(w.applied()).to.deep.equal(["01-01-2025-done", "02-01-2025-next"]);
    expect(w.locks).to.deep.equal([]);
  });

  it("makes a second runner wait, and then it finds nothing left to run", async function () {
    const w = world();
    const gate = deferred();
    const started = deferred();
    const events = [];
    const migrations = (runner) => [
      {
        name: "02-01-2025-next",
        up: async () => {
          events.push(`${runner} starts`);
          started.resolve();
          await gate.promise;
          events.push(`${runner} ends`);
        },
      },
    ];

    const first = runMigrations(
      w.connection,
      w.options({ migrations: migrations("a"), ownerId: "runner-a" }),
    );
    await started.promise;
    const second = runMigrations(
      w.connection,
      w.options({ migrations: migrations("b"), ownerId: "runner-b" }),
    ).then(() => events.push("b done"));

    // Longer than a lease: the heartbeat keeps the lock with the first one.
    await new Promise((resolve) => setTimeout(resolve, 450));
    expect(events).to.deep.equal(["a starts"]);
    expect(w.locks.map((lock) => lock.owner)).to.deep.equal(["runner-a"]);

    gate.resolve();
    await Promise.all([first, second]);

    expect(events).to.deep.equal(["a starts", "a ends", "b done"]);
    expect(w.applied()).to.deep.equal(["02-01-2025-next"]);
    expect(w.locks).to.deep.equal([]);
  });

  it("fails clearly, running nothing, when the lock is still held after the wait timeout", async function () {
    const w = world({
      MigrationLock: [
        {
          _id: "migrations",
          owner: "runner-a",
          expiresAt: new Date(Date.now() + 60000).toISOString(),
        },
      ],
    });
    const ran = [];
    const migrations = [
      { name: "02-01-2025-next", up: async () => ran.push(1) },
    ];

    let error;
    await runMigrations(
      w.connection,
      w.options({ migrations, ownerId: "runner-b", waitTimeoutMs: 30 }),
    ).catch((caught) => {
      error = caught;
    });

    expect(error).to.be.an("error");
    expect(error.name).to.equal("MigrationLockTimeoutError");
    expect(error.message).to.include("runner-a");
    expect(ran).to.deep.equal([]);
    expect(w.applied()).to.deep.equal([]);
    // The lock of the other runner is left alone.
    expect(w.locks.map((lock) => lock.owner)).to.deep.equal(["runner-a"]);
  });

  it("takes over a lease that has run out", async function () {
    const w = world({
      MigrationLock: [
        {
          _id: "migrations",
          owner: "runner-dead",
          expiresAt: new Date(Date.now() - 1000).toISOString(),
        },
      ],
    });
    let heldWhileRunning;
    const migrations = [
      {
        name: "02-01-2025-next",
        up: async () => {
          heldWhileRunning = w.locks.map((lock) => lock.owner);
        },
      },
    ];

    await runMigrations(
      w.connection,
      w.options({ migrations, ownerId: "runner-b", waitTimeoutMs: 30 }),
    );

    expect(heldWhileRunning).to.deep.equal(["runner-b"]);
    expect(w.applied()).to.deep.equal(["02-01-2025-next"]);
    expect(w.locks).to.deep.equal([]);
  });

  it("gives the lock back when a migration fails, and records only what succeeded", async function () {
    const w = world();
    const migrations = [
      { name: "01-01-2025-fine", up: async () => {} },
      {
        name: "02-01-2025-broken",
        up: async () => {
          throw new Error("boom");
        },
      },
      { name: "03-01-2025-never", up: async () => {} },
    ];

    let error;
    await runMigrations(w.connection, w.options({ migrations })).catch(
      (caught) => {
        error = caught;
      },
    );

    expect(error?.message).to.equal("boom");
    expect(w.applied()).to.deep.equal(["01-01-2025-fine"]);
    expect(w.locks).to.deep.equal([]);

    // The next runner needs no wait and picks up where the run broke off.
    migrations[1].up = async () => {};
    await runMigrations(
      w.connection,
      w.options({ migrations, waitTimeoutMs: 30 }),
    );
    expect(w.applied()).to.deep.equal([
      "01-01-2025-fine",
      "02-01-2025-broken",
      "03-01-2025-never",
    ]);
  });

  it("stops before the next migration once its lease was taken over", async function () {
    const w = world();
    const ran = [];
    const migrations = [
      {
        name: "01-01-2025-slow",
        up: async () => {
          ran.push("slow");
          // Another runner took the lock over (as after a long stall).
          w.locks[0].owner = "runner-b";
          await new Promise((resolve) => setTimeout(resolve, 60));
        },
      },
      { name: "02-01-2025-next", up: async () => ran.push("next") },
    ];

    let error;
    await runMigrations(
      w.connection,
      w.options({ migrations, ownerId: "runner-a", leaseMs: 30 }),
    ).catch((caught) => {
      error = caught;
    });

    expect(error?.name).to.equal("MigrationLockLostError");
    expect(ran).to.deep.equal(["slow"]);
    // The lock of the runner that took over stays.
    expect(w.locks.map((lock) => lock.owner)).to.deep.equal(["runner-b"]);
  });

  it("counts a lease it could not renew in time as lost, and records nothing under it", async function () {
    const w = world();
    const lockModel = w.connection.model("MigrationLock");
    const ran = [];
    const migrations = [
      {
        name: "01-01-2025-slow",
        up: async () => {
          ran.push("slow");
          // The database stops answering the heartbeat (as in a failover).
          const acquire = lockModel.findOneAndUpdate;
          lockModel.findOneAndUpdate = async (filter, ...rest) => {
            if (filter.owner) throw new Error("no primary");
            return acquire(filter, ...rest);
          };
          await new Promise((resolve) => setTimeout(resolve, 80));
        },
      },
      { name: "02-01-2025-next", up: async () => ran.push("next") },
    ];

    let error;
    await runMigrations(
      w.connection,
      w.options({ migrations, ownerId: "runner-a", leaseMs: 30 }),
    ).catch((caught) => {
      error = caught;
    });

    expect(error?.name).to.equal("MigrationLockLostError");
    expect(ran).to.deep.equal(["slow"]);
    expect(w.applied()).to.deep.equal([]);
  });

  it("reads the lock timing from the environment, with defaults", function () {
    const { lockTiming } = require("../migrations/lib/migration-lock");

    expect(lockTiming({}, {})).to.deep.equal({
      leaseMs: 60000,
      pollMs: 2000,
      waitTimeoutMs: 600000,
    });
    expect(
      lockTiming(
        {},
        {
          MIGRATION_LOCK_LEASE_MS: "30000",
          MIGRATION_LOCK_POLL_MS: "500",
          MIGRATION_LOCK_WAIT_TIMEOUT_MS: "nonsense",
        },
      ),
    ).to.deep.equal({ leaseMs: 30000, pollMs: 500, waitTimeoutMs: 600000 });
  });
});
