/**
 * The suspension of a user (glossary „Sperre (eines Users)“,
 * ECCdigital/tickets#624): suspending and lifting it are actions of their
 * own for the instance owner, no longer a field of the general update.
 * Suspending needs a reason and stores a record of reason, time, the person
 * who suspended and exactly one origin (`manual` here); it ends a running
 * session at once. An instance owner cannot be suspended. A preview names
 * the consequences for the dialog: the user's bookings and memberships.
 *
 * Runs over the real routers on the lifecycle harness, the user collection
 * in memory below `UserManager` at the model.
 */

const { expect } = require("chai");
const sinon = require("sinon");

const {
  installHarness,
  ADMIN,
  OWNER,
  CUSTOMER,
} = require("./helpers/booking-lifecycle-harness");
const UserManager = require("../src/commons/data-managers/user-manager");
const BookingModel = require("../src/commons/data-managers/models/bookingModel");
const {
  account,
  installUserCollection,
} = require("./helpers/auth-user-collection");

describe("user suspension (ECCdigital/tickets#624)", function () {
  this.timeout(20000);

  let h;
  let docs;
  let entries;

  beforeEach(async function () {
    h = await installHarness();
    UserManager.getUser.restore();
    UserManager.getRawUser.restore();
    docs = installUserCollection([
      account(ADMIN, "geheim-1234"),
      account(OWNER, "geheim-1234"),
      account(CUSTOMER, "geheim-1234", { firstName: "Erika" }),
    ]);
    entries = h.blacklist;
  });

  afterEach(async function () {
    sinon.restore();
    await h.close();
  });

  const stored = (id) => docs.find((doc) => doc.id === id);
  /** A domain entry hitting every address of the harness (ECCdigital/tickets#626). */
  const domainEntry = () => ({
    id: "domain",
    value: "@example.test",
    kind: "domain",
    reason: "Wegwerf",
    createdAt: 1,
    createdBy: ADMIN,
    origin: "manual",
    suspendedUserIds: [],
  });
  const suspend = (id, body, by = ADMIN) =>
    h.api().post(`/api/users/${id}/suspension`).set(h.as(by)).send(body);

  describe("suspending", function () {
    for (const [name, body] of [
      ["no reason", {}],
      ["a blank reason", { reason: "   " }],
    ]) {
      it(`refuses ${name} with 400 and leaves the account as it is`, async function () {
        const res = await suspend(CUSTOMER, body);

        expect(res.status).to.equal(400);
        expect(res.body.code).to.equal("suspension_reason_required");
        expect(stored(CUSTOMER).isSuspended).to.equal(false);
      });
    }

    it("suspends with a record of reason, time, person and origin manual", async function () {
      const before = Date.now();

      const res = await suspend(CUSTOMER, { reason: "  Beleidigt Personal  " });

      expect(res.status).to.equal(200);
      expect(res.body.isSuspended).to.equal(true);
      const { suspension } = res.body;
      expect(suspension).to.include({
        reason: "Beleidigt Personal",
        suspendedBy: ADMIN,
        origin: "manual",
      });
      expect(suspension.suspendedAt).to.be.within(before, Date.now());
      expect(stored(CUSTOMER).isSuspended).to.equal(true);
      expect(stored(CUSTOMER).suspension.reason).to.equal("Beleidigt Personal");
    });

    it("replaces the record of an earlier suspension, reasons do not pile up", async function () {
      await suspend(CUSTOMER, { reason: "erster Grund" });

      const res = await suspend(CUSTOMER, { reason: "zweiter Grund" });

      expect(res.status).to.equal(200);
      expect(res.body.suspension.reason).to.equal("zweiter Grund");
    });

    it("refuses an instance owner with 409", async function () {
      const res = await suspend(ADMIN, { reason: "Test" });

      expect(res.status).to.equal(409);
      expect(res.body.code).to.equal("instance_owner_not_suspendable");
      expect(stored(ADMIN).isSuspended).to.equal(false);
    });

    it("answers 404 for an unknown user", async function () {
      const res = await suspend("niemand@example.test", { reason: "Test" });

      expect(res.status).to.equal(404);
      expect(res.body.code).to.equal("user_not_found");
    });

    it("is the instance owner's alone", async function () {
      const res = await suspend(CUSTOMER, { reason: "Test" }, OWNER);

      expect(res.status).to.equal(403);
      expect(stored(CUSTOMER).isSuspended).to.equal(false);
    });

    it("ends a running session at once", async function () {
      const session = h.as(CUSTOMER);
      expect((await h.api().get("/auth/me").set(session)).status).to.equal(200);

      await suspend(CUSTOMER, { reason: "Test" });

      const res = await h.api().get("/auth/me").set(session);
      expect(res.status).to.equal(403);
    });
  });

  describe("suspending with the address on the blacklist (ECCdigital/tickets#626)", function () {
    it("adds an entry of origin suspension with the reason, the suspension stays manual", async function () {
      const res = await suspend(CUSTOMER, {
        reason: "Beleidigt Personal",
        blacklist: true,
      });

      expect(res.status).to.equal(200);
      expect(res.body.suspension.origin).to.equal("manual");
      expect(entries).to.have.lengthOf(1);
      expect(entries[0]).to.include({
        value: CUSTOMER,
        kind: "address",
        reason: "Beleidigt Personal",
        createdBy: ADMIN,
        origin: "suspension",
        suspensionUserId: CUSTOMER,
      });
      expect(entries[0].suspendedUserIds).to.deep.equal([]);
    });

    it("adds no entry without the checkbox", async function () {
      const res = await suspend(CUSTOMER, { reason: "Test" });

      expect(res.status).to.equal(200);
      expect(entries).to.have.lengthOf(0);
    });

    it("adds no second entry when one already hits the address", async function () {
      entries.push(domainEntry());

      const res = await suspend(CUSTOMER, { reason: "Test", blacklist: true });

      expect(res.status).to.equal(200);
      expect(entries.map((entry) => entry.id)).to.deep.equal(["domain"]);
    });

    it("adds no entry when the suspension is refused", async function () {
      const res = await suspend(CUSTOMER, { reason: " ", blacklist: true });

      expect(res.status).to.equal(400);
      expect(entries).to.have.lengthOf(0);
    });
  });

  describe("lifting", function () {
    const lift = (id, by = ADMIN) =>
      h.api().delete(`/api/users/${id}/suspension`).set(h.as(by));

    it("lifts the suspension and its record, the session works again", async function () {
      await suspend(CUSTOMER, { reason: "Test" });

      const res = await lift(CUSTOMER);

      expect(res.status).to.equal(200);
      expect(res.body.isSuspended).to.equal(false);
      expect(res.body.suspension).to.equal(null);
      expect(stored(CUSTOMER).suspension).to.equal(null);
      const me = await h.api().get("/auth/me").set(h.as(CUSTOMER));
      expect(me.status).to.equal(200);
    });

    it("lifts a suspension stored without a record", async function () {
      stored(CUSTOMER).isSuspended = true;

      const res = await lift(CUSTOMER);

      expect(res.status).to.equal(200);
      expect(stored(CUSTOMER).isSuspended).to.equal(false);
    });

    it("answers 404 for an unknown user and is the instance owner's alone", async function () {
      expect((await lift("niemand@example.test")).status).to.equal(404);
      expect((await lift(CUSTOMER, OWNER)).status).to.equal(403);
    });
  });

  describe("lifting with a blacklist entry (ECCdigital/tickets#626)", function () {
    const lift = (id, query = "") =>
      h.api().delete(`/api/users/${id}/suspension${query}`).set(h.as(ADMIN));
    beforeEach(async function () {
      await suspend(CUSTOMER, { reason: "Test", blacklist: true });
    });

    it("removes the exact entry with ?removeBlacklistEntry=true", async function () {
      const res = await lift(CUSTOMER, "?removeBlacklistEntry=true");

      expect(res.status).to.equal(200);
      expect(res.body.isSuspended).to.equal(false);
      expect(entries).to.have.lengthOf(0);
    });

    it("keeps the exact entry without the checkbox", async function () {
      const res = await lift(CUSTOMER);

      expect(res.status).to.equal(200);
      expect(res.body.isSuspended).to.equal(false);
      expect(entries.map((entry) => entry.value)).to.deep.equal([CUSTOMER]);
    });

    it("keeps a domain entry, which does not suspend the account anew", async function () {
      entries.splice(0, entries.length, domainEntry());

      const res = await lift(CUSTOMER, "?removeBlacklistEntry=true");

      expect(res.status).to.equal(200);
      expect(entries.map((entry) => entry.id)).to.deep.equal(["domain"]);
      expect(stored(CUSTOMER).isSuspended).to.equal(false);
      const me = await h.api().get("/auth/me").set(h.as(CUSTOMER));
      expect(me.status).to.equal(200);
    });
  });

  describe("reading", function () {
    it("shows a suspension stored without a record as one by hand without details", async function () {
      stored(CUSTOMER).isSuspended = true;

      const res = await h.api().get(`/api/users/${CUSTOMER}`).set(h.as(ADMIN));

      expect(res.body.suspension).to.deep.equal({
        reason: null,
        suspendedAt: null,
        suspendedBy: null,
        origin: "manual",
      });
    });

    it("shows no suspension for a user not suspended", async function () {
      const res = await h.api().get(`/api/users/${CUSTOMER}`).set(h.as(ADMIN));

      expect(res.body.isSuspended).to.equal(false);
      expect(res.body.suspension).to.equal(null);
    });
  });

  describe("the list of users", function () {
    it("narrows to the suspended with ?suspended=true and names the origin", async function () {
      stored(OWNER).isSuspended = true;
      await suspend(CUSTOMER, { reason: "Test" });

      const res = await h
        .api()
        .get("/api/users?suspended=true")
        .set(h.as(ADMIN));

      expect(res.status).to.equal(200);
      expect(res.body.map((user) => user.id)).to.have.members([
        OWNER,
        CUSTOMER,
      ]);
      expect(res.body.map((user) => user.suspension.origin)).to.deep.equal([
        "manual",
        "manual",
      ]);
    });

    it("lists everyone without the filter", async function () {
      await suspend(CUSTOMER, { reason: "Test" });

      const res = await h.api().get("/api/users").set(h.as(ADMIN));

      expect(res.body).to.have.lengthOf(3);
    });
  });

  describe("the preview of the consequences", function () {
    const preview = (id, by = ADMIN) =>
      h.api().get(`/api/users/${id}/suspension-preview`).set(h.as(by));

    it("counts the user's bookings across tenants and their memberships", async function () {
      const bookings = [
        { assignedUserId: CUSTOMER, tenantId: "tenant-1" },
        { assignedUserId: CUSTOMER, tenantId: "tenant-2" },
        { assignedUserId: OWNER, tenantId: "tenant-1" },
      ];
      sinon
        .stub(BookingModel, "countDocuments")
        .callsFake(
          async (filter) =>
            bookings.filter(
              (booking) => booking.assignedUserId === filter.assignedUserId,
            ).length,
        );

      const res = await preview(CUSTOMER);

      expect(res.status).to.equal(200);
      expect(res.body).to.deep.equal({
        bookings: 2,
        memberships: 1,
        blacklistEntry: null,
        openReports: [],
      });
    });

    it("names the blacklist entry that hits the address (ECCdigital/tickets#626)", async function () {
      sinon.stub(BookingModel, "countDocuments").resolves(0);
      entries.push(domainEntry());

      const res = await preview(CUSTOMER);

      expect(res.body.blacklistEntry).to.deep.equal({
        id: "domain",
        value: "@example.test",
        kind: "domain",
      });
    });

    it("answers 404 for an unknown user and is the instance owner's alone", async function () {
      expect((await preview("niemand@example.test")).status).to.equal(404);
      expect((await preview(CUSTOMER, OWNER)).status).to.equal(403);
    });
  });

  describe("the general update", function () {
    const update = (body) =>
      h
        .api()
        .put("/api/users")
        .set(h.as(ADMIN))
        .send({ id: CUSTOMER, ...body });

    it("creates no suspended user and takes no record from the client", async function () {
      const res = await h
        .api()
        .put("/api/users")
        .set(h.as(ADMIN))
        .send({
          id: "neu@example.test",
          firstName: "Neu",
          isSuspended: true,
          suspension: { reason: "erfunden", origin: "manual" },
        });

      expect(res.status).to.equal(200);
      expect(stored("neu@example.test").isSuspended).to.equal(false);
      expect(stored("neu@example.test").suspension).to.equal(null);
    });

    it("no longer suspends", async function () {
      const res = await update({ phone: "0431 123", isSuspended: true });

      expect(res.status).to.equal(200);
      expect(stored(CUSTOMER).phone).to.equal("0431 123");
      expect(stored(CUSTOMER).isSuspended).to.equal(false);
    });

    it("no longer lifts a suspension", async function () {
      await suspend(CUSTOMER, { reason: "Test" });

      await update({ isSuspended: false });

      expect(stored(CUSTOMER).isSuspended).to.equal(true);
    });
  });
});
