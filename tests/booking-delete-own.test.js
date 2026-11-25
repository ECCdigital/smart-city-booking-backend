/**
 * The hard delete of a booking (`booking.delete`): `manageBookings.deleteOwn`
 * reaches the holder's own bookings over the owner key `assignedUserId`,
 * `manageBookings.deleteAny` every booking of the tenant. A signed-in user
 * or a member without the role level deletes nothing - customers cancel,
 * they do not delete.
 */

const { expect } = require("chai");

const {
  decide,
  REACH,
} = require("../src/commons/services/authorization/policy");
const { ownerKeyOf } = require("../src/commons/services/authorization/table");

function principal(overrides = {}) {
  return {
    userId: "user-1",
    tenantId: "tenant-1",
    isInstanceOwner: false,
    isMember: false,
    isTenantOwner: false,
    grants: {},
    mayCreateTenant: false,
    ...overrides,
  };
}

function holderOf(step) {
  return principal({
    isMember: true,
    grants: { manageBookings: { [step]: true } },
  });
}

describe("booking.delete", function () {
  it("reaches the own bookings with manageBookings.deleteOwn", function () {
    expect(decide(holderOf("deleteOwn"), "booking", "delete")).to.equal(
      REACH.OWN,
    );
  });

  it("reaches every booking with manageBookings.deleteAny", function () {
    expect(decide(holderOf("deleteAny"), "booking", "delete")).to.equal(
      REACH.ANY,
    );
  });

  it("refuses a signed-in user and a member without the role level", function () {
    expect(decide(principal(), "booking", "delete")).to.equal(null);
    expect(decide(principal({ isMember: true }), "booking", "delete")).to.equal(
      null,
    );
    expect(decide(holderOf("updateAny"), "booking", "delete")).to.equal(null);
  });

  it("names the booking's assigned user as the owner", function () {
    expect(ownerKeyOf("booking", "delete")).to.deep.equal({
      key: "assignedUserId",
    });
  });
});
