const assert = require("assert");
const sinon = require("sinon");

const BookingManager = require("../src/commons/data-managers/booking-manager");
const BookingModel = require("../src/commons/data-managers/models/bookingModel");
const BookableModel = require("../src/commons/data-managers/models/bookableModel");
const EventManager = require("../src/commons/data-managers/event-manager");
const EventModel = require("../src/commons/data-managers/models/eventModel");
const InstanceManager = require("../src/commons/data-managers/instance-manager");
const InstanceModel = require("../src/commons/data-managers/models/instanceModel");
const MediaManager = require("../src/commons/data-managers/media-manager");
const MediaModel = require("../src/commons/data-managers/models/mediaModel");
const MediaService = require("../src/commons/services/media/media-service");
const TenantManager = require("../src/commons/data-managers/tenant-manager");
const BookingService = require("../src/commons/services/checkout/booking-service");
const AccessService = require("../src/commons/services/access/access-service");
const {
  BookableManager,
} = require("../src/commons/data-managers/bookable-manager");
const { Media } = require("../src/commons/entities/media/media");
const {
  MediaUsageService,
} = require("../src/commons/services/media/media-usage");
const {
  deleteBookingDocuments,
} = require("../src/commons/services/media/booking-documents");

const TENANT = "tenant1";
const MEDIA = "media-1";
const BOOKING = "booking-1";

/**
 * A `find(filter, projection).lean()` that answers with the given documents.
 */
function leanFind(sandbox, Model, docs) {
  return sandbox.stub(Model, "find").returns({ lean: async () => docs });
}

function documentFixture(overrides = {}) {
  return new Media({
    id: "media-1",
    tenantId: TENANT,
    kind: "document",
    mimeType: "application/pdf",
    size: 100,
    originalFileName: "invoice-1.pdf",
    bookingIds: [BOOKING],
    visibility: "intern",
    storage: {
      provider: "nextcloud",
      key: `${TENANT}/media/media-1/original.pdf`,
    },
    ...overrides,
  });
}

describe("media usage proof", function () {
  let sandbox;

  beforeEach(function () {
    sandbox = sinon.createSandbox();
  });

  afterEach(function () {
    sandbox.restore();
  });

  describe("reference sites", function () {
    it("finds bookables by their image list and their attachments", async function () {
      leanFind(sandbox, BookableModel, [
        { id: "bookable-1", title: "Meeting room 1" },
      ]);

      const sites = await BookableManager.getMediaUsage(TENANT, MEDIA);

      assert.deepStrictEqual(sites, [
        { id: "bookable-1", title: "Meeting room 1" },
      ]);
      assert.deepStrictEqual(BookableModel.find.firstCall.args[0], {
        tenantId: TENANT,
        $or: [
          { "images.mediaId": MEDIA },
          { "attachments.reference.mediaId": MEDIA },
        ],
      });
    });

    it("finds events by every image site and their attachments", async function () {
      leanFind(sandbox, EventModel, [
        { id: "event-1", information: { name: "Summer party" } },
      ]);

      const sites = await EventManager.getMediaUsage(TENANT, MEDIA);

      assert.deepStrictEqual(sites, [{ id: "event-1", title: "Summer party" }]);
      assert.deepStrictEqual(EventModel.find.firstCall.args[0], {
        tenantId: TENANT,
        $or: [
          { "information.teaserImage.mediaId": MEDIA },
          { "eventOrganizer.contactPersonImage.mediaId": MEDIA },
          { "eventOrganizer.speakers.image.mediaId": MEDIA },
          { "images.mediaId": MEDIA },
          { "attachments.reference.mediaId": MEDIA },
        ],
      });
    });

    it("finds bookings by their attachments", async function () {
      leanFind(sandbox, BookingModel, [{ id: BOOKING, name: "Jane Doe" }]);

      const sites = await BookingManager.getMediaUsage(TENANT, MEDIA);

      assert.deepStrictEqual(sites, [{ id: BOOKING, title: "Jane Doe" }]);
      assert.deepStrictEqual(BookingModel.find.firstCall.args[0], {
        tenantId: TENANT,
        "attachments.reference.mediaId": MEDIA,
      });
    });

    it("finds the instance by its branding and legal documents", async function () {
      sandbox
        .stub(InstanceModel, "findOne")
        .returns({ lean: async () => ({ _id: "instance" }) });

      const sites = await InstanceManager.getMediaUsage(MEDIA);

      assert.deepStrictEqual(sites, [{ id: null, title: "instance" }]);
      assert.deepStrictEqual(InstanceModel.findOne.firstCall.args[0], {
        $or: [
          { "branding.logo.mediaId": MEDIA },
          { "branding.favicon.mediaId": MEDIA },
          { "dataProtection.reference.mediaId": MEDIA },
          { "legalNotice.reference.mediaId": MEDIA },
          { "termsAndConditions.reference.mediaId": MEDIA },
        ],
      });
    });

    it("reports an unreferenced instance as unused", async function () {
      sandbox
        .stub(InstanceModel, "findOne")
        .returns({ lean: async () => null });

      assert.deepStrictEqual(await InstanceManager.getMediaUsage(MEDIA), []);
    });
  });

  describe("MediaUsageService", function () {
    it("labels every finding with its entity type", async function () {
      sandbox
        .stub(BookableManager, "getMediaUsage")
        .resolves([{ id: "bookable-1", title: "Meeting room 1" }]);
      sandbox
        .stub(EventManager, "getMediaUsage")
        .resolves([{ id: "event-1", title: "Summer party" }]);
      sandbox
        .stub(BookingManager, "getMediaUsage")
        .resolves([{ id: BOOKING, title: "Jane Doe" }]);
      sandbox
        .stub(InstanceManager, "getMediaUsage")
        .resolves([{ id: null, title: "instance" }]);
      sandbox
        .stub(TenantManager, "getMediaUsage")
        .resolves([{ id: TENANT, title: "Stadt" }]);

      const usage = await MediaUsageService.findUsage({
        tenantId: TENANT,
        mediaId: MEDIA,
      });

      assert.deepStrictEqual(usage, [
        { type: "bookable", id: "bookable-1", title: "Meeting room 1" },
        { type: "event", id: "event-1", title: "Summer party" },
        { type: "booking", id: BOOKING, title: "Jane Doe" },
        { type: "instance", id: null, title: "instance" },
        { type: "tenant", id: TENANT, title: "Stadt" },
      ]);
    });

    it("answers an empty proof for an unused medium", async function () {
      sandbox.stub(BookableManager, "getMediaUsage").resolves([]);
      sandbox.stub(EventManager, "getMediaUsage").resolves([]);
      sandbox.stub(BookingManager, "getMediaUsage").resolves([]);
      sandbox.stub(InstanceManager, "getMediaUsage").resolves([]);
      sandbox.stub(TenantManager, "getMediaUsage").resolves([]);

      const usage = await MediaUsageService.findUsage({
        tenantId: TENANT,
        mediaId: MEDIA,
      });

      assert.deepStrictEqual(usage, []);
    });
  });
});

describe("media deletion", function () {
  let sandbox;
  let provider;

  beforeEach(function () {
    sandbox = sinon.createSandbox();

    provider = {
      delete: sandbox.stub().resolves(),
      deleteMany: sandbox.stub().resolves(),
      deletePrefix: sandbox.stub().resolves(),
    };

    sandbox.stub(MediaService, "providerFor").returns(provider);
  });

  afterEach(function () {
    sandbox.restore();
  });

  it("accepts an orphan when the bytes cannot be removed", async function () {
    const removeMedia = sandbox
      .stub(MediaManager, "removeMedia")
      .resolves(true);
    provider.deletePrefix.rejects(new Error("storage down"));

    const removed = await MediaService.deleteMedia(documentFixture());

    assert.strictEqual(removed, true);
    assert.ok(removeMedia.calledBefore(provider.deletePrefix));
  });

  describe("booking documents", function () {
    it("cascade with their booking, system receipts included", async function () {
      const documents = [
        documentFixture({ id: "media-1", tags: ["receipt"] }),
        documentFixture({ id: "media-2", tags: ["invoice"] }),
      ];
      sandbox.stub(MediaManager, "getBookingDocuments").resolves(documents);
      sandbox
        .stub(MediaManager, "removeBookingReference")
        .callsFake(async (mediaId) =>
          documentFixture({ id: mediaId, bookingIds: [] }),
        );
      const removeMedia = sandbox
        .stub(MediaManager, "removeMedia")
        .resolves(true);

      const count = await deleteBookingDocuments({
        tenantId: TENANT,
        bookingId: BOOKING,
      });

      assert.strictEqual(count, 2);
      assert.deepStrictEqual(
        MediaManager.removeBookingReference.getCalls().map((call) => call.args),
        [
          ["media-1", TENANT, BOOKING],
          ["media-2", TENANT, BOOKING],
        ],
      );
      assert.deepStrictEqual(
        removeMedia.getCalls().map((call) => call.args[0]),
        ["media-1", "media-2"],
      );
    });

    it("only lose the reference while other bookings still hold the document", async function () {
      sandbox.stub(MediaManager, "getBookingDocuments").resolves([
        documentFixture({
          id: "media-1",
          bookingIds: [BOOKING, "booking-2"],
        }),
      ]);
      sandbox
        .stub(MediaManager, "removeBookingReference")
        .resolves(
          documentFixture({ id: "media-1", bookingIds: ["booking-2"] }),
        );
      const removeMedia = sandbox.stub(MediaManager, "removeMedia");

      const count = await deleteBookingDocuments({
        tenantId: TENANT,
        bookingId: BOOKING,
      });

      assert.strictEqual(count, 1);
      assert.strictEqual(removeMedia.called, false);
    });

    it("drop a reference with one atomic pull, never a read-modify-write", async function () {
      // Two concurrent booking deletions on the same aggregated medium must
      // not lose each other's update (ticket 01: `$pull`).
      sandbox.stub(MediaModel, "findOneAndUpdate").returns({
        toEntity: () => documentFixture({ bookingIds: [] }),
      });

      await MediaManager.removeBookingReference("media-1", TENANT, BOOKING);

      assert.deepStrictEqual(MediaModel.findOneAndUpdate.firstCall.args, [
        { id: "media-1", tenantId: TENANT },
        { $pull: { bookingIds: BOOKING } },
        { new: true },
      ]);
    });

    it("are searched by their booking alone", async function () {
      sandbox
        .stub(MediaModel, "find")
        .resolves([{ toEntity: () => documentFixture() }]);

      const documents = await MediaManager.getBookingDocuments(TENANT, BOOKING);

      assert.strictEqual(documents.length, 1);
      assert.deepStrictEqual(MediaModel.find.firstCall.args[0], {
        tenantId: TENANT,
        bookingIds: BOOKING,
      });
    });

    it("are gone before the booking that carried them", async function () {
      const booking = { id: BOOKING, tenantId: TENANT };
      sandbox.stub(BookingManager, "getBooking").resolves(booking);
      const removeBooking = sandbox
        .stub(BookingManager, "removeBooking")
        .resolves();
      const getDocuments = sandbox
        .stub(MediaManager, "getBookingDocuments")
        .resolves([documentFixture()]);
      sandbox
        .stub(MediaManager, "removeBookingReference")
        .resolves(documentFixture({ bookingIds: [] }));
      const removeMedia = sandbox
        .stub(MediaManager, "removeMedia")
        .resolves(true);
      sandbox.stub(AccessService, "revokeForBooking").resolves([]);

      await BookingService.cancelBooking(TENANT, BOOKING);

      assert.ok(getDocuments.calledWith(TENANT, BOOKING));
      assert.ok(removeMedia.calledBefore(removeBooking));
    });
  });
});
