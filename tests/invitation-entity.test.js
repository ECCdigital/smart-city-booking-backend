const { expect } = require("chai");
const Invitation = require("../src/commons/entities/tenant/invitation");

describe("Invitation.isUsable", () => {
  const NOW = 1_700_000_000_000;

  function invitation(overrides = {}) {
    return new Invitation({
      tenantId: "t1",
      token: "tok",
      type: "single",
      ...overrides,
    });
  }

  it("accepts an active single invitation nobody used", () => {
    expect(Invitation.isUsable(invitation(), NOW)).to.be.true;
  });

  it("accepts an invitation up to and including its expiry", () => {
    expect(Invitation.isUsable(invitation({ expiresAt: NOW }), NOW)).to.be.true;
    expect(Invitation.isUsable(invitation({ expiresAt: NOW - 1 }), NOW)).to.be
      .false;
  });

  it("refuses a used single invitation", () => {
    expect(Invitation.isUsable(invitation({ usedCount: 1 }), NOW)).to.be.false;
  });

  it("refuses a multi invitation at its limit and accepts one without a limit", () => {
    const multi = { type: "multi", usedCount: 3 };
    expect(Invitation.isUsable(invitation({ ...multi, maxUses: 3 }), NOW)).to.be
      .false;
    expect(Invitation.isUsable(invitation({ ...multi, maxUses: 4 }), NOW)).to.be
      .true;
    expect(Invitation.isUsable(invitation({ ...multi, maxUses: null }), NOW)).to
      .be.true;
  });

  it("refuses an invitation that is not active", () => {
    for (const status of ["revoked", "rejected", "exhausted"]) {
      expect(Invitation.isUsable(invitation({ status }), NOW)).to.be.false;
    }
  });
});
