/**
 * One proof for several bookings of a group: in a
 * group the customer hands a customer upload in once and chooses the
 * upload fields of the other bookings it counts for too - at the checkout
 * of the group and when handing in later. It is one medium with the ids of
 * all of them and a reference at each; it counts at each against the limit
 * of the booking. A check of it writes the note at all of them, a
 * rejection mails the customer once for all, the notice „Nachweis
 * eingereicht“ goes once per group, and the file stays until the end of
 * the last booking holding it. A guest has no such choice.
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
  ROLE_ALL,
  ROLE_HOLDER,
  TIME_BEGIN,
  TIME_END,
  DAY,
} = require("./helpers/booking-lifecycle-harness");
const {
  installRoleMembers,
} = require("./helpers/customer-upload-staff-notice");
const {
  installInMemoryRateLimitEvents,
} = require("./helpers/in-memory-rate-limit-events");
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

const PDF = Buffer.from(
  "%PDF-1.4\n%Vereinsausweis\n1 0 obj<<>>endobj\n%%EOF\n",
);
const WEEK = 7 * DAY;
const HOUR = 60 * 60 * 1000;
const FRONTEND = "https://admin.example.test";

/** The required upload field "in the checkout". */
const CHECKOUT_FIELD = {
  id: "field-checkout",
  label: "Vereinsausweis",
  required: true,
  maxFiles: 1,
  formats: ["pdf"],
  timing: "checkout",
};

/** A second field "in the checkout": no rule makes it "the same". */
const OTHER_CHECKOUT_FIELD = {
  id: "field-social",
  label: "Sozialpass",
  required: false,
  maxFiles: 1,
  formats: ["pdf"],
  timing: "checkout",
};

/** The required upload field "after the confirmation". */
const LATER_FIELD = {
  id: "field-later",
  label: "Ausweis",
  required: true,
  maxFiles: 1,
  formats: ["pdf"],
  timing: "afterConfirmation",
};

const clone = (value) => JSON.parse(JSON.stringify(value));
const waiting = (r) =>
  r.review?.status === "submitted" && r.review?.fileDeletedAt == null;

describe("customer uploads: one proof for several bookings of a group", function () {
  this.timeout(20000);

  let h;
  let blobs;
  let media;
  const env = {};

  beforeEach(async function () {
    for (const name of [
      "FRONTEND_URL",
      "STORE_FRONT_URL",
      "CUSTOMER_UPLOAD_MAX_FILES_PER_BOOKING",
    ]) {
      env[name] = process.env[name];
    }
    process.env.FRONTEND_URL = FRONTEND;
    process.env.STORE_FRONT_URL = "https://store.example.test";

    h = await installHarness({
      tenant: {
        customerUploads: {
          enabled: true,
          formats: ["pdf"],
          retentionDays: 30,
          notifyOnSubmitted: true,
          notifyRoleIds: [ROLE_ALL],
        },
      },
      bookables: {
        "checkout-room": bookable({
          id: "checkout-room",
          title: "Halle mit Nachweis im Checkout",
          autoCommitBooking: true,
          uploadFieldDefinitions: [CHECKOUT_FIELD, OTHER_CHECKOUT_FIELD],
        }),
        "later-room": bookable({
          id: "later-room",
          title: "Halle mit Nachweis danach",
          autoCommitBooking: true,
          uploadFieldDefinitions: [LATER_FIELD],
        }),
      },
    });

    installInMemoryRateLimitEvents();
    installRoleMembers({ [ROLE_ALL]: [ROLE_HOLDER] });

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
      .stub(MediaManager, "getAllMedia")
      .callsFake(async (filter) =>
        [...media.values()].filter(
          (m) => m.tenantId === filter.tenantId && filter.id.$in.includes(m.id),
        ),
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
        if (!doc) return false;
        const before = doc.customerUploads?.length ?? 0;
        doc.customerUploads = (doc.customerUploads || []).filter(
          (r) => !(r.mediaId === mediaId && r.review.status === status),
        );
        return doc.customerUploads.length < before;
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

    // The queries of the job, over the harness' store.
    sinon.stub(TenantManager, "getTenants").callsFake(async () => [h.tenant]);
    sinon.stub(BookingManager, "getBookingsCustomFilter").resolves([]);
    sinon
      .stub(BookingManager, "getBookingsWithStoredCustomerUploads")
      .callsFake(async () =>
        [...h.store.values()]
          .filter((doc) => (doc.customerUploads || []).some(waiting))
          .map((doc) => new Booking(clone(doc))),
      );
    sinon
      .stub(BookingManager, "setCustomerUploadEndedAt")
      .callsFake(async (tenantId, id, endedAt) => {
        h.store.get(id).customerUploadEndedAt = endedAt;
      });

    setVirusScanner({ scan: async () => ({ clean: true }) });
  });

  afterEach(async function () {
    setVirusScanner(null);
    sinon.restore();
    await h.close();
    for (const [name, value] of Object.entries(env)) {
      if (value === undefined) delete process.env[name];
      else process.env[name] = value;
    }
  });

  /** Two weekly bookings of one offer, as the v2 group checkout takes them. */
  const groupBody = (bookableId, overrides = {}) => ({
    bookableItems: [{ bookableId, amount: 1 }],
    bookingAttempts: [
      { timeBegin: TIME_BEGIN, timeEnd: TIME_END },
      { timeBegin: TIME_BEGIN + WEEK, timeEnd: TIME_END + WEEK },
    ],
    name: "Erika Muster",
    mail: CUSTOMER,
    paymentProvider: "giroCockpit",
    ...overrides,
  });

  /**
   * A group checkout as multipart: the body as JSON in `checkout`, each
   * file in `customerUpload:<key>`, its bookings and fields under
   * `customerUploadTargets[key]`.
   */
  function groupCheckout(
    files,
    {
      as = CUSTOMER,
      path = `/api/v2/${TENANT}/checkout/group`,
      body = groupBody("checkout-room"),
    } = {},
  ) {
    const targets = Object.fromEntries(
      files.map(({ key, targets: of }) => [key, of]),
    );
    const req = h.api().post(`${path}?simulate=false`);
    if (as) req.set(h.as(as));
    req.field(
      "checkout",
      JSON.stringify({ ...body, customerUploadTargets: targets }),
    );
    for (const { key, name = `${key}.pdf`, data = PDF } of files) {
      req.attach(`customerUpload:${key}`, data, name);
    }
    return req;
  }

  /** The v2 refusal of a checkout's upload, with its code. */
  function expectRefused(res, reason, code) {
    expect(res.status, res.text).to.equal(200);
    expect(res.body.success, res.text).to.equal(false);
    expect(res.body.error.reason).to.equal(reason);
    if (code) expect(res.body.error.params.code).to.equal(code);
  }

  function expectNothingStored() {
    expect(h.store.size).to.equal(0);
    expect(h.groups.size).to.equal(0);
    expect(media.size).to.equal(0);
    expect(blobs.size).to.equal(0);
  }

  /** The members of the stored group, in their order. */
  const membersOf = (res) => {
    const group = res.body.data.groupBooking;
    return group.bookingIds.map((id) => h.store.get(id));
  };

  /** A group of the customer with the field "after the confirmation". */
  async function laterGroup() {
    const res = await h
      .api()
      .post(`/api/v2/${TENANT}/checkout/group?simulate=false`)
      .set(h.as(CUSTOMER))
      .send(groupBody("later-room"));
    expect(res.status, res.text).to.equal(200);
    expect(res.body.success, res.text).to.equal(true);
    h.clearEffects();
    return res.body.data.groupBooking.bookingIds;
  }

  const base = (id) => `/api/v2/${TENANT}/bookings/${id}/customer-uploads`;

  const handIn = (
    id,
    alsoFor,
    { as = CUSTOMER, field = LATER_FIELD.id } = {},
  ) => {
    const req = h
      .api()
      .post(`${base(id)}/${field}`)
      .set(h.as(as));
    if (alsoFor !== undefined) req.field("alsoFor", JSON.stringify(alsoFor));
    return req.attach("file", PDF, "ausweis-erika.pdf");
  };

  const sentMails = (type) =>
    MailerService.send
      .getCalls()
      .map((call) => call.args[0])
      .filter((mail) => mail.type === type);

  describe("the checkout of a group", function () {
    it("stores one medium for the chosen bookings, with a reference at each", async function () {
      const res = await groupCheckout([
        {
          key: "card",
          name: "ausweis.pdf",
          targets: [
            { attempt: 0, fieldId: CHECKOUT_FIELD.id },
            { attempt: 1, fieldId: CHECKOUT_FIELD.id },
          ],
        },
      ]);

      expect(res.status, res.text).to.equal(200);
      expect(res.body.success, res.text).to.equal(true);
      const [first, second] = membersOf(res);
      expect(media.size).to.equal(1);
      const [medium] = [...media.values()];
      expect(medium.bookingIds).to.deep.equal([first.id, second.id]);
      for (const member of [first, second]) {
        const [reference] = member.customerUploads;
        expect(reference).to.include({
          mediaId: medium.id,
          fieldId: CHECKOUT_FIELD.id,
          originalFileName: "ausweis.pdf",
          uploadedBy: CUSTOMER,
        });
        expect(reference.sharedWith.map((t) => t.bookingId)).to.deep.equal([
          first.id,
          second.id,
        ]);
      }
    });

    it("lets the file count for another field of another booking", async function () {
      const res = await groupCheckout([
        {
          key: "card",
          targets: [
            { attempt: 0, fieldId: CHECKOUT_FIELD.id },
            { attempt: 1, fieldId: OTHER_CHECKOUT_FIELD.id },
          ],
        },
        {
          key: "second",
          targets: [{ attempt: 1, fieldId: CHECKOUT_FIELD.id }],
        },
      ]);

      expect(res.body.success, res.text).to.equal(true);
      const [first, second] = membersOf(res);
      expect(first.customerUploads.map((r) => r.fieldId)).to.deep.equal([
        CHECKOUT_FIELD.id,
      ]);
      expect(second.customerUploads.map((r) => r.fieldId)).to.deep.equal([
        OTHER_CHECKOUT_FIELD.id,
        CHECKOUT_FIELD.id,
      ]);
      expect(media.size).to.equal(2);
    });

    it("refuses a required field of one booking without a file, storing nothing", async function () {
      const res = await groupCheckout([
        {
          key: "card",
          targets: [{ attempt: 0, fieldId: CHECKOUT_FIELD.id }],
        },
      ]);

      expectRefused(res, "checkout.customer_upload_required");
      expect(res.body.error.params).to.include({
        code: "customer_upload_required_missing",
      });
      expect(res.body.error.params.attempts).to.deep.equal([1]);
      expectNothingStored();
    });

    it("refuses a JSON group checkout without the required files", async function () {
      const res = await h
        .api()
        .post(`/api/v2/${TENANT}/checkout/group?simulate=false`)
        .set(h.as(CUSTOMER))
        .send(groupBody("checkout-room"));

      expectRefused(res, "checkout.customer_upload_required");
      expectNothingStored();
    });

    it("counts a file of several bookings at each against the limit of the booking", async function () {
      process.env.CUSTOMER_UPLOAD_MAX_FILES_PER_BOOKING = "1";

      const res = await groupCheckout([
        {
          key: "card",
          targets: [
            { attempt: 0, fieldId: CHECKOUT_FIELD.id },
            { attempt: 1, fieldId: CHECKOUT_FIELD.id },
          ],
        },
        {
          key: "social",
          targets: [{ attempt: 1, fieldId: OTHER_CHECKOUT_FIELD.id }],
        },
      ]);

      expectRefused(
        res,
        "checkout.customer_upload_refused",
        "customer_upload_booking_limit",
      );
      expect(res.body.error.params.attempt).to.equal(1);
      expectNothingStored();
    });

    it("refuses a file for a booking or field outside the group", async function () {
      const outside = await groupCheckout([
        {
          key: "card",
          targets: [
            { attempt: 0, fieldId: CHECKOUT_FIELD.id },
            { attempt: 2, fieldId: CHECKOUT_FIELD.id },
          ],
        },
      ]);
      expectRefused(
        outside,
        "checkout.customer_upload_refused",
        "customer_upload_target_invalid",
      );

      const twice = await groupCheckout([
        {
          key: "card",
          targets: [
            { attempt: 0, fieldId: CHECKOUT_FIELD.id },
            { attempt: 0, fieldId: OTHER_CHECKOUT_FIELD.id },
          ],
        },
      ]);
      expectRefused(
        twice,
        "checkout.customer_upload_refused",
        "customer_upload_target_invalid",
      );

      const unnamed = await groupCheckout([{ key: "card", targets: [] }]);
      expectRefused(
        unnamed,
        "checkout.customer_upload_refused",
        "customer_upload_target_invalid",
      );
      expectNothingStored();
    });

    it("gives a guest no choice: a file for one booking each", async function () {
      const refused = await groupCheckout(
        [
          {
            key: "card",
            targets: [
              { attempt: 0, fieldId: CHECKOUT_FIELD.id },
              { attempt: 1, fieldId: CHECKOUT_FIELD.id },
            ],
          },
        ],
        { as: null },
      );
      expectRefused(
        refused,
        "checkout.customer_upload_refused",
        "customer_upload_target_invalid",
      );
      expectNothingStored();

      const res = await groupCheckout(
        [
          { key: "a", targets: [{ attempt: 0, fieldId: CHECKOUT_FIELD.id }] },
          { key: "b", targets: [{ attempt: 1, fieldId: CHECKOUT_FIELD.id }] },
        ],
        { as: null },
      );
      expect(res.body.success, res.text).to.equal(true);
      const [first, second] = membersOf(res);
      expect(first.customerUploads).to.have.length(1);
      expect(second.customerUploads).to.have.length(1);
      expect(first.customerUploads[0].mediaId).to.not.equal(
        second.customerUploads[0].mediaId,
      );
      expect(first.customerUploads[0].sharedWith).to.deep.equal([]);
    });

    it("takes the files on the legacy group checkout too", async function () {
      const slot = (timeBegin, timeEnd) => ({
        timeBegin,
        timeEnd,
        bookableItems: [
          {
            bookableId: "checkout-room",
            amount: 1,
            bookable: { id: "checkout-room" },
          },
        ],
      });
      const res = await groupCheckout(
        [
          {
            key: "card",
            targets: [
              { attempt: 0, fieldId: CHECKOUT_FIELD.id },
              { attempt: 1, fieldId: CHECKOUT_FIELD.id },
            ],
          },
        ],
        {
          path: `/api/${TENANT}/checkout/group`,
          body: {
            bookingAttempts: [
              slot(TIME_BEGIN + WEEK, TIME_END + WEEK),
              slot(TIME_BEGIN, TIME_END),
            ],
            contactData: { name: "Erika Muster", mail: CUSTOMER },
            paymentProvider: "giroCockpit",
          },
        },
      );

      expect(res.status, res.text).to.equal(200);
      expect(media.size).to.equal(1);
      const [medium] = [...media.values()];
      expect(medium.bookingIds).to.have.length(2);
      // The attempts as sent, whatever order the group stores them in.
      const later = [...h.store.values()].find(
        (doc) => doc.timeBegin === TIME_BEGIN + WEEK,
      );
      expect(medium.bookingIds[0]).to.equal(later.id);
    });

    it("answers a legacy refusal with its status and reason as JSON", async function () {
      const res = await groupCheckout([], {
        path: `/api/${TENANT}/checkout/group`,
        body: {
          bookingAttempts: [
            {
              timeBegin: TIME_BEGIN,
              timeEnd: TIME_END,
              bookableItems: [
                {
                  bookableId: "checkout-room",
                  amount: 1,
                  bookable: { id: "checkout-room" },
                },
              ],
            },
          ],
          contactData: { name: "Erika Muster", mail: CUSTOMER },
          paymentProvider: "giroCockpit",
        },
      });

      expect(res.status).to.equal(400);
      expect(res.body.error).to.equal("checkout.customer_upload_required");
      expectNothingStored();
    });
  });

  describe("handing in later in a group", function () {
    it("stores one medium for the chosen bookings and tells the staff once for the group", async function () {
      const [first, second] = await laterGroup();

      const res = await handIn(first, [
        { bookingId: second, fieldId: LATER_FIELD.id },
      ]);

      expect(res.status, res.text).to.equal(201);
      const [medium] = [...media.values()];
      expect(medium.bookingIds).to.deep.equal([first, second]);
      expect(h.store.get(second).customerUploads[0]).to.include({
        mediaId: medium.id,
        fieldId: LATER_FIELD.id,
      });
      const field = res.body.customerUploadState.fields[0];
      expect(field.uploads[0].alsoFor).to.deep.equal([
        {
          bookingId: second,
          fieldId: LATER_FIELD.id,
          fieldLabel: "Ausweis",
          timeBegin: TIME_BEGIN + WEEK,
          timeEnd: TIME_END + WEEK,
        },
      ]);

      // One notice for the group, to the members of the tenant's roles.
      const groupId = [...h.groups.keys()][0];
      expect(h.takeEffects()).to.deep.equal([
        `mail.CUSTOMER_UPLOAD_SUBMITTED ${ROLE_HOLDER}`,
      ]);
      const [mail] = sentMails("CUSTOMER_UPLOAD_SUBMITTED");
      expect(mail.subject).to.equal(
        `Nachweis eingereicht zur Gruppe ${groupId}`,
      );
      expect(mail.html).to.include(`${FRONTEND}/group-bookings/${groupId}`);
      expect(mail.html).to.include(second);
      expect(mail.html).to.not.include("ausweis-erika");
    });

    it("counts the upload at the other booking against its field", async function () {
      const [first, second] = await laterGroup();
      expect((await handIn(second)).status).to.equal(201);

      const res = await handIn(first, [
        { bookingId: second, fieldId: LATER_FIELD.id },
      ]);

      expect(res.status).to.equal(400);
      expect(res.body.code).to.equal("customer_upload_field_full");
      expect(res.body.params.bookingId).to.equal(second);
      expect(h.store.get(first).customerUploads || []).to.deep.equal([]);
      expect(media.size).to.equal(1);
    });

    it("refuses a booking outside the group, storing nothing", async function () {
      const [first] = await laterGroup();
      const res = await h
        .api()
        .post(`/api/v2/${TENANT}/checkout`)
        .set(h.as(CUSTOMER))
        .send(checkoutBody("later-room"));
      const loose = res.body.data.booking.id;

      const refused = await handIn(first, [
        { bookingId: loose, fieldId: LATER_FIELD.id },
      ]);

      expect(refused.status).to.equal(400);
      expect(refused.body.code).to.equal("customer_upload_target_invalid");
      expect(media.size).to.equal(0);
    });

    it("refuses the booking of the request named again, or a field the other booking lacks", async function () {
      const [first, second] = await laterGroup();

      const again = await handIn(first, [
        { bookingId: first, fieldId: LATER_FIELD.id },
      ]);
      expect(again.status).to.equal(400);

      const unknown = await handIn(first, [
        { bookingId: second, fieldId: "field-none" },
      ]);
      expect(unknown.status).to.equal(404);
      expect(media.size).to.equal(0);
    });
  });

  describe("the check of an upload of a group", function () {
    async function sharedUpload() {
      const [first, second] = await laterGroup();
      const res = await handIn(first, [
        { bookingId: second, fieldId: LATER_FIELD.id },
      ]);
      expect(res.status, res.text).to.equal(201);
      h.clearEffects();
      const [medium] = [...media.values()];
      return { first, second, mediaId: medium.id };
    }

    const review = (id, mediaId, body) =>
      h
        .api()
        .post(`${base(id)}/${LATER_FIELD.id}/${mediaId}/review`)
        .set(h.as(ADMIN))
        .send(body);

    it("shows the staff the other bookings it counts for", async function () {
      const { first, second } = await sharedUpload();

      const res = await h
        .api()
        .get(`/api/${TENANT}/bookings/${second}`)
        .set(h.as(ADMIN));

      expect(res.status, res.text).to.equal(200);
      const [upload] = res.body.customerUploadState.fields[0].uploads;
      expect(upload.alsoFor).to.deep.equal([
        {
          bookingId: first,
          fieldId: LATER_FIELD.id,
          fieldLabel: "Ausweis",
          timeBegin: TIME_BEGIN,
          timeEnd: TIME_END,
        },
      ]);
    });

    it("names only the bookings still holding it once one withdrew", async function () {
      const { first, second, mediaId } = await sharedUpload();
      const removed = await h
        .api()
        .delete(`${base(second)}/${LATER_FIELD.id}/${mediaId}`)
        .set(h.as(CUSTOMER));
      expect(removed.status, removed.text).to.equal(200);

      const res = await h
        .api()
        .get(`/api/${TENANT}/bookings/${first}`)
        .set(h.as(ADMIN));

      const [upload] = res.body.customerUploadState.fields[0].uploads;
      expect(upload.alsoFor).to.equal(undefined);
      expect(media.get(mediaId).bookingIds).to.deep.equal([first]);
    });

    it("counts for the bookings chosen alone, the file kept for the others", async function () {
      const { first, second, mediaId } = await sharedUpload();

      const res = await review(first, mediaId, {
        result: "accepted",
        alsoFor: [],
      });

      expect(res.status, res.text).to.equal(200);
      expect(h.store.get(first).customerUploads[0].review.status).to.equal(
        "accepted",
      );
      expect(h.store.get(second).customerUploads[0].review.status).to.equal(
        "submitted",
      );
      expect(media.get(mediaId).bookingIds).to.deep.equal([second]);

      const later = await review(second, mediaId, { result: "accepted" });
      expect(later.status, later.text).to.equal(200);
      expect(media.has(mediaId)).to.equal(false);
    });

    it("refuses a booking that does not hold the upload", async function () {
      const { first, mediaId } = await sharedUpload();

      const res = await review(first, mediaId, {
        result: "accepted",
        alsoFor: ["fremd"],
      });

      expect(res.status).to.equal(400);
      expect(res.body.code).to.equal("customer_upload_target_invalid");
      expect(h.store.get(first).customerUploads[0].review.status).to.equal(
        "submitted",
      );
    });

    it("writes the note at every booking and mails a rejection once", async function () {
      const { first, second, mediaId } = await sharedUpload();

      const res = await review(first, mediaId, {
        result: "rejected",
        reason: "Unleserlich",
      });

      expect(res.status, res.text).to.equal(200);
      expect(media.has(mediaId)).to.equal(false);
      for (const id of [first, second]) {
        const [reference] = h.store.get(id).customerUploads;
        expect(reference.review).to.include({
          status: "rejected",
          reason: "Unleserlich",
        });
        expect(reference.originalFileName).to.equal("");
      }
      expect(h.takeEffects()).to.deep.equal([
        `mail.CUSTOMER_UPLOAD_REOPENED ${CUSTOMER}`,
      ]);
    });
  });

  describe("the deletion deadline", function () {
    it("follows the end of the last booking holding the upload", async function () {
      const [first, second] = await laterGroup();
      await handIn(first, [{ bookingId: second, fieldId: LATER_FIELD.id }]);
      const [medium] = [...media.values()];

      const afterFirst = await CustomerUploadJobs.run({
        now: TIME_END + 30 * DAY + HOUR,
      });
      expect(afterFirst.deleted).to.deep.equal([]);
      expect(media.has(medium.id)).to.equal(true);

      const afterLast = await CustomerUploadJobs.run({
        now: TIME_END + WEEK + 30 * DAY + HOUR,
      });
      expect(afterLast.deleted).to.deep.equal([medium.id]);
      for (const id of [first, second]) {
        expect(h.store.get(id).customerUploads[0].review).to.include({
          autoDeleted: true,
        });
      }
    });
  });

  describe("handing in at once on the page „Nachweise einreichen“", function () {
    it("names the group of each booking in „my bookings“", async function () {
      const [first, second] = await laterGroup();
      sinon
        .stub(BookingManager, "getAssignedBookings")
        .callsFake(async (userId) =>
          [...h.store.values()]
            .filter((doc) => doc.assignedUserId === userId)
            .map((doc) => new Booking(clone(doc))),
        );

      const res = await h
        .api()
        .get(`/api/bookings/assigned`)
        .set(h.as(CUSTOMER));

      expect(res.status, res.text).to.equal(200);
      const groupId = [...h.groups.keys()][0];
      for (const booking of res.body) {
        expect(booking.customerUploadState.group).to.deep.equal({
          id: groupId,
          bookingIds: [first, second],
        });
      }
    });

    it("stores a file for the chosen bookings too and tells the staff once", async function () {
      const [first, second] = await laterGroup();

      const res = await h
        .api()
        .post(base(first))
        .set(h.as(CUSTOMER))
        .field(
          "alsoFor",
          JSON.stringify({
            0: [{ bookingId: second, fieldId: LATER_FIELD.id }],
          }),
        )
        .attach(`customerUpload:${LATER_FIELD.id}`, PDF, "ausweis.pdf");

      expect(res.status, res.text).to.equal(201);
      expect(res.body.refused).to.deep.equal([]);
      const [medium] = [...media.values()];
      expect(medium.bookingIds).to.deep.equal([first, second]);
      expect(h.store.get(second).customerUploads[0].mediaId).to.equal(
        medium.id,
      );
      expect(h.takeEffects()).to.deep.equal([
        `mail.CUSTOMER_UPLOAD_SUBMITTED ${ROLE_HOLDER}`,
      ]);
      const [mail] = sentMails("CUSTOMER_UPLOAD_SUBMITTED");
      expect(mail.subject).to.equal(
        `Nachweis eingereicht zur Gruppe ${[...h.groups.keys()][0]}`,
      );
    });

    it("refuses the one file whose other booking is outside the group", async function () {
      const [first] = await laterGroup();

      const res = await h
        .api()
        .post(base(first))
        .set(h.as(CUSTOMER))
        .field(
          "alsoFor",
          JSON.stringify({
            0: [{ bookingId: "fremd", fieldId: LATER_FIELD.id }],
          }),
        )
        .attach(`customerUpload:${LATER_FIELD.id}`, PDF, "ausweis.pdf");

      expect(res.status, res.text).to.equal(200);
      expect(res.body.refused).to.have.length(1);
      expect(res.body.refused[0].code).to.equal(
        "customer_upload_target_invalid",
      );
      expect(media.size).to.equal(0);
    });
  });

  describe("the rights of the group", function () {
    it("gives a guest's link no choice of the group", async function () {
      const res = await h
        .api()
        .post(`/api/v2/${TENANT}/checkout/group?simulate=false`)
        .send(groupBody("later-room"));
      expect(res.body.success, res.text).to.equal(true);
      const [first, second] = res.body.data.groupBooking.bookingIds;
      const {
        signCustomerUploadLink,
      } = require("../src/commons/services/customer-upload/customer-upload-link");
      const link = signCustomerUploadLink(h.store.get(first));

      const refused = await h
        .api()
        .post(
          `/api/v2/${TENANT}/bookings/${first}/customer-uploads-by-link/${LATER_FIELD.id}`,
        )
        .set("X-Customer-Upload-Link", link)
        .field(
          "alsoFor",
          JSON.stringify([{ bookingId: second, fieldId: LATER_FIELD.id }]),
        )
        .attach("file", PDF, "ausweis.pdf");

      expect(refused.status, refused.text).to.equal(400);
      expect(refused.body.code).to.equal("customer_upload_target_invalid");
      expect(media.size).to.equal(0);
    });

    it("refuses another person's upload into the group", async function () {
      const [first, second] = await laterGroup();

      const res = await handIn(
        first,
        [{ bookingId: second, fieldId: LATER_FIELD.id }],
        { as: ADMIN },
      );

      expect(res.status).to.equal(404);
      expect(media.size).to.equal(0);
    });
  });
});
