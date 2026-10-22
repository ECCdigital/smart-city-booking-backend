/**
 * Reports (glossary „Meldung (eines Users oder einer Adresse)“,
 * ECCdigital/tickets#630): a role with `manageUsers.updateAny` reports a
 * member of its tenant or the booker of a booking of its tenant to the
 * instance, with a reason. The instance owners get a mail and settle every
 * open report of a user at once, with a suspension or a rejection with a
 * reason; the tenant owners of each reporting tenant get the outcome. The
 * reported user learns nothing.
 *
 * Runs over the real routers on the lifecycle harness, the user collection
 * in memory below `UserManager` at the model, the reports below
 * `ReportManager` and the supervision outbox in memory; the transport
 * records every mail as an effect.
 */

const { expect } = require("chai");
const sinon = require("sinon");

const {
  installHarness,
  ADMIN,
  OWNER,
  ROLE_HOLDER,
  READ_OWN_HOLDER,
  CUSTOMER,
  OWNER_B,
  TENANT,
  TENANT_B,
} = require("./helpers/booking-lifecycle-harness");
const UserManager = require("../src/commons/data-managers/user-manager");
const BookingModel = require("../src/commons/data-managers/models/bookingModel");
const SupervisionNotificationService = require("../src/commons/services/supervision/supervision-notification-service");
const {
  account,
  installUserCollection,
} = require("./helpers/auth-user-collection");
const {
  installSupervisionOutboxStore,
} = require("./helpers/supervision-outbox-store");

describe("reports (ECCdigital/tickets#630)", function () {
  this.timeout(20000);

  let h;
  let users;
  let reports;
  let outbox;

  beforeEach(async function () {
    h = await installHarness();
    UserManager.getUser.restore();
    UserManager.getRawUser.restore();
    users = installUserCollection([
      account(ADMIN, "geheim-1234"),
      account(OWNER, "geheim-1234"),
      account(ROLE_HOLDER, "geheim-1234"),
      account(READ_OWN_HOLDER, "geheim-1234"),
      account(CUSTOMER, "geheim-1234", {
        firstName: "Erika",
        lastName: "Muster",
      }),
      account(OWNER_B, "geheim-1234"),
    ]);
    reports = h.reports;
    outbox = installSupervisionOutboxStore();
  });

  afterEach(async function () {
    await SupervisionNotificationService.whenIdle();
    sinon.restore();
    await h.close();
  });

  const user = (id) => users.find((doc) => doc.id === id);
  const report = (body, by = ROLE_HOLDER) =>
    h.api().post(`/api/tenants/${TENANT}/reports`).set(h.as(by)).send(body);
  /** The mails sent so far, as `<type> <to>`. */
  const mails = async () => {
    await SupervisionNotificationService.whenIdle();
    return h
      .takeEffects()
      .filter((effect) => effect.startsWith("mail."))
      .map((effect) => effect.slice("mail.".length));
  };

  describe("reporting a member", function () {
    it("stores an open report and mails every instance owner", async function () {
      const before = Date.now();

      const res = await report({ userId: CUSTOMER, reason: "Beleidigt" });

      expect(res.status).to.equal(201);
      expect(res.body).to.include({
        tenantId: TENANT,
        targetUserId: CUSTOMER,
        reason: "Beleidigt",
        bookingId: null,
        reportedBy: ROLE_HOLDER,
        status: "open",
      });
      expect(res.body.reportedAt).to.be.within(before, Date.now());
      expect(reports).to.have.length(1);
      expect(outbox.map((row) => row.type)).to.deep.equal(["report.created"]);
      expect(await mails()).to.deep.equal([
        `SUPERVISION_REPORT_CREATED ${ADMIN}`,
      ]);
      expect(user(CUSTOMER).isSuspended ?? false).to.equal(false);
    });

    it("trims the reason and refuses none with 400", async function () {
      const blank = await report({ userId: CUSTOMER, reason: "  " });
      const trimmed = await report({ userId: CUSTOMER, reason: " Laut " });

      expect(blank.status).to.equal(400);
      expect(blank.body.code).to.equal("report_reason_required");
      expect(trimmed.body.reason).to.equal("Laut");
    });

    it("adds a second report of the tenant to the open one instead of a new one, without a new mail", async function () {
      await report({ userId: CUSTOMER, reason: "Beleidigt" });
      await mails();

      const res = await report({ userId: CUSTOMER, reason: "Wieder" }, OWNER);

      expect(res.status).to.equal(200);
      expect(reports).to.have.length(1);
      expect(res.body.reason).to.equal("Beleidigt");
      expect(res.body.additions).to.have.length(1);
      expect(res.body.additions[0]).to.include({
        reason: "Wieder",
        reportedBy: OWNER,
      });
      expect(await mails()).to.deep.equal([]);
    });

    it("answers 409 for a user already suspended and stores nothing", async function () {
      user(CUSTOMER).isSuspended = true;

      const res = await report({ userId: CUSTOMER, reason: "Beleidigt" });

      expect(res.status).to.equal(409);
      expect(res.body.code).to.equal("report_target_already_suspended");
      expect(reports).to.have.length(0);
    });
  });

  describe("who reports whom", function () {
    it("lets no role holder report a tenant owner", async function () {
      const res = await report({ userId: OWNER, reason: "x" }, ROLE_HOLDER);

      expect(res.status).to.equal(403);
      expect(res.body.code).to.equal("report_target_tenant_owner");
      expect(reports).to.have.length(0);
    });

    it("lets an owner of the tenant report a tenant owner", async function () {
      // The instance owner holds every right of an owner in the tenant.
      const res = await report({ userId: OWNER, reason: "x" }, ADMIN);

      expect(res.status).to.equal(201);
    });

    it("lets nobody report an instance owner", async function () {
      const res = await report({ userId: ADMIN, reason: "x" }, OWNER);

      expect(res.status).to.equal(403);
      expect(res.body.code).to.equal("report_target_instance_owner");
    });

    it("refuses a user who is neither a member nor a booker of the tenant", async function () {
      const res = await report({ userId: OWNER_B, reason: "x" });

      expect(res.status).to.equal(403);
      expect(reports).to.have.length(0);
    });

    it("refuses a role without manageUsers.updateAny", async function () {
      const res = await report(
        { userId: CUSTOMER, reason: "x" },
        READ_OWN_HOLDER,
      );

      expect(res.status).to.equal(403);
      expect(reports).to.have.length(0);
    });
  });

  describe("reporting the booker of a booking", function () {
    it("reports the booker with an account, the booking as evidence", async function () {
      const booking = await h.manualBooking("room", {}, { mail: OWNER_B });

      const res = await report({ bookingId: booking.id, reason: "No-Show" });

      expect(res.status).to.equal(201);
      expect(res.body).to.include({
        targetUserId: OWNER_B,
        bookingId: booking.id,
      });
    });

    it("refuses a booker without an account", async function () {
      const booking = await h.manualBooking(
        "room",
        {},
        { mail: "gast@example.test" },
      );

      const res = await report({ bookingId: booking.id, reason: "x" });

      expect(res.status).to.equal(400);
      expect(res.body.code).to.equal("report_target_without_account");
    });
  });

  describe("settling the open reports of a user", function () {
    const resolve = (body, by = ADMIN) =>
      h.api().post("/api/instances/reports/resolve").set(h.as(by)).send(body);
    const list = (query = "", by = ADMIN) =>
      h.api().get(`/api/instances/reports${query}`).set(h.as(by));

    beforeEach(async function () {
      await report({ userId: CUSTOMER, reason: "Beleidigt" });
      // The second tenant reported the customer too, from a booking of its
      // own.
      reports.push({
        id: "R-B",
        tenantId: TENANT_B,
        targetUserId: CUSTOMER,
        reason: "Zahlt nicht",
        bookingId: "B-B",
        reportedBy: OWNER_B,
        reportedAt: Date.now(),
        additions: [],
        status: "open",
        rejectionReason: null,
        resolvedAt: null,
        resolvedBy: null,
      });
      await mails();
    });

    it("lists the open reports of every tenant with tenant and user names", async function () {
      const res = await list("?status=open");

      expect(res.status).to.equal(200);
      expect(res.body.map((row) => row.tenantName)).to.deep.equal([
        "Stadt Musterhausen",
        "Verein Nachbarort",
      ]);
      expect(res.body[0]).to.include({
        targetUserId: CUSTOMER,
        targetName: "Erika Muster",
        targetSuspended: false,
      });
    });

    it("suspends the user, settles every open report and mails the reporting tenant's owners", async function () {
      const res = await resolve({
        userId: CUSTOMER,
        decision: "suspend",
        reason: "Wiederholt beleidigend",
      });

      expect(res.status).to.equal(200);
      expect(res.body).to.have.length(2);
      for (const settled of res.body) {
        expect(settled).to.include({ status: "suspended", resolvedBy: ADMIN });
      }
      expect(user(CUSTOMER).isSuspended).to.equal(true);
      expect(user(CUSTOMER).suspension).to.deep.include({
        reason: "Wiederholt beleidigend",
        origin: "manual",
      });
      expect(user(CUSTOMER).suspension.reportIds).to.have.members([
        reports[0].id,
        "R-B",
      ]);
      expect(await mails()).to.have.members([
        `SUPERVISION_REPORT_RESOLVED ${OWNER}`,
        `SUPERVISION_REPORT_RESOLVED ${OWNER_B}`,
      ]);
      expect(outbox.at(-1).payload).to.include({
        outcome: "suspended",
        reason: null,
      });
    });

    it("rejects only with a reason, and tells the tenant owners why", async function () {
      const without = await resolve({ userId: CUSTOMER, decision: "reject" });
      expect(without.status).to.equal(400);
      expect(reports[0].status).to.equal("open");

      const res = await resolve({
        userId: CUSTOMER,
        decision: "reject",
        reason: "Kein Verstoß erkennbar",
      });

      expect(res.status).to.equal(200);
      for (const settled of reports) {
        expect(settled).to.include({
          status: "rejected",
          rejectionReason: "Kein Verstoß erkennbar",
          resolvedBy: ADMIN,
        });
      }
      expect(user(CUSTOMER).isSuspended ?? false).to.equal(false);
      expect(await mails()).to.have.members([
        `SUPERVISION_REPORT_RESOLVED ${OWNER}`,
        `SUPERVISION_REPORT_RESOLVED ${OWNER_B}`,
      ]);
      expect(outbox.at(-1).payload).to.include({
        outcome: "rejected",
        reason: "Kein Verstoß erkennbar",
      });
    });

    it("answers 404 where no report is open", async function () {
      const res = await resolve({
        userId: OWNER_B,
        decision: "reject",
        reason: "x",
      });

      expect(res.status).to.equal(404);
      expect(res.body.code).to.equal("report_none_open");
    });

    it("lets a new report be made after the settlement", async function () {
      await resolve({ userId: CUSTOMER, decision: "reject", reason: "Nein" });

      const res = await report({ userId: CUSTOMER, reason: "Erneut" });

      expect(res.status).to.equal(201);
      expect(reports.filter((doc) => doc.status === "open")).to.have.length(1);
    });

    it("is the instance owner's alone", async function () {
      expect((await list("", OWNER)).status).to.equal(403);
      expect(
        (
          await resolve(
            { userId: CUSTOMER, decision: "reject", reason: "x" },
            OWNER,
          )
        ).status,
      ).to.equal(403);
    });
  });

  describe("a direct suspension", function () {
    beforeEach(async function () {
      await report({ userId: CUSTOMER, reason: "Beleidigt" });
      await mails();
    });

    it("names the open reports and the tenant owners in its preview", async function () {
      sinon.stub(BookingModel, "countDocuments").resolves(0);

      const res = await h
        .api()
        .get(`/api/users/${CUSTOMER}/suspension-preview`)
        .set(h.as(ADMIN));

      expect(res.status).to.equal(200);
      expect(res.body.openReports).to.deep.equal([
        {
          tenantId: TENANT,
          tenantName: "Stadt Musterhausen",
          reports: 1,
          owners: [OWNER],
        },
      ]);
    });

    it("settles the open reports as suspended, points to them and mails the tenant owners", async function () {
      const res = await h
        .api()
        .post(`/api/users/${CUSTOMER}/suspension`)
        .set(h.as(ADMIN))
        .send({ reason: "Direkt" });

      expect(res.status).to.equal(200);
      expect(res.body.suspension.reportIds).to.deep.equal([reports[0].id]);
      expect(reports[0].status).to.equal("suspended");
      expect(await mails()).to.deep.equal([
        `SUPERVISION_REPORT_RESOLVED ${OWNER}`,
      ]);
    });

    it("sends no mail when the suspension is lifted later", async function () {
      await h
        .api()
        .post(`/api/users/${CUSTOMER}/suspension`)
        .set(h.as(ADMIN))
        .send({ reason: "Direkt" });
      await mails();

      const res = await h
        .api()
        .delete(`/api/users/${CUSTOMER}/suspension`)
        .set(h.as(ADMIN));

      expect(res.status).to.equal(200);
      expect(await mails()).to.deep.equal([]);
      expect(reports[0].status).to.equal("suspended");
    });
  });
});
