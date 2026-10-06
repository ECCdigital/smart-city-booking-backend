/**
 * Gives the stock its initial supervision state (tenant supervision spec
 * §11), without approving anything and without touching a decision:
 *
 *   instance without `tenantInitialSupervisionLevel`   ->  `free`
 *   tenant without `supervisionLevel`                  ->  `free`, no
 *     `supervisionChangedAt`, one `tenant.levelInitialized` history row
 *   bookable/event, `isPublic: true`, no review status ->  `pending` with
 *     the migration time as `submittedAt`, one `review.submitted` row
 *   any other offer                                    ->  left as it is
 *
 * The history rows are system rows of origin `migration` carrying the actual
 * migration time - no creation, submission or approval of the past is made
 * up. `isPublic`, `isBookable`, the catalog participation and the bookings
 * stand; a missing tenant contact is no obstacle. The models are written
 * directly: no review or supervision service, so no outbox row and no mail.
 *
 * Repeatable and resumable. Every write is conditional on "not migrated
 * yet", and per batch the order is history first, state second:
 *
 *   1. insert the history rows; the unique `dedupeKey` refuses a row that
 *      is there already (a rerun), and that refusal is skipped over;
 *   2. write the state, still conditional on "not migrated yet".
 *
 * An abort between 1 and 2 leaves a row whose subject still reads "not
 * migrated", so the rerun selects it again, skips the row and writes the
 * state - an offer then waits from the time its row names, not from the
 * rerun. An abort after 2 leaves nothing to select. A state without its row
 * cannot come about. The order relies on a review status never returning
 * to `null` once set (see `review-transitions.js`).
 *
 * A tenant without `id`, or an offer without `id`/`tenantId`, has no subject
 * a row could name: it is skipped and reported, not migrated.
 *
 * `down` is a no-op on purpose: taking the levels or the `pending` back
 * would drop decisions made since, and the history is never deleted.
 */

const bunyan = require("bunyan");
const { v4: uuidv4 } = require("uuid");
const {
  SUPERVISION_LEVELS,
  REVIEW_STATUS,
  OFFER_TYPES,
  HISTORY_EVENT_TYPES,
  HISTORY_ACTOR_TYPES,
  HISTORY_ORIGINS,
} = require("../../src/commons/services/supervision/supervision-constants");

const logger = bunyan.createLogger({
  name: "21-09-2026-tenant-supervision-initial-state.js",
  level: process.env.LOG_LEVEL,
});

const BATCH_SIZE = 500;
const DUPLICATE_KEY = 11000;

function chunks(items, size) {
  const result = [];
  for (let i = 0; i < items.length; i += size) {
    result.push(items.slice(i, i + size));
  }
  return result;
}

/**
 * The documents a history row can name. One without its id (or tenant) has
 * no subject to record; it is left as it is and reported, rather than
 * failing the run on every start.
 */
function identified(documents, keys, label) {
  const usable = documents.filter((document) =>
    keys.every((key) => typeof document[key] === "string" && document[key]),
  );

  if (usable.length < documents.length) {
    logger.warn(
      { skipped: documents.length - usable.length, label, keys },
      "Tenant supervision migration: skipped documents without their keys",
    );
  }

  return usable;
}

function isDuplicateKeyOnly(error) {
  const writeErrors = [].concat(error?.writeErrors ?? []);
  if (writeErrors.length > 0) {
    return writeErrors.every(
      (writeError) =>
        (writeError.code ?? writeError.err?.code) === DUPLICATE_KEY,
    );
  }
  return error?.code === DUPLICATE_KEY;
}

function migrationRow(subject, now) {
  return {
    id: uuidv4(),
    offerType: null,
    offerId: null,
    occurredAt: now,
    actor: { type: HISTORY_ACTOR_TYPES.SYSTEM, userId: null },
    from: null,
    reason: null,
    origin: HISTORY_ORIGINS.MIGRATION,
    ...subject,
  };
}

/**
 * Inserts the rows that are not there yet; a row whose `dedupeKey` exists
 * (a rerun) is refused by the unique index and skipped.
 */
async function insertHistoryOnce(SupervisionHistory, rows) {
  try {
    await SupervisionHistory.insertMany(rows, {
      ordered: false,
      throwOnValidationError: true,
    });
  } catch (error) {
    if (!isDuplicateKeyOnly(error)) throw error;
  }
}

async function migrateTenants(mongoose, now) {
  const Tenant = mongoose.model("Tenant");
  const SupervisionHistory = mongoose.model("SupervisionHistory");

  const tenants = identified(
    await Tenant.find({ supervisionLevel: null }).select("id").lean(),
    ["id"],
    "tenant",
  );

  for (const batch of chunks(tenants, BATCH_SIZE)) {
    await insertHistoryOnce(
      SupervisionHistory,
      batch.map((tenant) =>
        migrationRow(
          {
            tenantId: tenant.id,
            eventType: HISTORY_EVENT_TYPES.TENANT_LEVEL_INITIALIZED,
            to: SUPERVISION_LEVELS.FREE,
            dedupeKey: `migration:tenant-level:${tenant.id}`,
          },
          now,
        ),
      ),
    );

    await Tenant.updateMany(
      { id: { $in: batch.map((tenant) => tenant.id) }, supervisionLevel: null },
      { $set: { supervisionLevel: SUPERVISION_LEVELS.FREE } },
    );
  }
}

const OFFER_MODELS = [
  { model: "Bookable", offerType: OFFER_TYPES.BOOKABLE },
  { model: "Event", offerType: OFFER_TYPES.EVENT },
];

/** "Not yet migrated": published by wish, and no review status so far. */
const UNREVIEWED_PUBLIC = { isPublic: true, "review.status": null };

function reviewDedupeKey(offerType, offer) {
  return `migration:review:${offerType}:${offer.tenantId}:${offer.id}`;
}

async function migrateOffers(mongoose, { model, offerType }, now) {
  const Offer = mongoose.model(model);
  const SupervisionHistory = mongoose.model("SupervisionHistory");

  const offers = identified(
    await Offer.find(UNREVIEWED_PUBLIC).select("id tenantId").lean(),
    ["id", "tenantId"],
    offerType,
  );

  for (const batch of chunks(offers, BATCH_SIZE)) {
    await insertHistoryOnce(
      SupervisionHistory,
      batch.map((offer) =>
        migrationRow(
          {
            tenantId: offer.tenantId,
            offerType,
            offerId: offer.id,
            eventType: HISTORY_EVENT_TYPES.REVIEW_SUBMITTED,
            to: REVIEW_STATUS.PENDING,
            dedupeKey: reviewDedupeKey(offerType, offer),
          },
          now,
        ),
      ),
    );

    // The waiting time starts where the history says it did: a row left by
    // an aborted run keeps its time, and the offer takes it over.
    const rows = await SupervisionHistory.find({
      dedupeKey: { $in: batch.map((o) => reviewDedupeKey(offerType, o)) },
    })
      .select("dedupeKey occurredAt")
      .lean();
    const submittedAt = new Map(
      rows.map((row) => [row.dedupeKey, new Date(row.occurredAt)]),
    );

    await Offer.bulkWrite(
      batch.map((offer) => {
        const recordedAt = submittedAt.get(reviewDedupeKey(offerType, offer));
        if (!recordedAt) {
          throw new Error(
            `No migration history row for ${offerType} ${offer.tenantId}/${offer.id}`,
          );
        }

        return {
          updateOne: {
            filter: {
              id: offer.id,
              tenantId: offer.tenantId,
              ...UNREVIEWED_PUBLIC,
            },
            update: {
              $set: {
                review: {
                  status: REVIEW_STATUS.PENDING,
                  submittedAt: recordedAt,
                  decidedAt: null,
                  decidedBy: null,
                  reason: null,
                },
              },
            },
          },
        };
      }),
      { ordered: false },
    );
  }
}

module.exports = {
  name: "21-09-2026-tenant-supervision-initial-state",

  up: async function (mongoose) {
    const now = new Date();

    await mongoose
      .model("Instance")
      .updateMany(
        { tenantInitialSupervisionLevel: null },
        { $set: { tenantInitialSupervisionLevel: SUPERVISION_LEVELS.FREE } },
      );

    await migrateTenants(mongoose, now);

    for (const offerModel of OFFER_MODELS) {
      await migrateOffers(mongoose, offerModel, now);
    }
  },

  // Not reversible, see above.
  down: async function () {},
};
