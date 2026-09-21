/**
 * The lock of the migration runner (tenant supervision spec §11): a single
 * document in MongoDB that names the runner at work and the end of its lease.
 *
 * - Acquiring is one atomic upsert on the fixed `_id`: it matches only a
 *   lease that has run out, so it either takes that one over, inserts the
 *   first lock, or fails with a duplicate key because another runner holds
 *   it. The `_id` index always exists, so there is no index to wait for.
 * - The holder renews its lease while it runs (heartbeat), so a lease only
 *   runs out when its runner died.
 * - Renewing and releasing are bound to the owner: a runner that lost its
 *   lease never touches the lock of the one that took it over.
 *
 * The lease is compared with the clock of the runner that asks, so the
 * servers' clocks must not drift by more than a fraction of the lease.
 */

const crypto = require("crypto");
const os = require("os");

const LOCK_KEY = "migrations";

const DEFAULTS = Object.freeze({
  leaseMs: 60 * 1000,
  pollMs: 2 * 1000,
  waitTimeoutMs: 10 * 60 * 1000,
});

class MigrationLockTimeoutError extends Error {
  constructor(waitTimeoutMs, holder) {
    super(
      `Migration lock still held by "${holder ?? "unknown"}" after ${waitTimeoutMs} ms - ` +
        "no migration was run by this process. Another runner is still migrating or died " +
        "less than a lease ago; check it before starting again.",
    );
    this.name = "MigrationLockTimeoutError";
  }
}

class MigrationLockLostError extends Error {
  constructor(owner) {
    super(
      `Migration runner "${owner}" lost its lock while running - stopping before the next migration.`,
    );
    this.name = "MigrationLockLostError";
  }
}

function positiveInt(value, fallback) {
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

/**
 * The lock timing: explicit options first, then the environment, then the
 * defaults.
 *
 * @param {Object} [options]
 * @param {Object} [env=process.env]
 * @returns {{leaseMs: number, pollMs: number, waitTimeoutMs: number}}
 */
function lockTiming(options = {}, env = process.env) {
  return {
    leaseMs: positiveInt(
      options.leaseMs ?? env.MIGRATION_LOCK_LEASE_MS,
      DEFAULTS.leaseMs,
    ),
    pollMs: positiveInt(
      options.pollMs ?? env.MIGRATION_LOCK_POLL_MS,
      DEFAULTS.pollMs,
    ),
    waitTimeoutMs: positiveInt(
      options.waitTimeoutMs ?? env.MIGRATION_LOCK_WAIT_TIMEOUT_MS,
      DEFAULTS.waitTimeoutMs,
    ),
  };
}

function defaultOwnerId() {
  return `${os.hostname()}:${process.pid}:${crypto.randomUUID()}`;
}

const isDuplicateKey = (error) => error?.code === 11000;
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function tryAcquire(lockModel, owner, leaseMs) {
  const now = new Date();
  try {
    const lock = await lockModel.findOneAndUpdate(
      { _id: LOCK_KEY, expiresAt: { $lte: now } },
      {
        $set: {
          owner,
          acquiredAt: now,
          heartbeatAt: now,
          expiresAt: new Date(now.getTime() + leaseMs),
        },
      },
      { upsert: true, new: true },
    );
    return lock?.owner === owner;
  } catch (error) {
    // The duplicate `_id`: a lease that has not run out is in the way.
    if (isDuplicateKey(error)) return false;
    throw error;
  }
}

async function renew(lockModel, owner, leaseMs) {
  const now = new Date();
  const lock = await lockModel.findOneAndUpdate(
    { _id: LOCK_KEY, owner },
    {
      $set: {
        heartbeatAt: now,
        expiresAt: new Date(now.getTime() + leaseMs),
      },
    },
    { new: true },
  );
  return Boolean(lock);
}

async function currentHolder(lockModel) {
  const [lock] = await lockModel.find({ _id: LOCK_KEY });
  return lock?.owner;
}

/**
 * Run `work` while holding the migration lock.
 *
 * Waits (polling) while another runner holds the lock and fails with a
 * {@link MigrationLockTimeoutError} when it is still held after
 * `waitTimeoutMs`. `work` gets `{ waited, assertHeld }`: `waited` tells that
 * another runner was at work in the meantime, `assertHeld()` throws once the
 * lease was lost. The lock is released whether `work` succeeds or throws.
 *
 * @param {Object} lockModel The mongoose model of the lock collection
 * @param {Object} options `ownerId`, `leaseMs`, `pollMs`, `waitTimeoutMs`, `logger`
 * @param {function({waited: boolean, assertHeld: function(): void}): Promise<*>} work
 * @returns {Promise<*>} What `work` returns
 */
async function withMigrationLock(lockModel, options, work) {
  const owner = options.ownerId ?? defaultOwnerId();
  const logger = options.logger ?? console;
  const { leaseMs, pollMs, waitTimeoutMs } = lockTiming(options);

  const waitingSince = Date.now();
  let waited = false;
  while (!(await tryAcquire(lockModel, owner, leaseMs))) {
    if (Date.now() - waitingSince >= waitTimeoutMs) {
      throw new MigrationLockTimeoutError(
        waitTimeoutMs,
        await currentHolder(lockModel),
      );
    }
    if (!waited) {
      logger.log("Migration lock is held by another runner, waiting ...");
      waited = true;
    }
    await sleep(pollMs);
  }

  let lost = false;
  let renewing = Promise.resolve();
  const heartbeat = setInterval(
    () => {
      renewing = renew(lockModel, owner, leaseMs).then(
        (held) => {
          if (!held) lost = true;
        },
        (error) => {
          // A failed renewal is retried by the next beat; the lease decides.
          logger.error("Could not renew the migration lock", error);
        },
      );
    },
    Math.max(1, Math.floor(leaseMs / 3)),
  );
  heartbeat.unref?.();

  const assertHeld = () => {
    if (lost) throw new MigrationLockLostError(owner);
  };

  try {
    return await work({ waited, assertHeld });
  } finally {
    clearInterval(heartbeat);
    await renewing;
    try {
      await lockModel.deleteOne({ _id: LOCK_KEY, owner });
    } catch (error) {
      // The lease runs out by itself; never hide the outcome of `work`.
      logger.error("Could not release the migration lock", error);
    }
  }
}

module.exports = {
  LOCK_KEY,
  MigrationLockTimeoutError,
  MigrationLockLostError,
  lockTiming,
  withMigrationLock,
};
