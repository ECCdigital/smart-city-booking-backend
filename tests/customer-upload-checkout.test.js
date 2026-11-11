/**
 * Customer uploads with the checkout: the customer
 * hands in the files of the upload fields "in the checkout" with the
 * checkout request, as multipart. Every file runs through the one place of
 * acceptance, the same as handing in later; the booking and its customer
 * uploads come about together or not at all - no booking and no file where
 * a file is refused, and a required field of the checkout without a file
 * refuses the checkout with a reason of its own.
 *
 * Over the lifecycle harness: the real routers, the storage, the media
 * records and clamd as fakes.
 */

const { expect } = require("chai");
const sinon = require("sinon");
const sharp = require("sharp");

const {
  installHarness,
  bookable,
  checkoutBody,
  TENANT,
  TENANT_MAIL,
  CUSTOMER,
} = require("./helpers/booking-lifecycle-harness");
const MailerService = require("../src/commons/mail-service/mail-service");
const {
  installInMemoryRateLimitEvents,
} = require("./helpers/in-memory-rate-limit-events");
const MediaManager = require("../src/commons/data-managers/media-manager");
const storage = require("../src/commons/services/storage");
const {
  setVirusScanner,
  ScannerUnavailableError,
} = require("../src/commons/services/customer-upload/virus-scanner");
const {
  decryptUpload,
} = require("../src/commons/services/customer-upload/customer-upload-crypto");
const {
  bookingLifecycle,
} = require("../src/commons/services/booking-lifecycle");

const PDF = Buffer.from(
  "%PDF-1.4\n%Vereinsausweis\n1 0 obj<<>>endobj\n%%EOF\n",
);
const EICAR = Buffer.from(
  "%PDF-1.4\nEICAR-STANDARD-ANTIVIRUS-TEST-FILE\n%%EOF\n",
);
const TEXT = Buffer.from("nur ein Text, kein Nachweis");

/** A JPEG with a camera in its EXIF. */
const jpegWithExif = () =>
  sharp({
    create: { width: 24, height: 16, channels: 3, background: "#c00" },
  })
    .jpeg()
    .withExif({ IFD0: { Make: "Kamera", Model: "Modell 1" } })
    .toBuffer();

/** The required upload field "in the checkout". */
const CHECKOUT_FIELD = {
  id: "field-checkout",
  label: "Vereinsausweis",
  hint: "Vorder- und Rückseite",
  consentText: "Ich willige ein.",
  required: true,
  formats: ["pdf", "jpeg"],
  timing: "checkout",
};

const OPTIONAL_FIELD = {
  id: "field-optional",
  label: "Satzung",
  required: false,
  formats: ["pdf"],
  maxFileSizeMb: 1,
  timing: "checkout",
};

/** A field "after the confirmation": never part of the checkout. */
const LATER_FIELD = {
  id: "field-later",
  label: "Sozialpass",
  required: true,
  formats: ["pdf"],
  timing: "afterConfirmation",
};

describe("customer uploads: with the checkout", function () {
  this.timeout(20000);

  let h;
  let blobs;
  let media;
  let scanner;
  const env = {};

  const ENV = [
    "RATE_LIMIT_CUSTOMER_UPLOAD_PER_IP",
    "CUSTOMER_UPLOAD_MAX_FILES_PER_BOOKING",
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
          reviewReminderDaysBeforeDeletion: 3,
          notifyOnSubmitted: true,
          notifyOnOverdue: true,
        },
      },
      bookables: {
        "proof-room": bookable({
          id: "proof-room",
          title: "Halle mit Nachweis",
          autoCommitBooking: true,
          uploadFieldDefinitions: [CHECKOUT_FIELD, OPTIONAL_FIELD, LATER_FIELD],
        }),
        "optional-room": bookable({
          id: "optional-room",
          title: "Halle mit freiwilligem Nachweis",
          autoCommitBooking: true,
          uploadFieldDefinitions: [OPTIONAL_FIELD],
        }),
      },
    });

    installInMemoryRateLimitEvents();

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

    // clamd as a fake: EICAR is a virus, `down` is no answer.
    scanner = {
      down: false,
      scans: 0,
      scan: async (data) => {
        scanner.scans += 1;
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

  /**
   * A checkout as multipart: the body as JSON in `checkout`, each file in
   * `customerUpload:<fieldId>`.
   */
  function checkout(
    files,
    {
      bookableId = "proof-room",
      path = `/api/v2/${TENANT}/checkout`,
      body = checkoutBody(bookableId),
    } = {},
  ) {
    const req = h
      .api()
      .post(`${path}?simulate=false`)
      .set(h.as(CUSTOMER))
      .field("checkout", JSON.stringify(body));
    for (const { field = CHECKOUT_FIELD.id, data, name } of files) {
      req.attach(`customerUpload:${field}`, data, name);
    }
    return req;
  }

  /** Nothing came about: no booking, no medium, no bytes. */
  function expectNothingStored() {
    expect(h.store.size).to.equal(0);
    expect(media.size).to.equal(0);
    expect(blobs.size).to.equal(0);
  }

  /** The v2 refusal of a file, with its code. */
  function expectRefused(res, code) {
    expect(res.status, res.text).to.equal(200);
    expect(res.body.success).to.equal(false);
    expect(res.body.error.reason).to.equal("checkout.customer_upload_refused");
    expect(res.body.error.params.code).to.equal(code);
  }

  describe("a checkout with files", function () {
    it("stores the booking with a reference of each file, encrypted as booking documents", async function () {
      const res = await checkout([
        { data: PDF, name: "ausweis.pdf" },
        { field: OPTIONAL_FIELD.id, data: PDF, name: "satzung.pdf" },
      ]);

      expect(res.status, res.text).to.equal(200);
      expect(res.body.success, res.text).to.equal(true);
      const id = res.body.data.booking.id;
      const references = h.store.get(id).customerUploads;
      expect(
        references.map((r) => [r.fieldId, r.originalFileName]),
      ).to.deep.equal([
        [CHECKOUT_FIELD.id, "ausweis.pdf"],
        [OPTIONAL_FIELD.id, "satzung.pdf"],
      ]);
      for (const reference of references) {
        expect(reference).to.include({ source: "media", uploadedBy: CUSTOMER });
        expect(reference.review.status).to.equal("submitted");
        const medium = media.get(reference.mediaId);
        expect(medium.bookingIds).to.deep.equal([id]);
        expect(medium.encryption).to.equal("aes-256-gcm");
        expect(
          decryptUpload(blobs.get(medium.storage.key)).equals(PDF),
        ).to.equal(true);
      }
      expect(scanner.scans).to.equal(2);
    });

    it("encodes an image anew, without its EXIF", async function () {
      const res = await checkout([
        { data: await jpegWithExif(), name: "ausweis.jpg" },
      ]);

      const [reference] = h.store.get(res.body.data.booking.id).customerUploads;
      const stored = decryptUpload(
        blobs.get(media.get(reference.mediaId).storage.key),
      );
      const metadata = await sharp(stored).metadata();
      expect(metadata.exif).to.equal(undefined);
    });

    it("takes the files on the legacy checkout too", async function () {
      const res = await checkout([{ data: PDF, name: "ausweis.pdf" }], {
        path: `/api/${TENANT}/checkout`,
      });

      expect(res.status, res.text).to.equal(200);
      expect(h.store.get(res.body.id).customerUploads).to.have.length(1);
    });
  });

  describe("under the instance's settings", function () {
    it("asks for no file while the instance has customer uploads off, whatever the tenant stores", async function () {
      h.instance.customerUploads = { enabled: false };

      const res = await h
        .api()
        .post(`/api/v2/${TENANT}/checkout?simulate=false`)
        .set(h.as(CUSTOMER))
        .send(checkoutBody("proof-room"));

      expect(res.body.success, res.text).to.equal(true);
      expect(
        h.store.get(res.body.data.booking.id).customerUploads || [],
      ).to.deep.equal([]);
    });

    it("refuses a file while the instance has customer uploads off", async function () {
      h.instance.customerUploads = { enabled: false };

      const res = await checkout([{ data: PDF, name: "ausweis.pdf" }]);

      expectRefused(res, "customer_upload_field_not_found");
      expectNothingStored();
    });

    it("holds the instance's limit of the booking below the ceiling", async function () {
      h.instance.customerUploads = { enabled: true, maxFilesPerBooking: 1 };

      const res = await checkout([
        { data: PDF, name: "1.pdf" },
        { field: OPTIONAL_FIELD.id, data: PDF, name: "2.pdf" },
      ]);

      expectRefused(res, "customer_upload_booking_limit");
      expectNothingStored();
    });

    it("never lets the instance's limit above the ceiling", async function () {
      process.env.CUSTOMER_UPLOAD_MAX_FILES_PER_BOOKING = "1";
      h.instance.customerUploads = { enabled: true, maxFilesPerBooking: 5 };

      const res = await checkout([
        { data: PDF, name: "1.pdf" },
        { field: OPTIONAL_FIELD.id, data: PDF, name: "2.pdf" },
      ]);

      expectRefused(res, "customer_upload_booking_limit");
      expectNothingStored();
    });
  });

  describe("the tenant's notice of the new booking (ECCdigital/tickets#830)", function () {
    /** The mails the transport got, as sent. */
    const sentMails = () =>
      MailerService.send.getCalls().map((call) => call.args[0]);

    it("names the fields handed in with the checkout, without a file, and no notice „Nachweis eingereicht“", async function () {
      const res = await checkout([
        { data: PDF, name: "ausweis-erika.pdf" },
        { field: OPTIONAL_FIELD.id, data: PDF, name: "satzung-verein.pdf" },
      ]);
      expect(res.body.success, res.text).to.equal(true);

      const mails = sentMails();
      expect(mails.map((mail) => mail.type)).to.not.include(
        "CUSTOMER_UPLOAD_SUBMITTED",
      );
      const incoming = mails.filter((mail) => mail.type === "INCOMING_BOOKING");
      expect(incoming.map((mail) => mail.to)).to.deep.equal([TENANT_MAIL]);
      const [{ html, attachments }] = incoming;
      expect(html).to.include("Mit der Buchung eingereichte Nachweise");
      expect(html.match(/<li>\s*Vereinsausweis\s*<\/li>/g)).to.have.length(1);
      expect(html).to.match(/<li>\s*Satzung\s*<\/li>/);
      expect(html).to.not.include("Sozialpass");
      expect(html).to.not.match(/erika\.pdf|verein\.pdf/);
      expect(attachments).to.deep.equal([]);
      const attached = mails.flatMap((mail) =>
        (mail.attachments || []).map((att) => att.filename),
      );
      expect(
        attached.filter((name) => /erika|verein/.test(name)),
      ).to.deep.equal([]);
    });

    it("names nothing for a checkout without a file", async function () {
      const res = await checkout([], { bookableId: "optional-room" });
      expect(res.body.success, res.text).to.equal(true);

      const [incoming] = sentMails().filter(
        (mail) => mail.type === "INCOMING_BOOKING",
      );
      expect(incoming.html).to.not.include(
        "Mit der Buchung eingereichte Nachweise",
      );
    });
  });

  describe("a required field of the checkout", function () {
    it("refuses a JSON checkout without its file, with a reason of its own", async function () {
      const res = await h
        .api()
        .post(`/api/v2/${TENANT}/checkout?simulate=false`)
        .set(h.as(CUSTOMER))
        .send(checkoutBody("proof-room"));

      expect(res.body.success).to.equal(false);
      expect(res.body.error.reason).to.equal(
        "checkout.customer_upload_required",
      );
      expect(res.body.error.params).to.deep.include({
        code: "customer_upload_required_missing",
        fieldIds: [CHECKOUT_FIELD.id],
        labels: ["Vereinsausweis"],
      });
      expectNothingStored();
    });

    it("refuses a multipart checkout with files of other fields only", async function () {
      const res = await checkout([
        { field: OPTIONAL_FIELD.id, data: PDF, name: "satzung.pdf" },
      ]);

      expect(res.body.error.reason).to.equal(
        "checkout.customer_upload_required",
      );
      expect(scanner.scans).to.equal(0);
      expectNothingStored();
    });

    it("refuses the legacy checkout with its status and reason as JSON", async function () {
      const res = await h
        .api()
        .post(`/api/${TENANT}/checkout?simulate=false`)
        .set(h.as(CUSTOMER))
        .send(checkoutBody("proof-room"));

      expect(res.status).to.equal(400);
      expect(res.body.error).to.equal("checkout.customer_upload_required");
      expect(res.body.params.fieldIds).to.deep.equal([CHECKOUT_FIELD.id]);
      expectNothingStored();
    });

    it("is no question to a simulation", async function () {
      const res = await h
        .api()
        .post(`/api/v2/${TENANT}/checkout?simulate=true`)
        .set(h.as(CUSTOMER))
        .send(checkoutBody("proof-room"));

      expect(res.body.success, res.text).to.equal(true);
    });

    it("is no question while the tenant has customer uploads off", async function () {
      h.tenant.customerUploads.enabled = false;

      const res = await h
        .api()
        .post(`/api/v2/${TENANT}/checkout?simulate=false`)
        .set(h.as(CUSTOMER))
        .send(checkoutBody("proof-room"));

      expect(res.body.success, res.text).to.equal(true);
    });

    it("leaves an offer with an optional field bookable without a file", async function () {
      const res = await h
        .api()
        .post(`/api/v2/${TENANT}/checkout?simulate=false`)
        .set(h.as(CUSTOMER))
        .send(checkoutBody("optional-room"));

      expect(res.body.success, res.text).to.equal(true);
      expect(
        h.store.get(res.body.data.booking.id).customerUploads,
      ).to.deep.equal([]);
    });
  });

  describe("a file that is refused", function () {
    it("for its format", async function () {
      const res = await checkout([{ data: TEXT, name: "ausweis.pdf" }]);
      expectRefused(res, "customer_upload_format_not_allowed");
      expect(res.body.error.params.fieldId).to.equal(CHECKOUT_FIELD.id);
      expectNothingStored();
    });

    it("for its size against the field", async function () {
      const big = Buffer.concat([PDF, Buffer.alloc(1024 * 1024 + 1)]);
      const res = await checkout([
        { data: PDF, name: "ausweis.pdf" },
        { field: OPTIONAL_FIELD.id, data: big, name: "satzung.pdf" },
      ]);
      expectRefused(res, "customer_upload_too_large");
      expect(res.body.error.params).to.include({
        fieldId: OPTIONAL_FIELD.id,
        maxFileSizeMb: 1,
      });
      expectNothingStored();
    });

    it("for the number of the field", async function () {
      const res = await checkout([
        { data: PDF, name: "1.pdf" },
        { data: PDF, name: "2.pdf" },
      ]);
      expectRefused(res, "customer_upload_field_full");
      expect(res.body.error.params.maxFiles).to.equal(1);
      expectNothingStored();
    });

    it("for the limit of the booking", async function () {
      process.env.CUSTOMER_UPLOAD_MAX_FILES_PER_BOOKING = "1";
      const res = await checkout([
        { data: PDF, name: "1.pdf" },
        { field: OPTIONAL_FIELD.id, data: PDF, name: "2.pdf" },
      ]);
      expectRefused(res, "customer_upload_booking_limit");
      expectNothingStored();
    });

    it("for a virus", async function () {
      const res = await checkout([{ data: EICAR, name: "ausweis.pdf" }]);
      expectRefused(res, "customer_upload_virus_found");
      expectNothingStored();
    });

    it("while clamd does not answer", async function () {
      scanner.down = true;
      const res = await checkout([{ data: PDF, name: "ausweis.pdf" }]);
      expectRefused(res, "customer_upload_scanner_unavailable");
      expectNothingStored();
    });

    it("for a field the checkout does not have", async function () {
      const res = await checkout([
        { data: PDF, name: "ausweis.pdf" },
        { field: LATER_FIELD.id, data: PDF, name: "pass.pdf" },
      ]);
      expectRefused(res, "customer_upload_field_not_found");
      expectNothingStored();
    });

    it("after an accepted one: nothing of the request is stored", async function () {
      const res = await checkout([
        { data: PDF, name: "ausweis.pdf" },
        { field: OPTIONAL_FIELD.id, data: EICAR, name: "satzung.pdf" },
      ]);
      expectRefused(res, "customer_upload_virus_found");
      expect(scanner.scans).to.equal(2);
      expectNothingStored();
    });

    it("on the legacy checkout, with the status of its reason", async function () {
      const res = await checkout([{ data: EICAR, name: "ausweis.pdf" }], {
        path: `/api/${TENANT}/checkout`,
      });

      expect(res.status).to.equal(400);
      expect(res.body.error).to.equal("checkout.customer_upload_refused");
      expect(res.body.params.code).to.equal("customer_upload_virus_found");
      expectNothingStored();
    });
  });

  describe("a booking that does not come about", function () {
    it("takes its files back when the booking cannot be stored", async function () {
      h.failing.add("store.save");

      const res = await checkout([{ data: PDF, name: "ausweis.pdf" }]);

      expect(res.body.success).to.equal(false);
      expect(media.size).to.equal(0);
      expect(blobs.size).to.equal(0);
    });

    it("takes its files back when its admission aborts", async function () {
      sinon
        .stub(bookingLifecycle, "admit")
        .rejects(new Error("compartments could not be held"));

      const res = await checkout([{ data: PDF, name: "ausweis.pdf" }]);

      expect(res.body.success).to.equal(false);
      expectNothingStored();
    });
  });

  describe("the request", function () {
    it("counts against the rate limit of customer uploads", async function () {
      process.env.RATE_LIMIT_CUSTOMER_UPLOAD_PER_IP = "1";

      const first = await checkout([{ data: PDF, name: "ausweis.pdf" }]);
      const second = await checkout([{ data: PDF, name: "ausweis.pdf" }]);

      expect(first.body.success, first.text).to.equal(true);
      expect(second.status).to.equal(429);
      expect(second.body.code).to.equal("customer_upload_rate_limited");
      expect(h.store.size).to.equal(1);
    });

    it("refuses a body that is not JSON", async function () {
      const res = await h
        .api()
        .post(`/api/v2/${TENANT}/checkout?simulate=false`)
        .set(h.as(CUSTOMER))
        .field("checkout", "{kein json")
        .attach(`customerUpload:${CHECKOUT_FIELD.id}`, PDF, "ausweis.pdf");

      expect(res.status).to.equal(400);
      expect(res.body.code).to.equal("checkout_body_invalid");
      expectNothingStored();
    });

    it("refuses a file outside the fields' form names", async function () {
      const res = await h
        .api()
        .post(`/api/v2/${TENANT}/checkout?simulate=false`)
        .set(h.as(CUSTOMER))
        .field("checkout", JSON.stringify(checkoutBody("proof-room")))
        .attach("file", PDF, "ausweis.pdf");

      expect(res.status).to.equal(400);
      expect(res.body.code).to.equal("checkout_file_field_invalid");
      expectNothingStored();
    });
  });

  describe("the public offer", function () {
    it("names the upload fields of the checkout, with the size that counts", async function () {
      const res = await h
        .api()
        .get(`/api/${TENANT}/bookables/public/proof-room`);

      expect(res.status, res.text).to.equal(200);
      expect(res.body.checkoutUploadFields).to.deep.equal([
        {
          id: CHECKOUT_FIELD.id,
          label: "Vereinsausweis",
          hint: "Vorder- und Rückseite",
          consentText: "Ich willige ein.",
          required: true,
          maxFiles: 1,
          formats: ["pdf", "jpeg"],
          maxFileSizeMb: 10,
        },
        {
          id: OPTIONAL_FIELD.id,
          label: "Satzung",
          hint: "",
          consentText: "",
          required: false,
          maxFiles: 1,
          formats: ["pdf"],
          maxFileSizeMb: 1,
        },
      ]);
    });

    it("names none while the tenant has customer uploads off", async function () {
      h.tenant.customerUploads.enabled = false;

      const res = await h
        .api()
        .get(`/api/${TENANT}/bookables/public/proof-room`);

      expect(res.body.checkoutUploadFields).to.deep.equal([]);
    });
  });
});
