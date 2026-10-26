/**
 * Removes the status `suspended` of a membership:
 * there is no suspension at the tenant any more, only the suspension of a
 * user at the instance. Every suspended membership ends as „Mitgliedschaft
 * beenden“ ends one - the membership and the user's open invitations in
 * the tenant go, the account stays - also for a user already suspended at
 * the instance. No report and no suspension come of it, and the users
 * concerned are told nothing.
 *
 * Each tenant concerned gets one notice „Mitgliedschaften beendet“ in the
 * supervision outbox: to its owners, or to the instance owners where the
 * tenant is left without an owner. The outbox keeps its status, and the
 * instance owner sends a failed one again.
 *
 * Repeatable and resumable. Per tenant the order is notice first, end
 * second:
 *
 *   1. insert the outbox row; its unique `dedupeKey` refuses a row that is
 *      there already (a rerun), and that refusal is skipped over;
 *   2. end the memberships still suspended.
 *
 * An abort between 1 and 2 leaves the memberships suspended, so the rerun
 * selects the tenant again, skips the row and ends them. Last, every row of
 * this notice still pending is dispatched; a row the sender already sent
 * is never sent again.
 *
 * `down` is a no-op on purpose: an ended membership is not restored.
 */

const bunyan = require("bunyan");
const { v4: uuidv4 } = require("uuid");
const SupervisionNotificationService = require("../../src/commons/services/supervision/supervision-notification-service");
const {
  NOTIFICATION_TYPES,
  NOTIFICATION_STATUS,
} = require("../../src/commons/services/supervision/supervision-constants");

const logger = bunyan.createLogger({
  name: "23-10-2026-end-suspended-memberships.js",
  level: process.env.LOG_LEVEL,
});

const SUSPENDED = "suspended";
const DUPLICATE_KEY = 11000;

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

/** The suspended memberships, by tenant in the order found. */
function byTenant(memberships) {
  const tenants = new Map();
  for (const membership of memberships) {
    if (!tenants.has(membership.tenantId)) {
      tenants.set(membership.tenantId, []);
    }
    tenants.get(membership.tenantId).push(membership.userId);
  }
  return tenants;
}

const nameOf = (user) =>
  [user?.firstName, user?.lastName].filter(Boolean).join(" ").trim();

/** Records the tenant's notice once; a rerun's row is refused and skipped. */
async function recordNoticeOnce(mongoose, tenantId, userIds, now) {
  const Tenant = mongoose.model("Tenant");
  const User = mongoose.model("User");
  const Membership = mongoose.model("Membership");
  const SupervisionNotification = mongoose.model("SupervisionNotification");

  const tenant = await Tenant.findOne({ id: tenantId }).lean();
  const users = await User.find({ id: { $in: userIds } }).lean();
  const owners = (
    await Membership.find({ tenantId, owner: true }).lean()
  ).filter((owner) => owner.status !== SUSPENDED);

  const row = {
    id: uuidv4(),
    type: NOTIFICATION_TYPES.MEMBERSHIPS_ENDED,
    tenantId,
    payload: {
      tenantName: tenant?.name || tenantId,
      members: userIds.map((userId) => {
        const user = users.find((candidate) => candidate.id === userId);
        return {
          userId,
          name: nameOf(user),
          instanceSuspended: user?.isSuspended === true,
        };
      }),
      toInstanceOwners: owners.length === 0,
    },
    status: NOTIFICATION_STATUS.PENDING,
    attempts: 0,
    lastError: null,
    createdAt: now,
    sentAt: null,
    deliveries: [],
    dispatchingSince: null,
    dedupeKey: `migration:memberships-ended:${tenantId}`,
  };

  try {
    await SupervisionNotification.insertMany([row], { ordered: false });
  } catch (error) {
    if (!isDuplicateKeyOnly(error)) throw error;
  }
}

/** „Mitgliedschaft beenden“ for the tenant's suspended memberships. */
async function endMemberships(mongoose, tenantId, userIds) {
  await mongoose
    .model("Invitation")
    .deleteMany({ tenantId, intendedUserId: { $in: userIds } });
  await mongoose
    .model("Membership")
    .deleteMany({ tenantId, userId: { $in: userIds }, status: SUSPENDED });
}

module.exports = {
  name: "23-10-2026-end-suspended-memberships",

  up: async function (mongoose) {
    // The unique `dedupeKey` keeps a rerun from recording a notice twice;
    // the connection does not wait for the indexes of the models.
    await mongoose.model("SupervisionNotification").syncIndexes();
    const now = new Date();

    const suspended = await mongoose
      .model("Membership")
      .find({ status: SUSPENDED })
      .lean();

    for (const [tenantId, userIds] of byTenant(suspended)) {
      await recordNoticeOnce(mongoose, tenantId, userIds, now);
      await endMemberships(mongoose, tenantId, userIds);
      logger.info(
        { tenantId, ended: userIds.length },
        "Ended the suspended memberships of the tenant",
      );
    }

    const pending = await mongoose
      .model("SupervisionNotification")
      .find({
        type: NOTIFICATION_TYPES.MEMBERSHIPS_ENDED,
        status: NOTIFICATION_STATUS.PENDING,
      })
      .lean();
    for (const row of pending) {
      await SupervisionNotificationService.dispatch(row.id);
    }
  },

  // Not reversible, see above.
  down: async function () {},
};
