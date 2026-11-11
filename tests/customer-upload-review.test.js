/**
 * The staff checks a customer upload: accepts it,
 * or rejects it with a reason, and opens a checked field again with
 * „Erneut anfordern“. Every result deletes the file at once and leaves a
 * note without content at every booking the upload is handed in for; a
 * rejection and „Erneut anfordern“ mail the customer, accepting does not.
 * Checking needs the right to edit the booking.
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
  OWNER,
  OWNER_B,
  CUSTOMER,
  READ_OWN_HOLDER,
  ROLE_HOLDER,
} = require("./helpers/booking-lifecycle-harness");
const {
  installInMemoryRateLimitEvents,
} = require("./helpers/in-memory-rate-limit-events");
const BookingManager = require("../src/commons/data-managers/booking-manager");
const MediaManager = require("../src/commons/data-managers/media-manager");
const UserManager = require("../src/commons/data-managers/user-manager");
const storage = require("../src/commons/services/storage");
const {
  setVirusScanner,
} = require("../src/commons/services/customer-upload/virus-scanner");
const {
  deriveCustomerUploadState,
} = require("../src/commons/services/customer-upload/customer-upload-state");

const PDF = Buffer.from(
  "%PDF-1.4\n%Vereinsausweis\n1 0 obj<<>>endobj\n%%EOF\n",
);

/** An instance owner who is no member of the tenant (only of the second). */
const INSTANCE_OWNER = OWNER_B;

const PROOF_FIELD = {
  id: "field-proof",
  label: "Vereinsausweis",
  required: true,
  formats: ["pdf"],
  timing: "afterConfirmation",
  deadlineDaysBeforeStart: 7,
};

const ID_FIELD = {
  id: "field-id",
  label: "Ausweis",
  required: false,
  formats: ["pdf"],
  category: "sensitive",
  timing: "afterConfirmation",
};

describe("customer uploads: the check by the staff", function () {
  this.timeout(20000);

  let h;
  let blobs;
  let media;

  beforeEach(async function () {
    process.env.STORE_FRONT_URL ||= "https://store.example.test";

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
          title: "Halle mit Nachweis",
          autoCommitBooking: true,
          uploadFieldDefinitions: [PROOF_FIELD, ID_FIELD],
        }),
      },
      instance: { ownerUserIds: [ADMIN, INSTANCE_OWNER] },
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
      .stub(BookingManager, "reviewCustomerUpload")
      .callsFake(async (tenantId, id, mediaId, review) => {
        const doc = h.store.get(id);
        const reference = (doc?.customerUploads || []).find(
          (r) => r.mediaId === mediaId && r.review.status === "submitted",
        );
        if (!reference) return false;
        reference.review = review;
        if (review.fileDeletedAt != null) reference.originalFileName = "";
        return true;
      });
    sinon
      .stub(BookingManager, "addCustomerUploadRequest")
      .callsFake(async (tenantId, id, request) => {
        const doc = h.store.get(id);
        if (!doc) return false;
        doc.customerUploadRequests = [
          ...(doc.customerUploadRequests || []),
          request,
        ];
        return true;
      });

    setVirusScanner({ scan: async () => ({ clean: true }) });
  });

  afterEach(async function () {
    setVirusScanner(null);
    sinon.restore();
    await h.close();
  });

  const base = (id) => `/api/v2/${TENANT}/bookings/${id}/customer-uploads`;

  async function booking() {
    const res = await h
      .api()
      .post(`/api/v2/${TENANT}/checkout`)
      .set(h.as(CUSTOMER))
      .send(checkoutBody("proof-room"));
    expect(res.status, res.text).to.equal(200);
    return res.body.data.booking.id;
  }

  /** A file handed in by the customer; answers its medium's id. */
  async function handIn(id, field = PROOF_FIELD.id) {
    const res = await h
      .api()
      .post(`${base(id)}/${field}`)
      .set(h.as(CUSTOMER))
      .attach("file", PDF, "ausweis-erika.pdf");
    expect(res.status, res.text).to.equal(201);
    const references = h.store.get(id).customerUploads;
    h.clearEffects();
    return references[references.length - 1].mediaId;
  }

  const review = (id, mediaId, body, { as = ADMIN, field } = {}) =>
    h
      .api()
      .post(`${base(id)}/${field ?? PROOF_FIELD.id}/${mediaId}/review`)
      .set(h.as(as))
      .send(body);

  const requestAgain = (id, body, { as = ADMIN, field } = {}) =>
    h
      .api()
      .post(`${base(id)}/${field ?? PROOF_FIELD.id}/request-again`)
      .set(h.as(as))
      .send(body);

  const fieldOf = (body, fieldId = PROOF_FIELD.id) =>
    body.customerUploadState.fields.find((f) => f.fieldId === fieldId);
  const mails = () => h.effects.filter((row) => row.startsWith("mail."));

  describe("accepting", function () {
    it("keeps a normal file with its name, writes the note and mails nobody", async function () {
      // The request carries the id alone; the name is the account's.
      UserManager.getUser.callsFake(async (userId) =>
        userId === ADMIN
          ? { id: ADMIN, firstName: "Sabine", lastName: "Sachbearbeiterin" }
          : { id: userId },
      );
      const id = await booking();
      const mediaId = await handIn(id);
      const key = media.get(mediaId).storage.key;

      const res = await review(id, mediaId, { result: "accepted" });

      expect(res.status, res.text).to.equal(200);
      expect(media.has(mediaId)).to.equal(true);
      expect(blobs.has(key)).to.equal(true);
      expect(media.get(mediaId).bookingIds).to.include(id);

      const [reference] = h.store.get(id).customerUploads;
      expect(reference.category).to.equal("normal");
      expect(reference.originalFileName).to.equal("ausweis-erika.pdf");
      expect(reference.fieldLabel).to.equal("Vereinsausweis");
      expect(reference.review).to.include({
        status: "accepted",
        reason: "",
        reviewedBy: ADMIN,
        autoDeleted: false,
      });
      expect(reference.review.reviewedAt).to.be.a("number");
      expect(reference.review.fileDeletedAt).to.equal(null);

      const field = fieldOf(res.body);
      expect(field.state).to.equal("fulfilled");
      expect(field.uploads[0].review).to.include({
        status: "accepted",
        fileDeleted: false,
        autoDeleted: false,
      });
      expect(field.uploads[0].review.reviewedByName).to.equal(
        "Sabine Sachbearbeiterin",
      );
      expect(reference.review.reviewedByName).to.equal(
        "Sabine Sachbearbeiterin",
      );
      expect(res.body.customerUploadState.state).to.equal("fulfilled");

      expect(mails()).to.deep.equal([]);
    });

    it("cannot be checked twice: there is no taking back", async function () {
      const id = await booking();
      const mediaId = await handIn(id);
      await review(id, mediaId, { result: "accepted" });

      const again = await review(id, mediaId, {
        result: "rejected",
        reason: "Doch nicht",
      });

      expect(again.status).to.equal(409);
      expect(again.body.message ?? again.text).to.include(
        "customer_upload_already_reviewed",
      );
      expect(h.store.get(id).customerUploads[0].review.status).to.equal(
        "accepted",
      );
    });

    it("deletes a sensitive file at once, while another still waits", async function () {
      const id = await booking();
      const waiting = await handIn(id, PROOF_FIELD.id);
      const sensitive = await handIn(id, ID_FIELD.id);

      const res = await review(
        id,
        sensitive,
        { result: "accepted" },
        { field: ID_FIELD.id },
      );

      expect(res.status, res.text).to.equal(200);
      expect(media.has(sensitive)).to.equal(false);
      expect(media.has(waiting)).to.equal(true);
      expect(fieldOf(res.body).state).to.equal("submitted");
      const reference = h.store
        .get(id)
        .customerUploads.find((r) => r.mediaId === sensitive);
      expect(reference.category).to.equal("sensitive");
      expect(reference.originalFileName).to.equal("");
      expect(reference.review.fileDeletedAt).to.be.a("number");
      expect(
        fieldOf(res.body, ID_FIELD.id).uploads[0].review.fileDeleted,
      ).to.equal(true);
    });
  });

  describe("rejecting", function () {
    it("needs a reason", async function () {
      const id = await booking();
      const mediaId = await handIn(id);

      const res = await review(id, mediaId, { result: "rejected" });

      expect(res.status).to.equal(400);
      expect(res.text).to.include("customer_upload_reason_missing");
      expect(media.has(mediaId)).to.equal(true);
    });

    it("takes a reason of at most 500 characters", async function () {
      const id = await booking();
      const mediaId = await handIn(id);

      const res = await review(id, mediaId, {
        result: "rejected",
        reason: "x".repeat(501),
      });

      expect(res.status).to.equal(400);
      expect(res.text).to.include("customer_upload_reason_too_long");
      expect(media.has(mediaId)).to.equal(true);
    });

    it("refuses a result that is none", async function () {
      const id = await booking();
      const mediaId = await handIn(id);

      const res = await review(id, mediaId, { result: "maybe" });

      expect(res.status).to.equal(400);
      expect(res.text).to.include("customer_upload_review_result_invalid");
    });

    it("deletes a sensitive file", async function () {
      const id = await booking();
      const mediaId = await handIn(id, ID_FIELD.id);

      const res = await review(
        id,
        mediaId,
        { result: "rejected", reason: "Unleserlich" },
        { field: ID_FIELD.id },
      );

      expect(res.status, res.text).to.equal(200);
      expect(media.has(mediaId)).to.equal(false);
    });

    it("keeps a normal file, opens the field again and mails the customer the reason", async function () {
      const id = await booking();
      const mediaId = await handIn(id);

      const res = await review(id, mediaId, {
        result: "rejected",
        reason: "Unleserlich",
      });

      expect(res.status, res.text).to.equal(200);
      expect(media.has(mediaId)).to.equal(true);
      const field = fieldOf(res.body);
      expect(field.state).to.equal("rejected");
      expect(field.reopen).to.include({
        kind: "rejected",
        reason: "Unleserlich",
      });
      expect(field.remainingFiles).to.equal(1);
      expect(res.body.customerUploadState.state).to.equal("missing");

      expect(mails()).to.deep.equal([
        `mail.CUSTOMER_UPLOAD_REOPENED ${CUSTOMER}`,
      ]);
    });

    it("lets the customer hand in anew, and a replacement accepted fulfils the field", async function () {
      const id = await booking();
      const first = await handIn(id);
      await review(id, first, { result: "rejected", reason: "Unleserlich" });

      const second = await handIn(id);
      const res = await review(id, second, { result: "accepted" });

      expect(fieldOf(res.body).state).to.equal("fulfilled");
      expect(
        fieldOf(res.body).uploads.map((u) => u.review.status),
      ).to.deep.equal(["rejected", "accepted"]);
    });
  });

  describe("the mail", function () {
    it("names the reason and links the page, never the file", async function () {
      const sent = [];
      const MailerService = require("../src/commons/mail-service/mail-service");
      MailerService.send.callsFake(async (mail) => {
        sent.push(mail);
        return { status: "sent", transport: "instance" };
      });
      const id = await booking();
      const mediaId = await handIn(id);

      await review(id, mediaId, { result: "rejected", reason: "Abgelaufen" });

      const [mail] = sent.filter((m) => m.type === "CUSTOMER_UPLOAD_REOPENED");
      expect(mail.to).to.equal(CUSTOMER);
      expect(mail.attachments || []).to.deep.equal([]);
      expect(mail.html).to.include("Abgelaufen");
      expect(mail.html).to.include(
        "der Nachweis „<strong>Vereinsausweis</strong>“ für die unten",
      );
      // Greets like the booking confirmation.
      expect(mail.html).to.include("Hallo,<br />");
      expect(mail.html).to.include("Vereinsausweis");
      // The button opens the page at the field of the booking.
      const href = (mail.html.match(/href="([^"]*account\/proofs[^"]*)"/) ||
        [])[1];
      // As the mail client reads the attribute, its entities decoded.
      const decoded = href.replace(/&#x3D;/g, "=").replace(/&amp;/g, "&");
      expect(decoded).to.equal(
        `https://store.example.test/account/proofs?booking=${id}&field=${PROOF_FIELD.id}`,
      );
      expect(mail.html).not.to.include("ausweis-erika");
      // A normal file stays with the booking.
      expect(mail.html).not.to.include("bereits gelöscht");
    });

    it("says the file is gone for a sensitive upload alone", async function () {
      const sent = [];
      const MailerService = require("../src/commons/mail-service/mail-service");
      MailerService.send.callsFake(async (mail) => {
        sent.push(mail);
        return { status: "sent", transport: "instance" };
      });
      const id = await booking();
      const mediaId = await handIn(id, ID_FIELD.id);

      await review(
        id,
        mediaId,
        { result: "rejected", reason: "Abgelaufen" },
        { field: ID_FIELD.id },
      );

      const [mail] = sent.filter((m) => m.type === "CUSTOMER_UPLOAD_REOPENED");
      expect(mail.html).to.include(
        "Die geprüfte Datei haben wir bereits gelöscht.",
      );
    });
  });

  describe("„Erneut anfordern“", function () {
    it("opens a checked field again with a reason and mails the customer", async function () {
      const id = await booking();
      const mediaId = await handIn(id);
      await review(id, mediaId, { result: "accepted" });
      h.clearEffects();

      const res = await requestAgain(id, { reason: "Falsche Seite" });

      expect(res.status, res.text).to.equal(200);
      const field = fieldOf(res.body);
      expect(field.state).to.equal("rejected");
      expect(field.reopen).to.include({
        kind: "requestedAgain",
        reason: "Falsche Seite",
      });
      // The accepted note stays.
      expect(field.uploads[0].review.status).to.equal("accepted");
      expect(field.requests[0]).to.include({ reason: "Falsche Seite" });
      expect(mails()).to.deep.equal([
        `mail.CUSTOMER_UPLOAD_REOPENED ${CUSTOMER}`,
      ]);
    });

    it("needs a reason and a checked field", async function () {
      const id = await booking();
      const mediaId = await handIn(id);

      const waiting = await requestAgain(id, { reason: "Bitte neu" });
      expect(waiting.status).to.equal(409);
      expect(waiting.text).to.include("customer_upload_field_not_reviewed");

      await review(id, mediaId, { result: "accepted" });
      const without = await requestAgain(id, { reason: "  " });
      expect(without.status).to.equal(400);
      expect(without.text).to.include("customer_upload_reason_missing");

      // Open again already: a second request asks for nothing new.
      expect((await requestAgain(id, { reason: "Neu" })).status).to.equal(200);
      const twice = await requestAgain(id, { reason: "Noch einmal" });
      expect(twice.status).to.equal(409);
      expect(twice.text).to.include("customer_upload_field_not_reviewed");
    });
  });

  describe("the right to check", function () {
    it("is refused without the right to edit the booking", async function () {
      const id = await booking();
      const mediaId = await handIn(id);

      for (const who of [CUSTOMER, READ_OWN_HOLDER, INSTANCE_OWNER]) {
        const res = await review(
          id,
          mediaId,
          { result: "accepted" },
          {
            as: who,
          },
        );
        expect(res.status, who).to.be.oneOf([403, 404]);
        const again = await requestAgain(id, { reason: "x" }, { as: who });
        expect(again.status, who).to.be.oneOf([403, 404]);
      }
      expect(media.has(mediaId)).to.equal(true);
      expect(h.store.get(id).customerUploads[0].review.status).to.equal(
        "submitted",
      );
    });

    it("is the tenant owner's and the role holder's", async function () {
      const id = await booking();
      const one = await handIn(id);
      const two = await handIn(id, ID_FIELD.id);

      expect(
        (await review(id, one, { result: "accepted" }, { as: OWNER })).status,
      ).to.equal(200);
      expect(
        (
          await review(
            id,
            two,
            { result: "accepted" },
            { as: ROLE_HOLDER, field: ID_FIELD.id },
          )
        ).status,
      ).to.equal(200);
    });
  });
});

describe("customer uploads: a field from its notes", function () {
  const settings = { enabled: true };
  const limits = { maxFileSizeMb: 10 };
  const START = Date.UTC(2027, 5, 21, 10);
  const DAY = 24 * 60 * 60 * 1000;
  const field = {
    id: "f",
    label: "Nachweis",
    required: true,
    formats: ["pdf"],
    timing: "afterConfirmation",
  };
  const ref = (status, uploadedAt, reviewedAt) => ({
    fieldId: "f",
    fieldLabel: "Nachweis (alt)",
    mediaId: `m-${uploadedAt}`,
    uploadedAt,
    review: { status, reviewedAt },
  });
  const derive = (uploads, requests = [], fields = [field]) =>
    deriveCustomerUploadState({
      booking: {
        status: "confirmed",
        timeBegin: START,
        customerUploads: uploads,
        customerUploadRequests: requests,
      },
      fields,
      settings,
      limits,
      now: START - 5 * DAY,
    });

  it("stays rejected while a rejection is not answered by a later accepted upload", function () {
    // Front accepted, back rejected - the order of the checks does not
    // matter.
    expect(
      derive([ref("rejected", 1, 5), ref("accepted", 2, 6)]).fields[0].state,
    ).to.equal("rejected");
    expect(
      derive([
        ref("rejected", 1, 5),
        ref("accepted", 2, 6),
        ref("accepted", 7, 8),
      ]).fields[0].state,
    ).to.equal("fulfilled");
  });

  it("is opened again by „Erneut anfordern“, until a replacement is accepted", function () {
    const request = { fieldId: "f", reason: "Neu", requestedAt: 10 };
    expect(derive([ref("accepted", 1, 5)], [request]).fields[0]).to.include({
      state: "rejected",
    });
    expect(
      derive([ref("accepted", 1, 5), ref("accepted", 11, 12)], [request])
        .fields[0].state,
    ).to.equal("fulfilled");
  });

  it("keeps the notes of a deleted field readable under its old label", function () {
    const state = derive([ref("accepted", 1, 5)], [], []);
    expect(state.fields).to.deep.equal([]);
    expect(state.otherFields).to.have.length(1);
    expect(state.otherFields[0]).to.include({
      fieldId: "f",
      label: "Nachweis (alt)",
    });
    expect(state.otherFields[0].uploads[0].review.status).to.equal("accepted");
  });

  it("names the reviewer for the staff only", function () {
    const reference = {
      ...ref("accepted", 1, 5),
      review: { status: "accepted", reviewedAt: 5, reviewedByName: "Sabine" },
    };
    const customer = derive([reference]).fields[0].uploads[0].review;
    expect(customer).not.to.have.property("reviewedByName");
    const staff = deriveCustomerUploadState({
      booking: {
        status: "confirmed",
        timeBegin: START,
        customerUploads: [reference],
      },
      fields: [field],
      settings,
      limits,
      now: START - 5 * DAY,
      withReviewer: true,
    }).fields[0].uploads[0].review;
    expect(staff.reviewedByName).to.equal("Sabine");
  });
});
