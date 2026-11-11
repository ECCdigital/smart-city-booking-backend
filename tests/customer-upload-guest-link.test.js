/**
 * A guest hands proofs in with the signed link of the booking:
 * a booking made without an account gets one
 * link for all its upload fields, valid until the booking ends. With it
 * the guest reads that one booking, hands in, replaces and deletes a proof
 * until it is checked, and hands in anew after a rejection - nothing else.
 * The confirmation and the mail of a rejection carry the link; the rate
 * limits are those of a booking person.
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
const mail = require("../src/commons/services/booking-lifecycle/adapters/mail");
const storage = require("../src/commons/services/storage");
const {
  setVirusScanner,
} = require("../src/commons/services/customer-upload/virus-scanner");
const {
  signCustomerUploadLink,
  verifyCustomerUploadLink,
} = require("../src/commons/services/customer-upload/customer-upload-link");

const STORE_FRONT_URL = "https://store.example.test";

const PDF = Buffer.from(
  "%PDF-1.4\n%Vereinsausweis\n1 0 obj<<>>endobj\n%%EOF\n",
);
const OTHER_PDF = Buffer.from(
  "%PDF-1.4\n%Rueckseite\n1 0 obj<<>>endobj\n%%EOF\n",
);

const PROOF_FIELD = {
  id: "field-proof",
  label: "Vereinsausweis",
  required: true,
  formats: ["pdf"],
  timing: "afterConfirmation",
  deadlineDaysBeforeStart: 7,
};

/** The links of a mail as a client reads them, its entities decoded. */
const linksOf = (html) =>
  [...html.matchAll(/href="([^"]*)"/g)].map(([, href]) =>
    href.replace(/&#x3D;/g, "=").replace(/&amp;/g, "&"),
  );

describe("customer uploads: the signed link of a guest", function () {
  this.timeout(20000);

  let h;
  let media;
  let sent;
  let env;

  beforeEach(async function () {
    env = {
      STORE_FRONT_URL: process.env.STORE_FRONT_URL,
      RATE_LIMIT_CUSTOMER_UPLOAD_PER_BOOKING:
        process.env.RATE_LIMIT_CUSTOMER_UPLOAD_PER_BOOKING,
    };
    process.env.STORE_FRONT_URL = STORE_FRONT_URL;

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

  /** A booking made by a guest, without an account. */
  async function guestBooking() {
    const res = await h
      .api()
      .post(`/api/v2/${TENANT}/checkout`)
      .send(checkoutBody("proof-room"));
    expect(res.status, res.text).to.equal(200);
    const id = res.body.data.booking.id;
    expect(h.store.get(id).assignedUserId || "").to.equal("");
    h.clearEffects();
    return id;
  }

  /** A booking of the signed-in customer. */
  async function customerBooking() {
    const res = await h
      .api()
      .post(`/api/v2/${TENANT}/checkout`)
      .set(h.as(CUSTOMER))
      .send(checkoutBody("proof-room"));
    expect(res.status, res.text).to.equal(200);
    h.clearEffects();
    return res.body.data.booking.id;
  }

  const linkOf = (id) => signCustomerUploadLink({ id, tenantId: TENANT });

  const base = (id) =>
    `/api/v2/${TENANT}/bookings/${id}/customer-uploads-by-link`;

  const read = (id, link = linkOf(id)) =>
    h.api().get(base(id)).set("X-Customer-Upload-Link", link);

  const upload = (id, data = PDF, { link = linkOf(id) } = {}) =>
    h
      .api()
      .post(`${base(id)}/${PROOF_FIELD.id}`)
      .set("X-Customer-Upload-Link", link)
      .attach("file", data, "ausweis.pdf");

  const replace = (id, mediaId, data = OTHER_PDF) =>
    h
      .api()
      .put(`${base(id)}/${PROOF_FIELD.id}/${mediaId}`)
      .set("X-Customer-Upload-Link", linkOf(id))
      .attach("file", data, "rueckseite.pdf");

  const remove = (id, mediaId) =>
    h
      .api()
      .delete(`${base(id)}/${PROOF_FIELD.id}/${mediaId}`)
      .set("X-Customer-Upload-Link", linkOf(id));

  const review = (id, mediaId, body) =>
    h
      .api()
      .post(
        `/api/v2/${TENANT}/bookings/${id}/customer-uploads/${PROOF_FIELD.id}/${mediaId}/review`,
      )
      .set(h.as(ADMIN))
      .send(body);

  const references = (id) => h.store.get(id).customerUploads || [];
  const fieldOf = (state) =>
    state.fields.find((f) => f.fieldId === PROOF_FIELD.id);

  describe("the link itself", function () {
    it("names tenant and booking and is refused once altered", function () {
      const token = linkOf("B-1");
      expect(verifyCustomerUploadLink(token)).to.deep.equal({
        tenantId: TENANT,
        bookingId: "B-1",
      });

      const [payload, signature] = token.split(".");
      const forged = Buffer.from(
        JSON.stringify({ t: TENANT, b: "B-2" }),
      ).toString("base64url");
      expect(verifyCustomerUploadLink(`${forged}.${signature}`)).to.equal(null);
      expect(verifyCustomerUploadLink(`${payload}.x${signature}`)).to.equal(
        null,
      );
      expect(verifyCustomerUploadLink("")).to.equal(null);
    });
  });

  describe("a valid link", function () {
    it("reads that one booking with the state of its uploads, nothing else of it", async function () {
      const id = await guestBooking();

      const res = await read(id);

      expect(res.status, res.text).to.equal(200);
      expect(res.headers["cache-control"]).to.equal("no-store");
      expect(res.body.tenant.id).to.equal(TENANT);
      expect(res.body.booking).to.have.keys(
        "id",
        "tenantId",
        "timeBegin",
        "timeEnd",
        "bookableItems",
        "customerUploadState",
      );
      expect(res.body.booking.id).to.equal(id);
      expect(res.body.booking.bookableItems[0]._bookableUsed.title).to.equal(
        "Halle mit Nachweis",
      );
      expect(fieldOf(res.body.booking.customerUploadState).state).to.equal(
        "open",
      );
    });

    it("hands a proof in, replaces it and deletes it until the check", async function () {
      const id = await guestBooking();

      const handedIn = await upload(id);
      expect(handedIn.status, handedIn.text).to.equal(201);
      expect(fieldOf(handedIn.body.customerUploadState).state).to.equal(
        "submitted",
      );
      const [first] = references(id);
      expect(first.uploadedBy).to.equal(null);

      const replaced = await replace(id, first.mediaId);
      expect(replaced.status, replaced.text).to.equal(200);
      expect(references(id)).to.have.length(1);
      const [second] = references(id);
      expect(second.mediaId).to.not.equal(first.mediaId);
      expect(second.originalFileName).to.equal("rueckseite.pdf");
      expect(media.has(first.mediaId)).to.equal(false);

      const removed = await remove(id, second.mediaId);
      expect(removed.status, removed.text).to.equal(200);
      expect(references(id)).to.deep.equal([]);
      expect(media.has(second.mediaId)).to.equal(false);
      expect(fieldOf(removed.body.customerUploadState).state).to.equal("open");
    });

    it("hands every proof of the booking in at once, the button „Nachweise einreichen“ (ECCdigital/tickets#830)", async function () {
      const id = await guestBooking();

      const res = await h
        .api()
        .post(base(id))
        .set("X-Customer-Upload-Link", linkOf(id))
        .attach(`customerUpload:${PROOF_FIELD.id}`, PDF, "ausweis.pdf");

      expect(res.status, res.text).to.equal(201);
      expect(fieldOf(res.body.customerUploadState).state).to.equal("submitted");
      expect(references(id).map((r) => r.uploadedBy)).to.deep.equal([null]);

      const forged = await h
        .api()
        .post(base(id))
        .set("X-Customer-Upload-Link", "gefaelscht")
        .attach(`customerUpload:${PROOF_FIELD.id}`, PDF, "ausweis.pdf");
      expect(forged.status).to.equal(403);
      expect(references(id)).to.have.length(1);
    });

    it("neither replaces nor deletes a proof once it is checked", async function () {
      const id = await guestBooking();
      await upload(id);
      const [{ mediaId }] = references(id);
      const checked = await review(id, mediaId, { result: "accepted" });
      expect(checked.status, checked.text).to.equal(200);

      const replaced = await replace(id, mediaId);
      const removed = await remove(id, mediaId);

      expect(replaced.status).to.equal(409);
      expect(replaced.body.code).to.equal("customer_upload_already_reviewed");
      expect(removed.status).to.equal(409);
      expect(removed.body.code).to.equal("customer_upload_already_reviewed");
    });

    it("hands a proof in anew after a rejection, the mail carrying the link", async function () {
      const id = await guestBooking();
      await upload(id);
      const [{ mediaId }] = references(id);
      sent.length = 0;

      await review(id, mediaId, { result: "rejected", reason: "Unleserlich" });

      const [mail] = sent.filter((m) => m.type === "CUSTOMER_UPLOAD_REOPENED");
      expect(mail.to).to.equal(CUSTOMER);
      const [link] = linksOf(mail.html).filter((href) =>
        href.startsWith(`${STORE_FRONT_URL}/proofs?`),
      );
      const query = new URL(link).searchParams;
      expect(query.get("field")).to.equal(PROOF_FIELD.id);
      expect(verifyCustomerUploadLink(query.get("link"))).to.deep.equal({
        tenantId: TENANT,
        bookingId: id,
      });
      expect(linksOf(mail.html).join(" ")).not.to.include("/account/proofs");

      const again = await upload(id, OTHER_PDF, { link: query.get("link") });
      expect(again.status, again.text).to.equal(201);
      expect(fieldOf(again.body.customerUploadState).state).to.equal(
        "submitted",
      );
    });
  });

  describe("the confirmation", function () {
    /** The confirmation of a booking as the lifecycle sends it. */
    async function confirmationOf(id) {
      sent.length = 0;
      await mail.send("BOOKING_CONFIRMATION", {
        tenantId: TENANT,
        bookingIds: [id],
      });
      const [confirmation] = sent.filter((m) => m.to === CUSTOMER);
      expect(confirmation.html).to.include("Nachweise fehlen noch");
      return linksOf(confirmation.html);
    }

    it("of a guest names the missing proof with the link", async function () {
      const id = await guestBooking();

      const links = await confirmationOf(id);

      const [link] = links.filter((href) =>
        href.startsWith(`${STORE_FRONT_URL}/proofs?`),
      );
      const token = new URL(link).searchParams.get("link");
      expect(verifyCustomerUploadLink(token)).to.deep.equal({
        tenantId: TENANT,
        bookingId: id,
      });
      expect(links.some((l) => l.includes("/account/proofs"))).to.equal(false);
    });

    it("of a customer with an account links the page under the account", async function () {
      const id = await customerBooking();

      const links = await confirmationOf(id);

      expect(links.some((l) => l.includes("/account/proofs"))).to.equal(true);
      expect(links.some((l) => l.includes("/proofs?link="))).to.equal(false);
    });
  });

  describe("a link refused", function () {
    it("after the end of the booking", async function () {
      const id = await guestBooking();
      h.store.get(id).timeEnd = Date.now() - 1000;

      for (const res of [await read(id), await upload(id)]) {
        expect(res.status, res.text).to.equal(403);
        expect(res.body.code).to.equal("customer_upload_link_expired");
      }
      expect(references(id)).to.deep.equal([]);
    });

    it("for a booking of someone else", async function () {
      const mine = await guestBooking();
      const theirs = await guestBooking();

      for (const res of [
        await read(theirs, linkOf(mine)),
        await upload(theirs, PDF, { link: linkOf(mine) }),
      ]) {
        expect(res.status, res.text).to.equal(403);
        expect(res.body.code).to.equal("customer_upload_link_invalid");
      }
      expect(references(theirs)).to.deep.equal([]);
    });

    it("for a booking of a customer with an account", async function () {
      const id = await customerBooking();

      const res = await upload(id);

      expect(res.status, res.text).to.equal(403);
      expect(res.body.code).to.equal("customer_upload_link_invalid");
    });

    it("without a link, or a forged one", async function () {
      const id = await guestBooking();

      const without = await h
        .api()
        .post(`${base(id)}/${PROOF_FIELD.id}`)
        .attach("file", PDF, "ausweis.pdf");
      const forged = await upload(id, PDF, { link: `${linkOf(id)}x` });

      expect(without.status).to.equal(403);
      expect(forged.status).to.equal(403);
      expect(references(id)).to.deep.equal([]);
    });
  });

  describe("the rate limit", function () {
    it("holds per booking as for a booking person", async function () {
      process.env.RATE_LIMIT_CUSTOMER_UPLOAD_PER_BOOKING = "1";
      const id = await guestBooking();

      const first = await upload(id);
      const second = await upload(id, OTHER_PDF);

      expect(first.status, first.text).to.equal(201);
      expect(second.status).to.equal(429);
      expect(second.body.code).to.equal("customer_upload_rate_limited");
      expect(references(id)).to.have.length(1);
    });
  });
});
