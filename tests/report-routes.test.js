/**
 * Reports (glossary „Meldung (eines Users oder einer Adresse)“):
 * a role with `manageUsers.updateAny` reports a
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
const MembershipManager = require("../src/commons/data-managers/membership-manager");
const InvitationManager = require("../src/commons/data-managers/invitation-manager");
const SupervisionNotificationService = require("../src/commons/services/supervision/supervision-notification-service");
const {
  account,
  installUserCollection,
} = require("./helpers/auth-user-collection");
const {
  installSupervisionOutboxStore,
} = require("./helpers/supervision-outbox-store");

describe("reports", function () {
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
  /** A blacklist entry by hand, as stored. */
  const blacklistEntry = (value) => ({
    id: `E-${value}`,
    value,
    kind: value.startsWith("@") ? "domain" : "address",
    reason: "Test",
    createdAt: Date.now(),
    createdBy: ADMIN,
    origin: "manual",
    suspendedUserIds: [],
    suspensionUserId: null,
    reportIds: [],
  });
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

  describe("ending the membership with the report", function () {
    let removed;
    let deletedInvitations;

    beforeEach(function () {
      removed = sinon.stub(MembershipManager, "removeMembership").resolves();
      sinon
        .stub(InvitationManager, "getInvitationsByTenantIDAndUserID")
        .callsFake(async (tenantId, userId) =>
          userId === CUSTOMER ? [{ token: "T-1" }, { token: "T-2" }] : [],
        );
      deletedInvitations = sinon
        .stub(InvitationManager, "deleteInvitation")
        .resolves();
    });

    it("ends the membership and the open invitations of the member", async function () {
      const res = await report({
        userId: CUSTOMER,
        reason: "Beleidigt",
        endMembership: true,
      });

      expect(res.status).to.equal(201);
      expect(removed.calledOnceWith(TENANT, CUSTOMER)).to.equal(true);
      expect(deletedInvitations.args).to.deep.equal([
        [TENANT, "T-1"],
        [TENANT, "T-2"],
      ]);
    });

    it("keeps the membership without the checkbox", async function () {
      await report({ userId: CUSTOMER, reason: "Beleidigt" });

      expect(removed.called).to.equal(false);
      expect(deletedInvitations.called).to.equal(false);
    });

    it("ends nothing where the report is refused", async function () {
      user(CUSTOMER).isSuspended = true;
      const suspended = await report({
        userId: CUSTOMER,
        reason: "x",
        endMembership: true,
      });
      const owner = await report({
        userId: OWNER,
        reason: "x",
        endMembership: true,
      });

      expect(suspended.status).to.equal(409);
      expect(owner.status).to.equal(403);
      expect(removed.called).to.equal(false);
    });

    it("ends nothing for a booker who is no member", async function () {
      const booking = await h.manualBooking("room", {}, { mail: OWNER_B });

      const res = await report({
        bookingId: booking.id,
        reason: "No-Show",
        endMembership: true,
      });

      expect(res.status).to.equal(201);
      expect(removed.called).to.equal(false);
    });
  });

  describe("the reports of the tenant", function () {
    const list = (by = ROLE_HOLDER, tenant = TENANT) =>
      h.api().get(`/api/tenants/${tenant}/reports`).set(h.as(by));

    beforeEach(async function () {
      await report({ userId: CUSTOMER, reason: "Beleidigt" });
      // Another tenant's report about the same user.
      reports.push({
        id: "R-B",
        tenantId: TENANT_B,
        targetUserId: CUSTOMER,
        reason: "Zahlt nicht",
        bookingId: null,
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

    it("lists the tenant's own reports alone, with the name of the user", async function () {
      const res = await list();

      expect(res.status).to.equal(200);
      expect(res.body).to.have.length(1);
      expect(res.body[0]).to.include({
        tenantId: TENANT,
        targetUserId: CUSTOMER,
        targetName: "Erika Muster",
        status: "open",
      });
    });

    it("refuses a role without manageUsers.updateAny", async function () {
      expect((await list(READ_OWN_HOLDER)).status).to.equal(403);
    });

    const own = () => reports.find((doc) => doc.tenantId === TENANT);
    const addTo = (id, body, by = ROLE_HOLDER) =>
      h
        .api()
        .post(`/api/tenants/${TENANT}/reports/${id}/additions`)
        .set(h.as(by))
        .send(body);
    const withdraw = (id, by = ROLE_HOLDER) =>
      h
        .api()
        .post(`/api/tenants/${TENANT}/reports/${id}/withdraw`)
        .set(h.as(by));

    it("adds a reason to an open report of the tenant, without a mail", async function () {
      const res = await addTo(own().id, { reason: " Wieder laut " }, OWNER);

      expect(res.status).to.equal(200);
      expect(res.body.additions).to.have.length(1);
      expect(res.body.additions[0]).to.include({
        reason: "Wieder laut",
        reportedBy: OWNER,
        bookingId: null,
      });
      expect(await mails()).to.deep.equal([]);
    });

    it("adds nothing without a reason", async function () {
      const res = await addTo(own().id, { reason: "  " });

      expect(res.status).to.equal(400);
      expect(res.body.code).to.equal("report_reason_required");
      expect(own().additions).to.have.length(0);
    });

    it("withdraws an open report of the tenant, without a mail", async function () {
      const before = Date.now();

      const res = await withdraw(own().id);

      expect(res.status).to.equal(200);
      expect(res.body).to.include({
        status: "withdrawn",
        resolvedBy: ROLE_HOLDER,
      });
      expect(res.body.resolvedAt).to.be.within(before, Date.now());
      expect(own().status).to.equal("withdrawn");
      expect(await mails()).to.deep.equal([]);
    });

    it("lets a new report be made after the withdrawal", async function () {
      await withdraw(own().id);

      const res = await report({ userId: CUSTOMER, reason: "Erneut" });

      expect(res.status).to.equal(201);
      expect(
        reports.filter(
          (doc) => doc.tenantId === TENANT && doc.status === "open",
        ),
      ).to.have.length(1);
    });

    it("answers 409 for a report no longer open", async function () {
      await withdraw(own().id);

      const added = await addTo(own().id, { reason: "Noch was" });
      const again = await withdraw(own().id);

      expect(added.status).to.equal(409);
      expect(added.body.code).to.equal("report_not_open");
      expect(again.status).to.equal(409);
    });

    it("leaves a report about a tenant owner to the tenant owners, and says so in the list", async function () {
      const { body: aboutOwner } = await report(
        { userId: OWNER, reason: "Leitung" },
        ADMIN,
      );

      const added = await addTo(aboutOwner.id, { reason: "x" });
      const withdrawn = await withdraw(aboutOwner.id);
      const byOwner = await addTo(aboutOwner.id, { reason: "Ja" }, OWNER);
      const listed = (await list()).body;

      expect(added.status).to.equal(403);
      expect(withdrawn.status).to.equal(403);
      expect(byOwner.status).to.equal(200);
      expect(
        listed.map(({ targetUserId, targetTenantOwner }) => ({
          targetUserId,
          targetTenantOwner,
        })),
      ).to.deep.equal([
        { targetUserId: CUSTOMER, targetTenantOwner: false },
        { targetUserId: OWNER, targetTenantOwner: true },
      ]);
    });

    it("answers 404 for another tenant's report and leaves it alone", async function () {
      const added = await addTo("R-B", { reason: "Fremd" });
      const withdrawn = await withdraw("R-B");

      expect(added.status).to.equal(404);
      expect(withdrawn.status).to.equal(404);
      const foreign = reports.find((doc) => doc.id === "R-B");
      expect(foreign).to.include({ status: "open" });
      expect(foreign.additions).to.have.length(0);
    });

    it("refuses a role without manageUsers.updateAny", async function () {
      const added = await addTo(own().id, { reason: "x" }, READ_OWN_HOLDER);
      const withdrawn = await withdraw(own().id, READ_OWN_HOLDER);

      expect(added.status).to.equal(403);
      expect(withdrawn.status).to.equal(403);
      expect(own().status).to.equal("open");
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

  describe("reporting guest addresses", function () {
    const GUEST = "gast@example.test";
    const SECOND = "zweit@example.test";

    it("reports an address from `mail` of a booking of the tenant, normalized, and mails the instance owners", async function () {
      const booking = await h.manualBooking("room", {}, { mail: GUEST });
      await mails();

      const res = await report({
        bookingId: booking.id,
        addresses: [" Gast@Example.test "],
        reason: "No-Show",
      });

      expect(res.status).to.equal(201);
      expect(res.body.blacklisted).to.deep.equal([]);
      expect(res.body.reports).to.have.length(1);
      expect(res.body.reports[0]).to.include({
        tenantId: TENANT,
        targetUserId: null,
        targetAddress: GUEST,
        bookingId: booking.id,
        reason: "No-Show",
        status: "open",
      });
      expect(await mails()).to.deep.equal([
        `SUPERVISION_REPORT_CREATED ${ADMIN}`,
      ]);
      expect(outbox.at(-1).payload).to.include({ targetAddress: GUEST });
    });

    it("makes each address picked a report of its own with the same booking and reason", async function () {
      const booking = await h.manualBooking(
        "room",
        {},
        { mail: `${GUEST}, ${SECOND}` },
      );
      await mails();

      const res = await report({
        bookingId: booking.id,
        addresses: [GUEST, SECOND],
        reason: "Randale",
      });

      expect(res.status).to.equal(201);
      expect(
        reports.map(({ targetAddress, bookingId, reason }) => ({
          targetAddress,
          bookingId,
          reason,
        })),
      ).to.deep.equal([
        { targetAddress: GUEST, bookingId: booking.id, reason: "Randale" },
        { targetAddress: SECOND, bookingId: booking.id, reason: "Randale" },
      ]);
      expect(await mails()).to.deep.equal([
        `SUPERVISION_REPORT_CREATED ${ADMIN}`,
        `SUPERVISION_REPORT_CREATED ${ADMIN}`,
      ]);
    });

    it("refuses a free address without a booking, or one not in the booking's mail", async function () {
      const booking = await h.manualBooking("room", {}, { mail: GUEST });

      const free = await report({ addresses: [GUEST], reason: "x" });
      const foreign = await report({
        bookingId: booking.id,
        addresses: [GUEST, "fremd@example.test"],
        reason: "x",
      });

      expect(free.status).to.equal(400);
      expect(free.body.code).to.equal("report_booking_required");
      expect(foreign.status).to.equal(403);
      expect(foreign.body.code).to.equal("report_address_not_of_booking");
      expect(reports).to.have.length(0);
    });

    it("refuses the address of an account: that is a user to report", async function () {
      const booking = await h.manualBooking("room", {}, { mail: CUSTOMER });

      const res = await report({
        bookingId: booking.id,
        addresses: [CUSTOMER],
        reason: "x",
      });

      expect(res.status).to.equal(400);
      expect(res.body.code).to.equal("report_address_of_account");
      expect(reports).to.have.length(0);
    });

    it("refuses a booking of another tenant", async function () {
      const booking = await h.manualBooking("room", {}, { mail: GUEST });

      const res = await h
        .api()
        .post(`/api/tenants/${TENANT_B}/reports`)
        .set(h.as(OWNER_B))
        .send({ bookingId: booking.id, addresses: [GUEST], reason: "x" });

      expect(res.status).to.equal(404);
      expect(reports).to.have.length(0);
    });

    it("stores no report where an entry already hits the address, and says so", async function () {
      h.blacklist.push(blacklistEntry("@example.test"));
      const booking = await h.manualBooking("room", {}, { mail: GUEST });
      await mails();

      const res = await report({
        bookingId: booking.id,
        addresses: [GUEST],
        reason: "x",
      });

      expect(res.status).to.equal(409);
      expect(res.body.code).to.equal("report_target_already_blacklisted");
      expect(reports).to.have.length(0);
      expect(await mails()).to.deep.equal([]);
    });

    it("reports the other addresses and names the one already on the blacklist", async function () {
      h.blacklist.push(blacklistEntry(SECOND));
      const booking = await h.manualBooking(
        "room",
        {},
        { mail: `${GUEST}, ${SECOND}` },
      );

      const res = await report({
        bookingId: booking.id,
        addresses: [GUEST, SECOND],
        reason: "x",
      });

      expect(res.status).to.equal(201);
      expect(res.body.blacklisted).to.deep.equal([SECOND]);
      expect(reports.map((doc) => doc.targetAddress)).to.deep.equal([GUEST]);
    });

    it("adds a second report of the tenant about the address to the open one", async function () {
      const booking = await h.manualBooking("room", {}, { mail: GUEST });
      await report({ bookingId: booking.id, addresses: [GUEST], reason: "a" });

      const res = await report(
        { bookingId: booking.id, addresses: [GUEST], reason: "b" },
        OWNER,
      );

      expect(res.status).to.equal(200);
      expect(reports).to.have.length(1);
      expect(reports[0].additions.map((doc) => doc.reason)).to.deep.equal([
        "b",
      ]);
    });

    it("refuses a role without manageUsers.updateAny", async function () {
      const booking = await h.manualBooking("room", {}, { mail: GUEST });

      const res = await report(
        { bookingId: booking.id, addresses: [GUEST], reason: "x" },
        READ_OWN_HOLDER,
      );

      expect(res.status).to.equal(403);
      expect(reports).to.have.length(0);
    });

    describe("settling them", function () {
      const resolve = (body, by = ADMIN) =>
        h.api().post("/api/instances/reports/resolve").set(h.as(by)).send(body);
      const addEntry = (body) =>
        h.api().post("/api/instances/blacklist").set(h.as(ADMIN)).send(body);

      beforeEach(async function () {
        const booking = await h.manualBooking(
          "room",
          {},
          { mail: `${GUEST}, ${SECOND}` },
        );
        await report({
          bookingId: booking.id,
          addresses: [GUEST, SECOND],
          reason: "Randale",
        });
        // The second tenant reported the guest too.
        reports.push({
          id: "R-B",
          tenantId: TENANT_B,
          targetUserId: null,
          targetAddress: GUEST,
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

      const about = (address) =>
        reports.filter((doc) => doc.targetAddress === address);

      it("lists the open reports about addresses for the instance owner", async function () {
        const res = await h
          .api()
          .get(`/api/instances/reports?status=open&address=${GUEST}`)
          .set(h.as(ADMIN));

        expect(res.status).to.equal(200);
        expect(res.body.map((row) => row.tenantName)).to.deep.equal([
          "Stadt Musterhausen",
          "Verein Nachbarort",
        ]);
        expect(res.body[0]).to.include({
          targetUserId: null,
          targetAddress: GUEST,
          targetName: "",
        });
      });

      it("settles every open report about the address with an exact entry of origin `reports` that points to them", async function () {
        const res = await resolve({
          address: GUEST,
          decision: "blacklist",
          reason: "Randale",
        });

        expect(res.status).to.equal(200);
        expect(res.body).to.have.length(2);
        for (const settled of about(GUEST)) {
          expect(settled).to.include({
            status: "blacklisted",
            resolvedBy: ADMIN,
          });
        }
        expect(about(SECOND)[0].status).to.equal("open");
        expect(h.blacklist).to.have.length(1);
        expect(h.blacklist[0]).to.include({
          value: GUEST,
          kind: "address",
          reason: "Randale",
          origin: "reports",
          createdBy: ADMIN,
        });
        expect(h.blacklist[0].reportIds).to.have.members(
          about(GUEST).map((doc) => doc.id),
        );
        expect(await mails()).to.have.members([
          `SUPERVISION_REPORT_RESOLVED ${OWNER}`,
          `SUPERVISION_REPORT_RESOLVED ${OWNER_B}`,
        ]);
        expect(outbox.at(-1).payload).to.include({
          targetAddress: GUEST,
          outcome: "blacklisted",
        });
      });

      it("takes the domain instead, which settles the reports about every address of it", async function () {
        const res = await resolve({
          address: GUEST,
          decision: "blacklist",
          reason: "Wegwerf",
          domain: true,
        });

        expect(res.status).to.equal(200);
        expect(h.blacklist[0]).to.include({
          value: "@example.test",
          kind: "domain",
          origin: "reports",
        });
        expect(reports.map((doc) => doc.status)).to.deep.equal([
          "blacklisted",
          "blacklisted",
          "blacklisted",
        ]);
        expect(h.blacklist[0].reportIds).to.have.length(3);
        expect(
          res.body.map((settled) => settled.targetAddress),
        ).to.have.members([GUEST, GUEST, SECOND]);
      });

      it("rejects the reports about the address only with a reason", async function () {
        const without = await resolve({ address: GUEST, decision: "reject" });
        const res = await resolve({
          address: GUEST,
          decision: "reject",
          reason: "Kein Verstoß",
        });

        expect(without.status).to.equal(400);
        expect(res.status).to.equal(200);
        for (const settled of about(GUEST)) {
          expect(settled).to.include({
            status: "rejected",
            rejectionReason: "Kein Verstoß",
          });
        }
        expect(h.blacklist).to.have.length(0);
        expect(await mails()).to.have.members([
          `SUPERVISION_REPORT_RESOLVED ${OWNER}`,
          `SUPERVISION_REPORT_RESOLVED ${OWNER_B}`,
        ]);
      });

      it("knows no suspension of an address, and no entry for a user", async function () {
        const suspend = await resolve({
          address: GUEST,
          decision: "suspend",
          reason: "x",
        });
        const blacklist = await resolve({
          userId: CUSTOMER,
          decision: "blacklist",
          reason: "x",
        });

        expect(suspend.status).to.equal(400);
        expect(blacklist.status).to.equal(400);
        expect(about(GUEST)[0].status).to.equal("open");
      });

      it("is settled as on the blacklist by an entry added by hand", async function () {
        const res = await addEntry({ value: GUEST, reason: "von Hand" });

        expect(res.status).to.equal(201);
        expect(res.body.origin).to.equal("manual");
        expect(res.body.reportIds).to.have.length(2);
        expect(about(GUEST).map((doc) => doc.status)).to.deep.equal([
          "blacklisted",
          "blacklisted",
        ]);
        expect(about(SECOND)[0].status).to.equal("open");
        expect(await mails()).to.have.members([
          `SUPERVISION_REPORT_RESOLVED ${OWNER}`,
          `SUPERVISION_REPORT_RESOLVED ${OWNER_B}`,
        ]);
      });

      it("is settled as on the blacklist by a domain entry added by hand", async function () {
        await addEntry({ value: "@example.test", reason: "Wegwerf" });

        expect(reports.every((doc) => doc.status === "blacklisted")).to.equal(
          true,
        );
      });

      it("is settled as on the blacklist by the entry of a suspension", async function () {
        users.push({ ...account(GUEST, "geheim-1234") });

        const res = await h
          .api()
          .post(`/api/users/${GUEST}/suspension`)
          .set(h.as(ADMIN))
          .send({ reason: "Randale", blacklist: true });

        expect(res.status).to.equal(200);
        expect(h.blacklist[0]).to.include({
          value: GUEST,
          origin: "suspension",
        });
        expect(about(GUEST).map((doc) => doc.status)).to.deep.equal([
          "blacklisted",
          "blacklisted",
        ]);
      });

      it("sends no mail when the entry is removed later, and the reports stay settled", async function () {
        const { body: entry } = await addEntry({
          value: GUEST,
          reason: "von Hand",
        });
        await mails();

        const res = await h
          .api()
          .delete(`/api/instances/blacklist/${entry.id}`)
          .set(h.as(ADMIN));

        expect(res.status).to.equal(200);
        expect(await mails()).to.deep.equal([]);
        expect(about(GUEST)[0].status).to.equal("blacklisted");
      });

      it("tells the guest nothing", async function () {
        await resolve({ address: GUEST, decision: "blacklist", reason: "x" });

        expect(
          (await mails()).filter((mail) => mail.endsWith(GUEST)),
        ).to.deep.equal([]);
      });
    });

    it("settles the open reports about an account an entry suspends as suspended", async function () {
      await report({ userId: CUSTOMER, reason: "Beleidigt" });
      await mails();

      const res = await h
        .api()
        .post("/api/instances/blacklist")
        .set(h.as(ADMIN))
        .send({ value: CUSTOMER, reason: "Beleidigt" });

      expect(res.status).to.equal(201);
      expect(reports[0].status).to.equal("suspended");
      expect(user(CUSTOMER).suspension).to.deep.include({
        origin: "blacklist",
        reportIds: [reports[0].id],
      });
      expect(await mails()).to.deep.equal([
        `SUPERVISION_REPORT_RESOLVED ${OWNER}`,
      ]);
    });
  });
});
