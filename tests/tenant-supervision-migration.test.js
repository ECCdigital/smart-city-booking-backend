/**
 * The migration that gives the stock its initial supervision state: a
 * missing initial level and tenant level become `free`, a public offer
 * without a review status waits as `pending` from the migration time on,
 * each initial state is recorded as a system row of origin `migration` -
 * and a rerun, whole or after an abort, neither resets nor doubles anything.
 */

const { expect } = require("chai");
const sinon = require("sinon");

const migration = require("../migrations/scripts/21-09-2026-tenant-supervision-initial-state");
const { createFakeMongoose } = require("./helpers/fake-mongoose");

const FIRST_RUN = "2026-09-21T10:00:00.000Z";
const SECOND_RUN = "2026-09-22T08:30:00.000Z";

const DECISION = {
  submittedAt: "2026-09-01T00:00:00.000Z",
  decidedAt: "2026-09-02T00:00:00.000Z",
  decidedBy: "owner@example.org",
  reason: "checked",
};

function offers(prefix) {
  return [
    { id: `${prefix}-public-missing`, tenantId: "t-old", isPublic: true },
    {
      id: `${prefix}-public-null`,
      tenantId: "t-set",
      isPublic: true,
      review: {
        status: null,
        submittedAt: null,
        decidedAt: null,
        decidedBy: null,
        reason: null,
      },
    },
    { id: `${prefix}-private`, tenantId: "t-old", isPublic: false },
    { id: `${prefix}-no-wish`, tenantId: "t-old" },
    {
      id: `${prefix}-pending`,
      tenantId: "t-old",
      isPublic: true,
      review: {
        status: "pending",
        submittedAt: "2026-09-10T00:00:00.000Z",
        decidedAt: null,
        decidedBy: null,
        reason: null,
      },
    },
    {
      id: `${prefix}-approved`,
      tenantId: "t-old",
      isPublic: true,
      review: { status: "approved", ...DECISION },
    },
    {
      id: `${prefix}-rejected`,
      tenantId: "t-old",
      isPublic: false,
      review: { status: "rejected", ...DECISION },
    },
  ].map((offer) => ({
    isBookable: true,
    catalogParticipation: "listed",
    title: offer.id,
    ...offer,
  }));
}

function fixture() {
  return {
    Instance: [{ _id: "instance", name: "Portal" }],
    Tenant: [
      // No contact at all: contact gaps are no obstacle.
      { id: "t-old", name: "Old" },
      { id: "t-null", name: "Null", supervisionLevel: null },
      {
        id: "t-set",
        name: "Set",
        contactName: "A",
        supervisionLevel: "supervised",
        supervisionChangedAt: "2026-09-05T00:00:00.000Z",
      },
    ],
    Bookable: offers("b"),
    Event: offers("e"),
    Booking: [{ id: "booking-1", tenantId: "t-old", bookableIds: ["b-1"] }],
    SupervisionHistory: [],
    SupervisionNotification: [],
  };
}

function world(collections = fixture()) {
  return createFakeMongoose(collections, {
    unique: { SupervisionHistory: ["dedupeKey", "id"] },
  });
}

function byId(mongoose, model, id) {
  return mongoose.model(model).documents.find((doc) => doc.id === id);
}

function history(mongoose) {
  return mongoose.model("SupervisionHistory").documents;
}

describe("21-09-2026-tenant-supervision-initial-state migration", function () {
  let clock;

  beforeEach(function () {
    clock = sinon.useFakeTimers({ now: new Date(FIRST_RUN), toFake: ["Date"] });
  });

  afterEach(function () {
    clock.restore();
    sinon.restore();
  });

  describe("levels", function () {
    it("sets a missing initial level of the instance to free", async function () {
      const mongoose = world();
      await migration.up(mongoose);

      expect(
        mongoose.model("Instance").documents[0].tenantInitialSupervisionLevel,
      ).to.equal("free");
    });

    it("keeps an initial level that is set", async function () {
      const data = fixture();
      data.Instance[0].tenantInitialSupervisionLevel = "blocked";
      const mongoose = world(data);
      await migration.up(mongoose);

      expect(
        mongoose.model("Instance").documents[0].tenantInitialSupervisionLevel,
      ).to.equal("blocked");
    });

    it("sets a missing or null tenant level to free without a change date", async function () {
      const mongoose = world();
      await migration.up(mongoose);

      for (const id of ["t-old", "t-null"]) {
        const tenant = byId(mongoose, "Tenant", id);
        expect(tenant.supervisionLevel).to.equal("free");
        expect(tenant.supervisionChangedAt ?? null).to.equal(null);
      }
    });

    it("keeps a tenant level that is set, and writes no row for it", async function () {
      const mongoose = world();
      await migration.up(mongoose);

      expect(byId(mongoose, "Tenant", "t-set")).to.deep.equal(
        fixture().Tenant[2],
      );
      expect(
        history(mongoose).filter(
          (row) => row.tenantId === "t-set" && row.offerId === null,
        ),
      ).to.deep.equal([]);
    });

    it("records the initial level of a migrated tenant as a system row of the migration", async function () {
      const mongoose = world();
      await migration.up(mongoose);

      const rows = history(mongoose).filter(
        (row) => row.eventType === "tenant.levelInitialized",
      );
      expect(rows.map((row) => row.tenantId).sort()).to.deep.equal([
        "t-null",
        "t-old",
      ]);

      const { id, ...row } = rows.find((r) => r.tenantId === "t-old");
      expect(id).to.be.a("string").and.not.empty;
      expect(row).to.deep.equal({
        tenantId: "t-old",
        offerType: null,
        offerId: null,
        eventType: "tenant.levelInitialized",
        occurredAt: FIRST_RUN,
        actor: { type: "system", userId: null },
        from: null,
        to: "free",
        reason: null,
        origin: "migration",
        dedupeKey: "migration:tenant-level:t-old",
      });
    });
  });
  for (const [model, offerType, prefix] of [
    ["Bookable", "bookable", "b"],
    ["Event", "event", "e"],
  ]) {
    describe(`${offerType}s`, function () {
      it("lets a public offer without a review status wait from the migration time on", async function () {
        const mongoose = world();
        await migration.up(mongoose);

        for (const id of [
          `${prefix}-public-missing`,
          `${prefix}-public-null`,
        ]) {
          expect(byId(mongoose, model, id).review).to.deep.equal({
            status: "pending",
            submittedAt: FIRST_RUN,
            decidedAt: null,
            decidedBy: null,
            reason: null,
          });
        }
      });

      it("records that waiting as a submission of the migration, not of a user", async function () {
        const mongoose = world();
        await migration.up(mongoose);

        const rows = history(mongoose).filter(
          (row) => row.offerType === offerType,
        );
        expect(rows.map((row) => row.offerId).sort()).to.deep.equal([
          `${prefix}-public-missing`,
          `${prefix}-public-null`,
        ]);

        const { id, ...row } = rows.find(
          (r) => r.offerId === `${prefix}-public-null`,
        );
        expect(id).to.be.a("string").and.not.empty;
        expect(row).to.deep.equal({
          tenantId: "t-set",
          offerType,
          offerId: `${prefix}-public-null`,
          eventType: "review.submitted",
          occurredAt: FIRST_RUN,
          actor: { type: "system", userId: null },
          from: null,
          to: "pending",
          reason: null,
          origin: "migration",
          dedupeKey: `migration:review:${offerType}:t-set:${prefix}-public-null`,
        });
      });

      it("leaves an offer nobody wants published, and every existing decision, as it was", async function () {
        const mongoose = world();
        await migration.up(mongoose);

        const before = fixture()[model];
        for (const suffix of [
          "private",
          "no-wish",
          "pending",
          "approved",
          "rejected",
        ]) {
          const id = `${prefix}-${suffix}`;
          expect(byId(mongoose, model, id)).to.deep.equal(
            before.find((offer) => offer.id === id),
          );
        }
      });

      it("approves nothing", async function () {
        const mongoose = world();
        await migration.up(mongoose);

        expect(
          mongoose
            .model(model)
            .documents.filter((offer) => offer.review?.status === "approved")
            .map((offer) => offer.id),
        ).to.deep.equal([`${prefix}-approved`]);
      });

      it("touches nothing but the review of a migrated offer", async function () {
        const mongoose = world();
        await migration.up(mongoose);

        const id = `${prefix}-public-missing`;
        // eslint-disable-next-line no-unused-vars
        const { review, ...rest } = byId(mongoose, model, id);
        expect(rest).to.deep.equal(
          fixture()[model].find((offer) => offer.id === id),
        );
      });
    });
  }

  describe("side effects", function () {
    it("creates no outbox row and leaves the bookings alone", async function () {
      const mongoose = world();
      await migration.up(mongoose);

      expect(mongoose.model("SupervisionNotification").documents).to.deep.equal(
        [],
      );
      expect(mongoose.model("Booking").documents).to.deep.equal(
        fixture().Booking,
      );
    });

    it("writes only the migration's own history rows", async function () {
      const mongoose = world();
      await migration.up(mongoose);

      expect(history(mongoose)).to.have.length(6);
      expect(history(mongoose).every((row) => row.origin === "migration")).to.be
        .true;
    });
  });
  describe("rerun", function () {
    it("changes nothing on a second full run", async function () {
      const mongoose = world();
      await migration.up(mongoose);
      const afterFirst = mongoose.snapshot();

      clock.setSystemTime(new Date(SECOND_RUN));
      await migration.up(mongoose);

      expect(mongoose.snapshot()).to.deep.equal(afterFirst);
    });

    it("migrates what came in between and leaves the migrated rest alone", async function () {
      const mongoose = world();
      await migration.up(mongoose);
      const afterFirst = mongoose.snapshot();

      mongoose.model("Tenant").documents.push({ id: "t-late", name: "Late" });
      mongoose
        .model("Event")
        .documents.push({ id: "e-late", tenantId: "t-late", isPublic: true });

      clock.setSystemTime(new Date(SECOND_RUN));
      await migration.up(mongoose);

      expect(byId(mongoose, "Tenant", "t-late").supervisionLevel).to.equal(
        "free",
      );
      expect(byId(mongoose, "Event", "e-late").review.submittedAt).to.equal(
        SECOND_RUN,
      );
      expect(history(mongoose)).to.have.length(8);

      // Everything of the first run reads as it did.
      const late = (doc) => !/late/.test(`${doc.id}${doc.tenantId}`);
      for (const [model, state] of Object.entries(afterFirst)) {
        expect(
          mongoose.model(model).documents.filter(late),
          model,
        ).to.deep.equal(state.documents);
      }
    });

    it("does not decide again what was decided after the migration", async function () {
      const mongoose = world();
      await migration.up(mongoose);

      const approved = { status: "approved", ...DECISION };
      byId(mongoose, "Bookable", "b-public-missing").review = approved;
      byId(mongoose, "Tenant", "t-old").supervisionLevel = "blocked";

      clock.setSystemTime(new Date(SECOND_RUN));
      await migration.up(mongoose);

      expect(byId(mongoose, "Bookable", "b-public-missing").review).to.equal(
        approved,
      );
      expect(byId(mongoose, "Tenant", "t-old").supervisionLevel).to.equal(
        "blocked",
      );
      expect(history(mongoose)).to.have.length(6);
    });
  });

  describe("abort and rerun", function () {
    /**
     * Lets the n-th call of a model method fail - before it writes, or
     * right after - the way a lost connection would.
     */
    function abortAt(mongoose, model, method, { call = 1, after = false }) {
      const target = mongoose.model(model);
      const original = target[method].bind(target);
      let calls = 0;

      sinon.stub(target, method).callsFake(async (...args) => {
        calls += 1;
        if (calls !== call) return original(...args);
        if (after) await original(...args);
        throw new Error("connection lost");
      });
    }

    const ABORTS = [
      ["before the tenant history", "SupervisionHistory", "insertMany", {}],
      [
        "between the tenant history and the tenant levels",
        "Tenant",
        "updateMany",
        {},
      ],
      ["after the tenant levels", "Tenant", "updateMany", { after: true }],
      [
        "before the bookable history",
        "SupervisionHistory",
        "insertMany",
        { call: 2 },
      ],
      [
        "between the bookable history and the bookable reviews",
        "Bookable",
        "bulkWrite",
        {},
      ],
      ["after the bookable reviews", "Bookable", "bulkWrite", { after: true }],
      [
        "before the event history",
        "SupervisionHistory",
        "insertMany",
        { call: 3 },
      ],
      [
        "between the event history and the event reviews",
        "Event",
        "bulkWrite",
        {},
      ],
      ["after the event reviews", "Event", "bulkWrite", { after: true }],
    ];

    for (const [where, model, method, options] of ABORTS) {
      it(`completes consistently after an abort ${where}`, async function () {
        const mongoose = world();
        abortAt(mongoose, model, method, options);

        let failure = null;
        try {
          await migration.up(mongoose);
        } catch (error) {
          failure = error;
        }
        expect(failure?.message).to.equal("connection lost");
        const afterAbort = mongoose.snapshot();

        sinon.restore();
        clock = sinon.useFakeTimers({
          now: new Date(SECOND_RUN),
          toFake: ["Date"],
        });
        await migration.up(mongoose);

        // One row per migrated tenant and offer, never two.
        const keys = history(mongoose).map((row) => row.dedupeKey);
        expect(keys).to.have.length(6);
        expect(new Set(keys).size).to.equal(6);

        // What the aborted run wrote stands untouched.
        expect(history(mongoose).slice(0, keys.length)).to.include.deep.members(
          afterAbort.SupervisionHistory.documents,
        );
        for (const name of ["Bookable", "Event"]) {
          for (const offer of afterAbort[name]?.documents ?? []) {
            if (offer.review?.status === "pending") {
              expect(byId(mongoose, name, offer.id)).to.deep.equal(offer);
            }
          }
        }

        // Every migrated offer waits from the time its history row names.
        for (const row of history(mongoose).filter((r) => r.offerId)) {
          const name = row.offerType === "bookable" ? "Bookable" : "Event";
          expect(byId(mongoose, name, row.offerId).review).to.deep.equal({
            status: "pending",
            submittedAt: row.occurredAt,
            decidedAt: null,
            decidedBy: null,
            reason: null,
          });
        }

        for (const id of ["t-old", "t-null"]) {
          expect(byId(mongoose, "Tenant", id).supervisionLevel).to.equal(
            "free",
          );
        }

        // And a further run is a no-op.
        const done = mongoose.snapshot();
        await migration.up(mongoose);
        expect(mongoose.snapshot()).to.deep.equal(done);
      });
    }

    it("keeps the time of the history row an aborted run left for an offer", async function () {
      const mongoose = world();
      abortAt(mongoose, "Bookable", "bulkWrite", {});
      await migration.up(mongoose).catch(() => {});

      sinon.restore();
      clock = sinon.useFakeTimers({
        now: new Date(SECOND_RUN),
        toFake: ["Date"],
      });
      await migration.up(mongoose);

      expect(
        byId(mongoose, "Bookable", "b-public-missing").review.submittedAt,
      ).to.equal(FIRST_RUN);
      expect(
        byId(mongoose, "Event", "e-public-missing").review.submittedAt,
      ).to.equal(SECOND_RUN);
    });

    it("fails on a history error that is not a duplicate key", async function () {
      const mongoose = world();
      sinon
        .stub(mongoose.model("SupervisionHistory"), "insertMany")
        .rejects(Object.assign(new Error("not primary"), { code: 10107 }));

      let failure = null;
      try {
        await migration.up(mongoose);
      } catch (error) {
        failure = error;
      }

      expect(failure?.message).to.equal("not primary");
      expect(byId(mongoose, "Tenant", "t-old").supervisionLevel).to.equal(
        undefined,
      );
    });
  });

  describe("a stock larger than one batch", function () {
    function largeStock() {
      const data = fixture();
      data.Bookable = Array.from({ length: 1201 }, (_, n) => ({
        id: `b-${n}`,
        tenantId: "t-old",
        isPublic: true,
      }));
      data.Event = [];
      return data;
    }

    it("resumes after an abort between two batches without resetting the first", async function () {
      const mongoose = world(largeStock());
      const Bookable = mongoose.model("Bookable");
      const original = Bookable.bulkWrite.bind(Bookable);
      const stub = sinon.stub(Bookable, "bulkWrite");
      stub.onFirstCall().callsFake(original);
      stub.onSecondCall().rejects(new Error("connection lost"));

      await migration.up(mongoose).catch(() => {});

      const waiting = () =>
        Bookable.documents.filter((b) => b.review?.status === "pending");
      expect(waiting()).to.have.length(500);

      sinon.restore();
      clock = sinon.useFakeTimers({
        now: new Date(SECOND_RUN),
        toFake: ["Date"],
      });
      await migration.up(mongoose);

      expect(waiting()).to.have.length(1201);
      const times = waiting().map((b) => b.review.submittedAt);
      // Two batches carry the row of the first run, the third the rerun's.
      expect(times.filter((time) => time === FIRST_RUN)).to.have.length(1000);
      expect(times.filter((time) => time === SECOND_RUN)).to.have.length(201);

      const keys = history(mongoose)
        .filter((row) => row.offerType === "bookable")
        .map((row) => row.dedupeKey);
      expect(new Set(keys).size).to.equal(1201);
      expect(keys).to.have.length(1201);
    });
  });

  describe("a document the history cannot name", function () {
    it("is skipped and reported instead of failing the run", async function () {
      const data = fixture();
      data.Bookable.push({ id: "b-orphan", isPublic: true });
      data.Tenant.push({ name: "No id" });
      const mongoose = world(data);
      const warn = sinon.stub(require("bunyan").prototype, "warn");

      await migration.up(mongoose);

      expect(byId(mongoose, "Bookable", "b-orphan").review).to.equal(undefined);
      expect(
        mongoose.model("Tenant").documents.find((t) => t.name === "No id")
          .supervisionLevel,
      ).to.equal(undefined);
      expect(history(mongoose)).to.have.length(6);
      expect(warn.callCount).to.equal(2);
      expect(
        byId(mongoose, "Bookable", "b-public-missing").review.status,
      ).to.equal("pending");
    });
  });

  describe("down", function () {
    it("is a no-op: no decision and no history row is taken back", async function () {
      const mongoose = world();
      await migration.up(mongoose);
      const migrated = mongoose.snapshot();

      await migration.down(mongoose);

      expect(mongoose.snapshot()).to.deep.equal(migrated);
    });
  });
});
