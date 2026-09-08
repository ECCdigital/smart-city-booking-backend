const { expect } = require("chai");

const {
  planAccessPointMigration,
} = require("../migrations/lib/access-point-migration");
const migration = require("../migrations/scripts/12-08-2026-migrate-bookable-access-points");
const { createFakeMongoose } = require("./helpers/fake-mongoose");

function bookable(id, points, overrides = {}) {
  return {
    _id: id,
    id: id,
    tenantId: "tenant-1",
    accessPointDetails: { active: true, points: points },
    ...overrides,
  };
}

function point(overrides = {}) {
  return {
    id: "point-1",
    provider: "nuki",
    externalId: "lock-1",
    label: "Haupteingang",
    mode: "authorization",
    ...overrides,
  };
}

describe("planAccessPointMigration", () => {
  describe("deduplication", () => {
    it("merges points of the same tenant, provider and external lock", () => {
      const plan = planAccessPointMigration([
        bookable("bookable-a", [point({ id: "point-a" })]),
        bookable("bookable-b", [point({ id: "point-b" })]),
      ]);

      expect(plan.accessPoints.map((ap) => ap.id)).to.deep.equal(["point-a"]);
    });

    it("lets the first point win the whole entity", () => {
      const plan = planAccessPointMigration([
        bookable("bookable-a", [
          point({
            id: "point-a",
            label: "Haupteingang",
            mode: "authorization",
            config: { unlatch: true },
            locationId: "site-1",
          }),
        ]),
        bookable("bookable-b", [
          point({
            id: "point-b",
            label: "Nebeneingang",
            mode: "remote",
            config: { unlatch: false },
            locationId: "site-2",
          }),
        ]),
      ]);

      expect(plan.accessPoints).to.have.length(1);
      expect(plan.accessPoints[0]).to.include({
        id: "point-a",
        label: "Haupteingang",
        mode: "authorization",
        providerLocationId: "site-1",
      });
      expect(plan.accessPoints[0].config).to.deep.equal({ unlatch: true });
    });

    it("never merges across tenants", () => {
      const plan = planAccessPointMigration([
        bookable("bookable-a", [point({ id: "point-a" })]),
        bookable("bookable-b", [point({ id: "point-b" })], {
          tenantId: "tenant-2",
        }),
      ]);

      expect(plan.accessPoints.map((ap) => ap.id)).to.deep.equal([
        "point-a",
        "point-b",
      ]);
    });

    it("keeps points without an external id apart", () => {
      const plan = planAccessPointMigration([
        bookable("bookable-a", [point({ id: "point-a", externalId: "" })]),
        bookable("bookable-b", [point({ id: "point-b", externalId: "" })]),
      ]);

      expect(plan.accessPoints.map((ap) => ap.id)).to.deep.equal([
        "point-a",
        "point-b",
      ]);
    });

    it("merges duplicates inside a single bookable", () => {
      const plan = planAccessPointMigration([
        bookable("bookable-a", [
          point({ id: "point-a" }),
          point({ id: "point-b" }),
        ]),
      ]);

      expect(plan.accessPoints.map((ap) => ap.id)).to.deep.equal(["point-a"]);
    });

    it("reports every merge so it can be logged", () => {
      const plan = planAccessPointMigration([
        bookable("bookable-a", [point({ id: "point-a" })]),
        bookable("bookable-b", [point({ id: "point-b" })]),
      ]);

      expect(plan.merges).to.deep.equal([
        {
          tenantId: "tenant-1",
          provider: "nuki",
          externalId: "lock-1",
          winnerId: "point-a",
          loserId: "point-b",
          bookableId: "bookable-b",
        },
      ]);
    });
  });

  describe("access point fields", () => {
    it("maps a point onto a door access point without validation rules", () => {
      const plan = planAccessPointMigration([
        bookable("bookable-a", [
          point({
            id: "point-a",
            locationId: "site-1",
            accessBuffer: { before: 30, after: 15 },
          }),
        ]),
      ]);

      expect(plan.accessPoints[0]).to.deep.equal({
        id: "point-a",
        tenantId: "tenant-1",
        type: "door",
        provider: "nuki",
        externalId: "lock-1",
        providerLocationId: "site-1",
        label: "Haupteingang",
        mode: "authorization",
        config: {},
        location: null,
        validationRules: [],
      });
    });

    it("falls back to an authorization door without a provider location", () => {
      const plan = planAccessPointMigration([
        bookable("bookable-a", [
          { id: "point-a", provider: "nuki", externalId: "lock-1" },
        ]),
      ]);

      expect(plan.accessPoints[0]).to.include({
        label: "",
        mode: "authorization",
        providerLocationId: null,
      });
    });

    it("migrates points of bookables whose access is switched off", () => {
      const plan = planAccessPointMigration([
        bookable("bookable-a", [point({ id: "point-a" })], {
          accessPointDetails: { active: false, points: [point({ id: "a" })] },
        }),
      ]);

      expect(plan.accessPoints.map((ap) => ap.id)).to.deep.equal(["a"]);
    });
  });

  describe("bookable references", () => {
    it("references the access points of a bookable in order", () => {
      const plan = planAccessPointMigration([
        bookable("bookable-a", [
          point({ id: "point-a", externalId: "lock-1" }),
          point({ id: "point-b", externalId: "lock-2" }),
        ]),
      ]);

      expect(plan.bookableReferences).to.deep.equal([
        { _id: "bookable-a", accessPointIds: ["point-a", "point-b"] },
      ]);
    });

    it("rewrites a merged away id to its winner", () => {
      const plan = planAccessPointMigration([
        bookable("bookable-a", [point({ id: "point-a" })]),
        bookable("bookable-b", [point({ id: "point-b" })]),
      ]);

      expect(plan.bookableReferences[1]).to.deep.equal({
        _id: "bookable-b",
        accessPointIds: ["point-a"],
      });
    });

    it("deduplicates references but keeps their order", () => {
      const plan = planAccessPointMigration([
        bookable("bookable-a", [
          point({ id: "point-a", externalId: "lock-1" }),
          point({ id: "point-b", externalId: "lock-2" }),
          point({ id: "point-c", externalId: "lock-1" }),
        ]),
      ]);

      expect(plan.bookableReferences[0].accessPointIds).to.deep.equal([
        "point-a",
        "point-b",
      ]);
    });

    it("lets several bookables reference the same access point", () => {
      const plan = planAccessPointMigration([
        bookable("bookable-a", [point({ id: "point-a" })]),
        bookable("bookable-b", [point({ id: "point-b" })]),
      ]);

      expect(
        plan.bookableReferences.map((b) => b.accessPointIds),
      ).to.deep.equal([["point-a"], ["point-a"]]);
    });
  });
});

describe("12-08-2026-migrate-bookable-access-points", () => {
  function storedBookables() {
    return [
      {
        _id: "1",
        id: "bookable-a",
        tenantId: "tenant-1",
        accessPointDetails: {
          active: true,
          accessBuffer: { before: 10, after: 5 },
          points: [
            {
              id: "point-a",
              provider: "nuki",
              externalId: "lock-1",
              label: "Haupteingang",
              mode: "authorization",
              locationId: "site-1",
              accessBuffer: { before: 30, after: 0 },
            },
          ],
        },
      },
      {
        _id: "2",
        id: "bookable-b",
        tenantId: "tenant-1",
        accessPointDetails: {
          active: true,
          accessBuffer: { before: 0, after: 0 },
          points: [
            {
              id: "point-b",
              provider: "nuki",
              externalId: "lock-1",
              label: "Nebeneingang",
              mode: "remote",
            },
          ],
        },
      },
      {
        _id: "3",
        id: "bookable-c",
        tenantId: "tenant-1",
        accessPointDetails: {
          active: false,
          accessBuffer: { before: 0, after: 0 },
          points: [],
        },
      },
    ];
  }

  function storedBookings() {
    return [
      {
        _id: "10",
        id: "booking-1",
        tenantId: "tenant-1",
        accessInfo: [
          { accessPointId: "point-b", authorizationId: "auth-1" },
          { accessPointId: "point-a", authorizationId: "auth-2" },
        ],
      },
    ];
  }

  function createDatabase() {
    const mongoose = createFakeMongoose({
      Bookable: storedBookables(),
      Booking: storedBookings(),
      AccessPoint: [],
    });

    mongoose.model("Bookable").indexes.set("tenant_accessPoint_id", {
      keys: { tenantId: 1, "accessPointDetails.points.id": 1 },
      options: { name: "tenant_accessPoint_id" },
    });

    return mongoose;
  }

  function bookableById(mongoose, id) {
    return mongoose
      .model("Bookable")
      .documents.find((bookable) => bookable.id === id);
  }

  describe("up", () => {
    let mongoose;

    beforeEach(async () => {
      mongoose = createDatabase();
      await migration.up(mongoose);
    });

    it("creates one access point per physical lock", () => {
      const accessPoints = mongoose.model("AccessPoint").documents;

      expect(accessPoints).to.have.length(1);
      expect(accessPoints[0]).to.include({
        id: "point-a",
        tenantId: "tenant-1",
        type: "door",
        provider: "nuki",
        externalId: "lock-1",
        providerLocationId: "site-1",
        label: "Haupteingang",
        mode: "authorization",
      });
      expect(accessPoints[0].validationRules).to.deep.equal([]);
    });

    it("gives the access point a scan code", () => {
      const [accessPoint] = mongoose.model("AccessPoint").documents;

      expect(accessPoint.scanCode).to.be.a("string").with.length.above(0);
      expect(accessPoint.previousScanCodes).to.deep.equal([]);
    });

    it("replaces the embedded points by references", () => {
      const bookable = bookableById(mongoose, "bookable-a");

      expect(bookable.accessPointDetails).to.deep.equal({
        active: true,
        accessBuffer: { before: 10, after: 5 },
        accessPointIds: ["point-a"],
      });
    });

    it("points a merged away bookable at the winning access point", () => {
      const bookable = bookableById(mongoose, "bookable-b");

      expect(bookable.accessPointDetails.accessPointIds).to.deep.equal([
        "point-a",
      ]);
      expect(bookable.accessPointDetails).to.not.have.property("points");
    });

    it("leaves bookables without access points with an empty reference list", () => {
      const bookable = bookableById(mongoose, "bookable-c");

      expect(bookable.accessPointDetails.accessPointIds).to.deep.equal([]);
      expect(bookable.accessPointDetails).to.not.have.property("points");
    });

    it("rewrites merged away ids in the access info of bookings", () => {
      const [booking] = mongoose.model("Booking").documents;

      expect(booking.accessInfo).to.deep.equal([
        { accessPointId: "point-a", authorizationId: "auth-1" },
        { accessPointId: "point-a", authorizationId: "auth-2" },
      ]);
    });

    it("swaps the partial index over to the references", () => {
      const indexes = mongoose.model("Bookable").indexes;

      expect(indexes.has("tenant_accessPoint_id")).to.be.false;
      expect(indexes.get("tenant_accessPointIds")).to.deep.equal({
        keys: { tenantId: 1, "accessPointDetails.accessPointIds": 1 },
        options: {
          name: "tenant_accessPointIds",
          partialFilterExpression: { "accessPointDetails.active": true },
        },
      });
    });

    it("changes nothing when it runs again", async () => {
      const afterFirstRun = mongoose.snapshot();

      await migration.up(mongoose);

      expect(mongoose.snapshot()).to.deep.equal(afterFirstRun);
    });
  });

  describe("up after a run that did not finish", () => {
    it("picks the same winner again and does not split the group", async () => {
      const mongoose = createDatabase();
      const accessPoints = mongoose.model("AccessPoint").documents;

      // A run that died before removing the embedded points: the access point
      // is already there, the bookables still carry their points.
      accessPoints.push({
        id: "point-a",
        tenantId: "tenant-1",
        type: "door",
        provider: "nuki",
        externalId: "lock-1",
        providerLocationId: "site-1",
        label: "Haupteingang",
        mode: "authorization",
        config: {},
        location: null,
        validationRules: [],
        scanCode: "already-printed-code",
        previousScanCodes: [],
      });

      await migration.up(mongoose);

      expect(accessPoints.map((accessPoint) => accessPoint.id)).to.deep.equal([
        "point-a",
      ]);
      expect(accessPoints[0].scanCode).to.equal("already-printed-code");
      expect(
        bookableById(mongoose, "bookable-b").accessPointDetails.accessPointIds,
      ).to.deep.equal(["point-a"]);
    });
  });

  describe("down", () => {
    let mongoose;

    beforeEach(async () => {
      mongoose = createDatabase();
      await migration.up(mongoose);
      await migration.down(mongoose);
    });

    it("re-embeds the access points into the bookable", () => {
      const bookable = bookableById(mongoose, "bookable-a");

      expect(bookable.accessPointDetails.points).to.deep.equal([
        {
          id: "point-a",
          provider: "nuki",
          externalId: "lock-1",
          locationId: "site-1",
          label: "Haupteingang",
          mode: "authorization",
          config: {},
        },
      ]);
      expect(bookable.accessPointDetails).to.not.have.property(
        "accessPointIds",
      );
    });

    it("drops the access point collection", () => {
      expect(mongoose.model("AccessPoint").documents).to.deep.equal([]);
    });

    it("restores the old partial index", () => {
      const indexes = mongoose.model("Bookable").indexes;

      expect(indexes.has("tenant_accessPointIds")).to.be.false;
      expect(indexes.get("tenant_accessPoint_id").keys).to.deep.equal({
        tenantId: 1,
        "accessPointDetails.points.id": 1,
      });
    });
  });
});
