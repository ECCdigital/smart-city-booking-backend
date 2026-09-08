/**
 * Moves the grant of every `accessInfo` entry out of the provider-named
 * flat fields into `grant`, and the Salto user's cleanup fields into the
 * provider-neutral principal fields (Provider-Outcomes spec §3):
 *
 *   authorizationId, saltoUserId, pin  ->  grant: { authorizationId,
 *                                            externalPrincipalId, secret }
 *                                          (no authorizationId: grant null)
 *   saltoUserDeletedAt                 ->  principalRemovedAt
 *   saltoUserCleanupError              ->  principalCleanupError
 *   saltoUserCleanupAttemptedAt        ->  principalCleanupAttemptedAt
 *   accessId, providerResponse         ->  dropped (the audit log holds a copy)
 *
 * Idempotent: only entries without a `grant` key are touched. `down` maps
 * back; `providerResponse` is lost by then.
 */

function hasOwn(object, key) {
  return Object.prototype.hasOwnProperty.call(object, key);
}

function isEntry(value) {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

const LEGACY_FIELDS = [
  "authorizationId",
  "accessId",
  "saltoUserId",
  "pin",
  "providerResponse",
  "saltoUserDeletedAt",
  "saltoUserCleanupError",
  "saltoUserCleanupAttemptedAt",
];

function without(entry, fields) {
  const rest = { ...entry };
  for (const field of fields) {
    delete rest[field];
  }
  return rest;
}

function toGrantEntry(entry) {
  const {
    authorizationId,
    saltoUserId,
    pin,
    saltoUserDeletedAt,
    saltoUserCleanupError,
    saltoUserCleanupAttemptedAt,
  } = entry;

  return {
    ...without(entry, LEGACY_FIELDS),
    grant:
      authorizationId == null
        ? null
        : {
            authorizationId: String(authorizationId),
            externalPrincipalId: saltoUserId ?? null,
            secret: pin ?? null,
          },
    principalRemovedAt: saltoUserDeletedAt ?? null,
    principalCleanupAttemptedAt: saltoUserCleanupAttemptedAt ?? null,
    principalCleanupError: saltoUserCleanupError ?? null,
  };
}

function toLegacyEntry(entry) {
  const {
    grant,
    principalRemovedAt,
    principalCleanupAttemptedAt,
    principalCleanupError,
    ...rest
  } = entry;

  return {
    ...rest,
    authorizationId: grant?.authorizationId ?? null,
    accessId: grant?.authorizationId ?? null,
    saltoUserId: grant?.externalPrincipalId ?? null,
    pin: grant?.secret ?? null,
    saltoUserDeletedAt: principalRemovedAt ?? null,
    saltoUserCleanupError: principalCleanupError ?? null,
    saltoUserCleanupAttemptedAt: principalCleanupAttemptedAt ?? null,
  };
}

async function rewriteEntries(Booking, needsRewrite, convert) {
  const bookings = await Booking.find({
    "accessInfo.0": { $exists: true },
  }).lean();

  for (const booking of bookings) {
    const entries = booking.accessInfo;
    const outdated = (entry) => isEntry(entry) && needsRewrite(entry);

    if (!entries.some(outdated)) {
      continue;
    }

    await Booking.updateOne(
      { _id: booking._id },
      {
        $set: {
          accessInfo: entries.map((entry) =>
            outdated(entry) ? convert(entry) : entry,
          ),
        },
      },
    );
  }
}

module.exports = {
  name: "02-09-2026-move-access-grants",

  up: async function (mongoose) {
    await rewriteEntries(
      mongoose.model("Booking"),
      (entry) => !hasOwn(entry, "grant"),
      toGrantEntry,
    );
  },

  down: async function (mongoose) {
    await rewriteEntries(
      mongoose.model("Booking"),
      (entry) => hasOwn(entry, "grant"),
      toLegacyEntry,
    );
  },
};
