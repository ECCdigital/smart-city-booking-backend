/**
 * The effect pipeline of the booking lifecycle (spec part 2, sections 3
 * and 4): the one place that owns the order of a transition's effects and
 * what a failing effect does to the transition.
 *
 * A transition declares its steps as data - phase, adapter, operation, a
 * closure that runs it, a condition - and `runPipeline` runs them. Four
 * phases in a fixed order: `persist` (the store writes), `provision` (the
 * access seam), `document` (the issuance of booking documents), `notify`
 * (workflow event, mails, payment request). Steps declared out of that
 * order are refused before any effect runs.
 *
 * The failure policy belongs to the adapter operation (glossary
 * "Fehlerpolitik"): `POLICY_TABLE` says for every operation whether its
 * failure aborts the transition or is recorded; a transition never chooses.
 * Only the store write and the hold abort. An abort restores every persist
 * write of the run from the snapshot the conditional write answered, in
 * reverse order, and throws a `LifecycleError` with the partial outcome.
 * There is no undo register: provision, document and notify run after the
 * persist phase and only ever record, so there is nothing else to take
 * back. A guard that fires inside the conditional write (`ConflictError
 * invalid_transition`) is thrown as itself after the restore: it is the
 * transition table's answer, not a failed effect.
 */

const bunyan = require("bunyan");
const { ConflictError } = require("../../../errors/BaseError");

const logger = bunyan.createLogger({
  name: "booking-lifecycle-pipeline.js",
  level: process.env.LOG_LEVEL,
});

/** The phases, in the only order they run. */
const PHASE = Object.freeze({
  PERSIST: "persist",
  PROVISION: "provision",
  DOCUMENT: "document",
  NOTIFY: "notify",
});

const PHASES = Object.freeze(Object.values(PHASE));

/** What a failing effect does to its transition. */
const POLICY = Object.freeze({
  ABORT: "abort",
  RECORD: "record",
});

/** The status of an effect row. */
const EFFECT_STATUS = Object.freeze({
  OK: "ok",
  SKIPPED: "skipped",
  RECORDED: "recorded",
  FAILED: "failed",
});

/**
 * The failure policy per adapter operation (spec part 2, 4.1). Keyed
 * `adapter.op`; `mail.*` covers every notice type the mail adapter sends.
 */
const POLICY_TABLE = Object.freeze({
  "store.save": POLICY.ABORT,
  "access.hold": POLICY.ABORT,
  "access.provision": POLICY.RECORD,
  "access.update": POLICY.RECORD,
  "access.revoke": POLICY.RECORD,
  "access.refreshHolds": POLICY.RECORD,
  "documents.issue": POLICY.RECORD,
  "payment.requestPayment": POLICY.RECORD,
  "mail.*": POLICY.RECORD,
  "workflow.emit": POLICY.RECORD,
});

/** What a step's `run` answers to say the effect did not apply. */
const SKIPPED = Symbol("skipped");

/**
 * The failure policy of an adapter operation.
 *
 * @param {string} adapter
 * @param {string} op
 * @returns {string} One of POLICY
 * @throws {Error} For an operation the table does not know
 */
function policyOf(adapter, op) {
  const policy =
    POLICY_TABLE[`${adapter}.${op}`] ?? POLICY_TABLE[`${adapter}.*`];
  if (!policy) {
    throw new Error(
      `booking-lifecycle: no failure policy for ${adapter}.${op}`,
    );
  }
  return policy;
}

/**
 * The notify step of a notice (glossary "Mitteilung") of the given type
 * over the mail adapter: `mail.send(type, ctx)`, the effect row
 * `mail.<type>`, skipped where the notice has no recipient.
 *
 * @param {Object} mail The mail adapter
 * @param {string} type A key of the mail registry
 * @param {Object|function(): Object} ctx The context of `compose`; a
 *   function is read when the step runs, for a context an earlier step of
 *   the run fills in (the answer of the payment request)
 * @param {{ when?: function(Object): boolean, bookingId?: string }} [options]
 * @returns {Object} The step
 */
function noticeStep(mail, type, ctx, options) {
  return step(
    PHASE.NOTIFY,
    "mail",
    type,
    () => mail.send(type, typeof ctx === "function" ? ctx() : ctx),
    options,
  );
}

/**
 * The notices of one booking or one group: `notice(type, specific,
 * options)` declares the notify step of a type over `base` - the tenant,
 * the bookings, the group - joined by the type-specific part, which may
 * be a function read when the step runs.
 *
 * @param {Object} mail The mail adapter
 * @param {{ tenantId: string, bookingIds: string[], groupBookingId: string|null }} base
 * @returns {function(string, Object|function, Object=): Object}
 */
function noticesOf(mail, base) {
  return (type, specific = {}, options) =>
    noticeStep(
      mail,
      type,
      () => ({
        ...base,
        ...(typeof specific === "function" ? specific() : specific),
      }),
      options,
    );
}

class LifecycleError extends Error {
  /**
   * @param {string} transition
   * @param {Object} effect The effect row the transition aborted at
   * @param {Object} outcome The partial outcome, persist writes restored
   * @param {Error} cause
   */
  constructor(transition, effect, outcome, cause) {
    super(
      `${transition} aborted at ${effect.adapter}.${effect.op}: ${cause.message}`,
    );
    this.name = "LifecycleError";
    this.transition = transition;
    this.effect = effect;
    this.outcome = outcome;
    this.cause = cause;
  }
}

/**
 * One declared effect of a transition.
 *
 * @param {string} phase One of PHASES
 * @param {string} adapter The adapter that runs it, for the effect row
 * @param {string} op The adapter operation, for the effect row and the policy
 * @param {function(Object): Promise<*>} run Runs the effect; answers
 *   `SKIPPED` to say it did not apply (no payment service configured)
 * @param {{ when?: function(Object): boolean, bookingId?: string }} [options]
 *   The condition under which the step runs - a step whose condition is
 *   false is `skipped` - and, for a step of one member of a group, the
 *   member's id, which the effect row carries
 * @returns {Object} The step
 * @throws {Error} For an unknown phase or an operation without a policy
 */
function step(phase, adapter, op, run, { when, bookingId } = {}) {
  if (!PHASES.includes(phase)) {
    throw new Error(`booking-lifecycle: unknown phase ${phase}`);
  }
  return {
    phase,
    adapter,
    op,
    policy: policyOf(adapter, op),
    run,
    when: when || (() => true),
    ...(bookingId ? { bookingId } : {}),
  };
}

function assertPhaseOrder(transition, steps) {
  let last = -1;
  for (const s of steps) {
    const index = PHASES.indexOf(s.phase);
    if (index < last) {
      throw new Error(
        `booking-lifecycle: ${transition} declares ${s.adapter}.${s.op} in phase ${s.phase} after ${PHASES[last]}`,
      );
    }
    last = index;
  }
}

function isSnapshotStep(s) {
  return s.phase === PHASE.PERSIST && s.adapter === "store" && s.op === "save";
}

/**
 * @typedef {Object} Effect One row of the outcome.
 * @property {string} phase
 * @property {string} adapter
 * @property {string} op
 * @property {string} policy
 * @property {string} [bookingId] The member of a group the effect is of
 * @property {string} status One of EFFECT_STATUS
 * @property {Error} [error] Set where the status is `recorded` or `failed`
 */

/**
 * @typedef {Object} Outcome What a transition answers (spec part 1, 4.3).
 * @property {string} transition
 * @property {string} [bookingId]
 * @property {string[]} [bookingIds] For a group transition
 * @property {string|null} status The booking's state afterwards; for a
 *   group the state its members share, null where they differ
 * @property {Object|null} booking The booking as the store holds it afterwards
 * @property {Object[]} [bookings] For a group transition, the members
 * @property {Effect[]} effects In execution order
 * @property {null|{ effect: Effect, compensated: string[] }} failure The
 *   effect the transition aborted at and the ids of the bookings restored
 */

/**
 * Runs the steps of a transition in order and answers the outcome.
 *
 * @param {Object} ctx
 * @param {string} ctx.transition
 * @param {string} ctx.tenantId
 * @param {string} [ctx.bookingId]
 * @param {string[]} [ctx.bookingIds]
 * @param {Object} [ctx.booking] The booking the transition works on; the
 *   outcome carries it and its state afterwards
 * @param {Object[]} [ctx.bookings] The members a group transition works on
 * @param {{ get: Function, getMany: Function, restore: Function }} ctx.store
 *   The store adapter, for the restore of an abort
 * @param {Object[]} steps The declared steps
 * @returns {Promise<Outcome>}
 * @throws {LifecycleError} When a step with abort policy fails
 * @throws {ConflictError} When the conditional write of a persist step
 *   finds the booking in another state
 */
async function runPipeline(ctx, steps) {
  const { transition, tenantId, bookingId, bookingIds } = ctx;
  assertPhaseOrder(transition, steps);

  const outcome = {
    transition,
    ...(bookingIds ? { bookingIds } : { bookingId }),
    status: null,
    booking: null,
    effects: [],
    failure: null,
  };
  const snapshots = [];

  for (const s of steps) {
    const effect = {
      phase: s.phase,
      adapter: s.adapter,
      op: s.op,
      policy: s.policy,
      ...(s.bookingId ? { bookingId: s.bookingId } : {}),
    };

    if (!s.when(ctx)) {
      outcome.effects.push({ ...effect, status: EFFECT_STATUS.SKIPPED });
      continue;
    }

    try {
      const result = await s.run(ctx);
      if (result === SKIPPED) {
        outcome.effects.push({ ...effect, status: EFFECT_STATUS.SKIPPED });
        continue;
      }
      outcome.effects.push({ ...effect, status: EFFECT_STATUS.OK });
      if (isSnapshotStep(s) && result) {
        snapshots.push(result);
      }
    } catch (err) {
      if (s.policy === POLICY.RECORD) {
        outcome.effects.push({
          ...effect,
          status: EFFECT_STATUS.RECORDED,
          error: err,
        });
        logger.error(
          { err, tenantId, bookingId: bookingId ?? bookingIds, transition },
          `${transition}: ${s.adapter}.${s.op} failed and is recorded: ${err.message}`,
        );
        continue;
      }

      const failed = { ...effect, status: EFFECT_STATUS.FAILED, error: err };
      outcome.effects.push(failed);
      outcome.failure = {
        effect: failed,
        compensated: await restoreSnapshots(ctx, snapshots),
      };
      outcome.booking = await currentBooking(ctx);
      if (bookingIds) {
        outcome.bookings = await currentBookings(ctx);
        outcome.status = sharedStatus(outcome.bookings);
      } else {
        outcome.status = outcome.booking?.status ?? null;
      }

      if (err instanceof ConflictError) {
        throw err;
      }
      logger.error(
        { err, tenantId, bookingId: bookingId ?? bookingIds, transition },
        `${transition} aborted at ${s.adapter}.${s.op}: ${err.message}`,
      );
      throw new LifecycleError(transition, failed, outcome, err);
    }
  }

  outcome.booking = ctx.booking ?? null;
  if (bookingIds) {
    outcome.bookings = ctx.bookings ?? [];
    outcome.status = sharedStatus(outcome.bookings);
  } else {
    outcome.status = ctx.booking?.status ?? null;
  }
  return outcome;
}

/** The state every member is in, or null where they differ. */
function sharedStatus(bookings) {
  const statuses = new Set(bookings.map((booking) => booking.status));
  return statuses.size === 1 ? [...statuses][0] : null;
}

async function restoreSnapshots({ store, tenantId, transition }, snapshots) {
  const compensated = [];
  for (const previous of [...snapshots].reverse()) {
    try {
      await store.restore(previous);
      compensated.push(previous.id);
    } catch (err) {
      logger.error(
        { err, tenantId, bookingId: previous.id, transition },
        `${transition}: could not restore booking ${previous.id} after the abort: ${err.message}`,
      );
    }
  }
  return compensated;
}

async function currentBooking({ store, tenantId, bookingId }) {
  if (!bookingId) {
    return null;
  }
  try {
    return await store.get(tenantId, bookingId);
  } catch {
    return null;
  }
}

async function currentBookings({ store, tenantId, bookingIds }) {
  try {
    return await store.getMany(tenantId, bookingIds);
  } catch {
    return [];
  }
}

module.exports = {
  PHASE,
  PHASES,
  POLICY,
  POLICY_TABLE,
  EFFECT_STATUS,
  SKIPPED,
  noticeStep,
  noticesOf,
  policyOf,
  step,
  runPipeline,
  LifecycleError,
};
