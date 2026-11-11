/**
 * A customer hands in a customer upload later: the booking person uploads a file into an
 * upload field of their booking, replaces it and deletes it while nobody
 * has checked it. Every file runs through the one place of acceptance -
 * rights and booking, rate limit, size, number, type, clamd, an image
 * encoded anew, stored encrypted - and every refusal stores nothing and
 * answers a reason of its own. The derived state of each field and of the
 * booking stands in the booking answers.
 *
 * Over the lifecycle harness: the real routers, the storage, the media
 * records and clamd as fakes.
 */

const { expect } = require("chai");
const sinon = require("sinon");
const { Double } = require("mongodb");
const sharp = require("sharp");

const {
  installHarness,
  bookable,
  checkoutBody,
  TENANT,
  ADMIN,
  CUSTOMER,
  ROLE_HOLDER,
  ROLE_ALL,
} = require("./helpers/booking-lifecycle-harness");
const {
  installRoleMembers,
} = require("./helpers/customer-upload-staff-notice");
const MailerService = require("../src/commons/mail-service/mail-service");
const {
  installInMemoryRateLimitEvents,
} = require("./helpers/in-memory-rate-limit-events");
const BookingManager = require("../src/commons/data-managers/booking-manager");
const { Booking } = require("../src/commons/entities/booking/booking");
const MediaManager = require("../src/commons/data-managers/media-manager");
const MediaService = require("../src/commons/services/media/media-service");
const storage = require("../src/commons/services/storage");
const {
  setVirusScanner,
  parseClamdAnswer,
  ScannerUnavailableError,
} = require("../src/commons/services/customer-upload/virus-scanner");
const {
  decryptUpload,
} = require("../src/commons/services/customer-upload/customer-upload-crypto");
const {
  deriveCustomerUploadState,
} = require("../src/commons/services/customer-upload/customer-upload-state");

const DAY = 24 * 60 * 60 * 1000;
const STRANGER = "fremd@example.test";

const PDF = Buffer.from(
  "%PDF-1.4\n%Vereinsausweis\n1 0 obj<<>>endobj\n%%EOF\n",
);
const EICAR = Buffer.from(
  "%PDF-1.4\nEICAR-STANDARD-ANTIVIRUS-TEST-FILE\n%%EOF\n",
);
const TEXT = Buffer.from("nur ein Text, kein Nachweis");

/** A JPEG with a camera and a GPS position in its EXIF. */
const jpegWithGps = () =>
  sharp({
    create: { width: 24, height: 16, channels: 3, background: "#c00" },
  })
    .jpeg()
    .withExif({
      IFD0: { Make: "Kamera", Model: "Modell 1" },
      IFD3: { GPSLatitudeRef: "N", GPSLatitude: "52/1 8/1 0/1" },
    })
    .toBuffer();

const png = () =>
  sharp({
    create: { width: 8, height: 8, channels: 4, background: "#00f8" },
  })
    .png()
    .toBuffer();

/** The upload field "after the confirmation" of the tracer bullet. */
const PROOF_FIELD = {
  id: "field-proof",
  label: "Vereinsausweis",
  hint: "Vorder- und Rückseite",
  required: true,
  formats: ["pdf", "jpeg", "png"],
  timing: "afterConfirmation",
  deadlineDaysBeforeStart: 7,
};

const OPTIONAL_PDF_FIELD = {
  id: "field-optional",
  label: "Satzung",
  required: false,
  formats: ["pdf"],
  maxFileSizeMb: 1,
  timing: "afterConfirmation",
};

describe("customer uploads: handing in later", function () {
  this.timeout(20000);

  let h;
  let blobs;
  let media;
  let scans;
  let scanner;
  const env = {};

  const ENV = [
    "RATE_LIMIT_CUSTOMER_UPLOAD_PER_BOOKING",
    "CUSTOMER_UPLOAD_MAX_FILES_PER_BOOKING",
    "CUSTOMER_UPLOAD_MAX_FILE_SIZE_MB",
  ];

  beforeEach(async function () {
    for (const name of ENV) env[name] = process.env[name];

    h = await installHarness({
      tenant: {
        customerUploads: {
          enabled: true,
          formats: ["pdf", "jpeg", "png"],
          retentionDays: 30,
          reminderDaysBeforeDeadline: 3,
          notifyOnSubmitted: true,
          notifyOnOverdue: true,
        },
      },
      bookables: {
        "proof-room": bookable({
          id: "proof-room",
          title: "Halle mit Nachweis",
          autoCommitBooking: true,
          uploadFieldDefinitions: [PROOF_FIELD, OPTIONAL_PDF_FIELD],
        }),
        "proof-request-room": bookable({
          id: "proof-request-room",
          title: "Halle mit Nachweis (Anfrage)",
          uploadFieldDefinitions: [PROOF_FIELD],
        }),
        "late-room": bookable({
          id: "late-room",
          title: "Halle mit langer Frist",
          autoCommitBooking: true,
          uploadFieldDefinitions: [
            { ...PROOF_FIELD, deadlineDaysBeforeStart: 365 },
          ],
        }),
      },
    });

    installInMemoryRateLimitEvents();

    // The storage: bytes by key.
    blobs = new Map();
    const provider = {
      put: async ({ key, data }) => blobs.set(key, data),
      getBuffer: async ({ key }) => blobs.get(key),
      getStream: async () => {
        throw new Error("not streamed in these tests");
      },
      deletePrefix: async ({ prefix }) => {
        for (const key of [...blobs.keys()]) {
          if (key.startsWith(prefix)) blobs.delete(key);
        }
      },
    };
    sinon.stub(storage, "getStorageProvider").returns(provider);
    sinon.stub(storage, "configuredProviderName").returns("s3");

    // The media records, by id.
    media = new Map();
    sinon.stub(MediaManager, "storeMedia").callsFake(async (medium) => {
      media.set(medium.id, medium);
      return medium;
    });
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

    // "My bookings", over the harness' store.
    sinon
      .stub(BookingManager, "getAssignedBookings")
      .callsFake(async (userId) =>
        [...h.store.values()]
          .filter((doc) => doc.assignedUserId === userId)
          .map((doc) => new Booking(JSON.parse(JSON.stringify(doc)))),
      );

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

    // clamd as a fake: EICAR is a virus, `down` is no answer.
    scans = [];
    scanner = {
      down: false,
      scan: async (data) => {
        scans.push(data.length);
        if (scanner.down) {
          throw new ScannerUnavailableError("clamd: connect ECONNREFUSED");
        }
        return data.includes("EICAR")
          ? { clean: false, signature: "Eicar-Test-Signature" }
          : { clean: true };
      },
    };
    setVirusScanner(scanner);
  });

  afterEach(async function () {
    setVirusScanner(null);
    sinon.restore();
    await h.close();
    for (const name of ENV) {
      if (env[name] === undefined) delete process.env[name];
      else process.env[name] = env[name];
    }
  });

  /** A booking of the customer, signed in. */
  async function booking(bookableId = "proof-room") {
    const res = await h
      .api()
      .post(`/api/v2/${TENANT}/checkout`)
      .set(h.as(CUSTOMER))
      .send(checkoutBody(bookableId));
    expect(res.status, res.text).to.equal(200);
    h.clearEffects();
    return res.body.data.booking.id;
  }

  const base = (id) => `/api/v2/${TENANT}/bookings/${id}/customer-uploads`;

  const upload = (
    id,
    data,
    name,
    { as = CUSTOMER, field = PROOF_FIELD.id } = {},
  ) =>
    h
      .api()
      .post(`${base(id)}/${field}`)
      .set(h.as(as))
      .attach("file", data, name);

  const replace = (id, mediaId, data, name, field = PROOF_FIELD.id) =>
    h
      .api()
      .put(`${base(id)}/${field}/${mediaId}`)
      .set(h.as(CUSTOMER))
      .attach("file", data, name);

  const remove = (id, mediaId, field = PROOF_FIELD.id) =>
    h
      .api()
      .delete(`${base(id)}/${field}/${mediaId}`)
      .set(h.as(CUSTOMER));

  const references = (id) => h.store.get(id).customerUploads || [];
  const fieldState = (body, fieldId = PROOF_FIELD.id) =>
    body.customerUploadState.fields.find((f) => f.fieldId === fieldId);

  describe("a file that is accepted", function () {
    it("is stored encrypted as a booking document and referenced at the booking", async function () {
      const id = await booking();

      const res = await upload(id, PDF, "ausweis.pdf");

      expect(res.status, res.text).to.equal(201);
      const [reference] = references(id);
      expect(reference).to.include({
        source: "media",
        fieldId: PROOF_FIELD.id,
        fieldLabel: "Vereinsausweis",
        originalFileName: "ausweis.pdf",
        mimeType: "application/pdf",
        uploadedBy: CUSTOMER,
      });
      expect(reference.review.status).to.equal("submitted");

      const medium = media.get(reference.mediaId);
      expect(medium.bookingIds).to.deep.equal([id]);
      expect(medium.tags).to.deep.equal([MediaService.CUSTOMER_UPLOAD_TAG]);
      expect(medium.visibility).to.equal("intern");
      expect(medium.encryption).to.equal("aes-256-gcm");
      expect(medium.variants).to.deep.equal([]);

      const blob = blobs.get(medium.storage.key);
      expect(blob.includes("Vereinsausweis")).to.equal(false);
      expect(decryptUpload(blob).equals(PDF)).to.equal(true);
      expect(scans).to.deep.equal([PDF.length]);
    });

    it("answers the derived state: the field submitted, the booking to review", async function () {
      const id = await booking();

      const res = await upload(id, PDF, "ausweis.pdf");

      expect(res.body.customerUploadState.state).to.equal("toReview");
      const field = fieldState(res.body);
      expect(field).to.include({
        state: "submitted",
        label: "Vereinsausweis",
        required: true,
        maxFiles: 1,
        remainingFiles: 0,
        timing: "afterConfirmation",
      });
      expect(field.uploads).to.have.length(1);
      expect(field.uploads[0]).to.not.have.property("uploadedBy");
    });

    it("is an image encoded anew, without EXIF and GPS", async function () {
      const id = await booking();
      const original = await jpegWithGps();
      expect((await sharp(original).metadata()).exif).to.be.instanceOf(Buffer);

      const res = await upload(id, original, "ausweis.jpg");

      expect(res.status, res.text).to.equal(201);
      const medium = media.get(references(id)[0].mediaId);
      const stored = decryptUpload(blobs.get(medium.storage.key));
      const metadata = await sharp(stored).metadata();
      expect(metadata.format).to.equal("jpeg");
      expect(metadata.exif).to.equal(undefined);
      expect(stored.includes("Kamera")).to.equal(false);
      expect(medium.size).to.equal(stored.length);
    });

    it("takes a PNG too", async function () {
      const id = await booking();

      const res = await upload(id, await png(), "ausweis.png");

      expect(res.status, res.text).to.equal(201);
      expect(references(id)[0].mimeType).to.equal("image/png");
    });

    it("is taken after the deadline, which the state names", async function () {
      const id = await booking("late-room");
      const before = await h
        .api()
        .get(`/api/bookings/assigned`)
        .set(h.as(CUSTOMER));
      expect(fieldState(before.body[0]).state).to.equal("overdue");
      expect(before.body[0].customerUploadState.state).to.equal("overdue");

      const res = await upload(id, PDF, "spaet.pdf");

      expect(res.status, res.text).to.equal(201);
      expect(fieldState(res.body)).to.include({
        state: "submitted",
        pastDeadline: true,
      });
    });
  });

  describe("a file that is refused stores nothing", function () {
    async function refused(res, status, code) {
      expect(res.status, res.text).to.equal(status);
      expect(res.body.code).to.equal(code);
      expect(media.size).to.equal(0);
      expect(blobs.size).to.equal(0);
    }

    it("for a format the field does not take", async function () {
      const id = await booking();

      await refused(
        await upload(id, TEXT, "notiz.txt"),
        400,
        "customer_upload_format_not_allowed",
      );
      await refused(
        await upload(id, await png(), "bild.png", {
          field: OPTIONAL_PDF_FIELD.id,
        }),
        400,
        "customer_upload_format_not_allowed",
      );
      expect(references(id)).to.deep.equal([]);
    });

    it("for a size above the field", async function () {
      const id = await booking();
      const big = Buffer.concat([PDF, Buffer.alloc(1024 * 1024 + 1)]);

      const res = await upload(id, big, "gross.pdf", {
        field: OPTIONAL_PDF_FIELD.id,
      });

      await refused(res, 400, "customer_upload_too_large");
      expect(res.body.params.maxFileSizeMb).to.equal(1);
      expect(scans).to.deep.equal([]);
    });

    it("for a size above the instance", async function () {
      process.env.CUSTOMER_UPLOAD_MAX_FILE_SIZE_MB = "1";
      const id = await booking();
      const huge = Buffer.concat([PDF, Buffer.alloc(3 * 1024 * 1024)]);

      await refused(
        await upload(id, huge, "riesig.pdf"),
        400,
        "customer_upload_too_large",
      );
    });

    it("for a second file in the field", async function () {
      const id = await booking();
      await upload(id, PDF, "vorne.pdf");
      const before = media.size;

      const res = await upload(id, PDF, "hinten.pdf");

      expect(res.status).to.equal(400);
      expect(res.body.code).to.equal("customer_upload_field_full");
      expect(res.body.params.maxFiles).to.equal(1);
      expect(media.size).to.equal(before);
    });

    it("for more files than the booking takes", async function () {
      process.env.CUSTOMER_UPLOAD_MAX_FILES_PER_BOOKING = "1";
      const id = await booking();
      await upload(id, PDF, "erste.pdf");

      const res = await upload(id, PDF, "satzung.pdf", {
        field: OPTIONAL_PDF_FIELD.id,
      });

      expect(res.status).to.equal(400);
      expect(res.body.code).to.equal("customer_upload_booking_limit");
      expect(references(id)).to.have.length(1);
    });

    it("for a virus", async function () {
      const id = await booking();

      await refused(
        await upload(id, EICAR, "virus.pdf"),
        400,
        "customer_upload_virus_found",
      );
    });

    it("when clamd does not answer", async function () {
      scanner.down = true;
      const id = await booking();

      await refused(
        await upload(id, PDF, "ausweis.pdf"),
        503,
        "customer_upload_scanner_unavailable",
      );
    });

    it("past the rate limit, before the file is read", async function () {
      process.env.RATE_LIMIT_CUSTOMER_UPLOAD_PER_BOOKING = "2";
      const id = await booking();
      await upload(id, TEXT, "eins.txt");
      await upload(id, TEXT, "zwei.txt");

      const res = await upload(id, PDF, "drei.pdf");

      await refused(res, 429, "customer_upload_rate_limited");
      expect(res.headers["retry-after"]).to.match(/^\d+$/);
      expect(scans).to.deep.equal([]);
    });

    it("for a booking of someone else", async function () {
      const id = await booking();

      await refused(
        await upload(id, PDF, "ausweis.pdf", { as: STRANGER }),
        404,
        "booking_not_found",
      );
    });

    it("without a sign-in", async function () {
      const id = await booking();

      const res = await h
        .api()
        .post(`${base(id)}/${PROOF_FIELD.id}`)
        .attach("file", PDF, "ausweis.pdf");

      expect(res.status).to.equal(401);
      expect(media.size).to.equal(0);
    });

    it("for a field the booking does not have", async function () {
      const id = await booking();

      await refused(
        await upload(id, PDF, "ausweis.pdf", { field: "unknown" }),
        404,
        "customer_upload_field_not_found",
      );
    });

    it("for a field after the confirmation of a booking not confirmed yet", async function () {
      const id = await booking("proof-request-room");
      expect(h.stored(id).status).to.equal("requested");

      await refused(
        await upload(id, PDF, "ausweis.pdf"),
        409,
        "customer_upload_not_open",
      );

      await h
        .api()
        .get(`/api/${TENANT}/bookings/${id}/commit`)
        .set(h.as(ADMIN));
      expect(h.stored(id).status).to.not.equal("requested");

      const res = await upload(id, PDF, "ausweis.pdf");
      expect(res.status, res.text).to.equal(201);
    });

    it("for a cancelled booking", async function () {
      const id = await booking();
      await h
        .api()
        .post(`/api/${TENANT}/bookings/${id}/cancel`)
        .set(h.as(CUSTOMER))
        .send({ reason: "Krank" });

      await refused(
        await upload(id, PDF, "ausweis.pdf"),
        409,
        "customer_upload_not_open",
      );
    });
  });

  describe("replacing and deleting", function () {
    it("replaces an upload not checked yet: the old file is gone", async function () {
      const id = await booking();
      await upload(id, PDF, "alt.pdf");
      const [old] = references(id);

      const res = await replace(id, old.mediaId, await png(), "neu.png");

      expect(res.status, res.text).to.equal(200);
      const [now] = references(id);
      expect(references(id)).to.have.length(1);
      expect(now.originalFileName).to.equal("neu.png");
      expect(media.has(old.mediaId)).to.equal(false);
      expect([...blobs.keys()].some((k) => k.includes(old.mediaId))).to.equal(
        false,
      );
    });

    it("keeps the old file when the new one is refused", async function () {
      const id = await booking();
      await upload(id, PDF, "alt.pdf");
      const [old] = references(id);

      const res = await replace(id, old.mediaId, EICAR, "virus.pdf");

      expect(res.body.code).to.equal("customer_upload_virus_found");
      expect(references(id)).to.deep.equal([old]);
      expect(media.has(old.mediaId)).to.equal(true);
    });

    it("replaces in a full field, the replaced file does not count", async function () {
      const id = await booking();
      await upload(id, PDF, "alt.pdf");
      const [first] = references(id);

      const res = await replace(id, first.mediaId, PDF, "neu.pdf");

      expect(res.status, res.text).to.equal(200);
      expect(references(id).map((r) => r.originalFileName)).to.deep.equal([
        "neu.pdf",
      ]);
    });

    it("deletes an upload not checked yet: the field is open again", async function () {
      const id = await booking();
      await upload(id, PDF, "ausweis.pdf");
      const [reference] = references(id);

      const res = await remove(id, reference.mediaId);

      expect(res.status, res.text).to.equal(200);
      expect(references(id)).to.deep.equal([]);
      expect(media.size).to.equal(0);
      expect(blobs.size).to.equal(0);
      expect(fieldState(res.body).state).to.equal("open");
      expect(res.body.customerUploadState.state).to.equal("missing");
    });

    it("does not replace or delete an upload already checked", async function () {
      const id = await booking();
      await upload(id, PDF, "ausweis.pdf");
      const [reference] = references(id);
      reference.review = {
        status: "accepted",
        reason: "",
        reviewedAt: Date.now(),
        reviewedBy: ADMIN,
      };

      const deleted = await remove(id, reference.mediaId);
      const replaced = await replace(id, reference.mediaId, PDF, "neu.pdf");

      expect(deleted.status).to.equal(409);
      expect(deleted.body.code).to.equal("customer_upload_already_reviewed");
      expect(replaced.status).to.equal(409);
      expect(replaced.body.code).to.equal("customer_upload_already_reviewed");
      expect(references(id)).to.have.length(1);
    });

    it("does not delete an upload of someone else's booking", async function () {
      const id = await booking();
      await upload(id, PDF, "ausweis.pdf");
      const [reference] = references(id);

      const res = await h
        .api()
        .delete(`${base(id)}/${PROOF_FIELD.id}/${reference.mediaId}`)
        .set(h.as(STRANGER));

      expect(res.status).to.equal(404);
      expect(references(id)).to.have.length(1);
    });
  });

  describe("the derived state in the booking answers", function () {
    it("goes to the booking person, the raw references do not", async function () {
      const id = await booking();
      await upload(id, PDF, "ausweis.pdf");

      const res = await h
        .api()
        .get(`/api/bookings/assigned`)
        .set(h.as(CUSTOMER));

      const [view] = res.body;
      expect(view.id).to.equal(id);
      expect(view).to.not.have.property("customerUploads");
      expect(view.customerUploadState.state).to.equal("toReview");
      expect(
        view.customerUploadState.fields.map((f) => [f.fieldId, f.state]),
      ).to.deep.equal([
        [PROOF_FIELD.id, "submitted"],
        [OPTIONAL_PDF_FIELD.id, "open"],
      ]);
    });

    it("goes to a reader of the tenant's bookings", async function () {
      const id = await booking();
      await upload(id, PDF, "ausweis.pdf");

      const res = await h
        .api()
        .get(`/api/${TENANT}/bookings/${id}`)
        .set(h.as(ROLE_HOLDER));

      expect(res.status).to.equal(200);
      expect(res.body.customerUploadState.state).to.equal("toReview");
    });

    it("is missing for a booking with a required field and nothing handed in", async function () {
      await booking();

      const res = await h
        .api()
        .get(`/api/bookings/assigned`)
        .set(h.as(CUSTOMER));

      expect(res.body[0].customerUploadState.state).to.equal("missing");
      expect(fieldState(res.body[0]).deadline).to.be.a("number");
    });

    it("is empty while the tenant has customer uploads switched off", async function () {
      await booking();
      h.tenant.customerUploads = { enabled: false };

      const res = await h
        .api()
        .get(`/api/bookings/assigned`)
        .set(h.as(CUSTOMER));

      expect(res.body[0].customerUploadState).to.deep.equal({
        state: null,
        fields: [],
        otherFields: [],
      });
    });
  });

  describe("every proof of the booking at once, the button „Nachweise einreichen“ (ECCdigital/tickets#830)", function () {
    const REVIEWER = "pruefung@example.test";

    beforeEach(function () {
      h.tenant.customerUploads.notifyRoleIds = [ROLE_ALL];
      installRoleMembers({ [ROLE_ALL]: [REVIEWER] });
    });

    /** Files as `{ field, replacing, data, name }`, in one request. */
    function submitAll(id, files, { as = CUSTOMER } = {}) {
      const req = h.api().post(base(id)).set(h.as(as));
      for (const { field = PROOF_FIELD.id, replacing, data, name } of files) {
        req.attach(
          `customerUpload:${field}${replacing ? `:${replacing}` : ""}`,
          data,
          name,
        );
      }
      return req;
    }

    it("stores every file and tells the staff once, naming each field", async function () {
      const id = await booking();

      const res = await submitAll(id, [
        { data: await png(), name: "ausweis.png" },
        { field: OPTIONAL_PDF_FIELD.id, data: PDF, name: "satzung.pdf" },
      ]);

      expect(res.status, res.text).to.equal(201);
      expect(
        references(id).map((r) => [r.fieldId, r.originalFileName]),
      ).to.deep.equal([
        [PROOF_FIELD.id, "ausweis.png"],
        [OPTIONAL_PDF_FIELD.id, "satzung.pdf"],
      ]);
      expect(fieldState(res.body).state).to.equal("submitted");
      expect(h.takeEffects()).to.deep.equal([
        `mail.CUSTOMER_UPLOAD_SUBMITTED ${REVIEWER}`,
      ]);
      const [mail] = MailerService.send
        .getCalls()
        .map((call) => call.args[0])
        .filter((m) => m.type === "CUSTOMER_UPLOAD_SUBMITTED");
      expect(mail.html).to.match(
        new RegExp(
          `Zur Buchung\\s*<strong>${id}</strong>\\s*wurden folgende Nachweise eingereicht:\\s*</p>\\s*<ul>\\s*<li>Vereinsausweis</li>\\s*<li>Satzung</li>\\s*</ul>`,
        ),
      );
      expect(mail.html).to.not.match(/ausweis\.png|satzung\.pdf/);
    });

    it("replaces an upload not checked yet in the same request", async function () {
      const id = await booking();
      await upload(id, PDF, "alt.pdf");
      const [old] = references(id);
      h.clearEffects();

      const res = await submitAll(id, [
        { replacing: old.mediaId, data: PDF, name: "neu.pdf" },
      ]);

      expect(res.status, res.text).to.equal(201);
      expect(references(id).map((r) => r.originalFileName)).to.deep.equal([
        "neu.pdf",
      ]);
      expect(media.has(old.mediaId)).to.equal(false);
      expect(h.takeEffects()).to.deep.equal([
        `mail.CUSTOMER_UPLOAD_SUBMITTED ${REVIEWER}`,
      ]);
    });

    it("refuses only the file that fails, stores the others and names only them in the mail", async function () {
      const id = await booking();

      const res = await submitAll(id, [
        { data: PDF, name: "ausweis.pdf" },
        { field: OPTIONAL_PDF_FIELD.id, data: EICAR, name: "satzung.pdf" },
      ]);

      expect(res.status, res.text).to.equal(201);
      expect(res.body.refused).to.deep.equal([
        {
          index: 1,
          fieldId: OPTIONAL_PDF_FIELD.id,
          replacing: null,
          fileName: "satzung.pdf",
          code: "customer_upload_virus_found",
          params: { fieldId: OPTIONAL_PDF_FIELD.id },
        },
      ]);
      expect(references(id).map((r) => r.originalFileName)).to.deep.equal([
        "ausweis.pdf",
      ]);
      expect(media.size).to.equal(1);
      expect(fieldState(res.body).state).to.equal("submitted");
      expect(h.takeEffects()).to.deep.equal([
        `mail.CUSTOMER_UPLOAD_SUBMITTED ${REVIEWER}`,
      ]);
      const [mail] = MailerService.send
        .getCalls()
        .map((call) => call.args[0])
        .filter((m) => m.type === "CUSTOMER_UPLOAD_SUBMITTED");
      expect(mail.html).to.include("<li>Vereinsausweis</li>");
      expect(mail.html).to.not.include("Satzung");
    });

    it("keeps the old file where its replacement is refused", async function () {
      const id = await booking();
      await upload(id, PDF, "alt.pdf");
      const [old] = references(id);
      h.clearEffects();

      const res = await submitAll(id, [
        { replacing: old.mediaId, data: TEXT, name: "neu.pdf" },
      ]);

      expect(res.status, res.text).to.equal(200);
      expect(res.body.refused.map((r) => [r.code, r.replacing])).to.deep.equal([
        ["customer_upload_format_not_allowed", old.mediaId],
      ]);
      expect(references(id).map((r) => r.mediaId)).to.deep.equal([old.mediaId]);
      expect(media.has(old.mediaId)).to.equal(true);
      expect(h.takeEffects()).to.deep.equal([]);
    });

    it("tells nobody where every file is refused", async function () {
      const id = await booking();

      const res = await submitAll(id, [{ data: EICAR, name: "ausweis.pdf" }]);

      expect(res.status, res.text).to.equal(200);
      expect(res.body.refused.map((r) => r.code)).to.deep.equal([
        "customer_upload_virus_found",
      ]);
      expect(references(id)).to.deep.equal([]);
      expect(media.size).to.equal(0);
      expect(blobs.size).to.equal(0);
      expect(h.takeEffects()).to.deep.equal([]);
    });

    it("counts the files of the request against the field: the one too many is refused", async function () {
      const id = await booking();

      const res = await submitAll(id, [
        { data: PDF, name: "1.pdf" },
        { data: PDF, name: "2.pdf" },
      ]);

      expect(res.status, res.text).to.equal(201);
      expect(res.body.refused.map((r) => [r.index, r.code])).to.deep.equal([
        [1, "customer_upload_field_full"],
      ]);
      expect(references(id).map((r) => r.originalFileName)).to.deep.equal([
        "1.pdf",
      ]);
    });

    it("refuses a request without a file, and a form field of another name", async function () {
      const id = await booking();

      const empty = await submitAll(id, []);
      expect(empty.status, empty.text).to.equal(400);
      expect(empty.body.code).to.equal("customer_upload_file_missing");

      const other = await h
        .api()
        .post(base(id))
        .set(h.as(CUSTOMER))
        .attach("file", PDF, "ausweis.pdf");
      expect(other.status, other.text).to.equal(400);
      expect(other.body.code).to.equal("customer_upload_file_field_invalid");
      expect(references(id)).to.deep.equal([]);
    });

    it("refuses an upload of someone else to replace", async function () {
      const id = await booking();

      const res = await submitAll(id, [
        { replacing: "unbekannt", data: PDF, name: "neu.pdf" },
      ]);

      expect(res.status, res.text).to.equal(200);
      expect(res.body.refused.map((r) => r.code)).to.deep.equal([
        "customer_upload_not_found",
      ]);
      expect(references(id)).to.deep.equal([]);
    });

    it("refuses a booking of someone else before reading a file", async function () {
      const id = await booking();

      const res = await submitAll(id, [{ data: PDF, name: "ausweis.pdf" }], {
        as: STRANGER,
      });

      expect(res.status).to.equal(404);
      expect(scans).to.deep.equal([]);
      expect(references(id)).to.deep.equal([]);
    });
  });

  describe("the notice „Nachweis eingereicht“ to the staff (ECCdigital/tickets#830)", function () {
    const FRONTEND = "https://admin.example.test";
    const REVIEWER = "pruefung@example.test";
    let frontendUrl;

    beforeEach(function () {
      frontendUrl = process.env.FRONTEND_URL;
      process.env.FRONTEND_URL = FRONTEND;
      h.tenant.customerUploads.notifyRoleIds = [ROLE_ALL];
      installRoleMembers({ [ROLE_ALL]: [REVIEWER, ROLE_HOLDER] });
    });

    afterEach(function () {
      if (frontendUrl === undefined) delete process.env.FRONTEND_URL;
      else process.env.FRONTEND_URL = frontendUrl;
    });

    /** The notices „Nachweis eingereicht“ the transport got, as sent. */
    const submittedMails = () =>
      MailerService.send
        .getCalls()
        .map((call) => call.args[0])
        .filter((mail) => mail.type === "CUSTOMER_UPLOAD_SUBMITTED");

    const toReviewers = [
      `mail.CUSTOMER_UPLOAD_SUBMITTED ${REVIEWER}`,
      `mail.CUSTOMER_UPLOAD_SUBMITTED ${ROLE_HOLDER}`,
    ];

    it("goes to the members of the tenant's roles once per request, with the link into the Admin UI and no file", async function () {
      const id = await booking();

      const res = await upload(id, PDF, "ausweis-erika.pdf");

      expect(res.status, res.text).to.equal(201);
      expect(h.takeEffects()).to.deep.equal(toReviewers);
      const [mail] = submittedMails();
      expect(mail.subject).to.equal(`Nachweis eingereicht zur Buchung ${id}`);
      expect(mail.attachments).to.deep.equal([]);
      expect(mail.html).to.include("Vereinsausweis");
      expect(mail.html).to.include(
        `${FRONTEND}/bookings/${id}?tenant&#x3D;${TENANT}`,
      );
      expect(mail.html).to.not.include("ausweis-erika");
      expect(mail.html).to.not.include(".pdf");
    });

    it("goes again for a replacement, not for a deletion", async function () {
      const id = await booking();
      await upload(id, PDF, "ausweis.pdf");
      const [first] = references(id);
      h.clearEffects();

      await replace(id, first.mediaId, PDF, "ausweis-neu.pdf");
      expect(h.takeEffects()).to.deep.equal(toReviewers);

      await remove(id, references(id)[0].mediaId);
      expect(h.takeEffects()).to.deep.equal([]);
    });

    it("does not go for a refused file", async function () {
      const id = await booking();

      await upload(id, TEXT, "notiz.txt");

      expect(h.takeEffects()).to.deep.equal([]);
    });

    it("never goes to the tenant's address: without a role nobody gets it", async function () {
      h.tenant.customerUploads.notifyRoleIds = [];
      const id = await booking();

      const res = await upload(id, PDF, "ausweis.pdf");

      expect(res.status, res.text).to.equal(201);
      expect(h.takeEffects()).to.deep.equal([]);
    });

    it("is switched off by the tenant's switch, whatever the notice of new bookings", async function () {
      const id = await booking();
      h.tenant.customerUploads.notifyOnSubmitted = false;

      const res = await upload(id, PDF, "ausweis.pdf");

      expect(res.status, res.text).to.equal(201);
      expect(h.takeEffects()).to.deep.equal([]);
    });

    it("goes without the notice of new bookings", async function () {
      h.tenant.notifyOnNewBooking = false;
      const id = await booking();

      await upload(id, PDF, "ausweis.pdf");

      expect(h.takeEffects()).to.deep.equal(toReviewers);
    });
  });
});

describe("customer uploads: the derived state", function () {
  const settings = { enabled: true };
  const limits = { maxFileSizeMb: 10 };
  const START = Date.UTC(2027, 5, 21, 10);
  const field = (overrides = {}) => ({
    id: "f",
    label: "Nachweis",
    required: true,
    formats: ["pdf"],
    timing: "afterConfirmation",
    deadlineDaysBeforeStart: 2,
    ...overrides,
  });
  const reference = (status, reviewedAt = null) => ({
    fieldId: "f",
    mediaId: `m-${status}-${reviewedAt}`,
    uploadedAt: 1,
    review: { status, reviewedAt },
  });
  const derive = ({ status = "confirmed", uploads = [], fields, now }) =>
    deriveCustomerUploadState({
      booking: {
        status,
        timeBegin: START,
        customerUploads: uploads,
      },
      fields: fields ?? [field()],
      settings,
      limits,
      now: now ?? START - 5 * DAY,
    });

  it("is open with its deadline before the start, overdue after it", function () {
    expect(derive({}).fields[0]).to.include({
      state: "open",
      deadline: START - 2 * DAY,
    });
    expect(derive({}).state).to.equal("missing");
    const late = derive({ now: START - DAY });
    expect(late.fields[0].state).to.equal("overdue");
    expect(late.state).to.equal("overdue");
  });

  it("is fulfilled once accepted, rejected again by a later rejection", function () {
    expect(derive({ uploads: [reference("accepted", 5)] }).state).to.equal(
      "fulfilled",
    );
    const rejected = derive({
      uploads: [reference("accepted", 5), reference("rejected", 6)],
    });
    expect(rejected.fields[0].state).to.equal("rejected");
    expect(rejected.state).to.equal("missing");
  });

  it("counts an optional field for nothing", function () {
    const optional = derive({ fields: [field({ required: false })] });
    expect(optional.fields[0].state).to.equal("open");
    expect(optional.state).to.equal(null);
  });

  it("orders the booking from the least favourable field", function () {
    const state = derive({
      fields: [field({ id: "f" }), field({ id: "g" })],
      uploads: [reference("submitted")],
    });
    expect(state.fields.map((f) => f.state)).to.deep.equal([
      "submitted",
      "open",
    ]);
    expect(state.state).to.equal("missing");
  });

  it("reads the times of a stored booking, MongoDB Double included", function () {
    const state = deriveCustomerUploadState({
      booking: {
        status: "confirmed",
        timeBegin: new Double(START),
        timeEnd: new Double(START + DAY),
        customerUploads: [],
      },
      fields: [field()],
      settings,
      limits,
      now: START - DAY,
    });
    expect(state.fields[0]).to.include({
      state: "overdue",
      deadline: START - 2 * DAY,
    });
  });

  it("closes every field once the booking has ended", function () {
    const ended = deriveCustomerUploadState({
      booking: {
        status: "confirmed",
        timeBegin: START,
        timeEnd: START + DAY,
        customerUploads: [],
      },
      fields: [field()],
      settings,
      limits,
      now: START + 2 * DAY,
    });
    expect(ended).to.deep.equal({ state: null, fields: [], otherFields: [] });
  });

  it("opens a field after the confirmation only once the booking is no request", function () {
    expect(derive({ status: "requested" }).fields).to.deep.equal([]);
    expect(
      derive({ status: "requested", fields: [field({ timing: "checkout" })] })
        .fields,
    ).to.have.length(1);
    expect(derive({ status: "cancelled" }).fields).to.deep.equal([]);
  });
});

describe("customer uploads: clamd's answer", function () {
  it("reads OK, FOUND and nothing else", function () {
    expect(parseClamdAnswer("stream: OK")).to.deep.equal({ clean: true });
    expect(parseClamdAnswer("stream: Eicar-Signature FOUND")).to.deep.equal({
      clean: false,
      signature: "Eicar-Signature",
    });
    expect(parseClamdAnswer("INSTREAM size limit exceeded. ERROR")).to.equal(
      null,
    );
  });
});
