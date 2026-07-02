const { expect } = require("chai");
const {
  normalizeUserId,
  userIdsMatch,
} = require("../src/commons/utilities/user-id-utils");
const Invitation = require("../src/commons/entities/tenant/invitation");
const Membership = require("../src/commons/entities/tenant/membership");
const {
  pickMembershipToKeep,
  pickInvitationToKeep,
} = require("../migrations/scripts/02-07-2026-normalize-membership-invitation-user-ids");

describe("user-id-utils", () => {
  it("normalizes email to lowercase and trims whitespace", () => {
    expect(normalizeUserId("  A.Beispiel@Musterstadt.de  ")).to.equal(
      "a.beispiel@musterstadt.de",
    );
  });

  it("matches user ids case-insensitively", () => {
    expect(userIdsMatch("A@test.de", "a@test.de")).to.equal(true);
    expect(userIdsMatch("a@test.de", "b@test.de")).to.equal(false);
  });
});

describe("Invitation entity", () => {
  it("lowercases intendedUserId on construction", () => {
    const invitation = new Invitation({
      intendedUserId: "A.Beispiel@Musterstadt.de",
      tenantId: "tenant-1",
      token: "token",
      type: "single",
    });

    expect(invitation.intendedUserId).to.equal("a.beispiel@musterstadt.de");
  });
});

describe("Membership entity", () => {
  it("lowercases userId on construction", () => {
    const membership = new Membership({
      userId: "A.Beispiel@Musterstadt.de",
      tenantId: "tenant-1",
      source: "invite",
    });

    expect(membership.userId).to.equal("a.beispiel@musterstadt.de");
  });
});

describe("membership duplicate resolution", () => {
  it("keeps the accepted membership when one is active and one is pending", () => {
    const active = {
      _id: "1",
      status: "active",
      createdAt: new Date("2026-01-01"),
    };
    const pending = {
      _id: "2",
      status: "pending",
      createdAt: new Date("2026-06-01"),
    };

    expect(pickMembershipToKeep([pending, active])._id).to.equal("1");
  });

  it("keeps the newest membership when none are accepted", () => {
    const older = {
      _id: "1",
      status: "pending",
      createdAt: new Date("2026-01-01"),
    };
    const newer = {
      _id: "2",
      status: "pending",
      createdAt: new Date("2026-06-01"),
    };

    expect(pickMembershipToKeep([older, newer])._id).to.equal("2");
  });
});

describe("invitation duplicate resolution", () => {
  it("keeps the consumed invitation when one is used and one is still active", () => {
    const consumed = {
      _id: "1",
      type: "single",
      status: "exhausted",
      usedCount: 1,
      createdAt: new Date("2026-01-01"),
    };
    const active = {
      _id: "2",
      type: "single",
      status: "active",
      usedCount: 0,
      createdAt: new Date("2026-06-01"),
    };

    expect(pickInvitationToKeep([active, consumed])._id).to.equal("1");
  });

  it("keeps the newest active invitation when none are consumed", () => {
    const older = {
      _id: "1",
      type: "single",
      status: "active",
      usedCount: 0,
      createdAt: new Date("2026-01-01"),
    };
    const newer = {
      _id: "2",
      type: "single",
      status: "active",
      usedCount: 0,
      createdAt: new Date("2026-06-01"),
    };

    expect(pickInvitationToKeep([older, newer])._id).to.equal("2");
  });
});
