/**
 * `booking.lockerInfo` is a read field derived from the booking's
 * `accessInfo` entries of type `locker`, in the shape the locker stack used
 * to store: one record per compartment, confirmed once granted, with iFBS'
 * box facts under `ifbsMetadata`. Nothing writes it - a value handed to the
 * entity is ignored - and it goes out with the booking as it always did.
 */

const { expect } = require("chai");

const { Booking } = require("../src/commons/entities/booking/booking");
const {
  deriveLockerInfo,
} = require("../src/commons/entities/booking/locker-info");

const IFBS_HELD = {
  accessPointId: "loc-7",
  accessPointType: "locker",
  provider: "ifbs",
  externalId: "7",
  mode: "remote",
  bookableId: "bikebox",
  hold: { holdId: "100", expiresAt: 1, compartment: "62100103" },
  compartment: "62100103",
  metadata: { boxId: "box-62100103", price: "1.50" },
  externalBookingId: null,
  isProvisioned: false,
  provisionedAt: null,
  revokedAt: null,
  grant: null,
};

const IFBS_GRANTED = {
  ...IFBS_HELD,
  hold: null,
  externalBookingId: "100",
  isProvisioned: true,
  provisionedAt: 2,
  grant: { authorizationId: "100", externalPrincipalId: null, secret: null },
};

const PAREVA_GRANTED = {
  accessPointId: "size-s",
  accessPointType: "locker",
  provider: "pareva",
  externalId: "S",
  mode: "authorization",
  bookableId: "locker-s",
  hold: null,
  compartment: null,
  metadata: null,
  externalBookingId: "process-1",
  isProvisioned: true,
  provisionedAt: 2,
  revokedAt: null,
  grant: {
    authorizationId: "process-1",
    externalPrincipalId: null,
    secret: null,
  },
};

const DOOR = {
  accessPointId: "door-1",
  accessPointType: "door",
  provider: "nuki",
  externalId: "n-1",
  mode: "remote",
  isProvisioned: true,
  grant: { authorizationId: "a-1", externalPrincipalId: null, secret: null },
};

describe("booking.lockerInfo, derived from the compartments", function () {
  const cases = [
    {
      name: "a held iFBS box: unconfirmed, the box number and hold noted",
      accessInfo: [IFBS_HELD],
      lockerInfo: [
        {
          id: "7",
          lockerSystem: "ifbs",
          bookableId: "bikebox",
          isConfirmed: false,
          processId: null,
          ifbsMetadata: {
            boxId: "box-62100103",
            nummer: "62100103",
            price: "1.50",
            bookingId: "100",
          },
        },
      ],
    },
    {
      name: "a granted iFBS box: confirmed under the iFBS booking id",
      accessInfo: [IFBS_GRANTED],
      lockerInfo: [
        {
          id: "7",
          lockerSystem: "ifbs",
          bookableId: "bikebox",
          isConfirmed: true,
          processId: "100",
          ifbsMetadata: {
            boxId: "box-62100103",
            nummer: "62100103",
            price: "1.50",
            bookingId: "100",
          },
        },
      ],
    },
    {
      name: "a revoked iFBS box: unconfirmed again, without a process",
      accessInfo: [{ ...IFBS_GRANTED, isProvisioned: false, revokedAt: 3 }],
      lockerInfo: [
        {
          id: "7",
          lockerSystem: "ifbs",
          bookableId: "bikebox",
          isConfirmed: false,
          processId: null,
          ifbsMetadata: {
            boxId: "box-62100103",
            nummer: "62100103",
            price: "1.50",
            bookingId: null,
          },
        },
      ],
    },
    {
      name: "a Pareva rental: confirmed under its process, no iFBS facts",
      accessInfo: [PAREVA_GRANTED],
      lockerInfo: [
        {
          id: "S",
          lockerSystem: "pareva",
          bookableId: "locker-s",
          isConfirmed: true,
          processId: "process-1",
        },
      ],
    },
    {
      name: "a Pareva compartment only held by the platform",
      accessInfo: [
        {
          ...PAREVA_GRANTED,
          hold: { holdId: null, expiresAt: null, compartment: null },
          grant: null,
          externalBookingId: null,
          isProvisioned: false,
        },
      ],
      lockerInfo: [
        {
          id: "S",
          lockerSystem: "pareva",
          bookableId: "locker-s",
          isConfirmed: false,
          processId: null,
        },
      ],
    },
    {
      name: "doors are not compartments",
      accessInfo: [DOOR, PAREVA_GRANTED],
      lockerInfo: [
        {
          id: "S",
          lockerSystem: "pareva",
          bookableId: "locker-s",
          isConfirmed: true,
          processId: "process-1",
        },
      ],
    },
    { name: "no entries, no compartments", accessInfo: [], lockerInfo: [] },
    { name: "no accessInfo at all", accessInfo: undefined, lockerInfo: [] },
  ];

  for (const { name, accessInfo, lockerInfo } of cases) {
    it(name, function () {
      expect(deriveLockerInfo(accessInfo)).to.deep.equal(lockerInfo);
    });
  }

  describe("at the entity", function () {
    it("reads the compartments of the booking's accessInfo, as stored right now", function () {
      const booking = new Booking({ accessInfo: [IFBS_HELD] });

      expect(booking.lockerInfo[0]).to.include({ isConfirmed: false });

      booking.accessInfo = [IFBS_GRANTED];

      expect(booking.lockerInfo[0]).to.include({
        isConfirmed: true,
        processId: "100",
      });
    });

    it("ignores a lockerInfo handed in - the admin form still sends one", function () {
      const booking = new Booking({
        accessInfo: [PAREVA_GRANTED],
        lockerInfo: [{ id: "X", lockerSystem: "pareva", isConfirmed: true }],
      });

      expect(booking.lockerInfo).to.deep.equal(
        deriveLockerInfo([PAREVA_GRANTED]),
      );

      booking.lockerInfo = null;

      expect(booking.lockerInfo).to.have.length(1);
    });

    it("goes out with the booking, as a field of its own", function () {
      const booking = new Booking({ id: "B-1", accessInfo: [PAREVA_GRANTED] });

      const serialized = JSON.parse(JSON.stringify(booking));
      expect(serialized.lockerInfo).to.deep.equal(
        deriveLockerInfo([PAREVA_GRANTED]),
      );
      expect({ ...booking }.lockerInfo).to.deep.equal(serialized.lockerInfo);
    });

    it("is never written to the store: it is no own data property of the entity", function () {
      const booking = new Booking({ accessInfo: [PAREVA_GRANTED] });

      const descriptor = Object.getOwnPropertyDescriptor(booking, "lockerInfo");
      expect(descriptor).to.include({ enumerable: true });
      expect(descriptor.get).to.be.a("function");
      expect(descriptor).to.not.have.property("value");
    });
  });
});
