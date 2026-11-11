/**
 * The job of customer uploads: it reminds the
 * customer before the deadline of a required proof still missing, reports
 * an overdue one to the tenant and deletes every customer upload by the
 * deletion deadline, leaving the note „automatisch gelöscht“. Each case
 * once, and nothing twice on a second run; a cancellation is the end of a
 * booking; the tenant's switch holds the notice „Nachweis überfällig“ back.
 *
 * Over the lifecycle harness: the real routers, the mail module and the
 * job, the storage, the media records and clamd as fakes, and the clock of
 * the job handed in.
 */

const { expect } = require("chai");
const sinon = require("sinon");

const {
  installHarness,
  bookable,
  checkoutBody,
  TENANT,
  ROLE_ALL,
  ROLE_HOLDER,
  ADMIN,
  CUSTOMER,
  TIME_BEGIN,
  TIME_END,
  DAY,
} = require("./helpers/booking-lifecycle-harness");
const {
  installInMemoryRateLimitEvents,
} = require("./helpers/in-memory-rate-limit-events");
const {
  installRoleMembers,
} = require("./helpers/customer-upload-staff-notice");
const BookingManager = require("../src/commons/data-managers/booking-manager");
const MediaManager = require("../src/commons/data-managers/media-manager");
const TenantManager = require("../src/commons/data-managers/tenant-manager");
const MailerService = require("../src/commons/mail-service/mail-service");
const storage = require("../src/commons/services/storage");
const { Booking } = require("../src/commons/entities/booking/booking");
const {
  setVirusScanner,
} = require("../src/commons/services/customer-upload/virus-scanner");
const {
  CustomerUploadJobs,
} = require("../src/commons/services/customer-upload/customer-upload-jobs");
const {
  LIVE_STATUSES,
} = require("../src/commons/services/booking-lifecycle/booking-state");

const PDF = Buffer.from(
  "%PDF-1.4\n%Vereinsausweis\n1 0 obj<<>>endobj\n%%EOF\n",
);

const PROOF_FIELD = {
  id: "field-proof",
  label: "Vereinsausweis",
  required: true,
  formats: ["pdf"],
  timing: "afterConfirmation",
  deadlineDaysBeforeStart: 7,
};

const OPTIONAL_FIELD = {
  id: "field-optional",
  label: "Satzung",
  required: false,
  formats: ["pdf"],
  timing: "afterConfirmation",
};

const DEADLINE = TIME_BEGIN - 7 * DAY;
const HOUR = 60 * 60 * 1000;

const clone = (value) => structuredClone(value);
const waiting = (r) =>
  (r.review?.status ?? "submitted") === "submitted" &&
  r.review?.fileDeletedAt == null;

describe("customer uploads: the job of reminders, overdue and deletion", function () {
  this.timeout(20000);

  let h;
  let blobs;
  let media;

  async function install(settings = {}) {
    h = await installHarness({
      tenant: {
        customerUploads: {
          enabled: true,
          formats: ["pdf"],
          retentionDays: 30,
          reminderDaysBeforeDeadline: 3,
          notifyOnOverdue: true,
          notifyRoleIds: [ROLE_ALL],
          ...settings,
        },
      },
      bookables: {
        "proof-room": bookable({
          id: "proof-room",
          title: "Halle mit Nachweis",
          autoCommitBooking: true,
          uploadFieldDefinitions: [PROOF_FIELD, OPTIONAL_FIELD],
        }),
      },
    });

    installInMemoryRateLimitEvents();

    blobs = new Map();
    sinon.stub(storage, "getStorageProvider").returns({
      put: async ({ key, data }) => blobs.set(key, data),
      getBuffer: async ({ key }) => blobs.get(key),
      deletePrefix: async ({ prefix }) => {
        for (const key of [...blobs.keys()]) {
          if (key.startsWith(prefix)) blobs.delete(key);
        }
      },
    });
    sinon.stub(storage, "configuredProviderName").returns("s3");

    media = new Map();
    sinon.stub(MediaManager, "storeMedia").callsFake(async (medium) => {
      media.set(medium.id, medium);
      return medium;
    });
    MediaManager.getMedia.callsFake(
      async (id, tenantId) =>
        [media.get(id)].find((m) => m && m.tenantId === tenantId) ?? null,
    );
    sinon
      .stub(MediaManager, "removeMedia")
      .callsFake(async (id) => media.delete(id));

    // The tenants and the queries of the job, over the harness' store.
    sinon.stub(TenantManager, "getTenants").callsFake(async () => [h.tenant]);
    sinon
      .stub(BookingManager, "getBookingsCustomFilter")
      .callsFake(async (tenantId, filter) => {
        const from = filter.$or[0].timeEnd.$gte;
        return [...h.store.values()]
          .filter(
            (doc) =>
              doc.tenantId === tenantId &&
              LIVE_STATUSES.includes(doc.status) &&
              (doc.timeEnd == null || doc.timeEnd >= from),
          )
          .map((doc) => new Booking(clone(doc)));
      });
    sinon
      .stub(BookingManager, "getBookingsWithStoredCustomerUploads")
      .callsFake(async () =>
        [...h.store.values()]
          .filter((doc) => (doc.customerUploads || []).some(waiting))
          .map((doc) => new Booking(clone(doc))),
      );

    // The atomic writes at the booking, over the harness' store.
    sinon
      .stub(BookingManager, "addCustomerUpload")
      .callsFake(async (tenantId, id, reference) => {
        const doc = h.store.get(id);
        if (!doc) return false;
        doc.customerUploads = [...(doc.customerUploads || []), reference];
        return true;
      });
    sinon
      .stub(BookingManager, "reviewCustomerUpload")
      .callsFake(async (tenantId, id, mediaId, review) => {
        const doc = h.store.get(id);
        const reference = (doc?.customerUploads || []).find(
          (r) => r.mediaId === mediaId && waiting(r),
        );
        if (!reference) return false;
        reference.review = review;
        reference.originalFileName = "";
        return true;
      });
    sinon
      .stub(BookingManager, "claimCustomerUploadNotice")
      .callsFake(async (tenantId, id, notice) => {
        const doc = h.store.get(id);
        const notices = doc.customerUploadNotices || [];
        if (
          notices.some(
            (n) => n.kind === notice.kind && n.fieldId === notice.fieldId,
          )
        ) {
          return false;
        }
        doc.customerUploadNotices = [...notices, notice];
        return true;
      });
    sinon
      .stub(BookingManager, "releaseCustomerUploadNotice")
      .callsFake(async (tenantId, id, notice) => {
        const doc = h.store.get(id);
        doc.customerUploadNotices = (doc.customerUploadNotices || []).filter(
          (n) => !(n.kind === notice.kind && n.fieldId === notice.fieldId),
        );
      });
    sinon
      .stub(BookingManager, "setCustomerUploadEndedAt")
      .callsFake(async (tenantId, id, endedAt) => {
        const doc = h.store.get(id);
        if (endedAt === null || doc.customerUploadEndedAt == null) {
          doc.customerUploadEndedAt = endedAt;
        }
      });

    setVirusScanner({ scan: async () => ({ clean: true }) });
    installRoleMembers({ [ROLE_ALL]: [ROLE_HOLDER] });
  }

  beforeEach(function () {
    process.env.STORE_FRONT_URL ||= "https://store.example.test";
  });

  afterEach(async function () {
    setVirusScanner(null);
    sinon.restore();
    await h.close();
  });

  async function booking() {
    const res = await h
      .api()
      .post(`/api/v2/${TENANT}/checkout`)
      .set(h.as(CUSTOMER))
      .send(checkoutBody("proof-room"));
    expect(res.status, res.text).to.equal(200);
    h.clearEffects();
    return res.body.data.booking.id;
  }

  /** A file handed in by the customer; answers its medium's id. */
  async function handIn(id, field = PROOF_FIELD.id) {
    const res = await h
      .api()
      .post(`/api/v2/${TENANT}/bookings/${id}/customer-uploads/${field}`)
      .set(h.as(CUSTOMER))
      .attach("file", PDF, "ausweis-erika.pdf");
    expect(res.status, res.text).to.equal(201);
    const references = h.store.get(id).customerUploads;
    h.clearEffects();
    return references[references.length - 1].mediaId;
  }

  const run = (now) => CustomerUploadJobs.run({ now });
  const mails = () => h.effects.filter((row) => row.startsWith("mail."));
  const sentHtml = (type) =>
    MailerService.send
      .getCalls()
      .map((call) => call.args[0])
      .filter((mail) => mail.type === type)
      .map((mail) => mail.html);

  describe("reminder", function () {
    it("mails the customer once the deadline minus the distance is reached, once", async function () {
      await install();
      const id = await booking();

      await run(DEADLINE - 3 * DAY - HOUR);
      expect(mails()).to.deep.equal([]);

      const outcome = await run(DEADLINE - 3 * DAY + HOUR);
      expect(outcome.reminded).to.deep.equal([id]);
      expect(mails()).to.deep.equal([
        `mail.CUSTOMER_UPLOAD_REMINDER ${CUSTOMER}`,
      ]);
      const [html] = sentHtml("CUSTOMER_UPLOAD_REMINDER");
      // The greeting stands as a paragraph of its own.
      expect(html).to.match(/<p>\s*Hallo,\s*<\/p>/);
      expect(html).to.include("Folgende Nachweise fehlen noch:");
      expect(html).to.include("Vereinsausweis");
      expect(html).to.include(process.env.STORE_FRONT_URL);
      // Optional fields are no reason for a reminder.
      expect(html).to.not.include("Satzung");
      expect(h.store.get(id).customerUploadNotices).to.deep.equal([
        {
          kind: "reminder",
          fieldId: PROOF_FIELD.id,
          sentAt: DEADLINE - 3 * DAY + HOUR,
        },
      ]);

      h.clearEffects();
      const again = await run(DEADLINE - 2 * DAY);
      expect(again.reminded).to.deep.equal([]);
      expect(mails()).to.deep.equal([]);
    });

    it("follows the tenant's distance", async function () {
      await install({ reminderDaysBeforeDeadline: 10 });
      await booking();

      await run(DEADLINE - 10 * DAY + HOUR);

      expect(mails()).to.deep.equal([
        `mail.CUSTOMER_UPLOAD_REMINDER ${CUSTOMER}`,
      ]);
    });

    it("reminds of nothing handed in or fulfilled", async function () {
      await install();
      const id = await booking();
      await handIn(id);

      await run(DEADLINE - HOUR);

      expect(mails()).to.deep.equal([]);
    });

    it("sends on the next run what a failed mail did not", async function () {
      await install();
      const id = await booking();
      h.failing.add("mail.CUSTOMER_UPLOAD_REMINDER");

      const failed = await run(DEADLINE - HOUR);
      expect(failed.reminded).to.deep.equal([]);
      expect(h.store.get(id).customerUploadNotices).to.deep.equal([]);

      h.failing.clear();
      h.clearEffects();
      const next = await run(DEADLINE - HOUR / 2);
      expect(next.reminded).to.deep.equal([id]);
      expect(mails()).to.deep.equal([
        `mail.CUSTOMER_UPLOAD_REMINDER ${CUSTOMER}`,
      ]);
    });
  });

  describe("overdue", function () {
    it("tells the tenant once the deadline has passed, once, and blocks nothing", async function () {
      await install();
      const id = await booking();
      const status = h.store.get(id).status;

      const outcome = await run(DEADLINE + HOUR);

      expect(outcome.overdue).to.deep.equal([id]);
      // Past the deadline the customer gets no reminder any more.
      expect(mails()).to.deep.equal([
        `mail.CUSTOMER_UPLOAD_OVERDUE ${ROLE_HOLDER}`,
      ]);
      const [html] = sentHtml("CUSTOMER_UPLOAD_OVERDUE");
      // The overdue upload fields stand one point each.
      expect(html).to.match(/<li>\s*Vereinsausweis\s*<\/li>/);
      expect(html).to.include(`/bookings/${id}?tenant&#x3D;${TENANT}`);
      expect(h.store.get(id).status).to.equal(status);

      h.clearEffects();
      const again = await run(DEADLINE + 2 * HOUR);
      expect(again.overdue).to.deep.equal([]);
      expect(mails()).to.deep.equal([]);
      expect(h.store.get(id).status).to.equal(status);
    });

    it("follows a reminder with the notice once the deadline has passed", async function () {
      await install();
      await booking();

      await run(DEADLINE - HOUR);
      await run(DEADLINE + HOUR);

      expect(mails()).to.deep.equal([
        `mail.CUSTOMER_UPLOAD_REMINDER ${CUSTOMER}`,
        `mail.CUSTOMER_UPLOAD_OVERDUE ${ROLE_HOLDER}`,
      ]);
    });

    it("stays off behind the tenant's switch", async function () {
      await install({ notifyOnOverdue: false });
      const id = await booking();

      const outcome = await run(DEADLINE + HOUR);

      expect(outcome.overdue).to.deep.equal([]);
      expect(mails()).to.deep.equal([]);
      expect(h.store.get(id).customerUploadNotices).to.deep.equal([]);
    });

    it("goes to the members of the tenant's roles only: without a role, to nobody (ECCdigital/tickets#830)", async function () {
      await install({ notifyRoleIds: [] });
      await booking();

      const outcome = await run(DEADLINE + HOUR);

      expect(outcome.overdue).to.have.length(1);
      expect(mails()).to.deep.equal([]);
    });

    it("sends nothing while the tenant has customer uploads off", async function () {
      await install({ enabled: false });
      await booking();

      await run(DEADLINE - HOUR);
      await run(DEADLINE + HOUR);

      expect(mails()).to.deep.equal([]);
    });
  });

  describe("deletion deadline", function () {
    it("deletes the file after the end plus the deadline and leaves the note, once", async function () {
      await install();
      const id = await booking();
      const mediaId = await handIn(id);
      const key = media.get(mediaId).storage.key;

      const early = await run(TIME_END + 30 * DAY - HOUR);
      expect(early.deleted).to.deep.equal([]);
      expect(media.has(mediaId)).to.equal(true);

      const outcome = await run(TIME_END + 30 * DAY + HOUR);

      expect(outcome.deleted).to.deep.equal([mediaId]);
      expect(media.has(mediaId)).to.equal(false);
      expect(blobs.has(key)).to.equal(false);
      const [reference] = h.store.get(id).customerUploads;
      expect(reference.originalFileName).to.equal("");
      expect(reference.review).to.include({
        status: "submitted",
        autoDeleted: true,
        fileDeletedAt: TIME_END + 30 * DAY + HOUR,
      });

      const again = await run(TIME_END + 31 * DAY);
      expect(again.deleted).to.deep.equal([]);
      expect(h.store.get(id).customerUploads[0].review.fileDeletedAt).to.equal(
        TIME_END + 30 * DAY + HOUR,
      );
    });

    it("follows the tenant's shorter deadline", async function () {
      await install({ retentionDays: 5 });
      const id = await booking();
      const mediaId = await handIn(id);

      const outcome = await run(TIME_END + 5 * DAY + HOUR);

      expect(outcome.deleted).to.deep.equal([mediaId]);
    });

    it("takes a cancellation as the end of the booking", async function () {
      await install();
      const id = await booking();
      const mediaId = await handIn(id);
      // Cancelled two months before it would have begun.
      const cancelledAt = TIME_BEGIN - 60 * DAY;
      h.store.get(id).status = "cancelled";

      await run(cancelledAt);
      expect(h.store.get(id).customerUploadEndedAt).to.equal(cancelledAt);
      expect(media.has(mediaId)).to.equal(true);

      const outcome = await run(cancelledAt + 30 * DAY + HOUR);

      expect(outcome.deleted).to.deep.equal([mediaId]);
      expect(media.has(mediaId)).to.equal(false);
      expect(h.store.get(id).customerUploads[0].review.autoDeleted).to.equal(
        true,
      );
    });

    it("leaves an upload deleted so to no check any more", async function () {
      await install();
      const id = await booking();
      const mediaId = await handIn(id);
      await run(TIME_END + 30 * DAY + HOUR);

      const res = await h
        .api()
        .post(
          `/api/v2/${TENANT}/bookings/${id}/customer-uploads/${PROOF_FIELD.id}/${mediaId}/review`,
        )
        .set(h.as(ADMIN))
        .send({ result: "accepted" });

      expect(res.status).to.equal(409);
      expect(h.store.get(id).customerUploads[0].review.autoDeleted).to.equal(
        true,
      );
    });
  });
});
