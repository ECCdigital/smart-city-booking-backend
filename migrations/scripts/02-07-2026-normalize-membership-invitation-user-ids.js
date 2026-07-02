function normalizeUserId(userId) {
  return String(userId || "")
    .trim()
    .toLowerCase();
}

function getMembershipTimestamp(membership) {
  return new Date(membership.updatedAt || membership.createdAt || 0).getTime();
}

function isAcceptedMembership(membership) {
  return membership.status === "active";
}

/**
 * When duplicate memberships exist for the same tenant + email (case variants):
 * - Prefer an accepted (active) membership over any non-accepted one.
 * - If none are accepted, keep the newest record.
 */
function pickMembershipToKeep(memberships) {
  const accepted = memberships.filter(isAcceptedMembership);
  const candidates = accepted.length > 0 ? accepted : [...memberships];

  return candidates.sort(
    (a, b) => getMembershipTimestamp(b) - getMembershipTimestamp(a),
  )[0];
}

function getInvitationTimestamp(invitation) {
  return new Date(invitation.updatedAt || invitation.createdAt || 0).getTime();
}

function isConsumedInvitation(invitation) {
  return (invitation.usedCount || 0) >= 1 || invitation.status === "exhausted";
}

function isActiveSingleInvitation(invitation) {
  return (
    invitation.type === "single" &&
    invitation.status === "active" &&
    (invitation.usedCount || 0) < 1
  );
}

/**
 * When duplicate single-use invitations exist for the same tenant + email:
 * - Prefer a consumed invitation over an unused duplicate.
 * - If none are consumed, keep the newest active invitation.
 * - Otherwise keep the newest record.
 */
function pickInvitationToKeep(invitations) {
  const consumed = invitations.filter(isConsumedInvitation);
  if (consumed.length > 0) {
    return consumed.sort(
      (a, b) => getInvitationTimestamp(b) - getInvitationTimestamp(a),
    )[0];
  }

  const active = invitations.filter(isActiveSingleInvitation);
  const candidates = active.length > 0 ? active : [...invitations];

  return candidates.sort(
    (a, b) => getInvitationTimestamp(b) - getInvitationTimestamp(a),
  )[0];
}

module.exports = {
  name: "02-07-2026-normalize-membership-invitation-user-ids",
  pickMembershipToKeep,
  pickInvitationToKeep,
  normalizeUserId,

  up: async function (mongoose) {
    const Membership = mongoose.model("Membership");
    const Invitation = mongoose.model("Invitation");

    const allMemberships = await Membership.find({}).lean();
    const groups = new Map();

    for (const membership of allMemberships) {
      const key = `${membership.tenantId}::${normalizeUserId(membership.userId)}`;
      if (!groups.has(key)) {
        groups.set(key, []);
      }
      groups.get(key).push(membership);
    }

    let deletedDuplicates = 0;

    for (const [key, group] of groups) {
      if (group.length <= 1) {
        continue;
      }

      const toKeep = pickMembershipToKeep(group);
      const toDelete = group.filter(
        (membership) => membership._id.toString() !== toKeep._id.toString(),
      );

      for (const membership of toDelete) {
        console.log(
          `  Removing duplicate membership ${membership._id} (status=${membership.status}) - keeping ${toKeep._id} (status=${toKeep.status}) for ${key}`,
        );
        await Membership.deleteOne({ _id: membership._id });
        deletedDuplicates += 1;
      }
    }

    console.log(`Removed ${deletedDuplicates} duplicate membership(s)`);

    const membershipsToNormalize = await Membership.find({
      userId: { $exists: true, $ne: "" },
    });

    let normalizedMemberships = 0;

    for (const membership of membershipsToNormalize) {
      const normalizedUserId = normalizeUserId(membership.userId);
      if (membership.userId !== normalizedUserId) {
        await Membership.updateOne(
          { _id: membership._id },
          { $set: { userId: normalizedUserId } },
        );
        normalizedMemberships += 1;
      }
    }

    console.log(`Normalized ${normalizedMemberships} membership userId(s)`);

    const singleInvitations = await Invitation.find({
      type: "single",
      intendedUserId: { $exists: true, $nin: [null, ""] },
    }).lean();

    const invitationGroups = new Map();

    for (const invitation of singleInvitations) {
      const key = `${invitation.tenantId}::${normalizeUserId(invitation.intendedUserId)}`;
      if (!invitationGroups.has(key)) {
        invitationGroups.set(key, []);
      }
      invitationGroups.get(key).push(invitation);
    }

    let deletedInvitationDuplicates = 0;

    for (const [key, group] of invitationGroups) {
      if (group.length <= 1) {
        continue;
      }

      const toKeep = pickInvitationToKeep(group);
      const toDelete = group.filter(
        (invitation) => invitation._id.toString() !== toKeep._id.toString(),
      );

      for (const invitation of toDelete) {
        console.log(
          `  Removing duplicate invitation ${invitation._id} (status=${invitation.status}) - keeping ${toKeep._id} (status=${toKeep.status}) for ${key}`,
        );
        await Invitation.deleteOne({ _id: invitation._id });
        await Membership.updateMany(
          { tenantId: invitation.tenantId },
          { $pull: { invitations: { token: invitation.token } } },
        );
        deletedInvitationDuplicates += 1;
      }
    }

    console.log(
      `Removed ${deletedInvitationDuplicates} duplicate invitation(s)`,
    );

    const invitationsToNormalize = await Invitation.find({
      intendedUserId: { $exists: true, $nin: [null, ""] },
    });

    let normalizedInvitations = 0;

    for (const invitation of invitationsToNormalize) {
      const normalizedUserId = normalizeUserId(invitation.intendedUserId);
      if (invitation.intendedUserId !== normalizedUserId) {
        await Invitation.updateOne(
          { _id: invitation._id },
          { $set: { intendedUserId: normalizedUserId } },
        );
        normalizedInvitations += 1;
      }
    }

    console.log(
      `Normalized ${normalizedInvitations} invitation intendedUserId(s)`,
    );

    // Build invitation indexes after deduplication/normalization so startup
    // cannot fail on legacy duplicates before this migration has run.
    await Invitation.collection.createIndex({ token: 1 }, { unique: true });
    await Invitation.collection.createIndex(
      { tenantId: 1, intendedUserId: 1 },
      {
        unique: true,
        collation: { locale: "en", strength: 2 },
        partialFilterExpression: {
          type: "single",
          status: "active",
          usedCount: { $lt: 1 },
          intendedUserId: { $exists: true, $ne: "" },
        },
      },
    );
  },
};
