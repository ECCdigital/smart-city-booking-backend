const { expect } = require("chai");
const migration = require("../migrations/scripts/02-09-2026-move-access-grants");
const { createFakeMongoose } = require("./helpers/fake-mongoose");

const ENCRYPTED_PIN = { iv: "00ff", data: "abcd" };

function withoutProviderResponse(entry) {
  const rest = { ...entry };
  delete rest.providerResponse;
  return rest;
}

function nukiLegacyEntry() {
  return {
    accessPointId: "door-1",
    accessPointType: "door",
    provider: "nuki",
    externalId: "1001",
    mode: "authorization",
    authorizationId: "auth-1",
    accessId: "auth-1",
    saltoUserId: null,
    pin: ENCRYPTED_PIN,
    isProvisioned: true,
    provisionedAt: 1000,
    providerResponse: { id: "auth-1", code: 424242 },
    lastEvent: { type: "unlock", timestamp: 1500 },
  };
}

function saltoLegacyEntry() {
  return {
    accessPointId: "door-2",
    accessPointType: "door",
    provider: "salto-ks",
    externalId: "lock-2",
    mode: "authorization",
    authorizationId: "access-2",
    accessId: "access-2",
    saltoUserId: "user-1",
    pin: ENCRYPTED_PIN,
    isProvisioned: false,
    provisionedAt: 1000,
    revokedAt: 2000,
    saltoUserDeletedAt: null,
    saltoUserCleanupError: "User not found",
    saltoUserCleanupAttemptedAt: 2500,
    providerResponse: { access: "", userDeleteError: "User not found" },
  };
}

function remoteLegacyEntry() {
  return {
    accessPointId: "door-3",
    accessPointType: "door",
    provider: "nuki",
    externalId: "1003",
    mode: "remote",
    isProvisioned: true,
    provisionedAt: 1000,
  };
}

function storedBookings() {
  return [
    {
      _id: "10",
      id: "booking-1",
      tenantId: "tenant-1",
      accessInfo: [nukiLegacyEntry(), saltoLegacyEntry(), remoteLegacyEntry()],
    },
    { _id: "11", id: "booking-2", tenantId: "tenant-1", accessInfo: [] },
    { _id: "12", id: "booking-3", tenantId: "tenant-1" },
  ];
}

describe("02-09-2026-move-access-grants migration", () => {
  describe("up", () => {
    let mongoose;
    let entries;

    beforeEach(async () => {
      mongoose = createFakeMongoose({ Booking: storedBookings() });
      await migration.up(mongoose);
      entries = mongoose.model("Booking").documents[0].accessInfo;
    });

    it("moves a NUKI grant into `grant`, without a principal, its secret as it was", () => {
      expect(entries[0]).to.deep.equal({
        accessPointId: "door-1",
        accessPointType: "door",
        provider: "nuki",
        externalId: "1001",
        mode: "authorization",
        isProvisioned: true,
        provisionedAt: 1000,
        lastEvent: { type: "unlock", timestamp: 1500 },
        grant: {
          authorizationId: "auth-1",
          externalPrincipalId: null,
          secret: ENCRYPTED_PIN,
        },
        principalRemovedAt: null,
        principalCleanupAttemptedAt: null,
        principalCleanupError: null,
      });
    });

    it("moves a Salto grant with the guest as its principal and the cleanup fields renamed", () => {
      expect(entries[1]).to.deep.equal({
        accessPointId: "door-2",
        accessPointType: "door",
        provider: "salto-ks",
        externalId: "lock-2",
        mode: "authorization",
        isProvisioned: false,
        provisionedAt: 1000,
        revokedAt: 2000,
        grant: {
          authorizationId: "access-2",
          externalPrincipalId: "user-1",
          secret: ENCRYPTED_PIN,
        },
        principalRemovedAt: null,
        principalCleanupAttemptedAt: 2500,
        principalCleanupError: "User not found",
      });
    });

    it("gives an entry without an authorization no grant", () => {
      expect(entries[2]).to.deep.equal({
        accessPointId: "door-3",
        accessPointType: "door",
        provider: "nuki",
        externalId: "1003",
        mode: "remote",
        isProvisioned: true,
        provisionedAt: 1000,
        grant: null,
        principalRemovedAt: null,
        principalCleanupAttemptedAt: null,
        principalCleanupError: null,
      });
    });

    it("leaves bookings without entries as they are", () => {
      const [, second, third] = mongoose.model("Booking").documents;

      expect(second.accessInfo).to.deep.equal([]);
      expect(third).to.not.have.property("accessInfo");
    });

    it("changes nothing on a second run", async () => {
      const before = mongoose.snapshot();

      await migration.up(mongoose);

      expect(mongoose.snapshot()).to.deep.equal(before);
    });

    it("leaves an entry alone that already has a grant key", async () => {
      const already = {
        accessPointId: "door-4",
        authorizationId: "stale",
        grant: null,
      };
      mongoose = createFakeMongoose({
        Booking: [{ _id: "20", id: "booking-4", accessInfo: [already] }],
      });

      await migration.up(mongoose);

      expect(mongoose.model("Booking").documents[0].accessInfo).to.deep.equal([
        already,
      ]);
    });
  });

  describe("down", () => {
    it("moves the grant back into the flat fields, the provider answer lost", async () => {
      const mongoose = createFakeMongoose({ Booking: storedBookings() });
      await migration.up(mongoose);

      await migration.down(mongoose);

      const [nuki, salto, remote] =
        mongoose.model("Booking").documents[0].accessInfo;
      expect(nuki).to.deep.equal({
        ...withoutProviderResponse(nukiLegacyEntry()),
        saltoUserDeletedAt: null,
        saltoUserCleanupError: null,
        saltoUserCleanupAttemptedAt: null,
      });
      expect(salto).to.deep.equal(withoutProviderResponse(saltoLegacyEntry()));
      expect(remote).to.deep.equal({
        ...remoteLegacyEntry(),
        authorizationId: null,
        accessId: null,
        saltoUserId: null,
        pin: null,
        saltoUserDeletedAt: null,
        saltoUserCleanupError: null,
        saltoUserCleanupAttemptedAt: null,
      });
    });

    it("is undone by up again", async () => {
      const mongoose = createFakeMongoose({ Booking: storedBookings() });
      await migration.up(mongoose);
      const migrated = mongoose.snapshot();

      await migration.down(mongoose);
      await migration.up(mongoose);

      expect(mongoose.snapshot()).to.deep.equal(migrated);
    });
  });

  it("is named after its file", () => {
    expect(migration.name).to.equal("02-09-2026-move-access-grants");
  });
});
