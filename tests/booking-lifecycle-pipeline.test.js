/**
 * The effect pipeline of the booking lifecycle (spec part 2, sections 3, 4
 * and 11): four phases in a fixed order, the failure policy owned by the
 * adapter operation, and an abort that restores exactly the persist writes
 * of the run from their snapshots.
 */

const { expect } = require("chai");

const {
  PHASES,
  POLICY,
  policyOf,
  step,
  runPipeline,
  SKIPPED,
  LifecycleError,
} = require("../src/commons/services/booking-lifecycle/pipeline");
const { ConflictError } = require("../src/errors/BaseError");
const {
  inMemoryAdapters,
  effectTable,
} = require("./helpers/in-memory-lifecycle-adapters");

const TENANT = "tenant-1";

function booking(overrides = {}) {
  return {
    id: "B-1",
    tenantId: TENANT,
    status: "payment_due",
    priceEur: 40,
    mail: "erika@example.test",
    attachments: [],
    bookableItems: [],
    ...overrides,
  };
}

describe("booking lifecycle pipeline", function () {
  describe("the policy table", function () {
    const rows = [
      ["store", "save", "abort"],
      ["access", "hold", "abort"],
      ["access", "provision", "record"],
      ["access", "update", "record"],
      ["access", "revoke", "record"],
      ["access", "refreshHolds", "record"],
      ["documents", "issue", "record"],
      ["payment", "requestPayment", "record"],
      ["mail", "BOOKING_CONFIRMATION", "record"],
      ["mail", "NEW_BOOKING", "record"],
      ["workflow", "emit", "record"],
    ];

    for (const [adapter, op, policy] of rows) {
      it(`${adapter}.${op} is ${policy}`, function () {
        expect(policyOf(adapter, op)).to.equal(policy);
      });
    }

    it("has only abort and record", function () {
      expect(Object.values(POLICY)).to.have.members(["abort", "record"]);
    });

    it("refuses an operation it does not know when the step is declared", function () {
      expect(() =>
        step("provision", "access", "grant", async () => {}),
      ).to.throw(/access\.grant/);
    });

    it("refuses a phase it does not know", function () {
      expect(() => step("cleanup", "store", "save", async () => {})).to.throw(
        /cleanup/,
      );
    });
  });

  describe("the phases", function () {
    it("run in the order persist, provision, document, notify", function () {
      expect(PHASES).to.deep.equal([
        "persist",
        "provision",
        "document",
        "notify",
      ]);
    });

    it("refuses steps declared out of phase order before any effect runs", async function () {
      const adapters = inMemoryAdapters({ bookings: [booking()] });
      const ctx = {
        transition: "pay",
        tenantId: TENANT,
        bookingId: "B-1",
        store: adapters.store,
      };

      let error;
      try {
        await runPipeline(ctx, [
          step("notify", "workflow", "emit", () =>
            adapters.workflow.emit(TENANT, "B-1", "onPay"),
          ),
          step("provision", "access", "provision", () =>
            adapters.access.provision(TENANT, "B-1"),
          ),
        ]);
      } catch (err) {
        error = err;
      }

      expect(error).to.be.an("error");
      expect(error.message).to.match(/access\.provision.*provision.*notify/);
      expect(adapters.workflow.calls).to.deep.equal([]);
      expect(adapters.access.calls).to.deep.equal([]);
    });
  });

  describe("the outcome", function () {
    it("lists every step as an effect row: ok, skipped or recorded", async function () {
      const adapters = inMemoryAdapters({
        bookings: [booking()],
        failOn: { access: ["provision"] },
      });
      const entity = await adapters.store.get(TENANT, "B-1");
      entity.status = "confirmed";
      const ctx = {
        transition: "pay",
        tenantId: TENANT,
        bookingId: "B-1",
        booking: entity,
        store: adapters.store,
      };

      const outcome = await runPipeline(ctx, [
        step("persist", "store", "save", () =>
          adapters.store.save(entity, {
            expectStatus: "payment_due",
            transition: "pay",
          }),
        ),
        step("provision", "access", "provision", () =>
          adapters.access.provision(TENANT, "B-1"),
        ),
        step(
          "document",
          "documents",
          "issue",
          () =>
            adapters.documents.issue({
              tenantId: TENANT,
              bookingIds: ["B-1"],
              type: "receipt",
            }),
          { when: () => false },
        ),
        step("notify", "payment", "requestPayment", () => SKIPPED),
        step("notify", "mail", "BOOKING_CONFIRMATION", () =>
          adapters.mail.send("BOOKING_CONFIRMATION", {
            tenantId: TENANT,
            bookingIds: ["B-1"],
            attachments: [],
          }),
        ),
      ]);

      expect(effectTable(outcome)).to.deep.equal([
        "persist store.save ok",
        "provision access.provision recorded",
        "document documents.issue skipped",
        "notify payment.requestPayment skipped",
        "notify mail.BOOKING_CONFIRMATION ok",
      ]);
      expect(outcome).to.include({
        transition: "pay",
        bookingId: "B-1",
        status: "confirmed",
        failure: null,
      });
      expect(outcome.booking).to.equal(entity);
      const recorded = outcome.effects[1];
      expect(recorded.policy).to.equal("record");
      expect(recorded.error.message).to.equal(
        "access.provision failed (simulated)",
      );
      expect(adapters.store.rows.get("B-1").status).to.equal("confirmed");
      expect(adapters.mail.calls).to.have.length(1);
    });
  });

  describe("an abort", function () {
    it("restores the persist write of the run and throws a LifecycleError with the partial outcome", async function () {
      const adapters = inMemoryAdapters({
        bookings: [booking({ status: "requested", name: "Erika Muster" })],
        failOn: { access: ["hold"] },
      });
      const entity = await adapters.store.get(TENANT, "B-1");
      entity.name = "Erika M.";
      const ctx = {
        transition: "amend",
        tenantId: TENANT,
        bookingId: "B-1",
        booking: entity,
        store: adapters.store,
      };

      let error;
      try {
        await runPipeline(ctx, [
          step("persist", "store", "save", () =>
            adapters.store.save(entity, {
              expectStatus: "requested",
              transition: "amend",
            }),
          ),
          step("provision", "access", "hold", () =>
            adapters.access.hold(TENANT, "B-1"),
          ),
          step("notify", "workflow", "emit", () =>
            adapters.workflow.emit(TENANT, "B-1", "onAmend"),
          ),
        ]);
      } catch (err) {
        error = err;
      }

      expect(error).to.be.instanceOf(LifecycleError);
      expect(error).to.include({ transition: "amend" });
      expect(error.effect).to.include({ adapter: "access", op: "hold" });
      expect(error.cause.message).to.equal("access.hold failed (simulated)");
      expect(effectTable(error.outcome)).to.deep.equal([
        "persist store.save ok",
        "provision access.hold failed",
      ]);
      expect(error.outcome.failure.effect).to.include({
        adapter: "access",
        op: "hold",
        status: "failed",
      });
      expect(error.outcome.failure.compensated).to.deep.equal(["B-1"]);
      expect(adapters.store.rows.get("B-1").name).to.equal("Erika Muster");
      expect(adapters.store.writes).to.deep.equal([
        { id: "B-1", status: "requested" },
        { id: "B-1", status: "requested", restored: true },
      ]);
      expect(adapters.workflow.calls).to.deep.equal([]);
      // The booking of the partial outcome is the one the store holds now.
      expect(error.outcome.booking.name).to.equal("Erika Muster");
    });

    it("restores the members written before member k failed, in reverse order, and leaves the rest", async function () {
      const adapters = inMemoryAdapters({
        bookings: [
          booking({ id: "B-1" }),
          booking({ id: "B-2" }),
          booking({ id: "B-3" }),
        ],
        failOn: { store: ["save B-3"] },
      });
      const members = await adapters.store.getMany(TENANT, [
        "B-1",
        "B-2",
        "B-3",
      ]);
      for (const member of members) {
        member.status = "confirmed";
      }
      const ctx = {
        transition: "pay",
        tenantId: TENANT,
        bookingIds: ["B-1", "B-2", "B-3"],
        store: adapters.store,
      };

      let error;
      try {
        await runPipeline(
          ctx,
          members.map((member) =>
            step("persist", "store", "save", () =>
              adapters.store.save(member, {
                expectStatus: "payment_due",
                transition: "pay",
              }),
            ),
          ),
        );
      } catch (err) {
        error = err;
      }

      expect(error).to.be.instanceOf(LifecycleError);
      expect(error.outcome.failure.compensated).to.deep.equal(["B-2", "B-1"]);
      expect(
        ["B-1", "B-2", "B-3"].map((id) => adapters.store.rows.get(id).status),
      ).to.deep.equal(["payment_due", "payment_due", "payment_due"]);
    });

    it("lets the guard of the conditional write through as the ConflictError it is, after restoring", async function () {
      const adapters = inMemoryAdapters({
        bookings: [
          booking({ id: "B-1" }),
          booking({ id: "B-2", status: "confirmed" }),
        ],
      });
      const members = await adapters.store.getMany(TENANT, ["B-1", "B-2"]);
      for (const member of members) {
        member.status = "confirmed";
      }
      const ctx = {
        transition: "pay",
        tenantId: TENANT,
        bookingIds: ["B-1", "B-2"],
        store: adapters.store,
      };

      let error;
      try {
        await runPipeline(
          ctx,
          members.map((member) =>
            step("persist", "store", "save", () =>
              adapters.store.save(member, {
                expectStatus: "payment_due",
                transition: "pay",
              }),
            ),
          ),
        );
      } catch (err) {
        error = err;
      }

      expect(error).to.be.instanceOf(ConflictError);
      expect(error.code).to.equal("invalid_transition");
      expect(error.params).to.deep.equal({
        bookingId: "B-2",
        status: "confirmed",
        transition: "pay",
      });
      expect(adapters.store.rows.get("B-1").status).to.equal("payment_due");
    });

    it("records a failing step with record policy and carries on: nothing is restored", async function () {
      const adapters = inMemoryAdapters({
        bookings: [booking()],
        failOn: { documents: ["issue"], mail: ["BOOKING_CONFIRMATION"] },
      });
      const entity = await adapters.store.get(TENANT, "B-1");
      entity.status = "confirmed";
      const ctx = {
        transition: "pay",
        tenantId: TENANT,
        bookingId: "B-1",
        booking: entity,
        store: adapters.store,
      };

      const outcome = await runPipeline(ctx, [
        step("persist", "store", "save", () =>
          adapters.store.save(entity, {
            expectStatus: "payment_due",
            transition: "pay",
          }),
        ),
        step("document", "documents", "issue", () =>
          adapters.documents.issue({
            tenantId: TENANT,
            bookingIds: ["B-1"],
            type: "receipt",
          }),
        ),
        step("notify", "mail", "BOOKING_CONFIRMATION", () =>
          adapters.mail.BOOKING_CONFIRMATION([entity], {}),
        ),
        step("notify", "workflow", "emit", () =>
          adapters.workflow.emit(TENANT, "B-1", "onPay"),
        ),
      ]);

      expect(effectTable(outcome)).to.deep.equal([
        "persist store.save ok",
        "document documents.issue recorded",
        "notify mail.BOOKING_CONFIRMATION recorded",
        "notify workflow.emit ok",
      ]);
      expect(outcome.failure).to.equal(null);
      expect(adapters.store.writes).to.deep.equal([
        { id: "B-1", status: "confirmed" },
      ]);
    });
  });

  describe("a guard", function () {
    /** Steps that note where they ran: inside the guard or after it. */
    function noting(adapters, entity, log, inside) {
      const at = (name) => log.push(`${name}${inside() ? " guarded" : ""}`);
      return [
        step("persist", "store", "save", async () => {
          at("save");
          return adapters.store.save(entity, {
            expectStatus: "confirmed",
            transition: "amend",
          });
        }),
        step("provision", "access", "allocate", async () => {
          at("allocate");
          return adapters.access.allocate(TENANT, "B-1");
        }),
        step("provision", "access", "update", async () => at("update")),
        step("provision", "access", "hold", async () => at("hold"), {
          when: () => false,
        }),
        step("notify", "workflow", "emit", async () => at("emit")),
      ];
    }

    function guarding() {
      const state = { inside: false, entered: 0 };
      state.guard = async (work) => {
        state.entered += 1;
        state.inside = true;
        try {
          return await work();
        } finally {
          state.inside = false;
        }
      };
      return state;
    }

    it("holds the persist writes and every step up to the last one that may abort and runs, and lets go before the rest", async function () {
      const adapters = inMemoryAdapters({
        bookings: [booking({ status: "confirmed" })],
      });
      const entity = await adapters.store.get(TENANT, "B-1");
      const log = [];
      const state = guarding();

      const outcome = await runPipeline(
        {
          transition: "amend",
          tenantId: TENANT,
          bookingId: "B-1",
          booking: entity,
          store: adapters.store,
        },
        noting(adapters, entity, log, () => state.inside),
        { guard: state.guard },
      );

      expect(state.entered).to.equal(1);
      expect(log).to.deep.equal([
        "save guarded",
        "allocate guarded",
        "update",
        "emit",
      ]);
      expect(effectTable(outcome)).to.deep.equal([
        "persist store.save ok",
        "provision access.allocate ok",
        "provision access.update ok",
        "provision access.hold skipped",
        "notify workflow.emit ok",
      ]);
    });

    it("restores the persist writes inside the guard when a step aborts", async function () {
      const adapters = inMemoryAdapters({
        bookings: [booking({ status: "confirmed", name: "Erika Muster" })],
        failOn: { access: ["allocate"] },
      });
      const entity = await adapters.store.get(TENANT, "B-1");
      entity.name = "Erika M.";
      const state = guarding();
      const restore = adapters.store.restore;
      const restoredInside = [];
      adapters.store.restore = async (previous) => {
        restoredInside.push(state.inside);
        return restore(previous);
      };

      let error;
      try {
        await runPipeline(
          {
            transition: "amend",
            tenantId: TENANT,
            bookingId: "B-1",
            booking: entity,
            store: adapters.store,
          },
          noting(adapters, entity, [], () => state.inside),
          { guard: state.guard },
        );
      } catch (err) {
        error = err;
      }

      expect(error).to.be.instanceOf(LifecycleError);
      expect(restoredInside).to.deep.equal([true]);
      expect(adapters.store.rows.get("B-1").name).to.equal("Erika Muster");
    });
  });
});
