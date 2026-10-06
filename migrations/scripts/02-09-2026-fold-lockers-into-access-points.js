/**
 * The migration of the locker fold (spec §3.7): locker systems become rows
 * of `accesspoints`, compartments become `accessInfo` entries.
 *
 *   bookable.lockerDetails.units[]     -> one row per tenant and iFBS
 *   booking.lockerInfo[].{lockerSystem,   location (`externalId` =
 *     id}                                 `locationId`, `mode: remote`) or
 *                                         Pareva size (`externalId` = the
 *                                         product id, `providerLocationId` =
 *                                         the application's `lockerId`,
 *                                         `mode: authorization`)
 *   bookable.lockerDetails             -> accessPointDetails.accessPointIds,
 *                                         accessPointDetails.active; the iFBS
 *                                         price provider stays at the
 *                                         location; a Pareva unit's amount
 *                                         becomes the bookable's where it
 *                                         was the smaller one
 *   booking.lockerInfo[]               -> one `accessInfo` entry of type
 *                                         `locker` each: confirmed -> grant,
 *                                         unconfirmed -> hold
 *   accessInfo[].accessPointId         -> the row's id, where the checkout
 *     "locker:<provider>:<externalId>"     fold made the entry at a
 *                                         synthesized one
 *   tenant.applications[].type         -> `access`, for `ifbs` and `pareva`
 *     "locker"
 *
 * Idempotent: rows are found by tenant, provider and external id before
 * one is made; only bookables that still carry `lockerDetails` and bookings
 * that still carry `lockerInfo` are rewritten. `down` puts the units back
 * at the bookables (a unit's amount as the bookable's), the compartments
 * back under the synthesized ids of step 3 with `lockerInfo` derived from
 * them, turns the applications back and removes the locker rows.
 */

const {
  AccessPoint,
} = require("../../src/commons/entities/access/access-point");
const {
  deriveLockerInfo,
} = require("../../src/commons/entities/booking/locker-info");
const {
  ensureIfbsProvider,
} = require("../../src/commons/data-managers/models/bookable-ifbs-provider");
const {
  toUnit,
} = require("../../src/commons/entities/bookable/locker-details");
const {
  AccessPointType,
  AccessPointMode,
} = require("../../src/commons/schemas/accessPointSchema");
const IfbsAccessProvider = require("../../src/commons/services/access/providers/ifbs-access-provider");

const LOCKER = AccessPointType.LOCKER;
const IFBS = "ifbs";
const PAREVA = "pareva";
const LOCKER_PROVIDERS = [IFBS, PAREVA];
// The id the checkout fold (step 3) made compartment entries under while
// the locker systems were still configured at the bookable.
const SYNTHESIZED_ID_PREFIX = "locker:";

const MODE_BY_PROVIDER = {
  [IFBS]: AccessPointMode.REMOTE,
  [PAREVA]: AccessPointMode.AUTHORIZATION,
};

function loadAccessPointModel(mongoose) {
  require("../../src/commons/data-managers/models/accessPointModel");
  return mongoose.model("AccessPoint");
}

function rowKey(tenantId, provider, externalId) {
  return `${tenantId}/${provider}/${String(externalId)}`;
}

/** The external id a unit names: the location for iFBS, the size for Pareva. */
function unitExternalId(unit) {
  const externalId = unit.lockerSystem === IFBS ? unit.locationId : unit.id;
  return externalId == null ? null : String(externalId);
}

/**
 * The external id a `lockerInfo` record names. Pareva records of 2024 carry
 * the id of a unit the bookable had then as `id` and the size as `unitId`.
 */
function recordExternalId(record) {
  return record.unitId ?? record.id;
}

/**
 * The `lockerId` of each tenant's Pareva application, which locates its
 * sizes. Read raw: the field is not encrypted.
 */
async function parevaLockerIdsByTenant(Tenant) {
  const tenants = await Tenant.find({ "applications.id": PAREVA }).lean();
  const byTenant = new Map();

  for (const tenant of tenants) {
    const app = (tenant.applications || []).find(
      (candidate) => candidate.id === PAREVA,
    );
    if (app?.lockerId != null) {
      byTenant.set(tenant.id, String(app.lockerId));
    }
  }

  return byTenant;
}

/**
 * Every locker system the data names, keyed by tenant, provider and
 * external id: those the bookables configure and those the bookings note.
 * A bookable's title becomes the row's label, the first bookable winning;
 * a system only a booking names is labelled by its external id.
 */
function collectLockerSystems(bookables, bookings, parevaLockerIds) {
  const systems = new Map();

  const add = (tenantId, provider, externalId, label) => {
    if (!LOCKER_PROVIDERS.includes(provider) || externalId == null) {
      return;
    }
    const key = rowKey(tenantId, provider, externalId);
    if (!systems.has(key)) {
      systems.set(key, {
        tenantId,
        provider,
        externalId: String(externalId),
        label: label || String(externalId),
      });
    }
  };

  for (const bookable of bookables) {
    for (const unit of bookable.lockerDetails?.units || []) {
      add(
        bookable.tenantId,
        unit.lockerSystem,
        unitExternalId(unit),
        bookable.title,
      );
    }
  }

  for (const booking of bookings) {
    for (const record of booking.lockerInfo || []) {
      add(
        booking.tenantId,
        record.lockerSystem,
        recordExternalId(record),
        null,
      );
    }
    for (const entry of booking.accessInfo || []) {
      if (String(entry.accessPointId).startsWith(SYNTHESIZED_ID_PREFIX)) {
        add(booking.tenantId, entry.provider, entry.externalId, null);
      }
    }
  }

  for (const system of systems.values()) {
    system.providerLocationId =
      system.provider === IFBS
        ? system.externalId
        : parevaLockerIds.get(system.tenantId) ?? null;
    system.mode = MODE_BY_PROVIDER[system.provider];
  }

  return systems;
}

/**
 * The rows for the collected systems: the stored one where the tenant has
 * it already, a new one otherwise. Answers the rows keyed like the systems.
 */
async function ensureRows(AccessPointModel, systems) {
  const stored = await AccessPointModel.find({ type: LOCKER }).lean();
  const rows = new Map(
    stored.map((row) => [
      rowKey(row.tenantId, row.provider, row.externalId),
      row,
    ]),
  );

  for (const [key, system] of systems) {
    if (rows.has(key)) {
      continue;
    }

    const accessPoint = AccessPoint.create({
      tenantId: system.tenantId,
      type: LOCKER,
      provider: system.provider,
      externalId: system.externalId,
      providerLocationId: system.providerLocationId,
      label: system.label,
      mode: system.mode,
      config: {},
      location: null,
      validationRules: [],
    });
    const { scanCode, previousScanCodes, ...persisted } =
      accessPoint.toDocument();

    await AccessPointModel.updateOne(
      { id: persisted.id, tenantId: persisted.tenantId },
      {
        $set: persisted,
        $setOnInsert: { scanCode, previousScanCodes },
      },
      { upsert: true },
    );
    rows.set(key, { ...persisted, scanCode, previousScanCodes });
  }

  return rows;
}

/**
 * The bookable's side: the rows referenced and switched on where the
 * units were, the iFBS price provider kept at its location, a Pareva
 * unit's amount taken over as the capacity where it was the smaller one.
 */
async function foldBookable(Bookable, bookable, rows) {
  const details = bookable.lockerDetails || {};
  const units = details.units || [];
  const referenced = [];
  let ifbsLocationId = null;
  let amount = Number(bookable.amount);

  for (const unit of units) {
    const externalId = unitExternalId(unit);
    const row = rows.get(
      rowKey(bookable.tenantId, unit.lockerSystem, externalId),
    );
    if (!row) {
      continue;
    }

    if (details.active === true && !referenced.includes(row.id)) {
      referenced.push(row.id);
    }
    if (unit.lockerSystem === IFBS && ifbsLocationId == null) {
      ifbsLocationId = externalId;
    }
    if (unit.lockerSystem === PAREVA) {
      const unitAmount = Number(unit.amount);
      if (Number.isFinite(unitAmount) && unitAmount > 0) {
        amount = Number.isFinite(amount)
          ? Math.min(amount, unitAmount)
          : unitAmount;
      }
    }
  }

  if (units.length && !referenced.length) {
    console.warn(
      `${bookable.tenantId} -- bookable ${bookable.id} references no locker system: its lockerDetails were ${details.active === true ? "units that named none" : "switched off"}; the rows exist under /accesspoints`,
    );
  }

  const accessPointDetails = bookable.accessPointDetails || {
    active: false,
    accessBuffer: { before: 0, after: 0 },
    accessPointIds: [],
  };
  const accessPointIds = [...(accessPointDetails.accessPointIds || [])];
  for (const id of referenced) {
    if (!accessPointIds.includes(id)) {
      accessPointIds.push(id);
    }
  }

  const $set = {
    accessPointDetails: {
      ...accessPointDetails,
      active: accessPointDetails.active === true || referenced.length > 0,
      accessPointIds,
    },
  };

  if (ifbsLocationId != null) {
    const doc = { externalProviders: bookable.externalProviders };
    ensureIfbsProvider(doc, ifbsLocationId);
    $set.externalProviders = doc.externalProviders;
  }

  if (Number.isFinite(amount) && amount !== Number(bookable.amount)) {
    console.warn(
      `${bookable.tenantId} -- bookable ${bookable.id}: amount ${bookable.amount} lowered to ${amount}, the compartments its Pareva unit offered`,
    );
    $set.amount = amount;
  }

  await Bookable.collection.updateOne(
    { _id: bookable._id },
    { $set, $unset: { lockerDetails: "" } },
  );
}

/** A `lockerInfo` record as the compartment entry the seam keeps. */
function toCompartmentEntry(tenantId, record, rows) {
  const externalId = recordExternalId(record);
  const row = rows.get(rowKey(tenantId, record.lockerSystem, externalId));
  const metadata = record.ifbsMetadata || null;
  const authorizationId =
    record.isConfirmed && (record.processId ?? metadata?.bookingId) != null
      ? String(record.processId ?? metadata.bookingId)
      : null;
  const isIfbs = record.lockerSystem === IFBS;
  const compartment =
    isIfbs && metadata?.nummer != null ? String(metadata.nummer) : null;

  let hold = null;
  if (!authorizationId) {
    hold =
      isIfbs && metadata?.bookingId != null
        ? {
            holdId: String(metadata.bookingId),
            expiresAt:
              (Number(metadata.preReservedAt) || 0) +
              IfbsAccessProvider.holdTtlMs,
            compartment,
          }
        : { holdId: null, expiresAt: null, compartment: null };
  }

  return {
    accessPointId: row.id,
    accessPointType: LOCKER,
    provider: record.lockerSystem,
    externalId: String(externalId),
    mode: row.mode,
    bookableId: record.bookableId ?? null,
    hold,
    compartment,
    metadata: isIfbs
      ? { boxId: metadata?.boxId ?? null, price: metadata?.price ?? null }
      : null,
    externalBookingId: authorizationId,
    isProvisioned: Boolean(authorizationId),
    provisionedAt: null,
    revokedAt: null,
    grant: authorizationId
      ? { authorizationId, externalPrincipalId: null, secret: null }
      : null,
  };
}

/**
 * The booking's side: its `lockerInfo` records become compartment entries
 * after the entries it has, and entries made at a synthesized id since the
 * checkout fold move to the row.
 */
async function foldBooking(Booking, booking, rows) {
  const records = (booking.lockerInfo || []).filter(
    (record) =>
      LOCKER_PROVIDERS.includes(record.lockerSystem) &&
      recordExternalId(record) != null,
  );
  let changed = Boolean(booking.lockerInfo);

  const accessInfo = (booking.accessInfo || []).map((entry) => {
    const id = String(entry.accessPointId);
    if (!id.startsWith(SYNTHESIZED_ID_PREFIX)) {
      return entry;
    }
    const row = rows.get(
      rowKey(booking.tenantId, entry.provider, entry.externalId),
    );
    if (!row) {
      return entry;
    }
    changed = true;
    return { ...entry, accessPointId: row.id };
  });

  for (const record of records) {
    accessInfo.push(toCompartmentEntry(booking.tenantId, record, rows));
  }

  if (!changed) {
    return;
  }

  await Booking.collection.updateOne(
    { _id: booking._id },
    { $set: { accessInfo }, $unset: { lockerInfo: "" } },
  );
}

/** Retypes the two locker applications of every tenant, raw. */
async function retypeApplications(Tenant, from, to) {
  const tenants = await Tenant.find({ "applications.type": from }).lean();

  for (const tenant of tenants) {
    const applications = tenant.applications.map((app) =>
      app.type === from && LOCKER_PROVIDERS.includes(app.id)
        ? { ...app, type: to }
        : app,
    );
    await Tenant.collection.updateOne(
      { _id: tenant._id },
      { $set: { applications } },
    );
  }
}

module.exports = {
  name: "02-09-2026-fold-lockers-into-access-points",

  up: async function (mongoose) {
    const AccessPointModel = loadAccessPointModel(mongoose);
    const Tenant = mongoose.model("Tenant");
    const Bookable = mongoose.model("Bookable");
    const Booking = mongoose.model("Booking");

    await AccessPointModel.createCollection();
    await AccessPointModel.syncIndexes();

    const bookables = await Bookable.find({
      "lockerDetails.units.0": { $exists: true },
    })
      .sort({ _id: 1 })
      .lean();
    const bookingsWithRecords = await Booking.find({
      "lockerInfo.0": { $exists: true },
    }).lean();
    const bookingsWithEntries = await Booking.find({
      "accessInfo.0": { $exists: true },
    }).lean();
    const bookings = [
      ...bookingsWithRecords,
      ...bookingsWithEntries.filter(
        (booking) =>
          !bookingsWithRecords.some(
            (other) => String(other._id) === String(booking._id),
          ),
      ),
    ];

    const systems = collectLockerSystems(
      bookables,
      bookings,
      await parevaLockerIdsByTenant(Tenant),
    );
    const rows = await ensureRows(AccessPointModel, systems);

    for (const bookable of bookables) {
      await foldBookable(Bookable, bookable, rows);
    }

    await Bookable.collection.updateMany(
      { lockerDetails: { $exists: true } },
      { $unset: { lockerDetails: "" } },
    );

    for (const booking of bookings) {
      await foldBooking(Booking, booking, rows);
    }

    await retypeApplications(Tenant, LOCKER, "access");
  },

  down: async function (mongoose) {
    const AccessPointModel = loadAccessPointModel(mongoose);
    const Tenant = mongoose.model("Tenant");
    const Bookable = mongoose.model("Bookable");
    const Booking = mongoose.model("Booking");

    const rows = await AccessPointModel.find({ type: LOCKER }).lean();
    const rowsById = new Map(
      rows.map((row) => [`${row.tenantId}/${row.id}`, row]),
    );

    const bookables = await Bookable.find({
      "accessPointDetails.accessPointIds.0": { $exists: true },
    }).lean();

    for (const bookable of bookables) {
      const ids = bookable.accessPointDetails.accessPointIds || [];
      const lockerRows = ids
        .map((id) => rowsById.get(`${bookable.tenantId}/${id}`))
        .filter(Boolean);
      if (!lockerRows.length) {
        continue;
      }

      await Bookable.collection.updateOne(
        { _id: bookable._id },
        {
          $set: {
            lockerDetails: {
              active: true,
              units: lockerRows.map((row) =>
                toUnit(row, Number(bookable.amount)),
              ),
            },
            "accessPointDetails.accessPointIds": ids.filter(
              (id) => !rowsById.has(`${bookable.tenantId}/${id}`),
            ),
          },
        },
      );
    }

    const bookings = await Booking.find({
      "accessInfo.accessPointType": LOCKER,
    }).lean();

    // The step-3 code this rolls back to reads compartments off `accessInfo`
    // under the synthesized ids and derives `lockerInfo` from them; older
    // code reads the stored `lockerInfo`. Both are written.
    for (const booking of bookings) {
      const accessInfo = booking.accessInfo.map((entry) => {
        const row = rowsById.get(`${booking.tenantId}/${entry.accessPointId}`);
        return row
          ? {
              ...entry,
              accessPointId: `${SYNTHESIZED_ID_PREFIX}${row.provider}:${row.externalId}`,
            }
          : entry;
      });

      await Booking.collection.updateOne(
        { _id: booking._id },
        { $set: { lockerInfo: deriveLockerInfo(accessInfo), accessInfo } },
      );
    }

    await retypeApplications(Tenant, "access", LOCKER);

    await AccessPointModel.collection.deleteMany({ type: LOCKER });
  },
};
