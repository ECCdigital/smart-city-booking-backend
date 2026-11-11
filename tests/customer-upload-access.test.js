/**
 * Who sees a customer upload: the administration
 * sees the proofs of a booking in its drawer and downloads them. Seeing and
 * downloading follow the right to read the tenant's bookings
 * (`manageBookings.readAny`), like the booking documents; the tenant owner
 * sees everything. The booking person reaches their own upload until it is
 * checked. The instance owner sees nothing by the special position - the
 * one exception of the policy to "the instance owner satisfies every
 * level". A file goes out only as a download in a sandbox, never stored.
 *
 * Over the lifecycle harness: the real routers and rights, the storage, the
 * media records and clamd as fakes.
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
  ROLE_HOLDER,
  READ_OWN_HOLDER,
  CUSTOMER,
} = require("./helpers/booking-lifecycle-harness");
const {
  installInMemoryRateLimitEvents,
} = require("./helpers/in-memory-rate-limit-events");
const BookingManager = require("../src/commons/data-managers/booking-manager");
const MediaManager = require("../src/commons/data-managers/media-manager");
const MediaService = require("../src/commons/services/media/media-service");
const storage = require("../src/commons/services/storage");
const {
  setVirusScanner,
} = require("../src/commons/services/customer-upload/virus-scanner");

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

describe("customer uploads: who sees them", function () {
  this.timeout(20000);

  let h;
  let media;

  beforeEach(async function () {
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
          uploadFieldDefinitions: [PROOF_FIELD],
        }),
      },
      instance: { ownerUserIds: [ADMIN, INSTANCE_OWNER] },
    });

    installInMemoryRateLimitEvents();

    // The storage: bytes by key, read back through the real decryption.
    const blobs = new Map();
    sinon.stub(storage, "getStorageProvider").returns({
      put: async ({ key, data }) => blobs.set(key, data),
      getBuffer: async ({ key }) => blobs.get(key),
    });
    sinon.stub(storage, "configuredProviderName").returns("s3");
    MediaService.getBuffer.restore();

    // The media records, by id.
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
      .stub(BookingManager, "addCustomerUpload")
      .callsFake(async (tenantId, id, reference) => {
        const doc = h.store.get(id);
        if (!doc) return false;
        doc.customerUploads = [...(doc.customerUploads || []), reference];
        return true;
      });

    setVirusScanner({ scan: async () => ({ clean: true }) });
  });

  afterEach(async function () {
    setVirusScanner(null);
    sinon.restore();
    await h.close();
  });

  /** A booking of the customer with one proof handed in. */
  async function bookingWithProof() {
    const checkout = await h
      .api()
      .post(`/api/v2/${TENANT}/checkout`)
      .set(h.as(CUSTOMER))
      .send(checkoutBody("proof-room"));
    expect(checkout.status, checkout.text).to.equal(200);
    const id = checkout.body.data.booking.id;

    const upload = await h
      .api()
      .post(
        `/api/v2/${TENANT}/bookings/${id}/customer-uploads/${PROOF_FIELD.id}`,
      )
      .set(h.as(CUSTOMER))
      .attach("file", PDF, "ausweis.pdf");
    expect(upload.status, upload.text).to.equal(201);
    h.clearEffects();

    const [reference] = h.store.get(id).customerUploads;
    return { id, mediaId: reference.mediaId };
  }

  const file = (mediaId, as) => {
    const req = h.api().get(`/api/v2/${TENANT}/media/${mediaId}/file`);
    return as ? req.set(h.as(as)) : req;
  };

  const metadata = (mediaId, as) =>
    h.api().get(`/api/v2/${TENANT}/media/${mediaId}`).set(h.as(as));

  const bookingOf = (id, as) =>
    h.api().get(`/api/${TENANT}/bookings/${id}`).set(h.as(as));

  const bookingsAs = (as) =>
    h.api().get(`/api/${TENANT}/bookings`).set(h.as(as));

  describe("the download", function () {
    it("goes to whoever reads the tenant's bookings, as an attachment in a sandbox, never stored", async function () {
      const { mediaId } = await bookingWithProof();

      const res = await file(mediaId, ROLE_HOLDER).buffer(true);

      expect(res.status, res.text).to.equal(200);
      expect(res.headers["content-disposition"]).to.equal(
        'attachment; filename="ausweis.pdf"',
      );
      expect(res.headers["content-security-policy"]).to.equal("sandbox");
      expect(res.headers["cache-control"]).to.include("no-store");
      expect(res.headers.etag).to.equal(undefined);
      expect(Buffer.from(res.body).equals(PDF)).to.equal(true);
    });

    it("goes to the tenant owner without a role", async function () {
      const { mediaId } = await bookingWithProof();

      const res = await file(mediaId, OWNER);

      expect(res.status, res.text).to.equal(200);
    });

    it("goes to the instance owner only for what they hold in the tenant", async function () {
      const { mediaId } = await bookingWithProof();

      // The admin of the harness owns the instance and holds the all-role
      // in the tenant: the role counts, as for anyone.
      expect((await file(mediaId, ADMIN)).status).to.equal(200);
    });

    it("is refused to the instance owner by the special position", async function () {
      const { mediaId } = await bookingWithProof();

      const res = await file(mediaId, INSTANCE_OWNER);

      expect(res.status).to.equal(403);
      expect(res.headers["content-disposition"]).to.equal(undefined);
    });

    it("is refused to a member without manageBookings.readAny", async function () {
      const { mediaId } = await bookingWithProof();

      expect((await file(mediaId, READ_OWN_HOLDER)).status).to.equal(403);
    });

    it("is refused to anyone signed out", async function () {
      const { mediaId } = await bookingWithProof();

      expect((await file(mediaId)).status).to.equal(401);
    });

    it("goes to the booking person until the check, not after", async function () {
      const { id, mediaId } = await bookingWithProof();

      expect((await file(mediaId, CUSTOMER)).status).to.equal(200);

      h.store.get(id).customerUploads[0].review.status = "accepted";

      expect((await file(mediaId, CUSTOMER)).status).to.equal(403);
      expect((await file(mediaId, ROLE_HOLDER)).status).to.equal(200);
    });
  });

  describe("the metadata", function () {
    it("is read by whoever reads the tenant's bookings and hidden from the instance owner", async function () {
      const { mediaId } = await bookingWithProof();

      expect((await metadata(mediaId, ROLE_HOLDER)).status).to.equal(200);
      expect((await metadata(mediaId, OWNER)).status).to.equal(200);
      expect((await metadata(mediaId, INSTANCE_OWNER)).status).to.equal(404);
      expect((await metadata(mediaId, READ_OWN_HOLDER)).status).to.equal(404);
    });

    it("is changed by nobody by hand", async function () {
      const { mediaId } = await bookingWithProof();

      const res = await h
        .api()
        .patch(`/api/v2/${TENANT}/media/${mediaId}`)
        .set(h.as(OWNER))
        .send({ title: "umbenannt" });

      expect(res.status).to.equal(404);
      expect(media.get(mediaId).title).to.equal("ausweis.pdf");
    });
  });

  describe("the state in the booking answers", function () {
    it("stands in the booking for whoever reads the tenant's bookings, with the files of each field", async function () {
      const { id, mediaId } = await bookingWithProof();

      for (const reader of [ROLE_HOLDER, OWNER]) {
        const res = await bookingOf(id, reader);

        expect(res.status, res.text).to.equal(200);
        expect(res.body.customerUploadState.state).to.equal("toReview");
        const [field] = res.body.customerUploadState.fields;
        expect(field).to.include({
          fieldId: PROOF_FIELD.id,
          label: "Vereinsausweis",
          state: "submitted",
        });
        expect(field.uploads).to.have.lengthOf(1);
        expect(field.uploads[0]).to.include({
          mediaId,
          originalFileName: "ausweis.pdf",
        });
        expect(field.uploads[0]).to.not.have.property("uploadedBy");
        expect(res.body).to.not.have.property("customerUploads");
      }
    });

    it("stands in the list for whoever reads the tenant's bookings", async function () {
      const { id } = await bookingWithProof();

      const res = await bookingsAs(ROLE_HOLDER);

      expect(res.status, res.text).to.equal(200);
      const booking = res.body.find((b) => b.id === id);
      expect(booking.customerUploadState.state).to.equal("toReview");
      expect(booking).to.not.have.property("customerUploads");
    });

    it("is left out for the instance owner by the special position", async function () {
      const { id } = await bookingWithProof();

      const one = await bookingOf(id, INSTANCE_OWNER);
      const list = await bookingsAs(INSTANCE_OWNER);

      expect(one.status, one.text).to.equal(200);
      expect(one.body.customerUploadState).to.equal(null);
      expect(one.body).to.not.have.property("customerUploads");
      const listed = list.body.find((b) => b.id === id);
      expect(listed.customerUploadState).to.equal(null);
      expect(listed).to.not.have.property("customerUploads");
    });

    it("is left out for a reader without manageBookings.readAny", async function () {
      const { id } = await bookingWithProof();

      // The own levels reach no booking of someone else at all.
      expect((await bookingOf(id, READ_OWN_HOLDER)).status).to.equal(404);
      const list = await bookingsAs(READ_OWN_HOLDER);
      expect(list.body.find((b) => b.id === id)).to.equal(undefined);
    });
  });
});
