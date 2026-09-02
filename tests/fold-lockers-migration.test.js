/**
 * The migration of the locker fold: the locker systems configured at the
 * bookables as `lockerDetails.units` and noted at the bookings as
 * `lockerInfo` become rows of `accesspoints`, referenced by the bookables
 * and held or granted at the bookings as `accessInfo` entries; the two
 * locker applications become access applications. `down` puts both back.
 */

const { expect } = require("chai");

const migration = require("../migrations/scripts/02-09-2026-fold-lockers-into-access-points");
const {
  deriveLockerInfo,
} = require("../src/commons/entities/booking/locker-info");
const { createFakeMongoose } = require("./helpers/fake-mongoose");

const TENANT = "tenant-1";
const IFBS_LOCATION = "7";
const SIZE_S = "S";
const SIZE_M = "M";
const PAREVA_LOCKER_ID = "L1";
const HOLD_TTL_MS = 2 * 60 * 1000;

const DOOR_ENTRY = {
  accessPointId: "door-1",
  accessPointType: "door",
  provider: "nuki",
  externalId: "1001",
  mode: "authorization",
  isProvisioned: true,
  provisionedAt: 1000,
  grant: { authorizationId: "auth-1", externalPrincipalId: null, secret: null },
};

function ifbsRecord(overrides = {}) {
  return {
    id: IFBS_LOCATION,
    lockerSystem: "ifbs",
    bookableId: "bikebox",
    isConfirmed: true,
    processId: "100",
    ifbsMetadata: {
      boxId: "box-1",
      nummer: "62100103",
      price: "1.50",
      bookingId: "100",
    },
    ...overrides,
  };
}

function parevaRecord(overrides = {}) {
  return {
    id: SIZE_S,
    lockerSystem: "pareva",
    bookableId: "locker-s",
    isConfirmed: true,
    processId: "p-1",
    ...overrides,
  };
}

function tenants() {
  return [
    {
      _id: "t1",
      id: TENANT,
      applications: [
        { type: "payment", id: "invoice", active: true },
        {
          type: "locker",
          id: "ifbs",
          active: true,
          serverUrl: "https://ifbs.example.test",
          apiKey: { iv: "00", data: "ff" },
          secretPhrase: { iv: "00", data: "ee" },
        },
        {
          type: "locker",
          id: "pareva",
          active: true,
          serverUrl: "https://pareva.example.test",
          lockerId: PAREVA_LOCKER_ID,
          user: "user",
          password: { iv: "00", data: "dd" },
        },
      ],
    },
  ];
}

function bookables() {
  return [
    {
      _id: "b1",
      id: "bikebox",
      tenantId: TENANT,
      title: "Fahrradbox",
      amount: 10,
      lockerDetails: {
        active: true,
        units: [{ lockerSystem: "ifbs", locationId: IFBS_LOCATION, amount: 2 }],
      },
      externalProviders: [],
    },
    {
      _id: "b2",
      id: "locker-s",
      tenantId: TENANT,
      title: "Schließfach S",
      amount: 10,
      lockerDetails: {
        active: true,
        units: [{ id: SIZE_S, lockerSystem: "pareva", amount: "2" }],
      },
      accessPointDetails: {
        active: false,
        accessBuffer: { before: 0, after: 0 },
        accessPointIds: [],
      },
      externalProviders: [],
    },
    {
      _id: "b3",
      id: "room",
      tenantId: TENANT,
      title: "Raum",
      amount: 1,
      lockerDetails: { active: false, units: [] },
      accessPointDetails: {
        active: true,
        accessBuffer: { before: 0, after: 0 },
        accessPointIds: ["door-1"],
      },
      externalProviders: [],
    },
  ];
}

function bookings() {
  return [
    {
      _id: "k1",
      id: "ifbs-confirmed",
      tenantId: TENANT,
      accessInfo: [DOOR_ENTRY],
      lockerInfo: [ifbsRecord()],
    },
    {
      _id: "k2",
      id: "ifbs-held",
      tenantId: TENANT,
      accessInfo: [],
      lockerInfo: [
        ifbsRecord({
          isConfirmed: false,
          processId: null,
          ifbsMetadata: {
            boxId: "box-2",
            nummer: "62100104",
            price: "1.50",
            bookingId: "101",
            preReservedAt: 5000,
          },
        }),
      ],
    },
    {
      _id: "k3",
      id: "pareva-confirmed",
      tenantId: TENANT,
      lockerInfo: [parevaRecord(), parevaRecord({ processId: "p-2" })],
    },
    {
      _id: "k4",
      id: "pareva-held",
      tenantId: TENANT,
      accessInfo: [],
      lockerInfo: [
        parevaRecord({ isConfirmed: false, processId: null, preReservedAt: 1 }),
      ],
    },
    {
      _id: "k5",
      id: "unit-dropped",
      tenantId: TENANT,
      accessInfo: [],
      lockerInfo: [
        parevaRecord({ id: SIZE_M, bookableId: "locker-m", processId: "p-9" }),
      ],
    },
    {
      _id: "k6",
      id: "fold-3",
      tenantId: TENANT,
      accessInfo: [
        {
          accessPointId: `locker:ifbs:${IFBS_LOCATION}`,
          accessPointType: "locker",
          provider: "ifbs",
          externalId: IFBS_LOCATION,
          mode: "remote",
          bookableId: "bikebox",
          hold: null,
          compartment: "62100105",
          metadata: { boxId: "box-3", price: "1.50" },
          externalBookingId: "102",
          isProvisioned: true,
          provisionedAt: 2000,
          revokedAt: null,
          grant: {
            authorizationId: "102",
            externalPrincipalId: null,
            secret: null,
          },
        },
      ],
    },
    { _id: "k7", id: "plain", tenantId: TENANT, accessInfo: [] },
  ];
}

function accessPoints() {
  return [
    {
      id: "door-1",
      tenantId: TENANT,
      type: "door",
      provider: "nuki",
      externalId: "1001",
      mode: "authorization",
      scanCode: "code-door-1",
      previousScanCodes: [],
    },
  ];
}

function withoutPreReservedAt(record) {
  const { preReservedAt, ...rest } = record;
  if (rest.ifbsMetadata) {
    const { preReservedAt: _, ...metadata } = rest.ifbsMetadata;
    rest.ifbsMetadata = metadata;
  }
  return rest;
}

describe("02-09-2026-fold-lockers-into-access-points migration", () => {
  let mongoose;
  const model = (name) => mongoose.model(name).documents;
  const lockerRows = () =>
    model("AccessPoint").filter((row) => row.type === "locker");
  const row = (provider, externalId) =>
    lockerRows().find(
      (candidate) =>
        candidate.provider === provider && candidate.externalId === externalId,
    );
  const bookable = (id) => model("Bookable").find((doc) => doc.id === id);
  const booking = (id) => model("Booking").find((doc) => doc.id === id);
  const compartments = (id) =>
    booking(id).accessInfo.filter(
      (entry) => entry.accessPointType === "locker",
    );

  beforeEach(() => {
    mongoose = createFakeMongoose({
      Tenant: tenants(),
      Bookable: bookables(),
      Booking: bookings(),
      AccessPoint: accessPoints(),
    });
  });

  describe("up", () => {
    beforeEach(async () => {
      await migration.up(mongoose);
    });

    it("makes one locker row per iFBS location, remote, located at the location", () => {
      expect(lockerRows()).to.have.length(3);
      const ifbs = row("ifbs", IFBS_LOCATION);
      expect(ifbs).to.include({
        tenantId: TENANT,
        type: "locker",
        provider: "ifbs",
        externalId: IFBS_LOCATION,
        providerLocationId: IFBS_LOCATION,
        label: "Fahrradbox",
        mode: "remote",
      });
      expect(ifbs.id).to.be.a("string").that.is.not.empty;
      expect(ifbs.scanCode).to.be.a("string").that.is.not.empty;
      expect(ifbs.validationRules).to.deep.equal([]);
    });

    it("makes one locker row per Pareva size, taking a code, located at the locker system of the application", () => {
      expect(row("pareva", SIZE_S)).to.include({
        provider: "pareva",
        externalId: SIZE_S,
        providerLocationId: PAREVA_LOCKER_ID,
        label: "Schließfach S",
        mode: "authorization",
      });
    });

    it("makes a row for a size only a booking still names, since its compartment has to be revoked somewhere", () => {
      expect(row("pareva", SIZE_M)).to.include({
        externalId: SIZE_M,
        providerLocationId: PAREVA_LOCKER_ID,
        label: SIZE_M,
      });
      expect(
        model("Bookable").some((doc) =>
          (doc.accessPointDetails?.accessPointIds || []).includes(
            row("pareva", SIZE_M).id,
          ),
        ),
      ).to.equal(false);
    });

    it("references the rows from the bookables, switches their access points on and drops lockerDetails", () => {
      expect(bookable("bikebox").accessPointDetails).to.deep.include({
        active: true,
        accessPointIds: [row("ifbs", IFBS_LOCATION).id],
      });
      expect(bookable("locker-s").accessPointDetails).to.deep.include({
        active: true,
        accessBuffer: { before: 0, after: 0 },
        accessPointIds: [row("pareva", SIZE_S).id],
      });
      expect(bookable("bikebox")).to.not.have.property("lockerDetails");
      expect(bookable("locker-s")).to.not.have.property("lockerDetails");
    });

    it("keeps the iFBS price provider of the bookable at the location", () => {
      expect(bookable("bikebox").externalProviders).to.deep.equal([
        {
          active: false,
          provider: "ifbs",
          handles: ["pricing", "availability", "maxAmount"],
          config: { locationId: IFBS_LOCATION, amount: 1 },
        },
      ]);
    });

    it("lets the Pareva unit's amount become the bookable's capacity where it was the smaller one", () => {
      expect(bookable("locker-s").amount).to.equal(2);
      expect(bookable("bikebox").amount).to.equal(10);
    });

    it("takes lockerDetails off a bookable without locker systems and leaves the rest", () => {
      const { lockerDetails, ...room } = bookables()[2];
      expect(bookable("room")).to.deep.equal(room);
    });

    it("turns a confirmed iFBS record into a granted compartment after the doors, and drops lockerInfo", () => {
      const { accessInfo } = booking("ifbs-confirmed");
      expect(accessInfo[0]).to.deep.equal(DOOR_ENTRY);
      expect(accessInfo[1]).to.deep.equal({
        accessPointId: row("ifbs", IFBS_LOCATION).id,
        accessPointType: "locker",
        provider: "ifbs",
        externalId: IFBS_LOCATION,
        mode: "remote",
        bookableId: "bikebox",
        hold: null,
        compartment: "62100103",
        metadata: { boxId: "box-1", price: "1.50" },
        externalBookingId: "100",
        isProvisioned: true,
        provisionedAt: null,
        revokedAt: null,
        grant: {
          authorizationId: "100",
          externalPrincipalId: null,
          secret: null,
        },
      });
      expect(booking("ifbs-confirmed")).to.not.have.property("lockerInfo");
    });

    it("turns an unconfirmed iFBS record into a held compartment, the hold dated from when it was taken", () => {
      const [entry] = compartments("ifbs-held");
      expect(entry).to.deep.include({
        hold: {
          holdId: "101",
          expiresAt: 5000 + HOLD_TTL_MS,
          compartment: "62100104",
        },
        compartment: "62100104",
        metadata: { boxId: "box-2", price: "1.50" },
        externalBookingId: null,
        isProvisioned: false,
        grant: null,
      });
    });

    it("turns confirmed Pareva records into one granted compartment each", () => {
      const entries = compartments("pareva-confirmed");
      expect(entries.map((entry) => entry.grant.authorizationId)).to.deep.equal(
        ["p-1", "p-2"],
      );
      expect(entries[0]).to.deep.include({
        accessPointId: row("pareva", SIZE_S).id,
        provider: "pareva",
        externalId: SIZE_S,
        mode: "authorization",
        bookableId: "locker-s",
        hold: null,
        compartment: null,
        metadata: null,
        externalBookingId: "p-1",
        isProvisioned: true,
      });
    });

    it("turns an unconfirmed Pareva record into a compartment held by the platform", () => {
      expect(compartments("pareva-held")[0]).to.deep.include({
        hold: { holdId: null, expiresAt: null, compartment: null },
        isProvisioned: false,
        grant: null,
      });
    });

    it("grants a record at the row of the size no bookable offers any more", () => {
      expect(compartments("unit-dropped")[0]).to.deep.include({
        accessPointId: row("pareva", SIZE_M).id,
        bookableId: "locker-m",
        grant: {
          authorizationId: "p-9",
          externalPrincipalId: null,
          secret: null,
        },
      });
    });

    it("moves the compartments made since the checkout fold from the synthesized id to the row", () => {
      const [entry] = compartments("fold-3");
      expect(entry.accessPointId).to.equal(row("ifbs", IFBS_LOCATION).id);
      expect(entry.grant.authorizationId).to.equal("102");
    });

    it("reads as the lockerInfo it was", () => {
      for (const stored of bookings().filter((doc) => doc.lockerInfo)) {
        expect(deriveLockerInfo(booking(stored.id).accessInfo)).to.deep.equal(
          stored.lockerInfo.map(withoutPreReservedAt),
        );
      }
    });

    it("turns the locker applications into access applications and leaves the rest", () => {
      const [tenant] = model("Tenant");
      expect(
        tenant.applications.map((app) => [app.type, app.id]),
      ).to.deep.equal([
        ["payment", "invoice"],
        ["access", "ifbs"],
        ["access", "pareva"],
      ]);
      expect(tenant.applications[1]).to.deep.equal({
        ...tenants()[0].applications[1],
        type: "access",
      });
    });

    it("changes nothing when run again", async () => {
      const before = mongoose.snapshot();
      await migration.up(mongoose);
      expect(mongoose.snapshot()).to.deep.equal(before);
    });
  });

  describe("down", () => {
    beforeEach(async () => {
      await migration.up(mongoose);
      await migration.down(mongoose);
    });

    it("puts the units back at the bookables, with the bookable's amount, and drops the references", () => {
      expect(bookable("bikebox").lockerDetails).to.deep.equal({
        active: true,
        units: [
          { lockerSystem: "ifbs", locationId: IFBS_LOCATION, amount: 10 },
        ],
      });
      expect(
        bookable("bikebox").accessPointDetails.accessPointIds,
      ).to.deep.equal([]);
      expect(bookable("locker-s").lockerDetails).to.deep.equal({
        active: true,
        units: [{ id: SIZE_S, lockerSystem: "pareva", amount: 2 }],
      });
      const { lockerDetails, ...room } = bookables()[2];
      expect(bookable("room")).to.deep.equal(room);
    });

    it("puts lockerInfo back at the bookings and takes the compartments out of accessInfo", () => {
      for (const stored of bookings().filter((doc) => doc.lockerInfo)) {
        expect(booking(stored.id).lockerInfo).to.deep.equal(
          stored.lockerInfo.map(withoutPreReservedAt),
        );
        expect(compartments(stored.id)).to.deep.equal([]);
      }
      expect(booking("ifbs-confirmed").accessInfo).to.deep.equal([DOOR_ENTRY]);
      expect(booking("fold-3").lockerInfo).to.deep.equal([
        {
          id: IFBS_LOCATION,
          lockerSystem: "ifbs",
          bookableId: "bikebox",
          isConfirmed: true,
          processId: "102",
          ifbsMetadata: {
            boxId: "box-3",
            nummer: "62100105",
            price: "1.50",
            bookingId: "102",
          },
        },
      ]);
      expect(booking("plain")).to.deep.equal(bookings()[6]);
    });

    it("makes the applications locker applications again", () => {
      expect(model("Tenant")[0].applications).to.deep.equal(
        tenants()[0].applications,
      );
    });

    it("removes the locker rows and keeps the doors", () => {
      expect(model("AccessPoint").map((doc) => doc.id)).to.deep.equal([
        "door-1",
      ]);
    });
  });
});
