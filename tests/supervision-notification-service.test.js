/**
 * The sender of the supervision notification outbox (tenant supervision
 * spec §8, glossary "Aufsichtsmitteilung"): an occasion recorded is a mail
 * to the owners in charge, over the instance's transport and the central
 * templates; a failed send stays on the row and is sent again without a
 * new decision. Runs over the mail fixture, the in-memory transport and
 * the in-memory outbox.
 */

const { expect } = require("chai");
const sinon = require("sinon");

const SupervisionNotificationService = require("../src/commons/services/supervision/supervision-notification-service");
const InstanceManager = require("../src/commons/data-managers/instance-manager");
const MembershipManager = require("../src/commons/data-managers/membership-manager");
const UserManager = require("../src/commons/data-managers/user-manager");
const MailerService = require("../src/commons/mail-service/mail-service");
const { expectSnapshot } = require("./helpers/snapshot");
const {
  installInMemoryMailTransport,
} = require("./helpers/in-memory-mail-transport");
const {
  installSupervisionOutboxStore,
} = require("./helpers/supervision-outbox-store");
const {
  TENANT,
  TENANT_NAME,
  FRONTEND_URL,
  NOW,
  tenant,
  instance,
  installMailStackStore,
} = require("./helpers/mail-stack-fixtures");

const INSTANCE_OWNER_A = "anna@plattform.example.test";
const INSTANCE_OWNER_B = "bernd@plattform.example.test";
const TENANT_OWNER_A = "olga@stadthalle.example.test";
const TENANT_OWNER_B = "otto@stadthalle.example.test";
const CREATOR = TENANT_OWNER_A;
const INSTANCE_FROM = "Buchungsplattform <noreply@plattform.example.test>";

function snapshotOf(sent) {
  return [
    `From: ${sent.from}`,
    `To: ${sent.to}`,
    `Subject: ${sent.subject}`,
    "",
    sent.html,
  ].join("\n");
}

const levelChanged = (payload = {}) => ({
  type: "tenant.levelChanged",
  tenantId: TENANT,
  payload: {
    tenantName: TENANT_NAME,
    from: "free",
    to: "supervised",
    reason: "Neue Angebote werden zunächst geprüft.",
    actorUserId: INSTANCE_OWNER_A,
    changedAt: new Date(NOW),
    ...payload,
  },
});

const selfCreated = (payload = {}) => ({
  type: "tenant.selfCreated",
  tenantId: TENANT,
  payload: {
    tenantId: TENANT,
    tenantName: TENANT_NAME,
    creatorUserId: CREATOR,
    supervisionLevel: "supervised",
    ...payload,
  },
  dedupeKey: `tenant.selfCreated:${TENANT}`,
});

const queueEntered = (payload = {}) => ({
  type: "review.queueEntered",
  tenantId: TENANT,
  payload: {
    tenantName: TENANT_NAME,
    cause: "tenant.levelChanged",
    offers: [
      {
        offerType: "bookable",
        offerId: "room",
        title: "Großer Saal",
        submittedAt: new Date(Date.UTC(2026, 8, 1, 9, 30, 0)),
        isPublic: true,
      },
      {
        offerType: "event",
        offerId: "concert",
        title: "Herbstkonzert",
        submittedAt: new Date(Date.UTC(2026, 8, 2, 14, 0, 0)),
        isPublic: false,
      },
    ],
    ...payload,
  },
});

const decided = (payload = {}) => ({
  type: "review.decided",
  tenantId: TENANT,
  payload: {
    tenantName: TENANT_NAME,
    offerType: "bookable",
    offerId: "room",
    title: "Großer Saal",
    action: "reject",
    from: "pending",
    to: "rejected",
    reason: "Die Beschreibung ist unvollständig.",
    actorUserId: INSTANCE_OWNER_A,
    decidedAt: new Date(NOW),
    ...payload,
  },
});

describe("supervision notification sender", function () {
  let sent;
  let rows;
  let env;

  function given({ storeOptions = {}, tenantOwners, instanceOwners } = {}) {
    const owners = instanceOwners ?? [INSTANCE_OWNER_A, INSTANCE_OWNER_B];
    installMailStackStore({
      ...storeOptions,
      instance: instance({
        ownerUserIds: owners,
        ...(storeOptions.instance ?? {}),
      }),
    });
    sinon
      .stub(UserManager, "getUsersById")
      .callsFake(async (ids) => ids.map((id) => ({ id })));
    sinon
      .stub(MembershipManager, "getOwnerMembershipsByTenantID")
      .callsFake(async (tenantId) =>
        tenantId === TENANT
          ? (tenantOwners ?? [TENANT_OWNER_A, TENANT_OWNER_B]).map(
              (userId) => ({ tenantId, userId, owner: true }),
            )
          : [],
      );
    sent = installInMemoryMailTransport();
    rows = installSupervisionOutboxStore();
  }

  /** Records the occasion and waits until its dispatch settled. */
  async function occasion(value) {
    const row = await SupervisionNotificationService.recordAndDispatch(value);
    await SupervisionNotificationService.whenIdle();
    return row;
  }

  beforeEach(function () {
    env = process.env.FRONTEND_URL;
    process.env.FRONTEND_URL = FRONTEND_URL;
    sinon.useFakeTimers({ now: NOW, toFake: ["Date"] });
  });

  afterEach(function () {
    sinon.restore();
    process.env.FRONTEND_URL = env;
  });

  describe("a level change", function () {
    it("tells every tenant owner the old and the new level, the reason and the admin link", async function () {
      given();

      await occasion(levelChanged());

      expect(sent.map((mail) => mail.to)).to.deep.equal([
        TENANT_OWNER_A,
        TENANT_OWNER_B,
      ]);
      expect(sent[0].from).to.equal(INSTANCE_FROM);
      expect(sent[0].html).to.include("frei");
      expect(sent[0].html).to.include("beaufsichtigt");
      expect(sent[0].html).to.include("Neue Angebote werden zunächst geprüft.");
      expect(sent[0].html).to.include(`${FRONTEND_URL}/dashboard`);
      expectSnapshot(
        "mail/supervision-tenant-level-changed.txt",
        snapshotOf(sent[0]),
      );
      expect(rows[0]).to.include({ status: "sent", attempts: 1 });
      expect(rows[0].sentAt.getTime()).to.equal(NOW);
    });

    it("names a pending tenant 'Freigabe ausstehend' and says what waits for the approval", async function () {
      given();

      await occasion(levelChanged({ from: "supervised", to: "pending" }));

      expect(sent[0].html).to.include(
        "<strong>Bisherige Stufe:</strong> beaufsichtigt",
      );
      expect(sent[0].html).to.include(
        "<strong>Neue Stufe:</strong> Freigabe ausstehend",
      );
      expect(sent[0].html).to.include(
        "Ihr Mandant wartet auf die Freigabe durch die Plattform. Sie können bereits alles vorbereiten; Ihre Angebote werden erst nach der Freigabe öffentlich sichtbar und buchbar.",
      );
      expect(sent[0].html).to.not.include("gesperrt");
    });

    it("tells a declined tenant's owners the declination, the reason and the instance's contact", async function () {
      given({
        storeOptions: {
          instance: { contactAddress: "kontakt@plattform.example.test" },
        },
      });

      await occasion(
        levelChanged({
          from: "pending",
          to: "declined",
          reason: "Der Mandant gehört nicht zur Stadt.",
        }),
      );

      expect(sent.map((mail) => mail.to)).to.deep.equal([
        TENANT_OWNER_A,
        TENANT_OWNER_B,
      ]);
      expect(sent[0].subject).to.equal(
        "Ihr Mandant Stadthalle Musterstadt wurde abgewiesen",
      );
      expect(sent[0].html).to.include(
        "<strong>Bisherige Stufe:</strong> Freigabe ausstehend",
      );
      expect(sent[0].html).to.include(
        "<strong>Neue Stufe:</strong> abgewiesen",
      );
      expect(sent[0].html).to.include(
        "<strong>Begründung:</strong> Der Mandant gehört nicht zur Stadt.",
      );
      expect(sent[0].html).to.include(
        "Ihr Mandant wurde von der Plattform abgewiesen. Er und seine Angebote sind öffentlich nicht sichtbar und nicht buchbar, und Sie und Ihre Mitglieder können ihn im Admin-Bereich derzeit nicht bearbeiten oder einsehen. Bereits getätigte Buchungen bleiben für Ihre Kundinnen und Kunden gültig; Zugang, Belege und Stornierungen laufen weiter. Die Abweisung kann von der Plattform jederzeit zurückgenommen werden.",
      );
      expect(sent[0].html).to.include(
        "Bei Fragen wenden Sie sich an kontakt@plattform.example.test",
      );
      expect(sent[0].html).to.include(`${FRONTEND_URL}/dashboard`);
      expect(sent[0].html).to.not.include("declined");
      expectSnapshot(
        "mail/supervision-tenant-declined.txt",
        snapshotOf(sent[0]),
      );
    });

    it("leaves the reason and the contact line out of a declination without a reason by an instance without a contact", async function () {
      given({
        storeOptions: { instance: { contactAddress: "", mailAddress: "" } },
      });

      await occasion(
        levelChanged({ from: "supervised", to: "declined", reason: null }),
      );

      expect(sent[0].subject).to.equal(
        "Ihr Mandant Stadthalle Musterstadt wurde abgewiesen",
      );
      expect(sent[0].html).to.include(
        "<strong>Neue Stufe:</strong> abgewiesen",
      );
      expect(sent[0].html).to.include(
        "Ihr Mandant wurde von der Plattform abgewiesen.",
      );
      expect(sent[0].html).to.not.include("Begründung");
      expect(sent[0].html).to.not.include("Bei Fragen wenden Sie sich an");
    });

    it("falls back to the instance's mail address for the contact of a declination", async function () {
      given({ storeOptions: { instance: { contactAddress: "" } } });

      await occasion(levelChanged({ from: "pending", to: "declined" }));

      expect(sent[0].html).to.include(
        "Bei Fragen wenden Sie sich an admin@plattform.example.test",
      );
    });

    it("tells the withdrawal of a declination as a generic level change with the new level's hint and no contact", async function () {
      given({
        storeOptions: {
          instance: { contactAddress: "kontakt@plattform.example.test" },
        },
      });

      await occasion(
        levelChanged({ from: "declined", to: "supervised", reason: null }),
      );

      expect(sent[0].subject).to.equal(
        "Freigabestufe Ihres Mandanten Stadthalle Musterstadt wurde geändert",
      );
      expect(sent[0].html).to.include(
        "<strong>Bisherige Stufe:</strong> abgewiesen",
      );
      expect(sent[0].html).to.include(
        "<strong>Neue Stufe:</strong> beaufsichtigt",
      );
      expect(sent[0].html).to.include(
        "Ihre Angebote werden vor der Veröffentlichung von der Plattform geprüft.",
      );
      expect(sent[0].html).to.not.include(
        "Ihr Mandant wurde von der Plattform abgewiesen",
      );
      expect(sent[0].html).to.not.include("Bei Fragen wenden Sie sich an");
      expect(sent[0].html).to.include(`${FRONTEND_URL}/dashboard`);
    });

    it("tells a reset to pending to the tenant owners only, with the waiting hint", async function () {
      given({
        storeOptions: {
          instance: { contactAddress: "kontakt@plattform.example.test" },
        },
      });

      await occasion(levelChanged({ from: "declined", to: "pending" }));

      expect(sent.map((mail) => mail.to)).to.deep.equal([
        TENANT_OWNER_A,
        TENANT_OWNER_B,
      ]);
      expect(sent[0].subject).to.equal(
        "Freigabestufe Ihres Mandanten Stadthalle Musterstadt wurde geändert",
      );
      expect(sent[0].html).to.include(
        "<strong>Neue Stufe:</strong> Freigabe ausstehend",
      );
      expect(sent[0].html).to.include(
        "Ihr Mandant wartet auf die Freigabe durch die Plattform.",
      );
      expect(sent[0].html).to.not.include("Bei Fragen wenden Sie sich an");
    });
  });

  describe("a review decision", function () {
    it("tells every tenant owner the offer, the old and the new status and the reason", async function () {
      given();

      await occasion(decided());

      expect(sent.map((mail) => mail.to)).to.deep.equal([
        TENANT_OWNER_A,
        TENANT_OWNER_B,
      ]);
      expect(sent[0].subject).to.equal(
        "Ablehnung: Buchungsobjekt „Großer Saal“",
      );
      expect(sent[0].html).to.include("ausstehend");
      expect(sent[0].html).to.include("abgelehnt");
      expect(sent[0].html).to.include("Die Beschreibung ist unvollständig.");
      expect(sent[0].html).to.include(`${FRONTEND_URL}/dashboard`);
      expectSnapshot(
        "mail/supervision-review-decided.txt",
        snapshotOf(sent[0]),
      );
      expect(rows[0].status).to.equal("sent");
    });

    it("names an event as one, and a withdrawal without a reason", async function () {
      given();

      await occasion(
        decided({
          offerType: "event",
          offerId: "concert",
          title: "Herbstkonzert",
          action: "withdraw",
          from: "approved",
          to: "rejected",
          reason: null,
        }),
      );

      expect(sent[0].subject).to.equal(
        "Freigaberückzug: Veranstaltung „Herbstkonzert“",
      );
      expect(sent[0].html).to.include("freigegeben");
      expect(sent[0].html).not.to.include("Begründung");
    });
  });

  describe("an entry into the active review queue", function () {
    it("is one mail per instance owner listing every offer of the occasion, of both types", async function () {
      given();

      await occasion(queueEntered());

      expect(sent.map((mail) => mail.to)).to.deep.equal([
        INSTANCE_OWNER_A,
        INSTANCE_OWNER_B,
      ]);
      expect(sent[0].subject).to.equal(
        "2 neue Angebote zur Prüfung: Stadthalle Musterstadt",
      );
      expect(sent[0].html).to.include("Großer Saal");
      expect(sent[0].html).to.include("Herbstkonzert");
      expect(sent[0].html).to.include("Buchungsobjekt");
      expect(sent[0].html).to.include("Veranstaltung");
      expect(sent[0].html).to.include(`${FRONTEND_URL}/instance/mandanten`);
      expectSnapshot(
        "mail/supervision-review-queue-entered.txt",
        snapshotOf(sent[0]),
      );
    });
  });

  describe("a self-creation", function () {
    it("tells every instance owner and confirms the actual initial level to the creator", async function () {
      given();

      await occasion(selfCreated());

      expect(sent.map((mail) => mail.to)).to.deep.equal([
        INSTANCE_OWNER_A,
        INSTANCE_OWNER_B,
        CREATOR,
      ]);
      expect(sent[0].html).to.include(CREATOR);
      expect(sent[0].html).to.include(
        "<strong>Aufsichtsstufe:</strong> beaufsichtigt",
      );
      expect(sent[2].subject).to.equal(
        "Ihr Mandant Stadthalle Musterstadt wurde angelegt",
      );
      expect(sent[2].html).to.include(
        "<strong>Freigabestufe:</strong> beaufsichtigt",
      );
      expectSnapshot(
        "mail/supervision-tenant-self-created.txt",
        snapshotOf(sent[0]),
      );
      expectSnapshot(
        "mail/supervision-tenant-creation-confirmed.txt",
        snapshotOf(sent[2]),
      );
      expect(
        rows[0].deliveries.map(({ mailType, to }) => [mailType, to]),
      ).to.deep.equal([
        ["SUPERVISION_TENANT_SELF_CREATED", INSTANCE_OWNER_A],
        ["SUPERVISION_TENANT_SELF_CREATED", INSTANCE_OWNER_B],
        ["SUPERVISION_TENANT_CREATION_CONFIRMED", CREATOR],
      ]);
    });

    it("confirms a free start as free", async function () {
      given();

      await occasion(selfCreated({ supervisionLevel: "free" }));

      expect(sent[2].html).to.include("<strong>Freigabestufe:</strong> frei");
    });

    it("confirms a pending start as 'Freigabe ausstehend' with the waiting hint", async function () {
      given();

      await occasion(selfCreated({ supervisionLevel: "pending" }));

      expect(sent[2].html).to.include(
        "<strong>Freigabestufe:</strong> Freigabe ausstehend",
      );
      expect(sent[2].html).to.include(
        "Ihr Mandant wartet auf die Freigabe durch die Plattform.",
      );
    });

    it("is not sent while no instance owner could be told, though the creator has the confirmation", async function () {
      given({ instanceOwners: [] });

      const row = await occasion(selfCreated());

      expect(sent.map((mail) => mail.to)).to.deep.equal([CREATOR]);
      expect(rows[0].status).to.equal("failed");
      expect(rows[0].lastError).to.match(/^no_recipients/);

      const current = await InstanceManager.getInstance();
      current.ownerUserIds = [INSTANCE_OWNER_A];
      await SupervisionNotificationService.retry(row.id);

      expect(sent.map((mail) => mail.to)).to.deep.equal([
        CREATOR,
        INSTANCE_OWNER_A,
      ]);
      expect(rows[0].status).to.equal("sent");
    });

    it("never dispatches a repeated occasion of the same dedupe key", async function () {
      given();
      await occasion(selfCreated());
      sent.length = 0;

      let error = null;
      try {
        await occasion(selfCreated());
      } catch (caught) {
        error = caught;
      }

      expect(error?.code).to.equal(11000);
      expect(rows).to.have.length(1);
      expect(sent).to.have.length(0);
    });
  });

  describe("the transport", function () {
    it("is the instance's even where the tenant has a complete mail configuration of its own", async function () {
      given({
        storeOptions: {
          tenant: tenant({
            useInstanceMail: false,
            noreplyMail: "noreply@stadthalle.example.test",
            noreplyDisplayName: "Stadthalle",
            noreplyHost: "smtp.stadthalle.example.test",
            noreplyPort: 465,
            noreplyUser: "stadthalle",
            noreplyPassword: "tenant-secret",
          }),
        },
      });

      await occasion(levelChanged());
      await occasion(queueEntered());

      expect(sent).to.have.length(4);
      for (const mail of sent) {
        expect(mail.from).to.equal(INSTANCE_FROM);
      }
    });
  });

  describe("a failed send", function () {
    /** A transport that refuses one address and delivers the others. */
    function refusing(address) {
      MailerService.createTransporter.restore();
      const delivered = [];
      sinon.stub(MailerService, "createTransporter").returns({
        sendMail: async (options) => {
          if (options.to === address && refusing.active) {
            throw new Error(
              "connection refused for noreply:instance-secret@smtp",
            );
          }
          delivered.push(options);
          return { messageId: "<x@example.test>" };
        },
      });
      refusing.active = true;
      return delivered;
    }

    it("stays on the row, is retried for the missing recipient only, and writes nothing but the row", async function () {
      // The transport retries with backoff before it gives up.
      this.timeout(20000);
      // A no-reply account of its own: the transporters are pooled by it.
      given({
        storeOptions: { instance: { noreplyHost: "smtp.flaky.example.test" } },
      });
      const delivered = refusing(TENANT_OWNER_B);

      const row = await occasion(levelChanged());

      expect(delivered.map((mail) => mail.to)).to.deep.equal([TENANT_OWNER_A]);
      expect(rows[0]).to.include({ status: "failed", attempts: 1 });
      expect(rows[0].sentAt).to.equal(null);
      expect(rows[0].lastError).to.include(TENANT_OWNER_B);
      expect(rows[0].lastError).to.include("connection refused");
      expect(rows[0].lastError).not.to.include("instance-secret");

      refusing.active = false;
      const retried = await SupervisionNotificationService.retry(row.id);

      expect(retried).to.include({ status: "sent", attempts: 2 });
      expect(retried.lastError).to.equal(null);
      expect(delivered.map((mail) => mail.to)).to.deep.equal([
        TENANT_OWNER_A,
        TENANT_OWNER_B,
      ]);
      expect(rows).to.have.length(1);
    });

    it("refuses the retry of a row already sent, and of an unknown row", async function () {
      given();
      const row = await occasion(levelChanged());
      sent.length = 0;

      let conflict = null;
      try {
        await SupervisionNotificationService.retry(row.id);
      } catch (caught) {
        conflict = caught;
      }
      let missing = null;
      try {
        await SupervisionNotificationService.retry("N-unknown");
      } catch (caught) {
        missing = caught;
      }

      expect(conflict?.status ?? conflict?.statusCode).to.equal(409);
      expect(missing?.status ?? missing?.statusCode).to.equal(404);
      expect(sent).to.have.length(0);
    });

    it("marks the row failed and retryable while the instance's mail is switched off", async function () {
      given({ storeOptions: { instance: { mailEnabled: false } } });

      await occasion(queueEntered());

      expect(sent).to.have.length(0);
      expect(rows[0].status).to.equal("failed");
      expect(rows[0].lastError).to.match(/^mail_disabled/);
    });

    it("marks the row failed where nobody is there to tell", async function () {
      given({ tenantOwners: [] });

      await occasion(levelChanged());

      expect(rows[0].status).to.equal("failed");
      expect(rows[0].lastError).to.match(/^no_recipients/);
    });

    it("sends once where two dispatches of the same row race", async function () {
      given();
      const row = await occasion(levelChanged());
      rows[0].status = "pending";
      rows[0].deliveries = [];
      sent.length = 0;

      const outcomes = await Promise.all([
        SupervisionNotificationService.dispatch(row.id),
        SupervisionNotificationService.dispatch(row.id),
      ]);

      expect(outcomes.filter(Boolean)).to.have.length(1);
      expect(sent).to.have.length(2);
    });
  });
});
