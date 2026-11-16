/**
 * Proofs of a manual booking: the staff hands files in with the booking
 * it makes, for any of its upload fields - accepted in their name once
 * the booking is admitted, a sensitive one without its file - and asks
 * the booker for a proof not handed in yet with „Nachreichen anfordern“,
 * one field at a time.
 *
 * Over the lifecycle harness: the real routers and the mail module, the
 * storage, the media records and clamd as fakes.
 */

const { expect } = require("chai");
const sinon = require("sinon");

const {
  installHarness,
  bookable,
  checkoutBody,
  TENANT,
  ADMIN,
  CUSTOMER,
} = require("./helpers/booking-lifecycle-harness");
const {
  installInMemoryRateLimitEvents,
} = require("./helpers/in-memory-rate-limit-events");
const BookingManager = require("../src/commons/data-managers/booking-manager");
const MediaManager = require("../src/commons/data-managers/media-manager");
const MailerService = require("../src/commons/mail-service/mail-service");
const storage = require("../src/commons/services/storage");
const {
  setVirusScanner,
} = require("../src/commons/services/customer-upload/virus-scanner");

const STORE_FRONT_URL = "https://store.example.test";
const FRONTEND_URL = "https://admin.example.test";

const PDF = Buffer.from(
  "%PDF-1.4\n%Vereinsausweis\n1 0 obj<<>>endobj\n%%EOF\n",
);

const PROOF_FIELD = {
  id: "field-proof",
  label: "Mitgliedsnachweis",
  required: true,
  formats: ["pdf"],
  timing: "afterConfirmation",
  deadlineDaysBeforeStart: 7,
};

const SENSITIVE_FIELD = {
  id: "field-sensitive",
  label: "Personalausweis",
  required: true,
  formats: ["pdf"],
  category: "sensitive",
  timing: "beforeRelease",
};

const OPTIONAL_FIELD = {
  id: "field-optional",
  label: "Sozialpass",
  required: false,
  formats: ["pdf"],
  timing: "beforeRelease",
};

/** The links of a mail as a client reads them, its entities decoded. */
const linksOf = (html) =>
  [...html.matchAll(/href="([^"]*)"/g)].map(([, href]) =>
    href.replace(/&#x3D;/g, "=").replace(/&amp;/g, "&"),
  );

describe("customer uploads: proofs of a manual booking", function () {
  this.timeout(20000);

  let h;
  let media;
  let sent;
  let env;

  beforeEach(async function () {
    env = {
      STORE_FRONT_URL: process.env.STORE_FRONT_URL,
      FRONTEND_URL: process.env.FRONTEND_URL,
      RATE_LIMIT_CUSTOMER_UPLOAD_PER_BOOKING:
        process.env.RATE_LIMIT_CUSTOMER_UPLOAD_PER_BOOKING,
    };
    process.env.STORE_FRONT_URL = STORE_FRONT_URL;
    process.env.FRONTEND_URL = FRONTEND_URL;

    h = await installHarness({
      tenant: {
        customerUploads: {
          enabled: true,
          formats: ["pdf"],
          retentionDays: 30,
        },
      },
      bookables: {
        "proof-room": bookable({
          id: "proof-room",
          title: "Halle mit Nachweisen",
          autoCommitBooking: false,
          uploadFieldDefinitions: [
            PROOF_FIELD,
            SENSITIVE_FIELD,
            OPTIONAL_FIELD,
          ],
        }),
      },
    });

    installInMemoryRateLimitEvents();

    const blobs = new Map();
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
    // The holders of a medium of several bookings, for the state.
    sinon
      .stub(MediaManager, "getAllMedia")
      .callsFake(async (filter) =>
        [...media.values()].filter(
          (m) => m.tenantId === filter.tenantId && filter.id.$in.includes(m.id),
        ),
      );
    MediaManager.getMedia.callsFake(
      async (id, tenantId) =>
        [media.get(id)].find((m) => m && m.tenantId === tenantId) ?? null,
    );
    sinon
      .stub(MediaManager, "removeBookingReference")
      .callsFake(async (id, tenantId, bookingId) => {
        const medium = media.get(id);
        if (!medium) return null;
        medium.bookingIds = medium.bookingIds.filter((b) => b !== bookingId);
        return medium;
      });
    sinon
      .stub(MediaManager, "removeMedia")
      .callsFake(async (id) => media.delete(id));

    // The atomic writes of the references, over the harness' store.
    sinon
      .stub(BookingManager, "addCustomerUpload")
      .callsFake(async (tenantId, id, reference) => {
        const doc = h.store.get(id);
        if (!doc) return false;
        doc.customerUploads = [...(doc.customerUploads || []), reference];
        return true;
      });
    sinon
      .stub(BookingManager, "removeCustomerUpload")
      .callsFake(async (tenantId, id, mediaId, status) => {
        const doc = h.store.get(id);
        const before = doc?.customerUploads?.length ?? 0;
        if (!doc) return false;
        doc.customerUploads = doc.customerUploads.filter(
          (r) => !(r.mediaId === mediaId && r.review.status === status),
        );
        return doc.customerUploads.length < before;
      });
    sinon
      .stub(BookingManager, "reviewCustomerUpload")
      .callsFake(async (tenantId, id, mediaId, review) => {
        const doc = h.store.get(id);
        const reference = (doc?.customerUploads || []).find(
          (r) => r.mediaId === mediaId && r.review.status === "submitted",
        );
        if (!reference) return false;
        reference.review = review;
        reference.originalFileName = "";
        return true;
      });

    sent = [];
    MailerService.send.callsFake(async (mail) => {
      sent.push(mail);
      return { status: "sent", transport: "instance" };
    });

    setVirusScanner({ scan: async () => ({ clean: true }) });
  });

  afterEach(async function () {
    setVirusScanner(null);
    sinon.restore();
    await h.close();
    for (const [key, value] of Object.entries(env)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  });

  /** A manual booking of the staff, as multipart with `files` by field. */
  function manual(files = {}) {
    const req = h
      .api()
      .post(`/api/${TENANT}/bookings`)
      .set(h.as(ADMIN))
      .field(
        "checkout",
        JSON.stringify({ tenantId: TENANT, ...checkoutBody("proof-room") }),
      );
    for (const [fieldId, name] of Object.entries(files)) {
      req.attach(`customerUpload:${fieldId}`, PDF, name);
    }
    return req;
  }

  const references = (id) => h.store.get(id).customerUploads || [];
  const reviewOf = (id, fieldId) =>
    references(id).find((r) => r.fieldId === fieldId)?.review;
  const mailsTo = (to) => sent.filter((m) => m.to === to);

  describe("files with the booking", function () {
    it("accepts them in the name of the staff, a sensitive one without its file", async function () {
      const res = await manual({
        [PROOF_FIELD.id]: "ausweis.pdf",
        [SENSITIVE_FIELD.id]: "pass.pdf",
      });

      expect(res.status, res.text).to.equal(200);
      const id = res.body.id;
      expect(reviewOf(id, PROOF_FIELD.id).status).to.equal("accepted");
      expect(reviewOf(id, SENSITIVE_FIELD.id).status).to.equal("accepted");
      expect(reviewOf(id, SENSITIVE_FIELD.id).fileDeletedAt).to.be.a("number");
      expect(media.size).to.equal(1);
      expect([...media.values()][0].bookingIds).to.deep.equal([id]);
    });

    it("names in the booker's mail only the proofs not handed in", async function () {
      const missingIn = (mails) =>
        mails.some((m) => m.html.includes("Folgende Nachweise fehlen noch"));

      sent.length = 0;
      expect((await manual()).status).to.equal(200);
      expect(missingIn(mailsTo(CUSTOMER))).to.equal(true);

      sent.length = 0;
      const res = await manual({ [SENSITIVE_FIELD.id]: "pass.pdf" });
      expect(res.status, res.text).to.equal(200);
      expect(missingIn(mailsTo(CUSTOMER))).to.equal(false);
    });

    it("takes a booking without files as before", async function () {
      const res = await h
        .api()
        .post(`/api/${TENANT}/bookings`)
        .set(h.as(ADMIN))
        .send({ tenantId: TENANT, ...checkoutBody("proof-room") });

      expect(res.status, res.text).to.equal(200);
      expect(references(res.body.id)).to.have.length(0);
    });

    it("refuses a file of another format, storing nothing", async function () {
      const res = await h
        .api()
        .post(`/api/${TENANT}/bookings`)
        .set(h.as(ADMIN))
        .field(
          "checkout",
          JSON.stringify({ tenantId: TENANT, ...checkoutBody("proof-room") }),
        )
        .attach(
          `customerUpload:${PROOF_FIELD.id}`,
          Buffer.from("text"),
          "a.txt",
        );

      expect(res.status, res.text).to.be.within(400, 499);
      expect(h.store.size).to.equal(0);
      expect(media.size).to.equal(0);
    });
  });

  describe("„Nachreichen anfordern“", function () {
    const ask = (id, fieldId) =>
      h
        .api()
        .post(
          `/api/v2/${TENANT}/bookings/${id}/customer-uploads/${fieldId}/request`,
        )
        .set(h.as(ADMIN));

    async function booked(files = {}) {
      const res = await manual(files);
      expect(res.status, res.text).to.equal(200);
      sent.length = 0;
      return res.body.id;
    }

    it("mails the booker the one proof asked for", async function () {
      const id = await booked();

      const res = await ask(id, SENSITIVE_FIELD.id);

      expect(res.status, res.text).to.equal(200);
      expect(res.body.customerUploadState.fields).to.be.an("array");
      const [mail] = mailsTo(CUSTOMER);
      expect(mail.subject).to.include("Nachweise für Ihre Buchung");
      expect(mail.html).to.include("benötigen wir noch den Nachweis");
      expect(mail.html).to.include("Personalausweis");
    });

    it("links an optional proof where the block of the missing ones leaves it out", async function () {
      const id = await booked();

      const res = await ask(id, OPTIONAL_FIELD.id);

      expect(res.status, res.text).to.equal(200);
      const [mail] = mailsTo(CUSTOMER);
      expect(mail.html).to.include("Sozialpass");
      expect(
        linksOf(mail.html).filter((l) => l.includes("field=field-optional")),
      ).to.have.length(1);
    });

    it("refuses a proof already handed in", async function () {
      const id = await booked({ [OPTIONAL_FIELD.id]: "pass.pdf" });

      const res = await ask(id, OPTIONAL_FIELD.id);

      expect(res.status, res.text).to.equal(409);
      expect(res.body.code).to.equal("customer_upload_nothing_missing");
      expect(mailsTo(CUSTOMER)).to.have.length(0);
    });

    it("refuses a field the booking has not", async function () {
      const id = await booked();

      const res = await ask(id, "field-unknown");

      expect(res.status, res.text).to.equal(404);
    });
  });
});
