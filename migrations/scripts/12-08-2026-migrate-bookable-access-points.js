const {
  AccessPoint,
} = require("../../src/commons/entities/access/access-point");
const {
  planAccessPointMigration,
  winnerIdsByTenant,
  rewriteAccessInfo,
  toEmbeddedPoint,
} = require("../lib/access-point-migration");

const REFERENCE_INDEX = {
  name: "tenant_accessPointIds",
  keys: { tenantId: 1, "accessPointDetails.accessPointIds": 1 },
};

const EMBEDDED_INDEX = {
  name: "tenant_accessPoint_id",
  keys: { tenantId: 1, "accessPointDetails.points.id": 1 },
};

const ACTIVE_ACCESS_POINTS_ONLY = {
  partialFilterExpression: { "accessPointDetails.active": true },
};

/**
 * Resolve the access point model, registering it on the connection first.
 *
 * @param {Object} mongoose The mongoose connection the migration runs on
 * @returns {Object} The AccessPoint model
 */
function loadAccessPointModel(mongoose) {
  require("../../src/commons/data-managers/models/accessPointModel");
  return mongoose.model("AccessPoint");
}

/**
 * Drop an index, tolerating that it is not there. Lets the migration run on a
 * database that never had the index and lets it be re-run after a failure.
 *
 * @param {Object} collection The raw mongodb collection
 * @param {string} name The index name
 * @returns {Promise<void>}
 */
async function dropIndexIfExists(collection, name) {
  try {
    await collection.dropIndex(name);
  } catch (err) {
    if (
      err.codeName !== "IndexNotFound" &&
      !/index not found/i.test(err.message)
    ) {
      throw err;
    }
  }
}

/**
 * Store an access point of the plan. The scan code is minted on creation and
 * never replaced afterwards, so re-running the migration leaves the printed QR
 * codes of already migrated access points valid.
 *
 * @param {Object} AccessPointModel The mongoose model of the collection
 * @param {Object} fields The access point fields of the plan
 * @returns {Promise<void>}
 */
async function upsertAccessPoint(AccessPointModel, fields) {
  const accessPoint = AccessPoint.create(fields);
  const { scanCode, previousScanCodes, ...persisted } =
    accessPoint.toDocument();

  await AccessPointModel.updateOne(
    { id: persisted.id, tenantId: persisted.tenantId },
    {
      $set: persisted,
      $setOnInsert: {
        scanCode: scanCode,
        previousScanCodes: previousScanCodes,
      },
    },
    { upsert: true },
  );
}

/**
 * Point the access info of existing bookings at the winning access points. The
 * ids in `booking.accessInfo` are the handle for revoking a granted access at
 * the provider, so a merged away id there would strand that authorization.
 *
 * @param {Object} Booking The mongoose model of the bookings
 * @param {Object[]} merges The merges of the migration plan
 * @returns {Promise<void>}
 */
async function rewriteBookingAccessInfo(Booking, merges) {
  for (const [tenantId, winnerIds] of winnerIdsByTenant(merges)) {
    const bookings = await Booking.find({
      tenantId: tenantId,
      "accessInfo.accessPointId": { $in: [...winnerIds.keys()] },
    }).lean();

    for (const booking of bookings) {
      await Booking.collection.updateOne(
        { _id: booking._id },
        {
          $set: {
            accessInfo: rewriteAccessInfo(booking.accessInfo, winnerIds),
          },
        },
      );
    }
  }
}

module.exports = {
  name: "12-08-2026-migrate-bookable-access-points",

  /**
   * Move the access points embedded in bookables into the tenant-wide
   * `accesspoints` collection and leave references behind. This has to ship in
   * the same deploy as the code reading those references - there is no version
   * in between in which only one of the two exists.
   *
   * The embedded `points` are the only source the winner of a duplicate group
   * is derived from, so they are removed in the very last step. A run that dies
   * halfway therefore still sees the complete source data on its next attempt
   * and picks the same winners again.
   *
   * @param {Object} mongoose The mongoose connection the migration runs on
   * @returns {Promise<void>}
   */
  up: async function (mongoose) {
    const AccessPointModel = loadAccessPointModel(mongoose);
    const Bookable = mongoose.model("Bookable");
    const Booking = mongoose.model("Booking");

    await AccessPointModel.createCollection();
    await AccessPointModel.syncIndexes();

    const bookables = await Bookable.find({
      "accessPointDetails.points.0": { $exists: true },
    })
      .sort({ _id: 1 })
      .lean();

    const plan = planAccessPointMigration(bookables);

    for (const merge of plan.merges) {
      console.warn(
        `${merge.tenantId} -- merging access point ${merge.loserId} of bookable ${merge.bookableId} into ${merge.winnerId} (${merge.provider}/${merge.externalId})`,
      );
    }

    for (const fields of plan.accessPoints) {
      await upsertAccessPoint(AccessPointModel, fields);
    }

    await rewriteBookingAccessInfo(Booking, plan.merges);

    for (const { _id, accessPointIds } of plan.bookableReferences) {
      await Bookable.collection.updateOne(
        { _id: _id },
        { $set: { "accessPointDetails.accessPointIds": accessPointIds } },
      );
    }

    await Bookable.collection.updateMany(
      {
        accessPointDetails: { $exists: true },
        "accessPointDetails.accessPointIds": { $exists: false },
      },
      { $set: { "accessPointDetails.accessPointIds": [] } },
    );

    await dropIndexIfExists(Bookable.collection, EMBEDDED_INDEX.name);
    await Bookable.collection.createIndex(REFERENCE_INDEX.keys, {
      name: REFERENCE_INDEX.name,
      ...ACTIVE_ACCESS_POINTS_ONLY,
    });

    await Bookable.collection.updateMany(
      { "accessPointDetails.points": { $exists: true } },
      { $unset: { "accessPointDetails.points": "" } },
    );
  },

  /**
   * Best-effort re-embedding for test environments. What the migration threw
   * away cannot come back: the per point access buffers are gone, merged points
   * stay merged into one, and the rewritten `booking.accessInfo` keeps pointing
   * at the winner.
   *
   * @param {Object} mongoose The mongoose connection the migration runs on
   * @returns {Promise<void>}
   */
  down: async function (mongoose) {
    const AccessPointModel = loadAccessPointModel(mongoose);
    const Bookable = mongoose.model("Bookable");

    const accessPoints = await AccessPointModel.find({}).lean();
    const accessPointsById = new Map(
      accessPoints.map((accessPoint) => [
        `${accessPoint.tenantId}/${accessPoint.id}`,
        accessPoint,
      ]),
    );

    const bookables = await Bookable.find({
      "accessPointDetails.accessPointIds": { $exists: true },
    }).lean();

    for (const bookable of bookables) {
      const points = (bookable.accessPointDetails.accessPointIds || [])
        .map((id) => accessPointsById.get(`${bookable.tenantId}/${id}`))
        .filter(Boolean)
        .map(toEmbeddedPoint);

      await Bookable.collection.updateOne(
        { _id: bookable._id },
        {
          $set: { "accessPointDetails.points": points },
          $unset: { "accessPointDetails.accessPointIds": "" },
        },
      );
    }

    await dropIndexIfExists(Bookable.collection, REFERENCE_INDEX.name);
    await Bookable.collection.createIndex(EMBEDDED_INDEX.keys, {
      name: EMBEDDED_INDEX.name,
      ...ACTIVE_ACCESS_POINTS_ONLY,
    });

    await AccessPointModel.collection.drop();
  },
};
