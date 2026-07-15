const { expect } = require("chai");
const {
  GroupBookingPermissions,
} = require("../src/commons/utilities/group-booking-permissions");

describe("group-booking-permissions", () => {
  const identity = { id: "user-1" };

  function bookable(overrides = {}) {
    return {
      groupBooking: { enabled: false, permittedRoles: [] },
      ...overrides,
    };
  }

  describe("isAllowed", () => {
    it("returns false when group booking is disabled", () => {
      expect(
        GroupBookingPermissions.isAllowed(
          bookable({
            groupBooking: { enabled: false, permittedRoles: [] },
          }),
          identity,
          ["admin"],
        ),
      ).to.equal(false);
    });

    it("returns true when enabled without role restrictions for guests", () => {
      expect(
        GroupBookingPermissions.isAllowed(
          bookable({
            groupBooking: { enabled: true, permittedRoles: [] },
          }),
          null,
          null,
        ),
      ).to.equal(true);
    });

    it("returns true when enabled without role restrictions for logged-in users", () => {
      expect(
        GroupBookingPermissions.isAllowed(
          bookable({
            groupBooking: { enabled: true, permittedRoles: [] },
          }),
          identity,
          ["member"],
        ),
      ).to.equal(true);
    });

    it("returns false when roles are required but user is not logged in", () => {
      expect(
        GroupBookingPermissions.isAllowed(
          bookable({
            groupBooking: { enabled: true, permittedRoles: ["staff"] },
          }),
          null,
          null,
        ),
      ).to.equal(false);
    });

    it("returns true when user has a permitted role", () => {
      expect(
        GroupBookingPermissions.isAllowed(
          bookable({
            groupBooking: { enabled: true, permittedRoles: ["staff", "admin"] },
          }),
          identity,
          ["staff"],
        ),
      ).to.equal(true);
    });

    it("returns false when user lacks a permitted role", () => {
      expect(
        GroupBookingPermissions.isAllowed(
          bookable({
            groupBooking: { enabled: true, permittedRoles: ["staff"] },
          }),
          identity,
          ["member"],
        ),
      ).to.equal(false);
    });

    it("returns false when groupBooking is missing", () => {
      expect(
        GroupBookingPermissions.isAllowed({}, identity, ["staff"]),
      ).to.equal(false);
    });
  });
});
