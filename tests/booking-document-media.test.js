const assert = require("assert");
const sinon = require("sinon");

const CancellationService = require("../src/commons/services/payment/cancellation-service");
const InvoiceService = require("../src/commons/services/payment/invoice-service");
const MediaManager = require("../src/commons/data-managers/media-manager");
const MediaModel = require("../src/commons/data-managers/models/mediaModel");
const MediaService = require("../src/commons/services/media/media-service");
const PdfService = require("../src/commons/pdf-service/pdf-service");
const ReceiptService = require("../src/commons/services/payment/receipt-service");
const TenantManager = require("../src/commons/data-managers/tenant-manager");
const BookingManager = require("../src/commons/data-managers/booking-manager");
const IdGenerator = require("../src/commons/utilities/id-generator");
const {
  NextcloudManager,
} = require("../src/commons/data-managers/file-manager");
const { Media } = require("../src/commons/entities/media/media");

const TENANT = "tenant1";
const BOOKING = "booking-1";

function documentFixture(overrides = {}) {
  return new Media({
    id: "media-1",
    tenantId: TENANT,
    kind: "document",
    mimeType: "application/pdf",
    size: 100,
    originalFileName: "invoice-1.pdf",
    bookingId: BOOKING,
    visibility: "intern",
    storage: {
      provider: "nextcloud",
      key: `${TENANT}/media/media-1/original.pdf`,
    },
    ...overrides,
  });
}

describe("booking documents in the media library", function () {
  let sandbox;

  beforeEach(function () {
    sandbox = sinon.createSandbox();
  });

  afterEach(function () {
    sandbox.restore();
  });

  describe("MediaManager", function () {
    it("keeps booking documents out of the library listing", async function () {
      const query = {
        sort: sinon.stub().returnsThis(),
        skip: sinon.stub().returnsThis(),
        limit: sinon.stub().resolves([]),
      };
      sandbox.stub(MediaModel, "find").returns(query);
      sandbox.stub(MediaModel, "countDocuments").resolves(0);

      await MediaManager.getMediaList({ tenantId: TENANT });

      assert.strictEqual(MediaModel.find.firstCall.args[0].bookingId, null);
      assert.strictEqual(
        MediaModel.countDocuments.firstCall.args[0].bookingId,
        null,
      );
    });

    it("narrows the listing to one uploader when asked to", async function () {
      const query = {
        sort: sinon.stub().returnsThis(),
        skip: sinon.stub().returnsThis(),
        limit: sinon.stub().resolves([]),
      };
      sandbox.stub(MediaModel, "find").returns(query);
      sandbox.stub(MediaModel, "countDocuments").resolves(0);

      await MediaManager.getMediaList({ tenantId: TENANT, uploadedBy: "u-1" });

      assert.strictEqual(MediaModel.find.firstCall.args[0].uploadedBy, "u-1");
    });

    it("finds a booking document by its file name", async function () {
      const raw = { toEntity: () => documentFixture() };
      sandbox
        .stub(MediaModel, "findOne")
        .returns({ sort: sinon.stub().resolves(raw) });

      const media = await MediaManager.getBookingDocumentByFileName(
        TENANT,
        "invoice-1.pdf",
      );

      assert.strictEqual(media.id, "media-1");
      assert.deepStrictEqual(MediaModel.findOne.firstCall.args[0], {
        tenantId: TENANT,
        bookingId: { $ne: null },
        originalFileName: "invoice-1.pdf",
      });
    });

    it("scopes the search to the booking when one is known", async function () {
      sandbox
        .stub(MediaModel, "findOne")
        .returns({ sort: sinon.stub().resolves(null) });

      await MediaManager.getBookingDocumentByFileName(
        TENANT,
        "invoice-1.pdf",
        BOOKING,
      );

      assert.strictEqual(
        MediaModel.findOne.firstCall.args[0].bookingId,
        BOOKING,
      );
    });

    it("does not search without a file name", async function () {
      sandbox.stub(MediaModel, "findOne");

      assert.strictEqual(
        await MediaManager.getBookingDocumentByFileName(TENANT, undefined),
        null,
      );
      assert.strictEqual(MediaModel.findOne.called, false);
    });
  });

  describe("MediaService.createBookingDocument", function () {
    it("marks the medium with its booking and keeps it out of the public web", async function () {
      const createMedia = sandbox
        .stub(MediaService, "createMedia")
        .callsFake(async (params) => params);

      const result = await MediaService.createBookingDocument({
        tenantId: TENANT,
        bookingId: BOOKING,
        file: { name: "invoice-1.pdf", data: Buffer.from("pdf") },
        tags: ["invoice"],
      });

      assert.strictEqual(createMedia.calledOnce, true);
      assert.strictEqual(result.bookingId, BOOKING);
      assert.strictEqual(result.tenantId, TENANT);
      assert.strictEqual(result.metadata.visibility, "intern");
      assert.deepStrictEqual(result.metadata.tags, ["invoice"]);
      assert.strictEqual(result.metadata.title, "invoice-1.pdf");
    });

    it("refuses a document without a booking", async function () {
      await assert.rejects(
        () =>
          MediaService.createBookingDocument({
            tenantId: TENANT,
            file: { name: "x.pdf", data: Buffer.from("pdf") },
          }),
        (error) => error.code === "missing_booking_id",
      );
    });
  });

  describe("the document services", function () {
    let createBookingDocument;

    beforeEach(function () {
      createBookingDocument = sandbox
        .stub(MediaService, "createBookingDocument")
        .resolves(documentFixture());
      sandbox.stub(NextcloudManager, "createFile").resolves();
      sandbox.stub(TenantManager, "getTenant").resolves({
        id: TENANT,
        receiptNumberPrefix: "R",
        invoiceNumberPrefix: "I",
        cancellationNumberPrefix: "C",
      });
      sandbox.stub(BookingManager, "getBooking").resolves({
        id: BOOKING,
        tenantId: TENANT,
        attachments: [],
        timeCreated: 0,
      });
      sandbox.stub(IdGenerator, "next").resolves("0001");
    });

    it("stores a receipt as a booking document instead of a raw file", async function () {
      sandbox
        .stub(PdfService, "generateSingleReceipt")
        .resolves({ buffer: Buffer.from("pdf"), name: "receipt-1.pdf" });

      const result = await ReceiptService.createSingleReceipt(TENANT, BOOKING);

      assert.strictEqual(result.name, "receipt-1.pdf");
      assert.strictEqual(NextcloudManager.createFile.called, false);
      const args = createBookingDocument.firstCall.args[0];
      assert.strictEqual(args.tenantId, TENANT);
      assert.strictEqual(args.bookingId, BOOKING);
      assert.strictEqual(args.file.name, "receipt-1.pdf");
      assert.deepStrictEqual(args.tags, ["receipt"]);
    });

    it("stores an invoice as a booking document", async function () {
      sandbox
        .stub(PdfService, "generateSingleInvoice")
        .resolves({ buffer: Buffer.from("pdf"), name: "invoice-1.pdf" });

      await InvoiceService.createSingleInvoice(TENANT, BOOKING);

      assert.strictEqual(NextcloudManager.createFile.called, false);
      assert.deepStrictEqual(createBookingDocument.firstCall.args[0].tags, [
        "invoice",
      ]);
    });

    it("stores a cancellation as a booking document", async function () {
      sandbox
        .stub(PdfService, "generateSingleCancellationReceipt")
        .resolves({ buffer: Buffer.from("pdf"), name: "cancellation-1.pdf" });

      await CancellationService.createSingleCancellation({
        tenantId: TENANT,
        bookingId: BOOKING,
      });

      assert.strictEqual(NextcloudManager.createFile.called, false);
      assert.deepStrictEqual(createBookingDocument.firstCall.args[0].tags, [
        "cancellation",
      ]);
    });

    it("links an aggregated document to every booking of the group", async function () {
      // The aggregated receipt is attached to all bookings of the group, so
      // every owner has to reach it — one medium could only name one booking.
      sandbox.stub(BookingManager, "getBookings").resolves([
        { id: "booking-1", tenantId: TENANT, attachments: [] },
        { id: "booking-2", tenantId: TENANT, attachments: [] },
        { id: "booking-3", tenantId: TENANT, attachments: [] },
      ]);
      sandbox
        .stub(PdfService, "generateAggregatedReceipt")
        .resolves({ buffer: Buffer.from("pdf"), name: "receipt-group.pdf" });

      await ReceiptService.createAggregatedReceipt(TENANT, [
        "booking-1",
        "booking-2",
        "booking-3",
      ]);

      assert.strictEqual(createBookingDocument.callCount, 3);
      assert.deepStrictEqual(
        createBookingDocument.getCalls().map((call) => call.args[0].bookingId),
        ["booking-1", "booking-2", "booking-3"],
      );
    });
  });

  describe("the download facades", function () {
    it("serve a document that is already a medium from the media library", async function () {
      sandbox
        .stub(MediaManager, "getBookingDocumentByFileName")
        .resolves(documentFixture());
      sandbox.stub(MediaService, "getBuffer").resolves(Buffer.from("pdf"));
      const legacy = sandbox.stub(NextcloudManager, "getFile");

      const receipt = await ReceiptService.getReceipt(
        TENANT,
        "invoice-1.pdf",
        BOOKING,
      );

      assert.strictEqual(receipt.toString(), "pdf");
      assert.strictEqual(legacy.called, false);
    });

    it("look the document up within its own booking, never by name alone", async function () {
      sandbox
        .stub(MediaManager, "getBookingDocumentByFileName")
        .resolves(documentFixture());
      sandbox.stub(MediaService, "getBuffer").resolves(Buffer.from("pdf"));

      await ReceiptService.getReceipt(TENANT, "receipt-1.pdf", BOOKING);

      assert.deepStrictEqual(
        MediaManager.getBookingDocumentByFileName.firstCall.args,
        [TENANT, "receipt-1.pdf", BOOKING],
      );
    });

    it("fall back to the legacy tree for documents the media import has not moved yet", async function () {
      sandbox.stub(MediaManager, "getBookingDocumentByFileName").resolves(null);
      sandbox
        .stub(NextcloudManager, "getFile")
        .resolves(Buffer.from("legacy pdf"));

      const invoice = await InvoiceService.getInvoice(TENANT, "old.pdf");

      assert.strictEqual(invoice.toString(), "legacy pdf");
      assert.deepStrictEqual(NextcloudManager.getFile.firstCall.args[0], {
        tenant: TENANT,
        subFolder: "invoices",
        filename: "old.pdf",
      });
    });

    it("report a storage outage as an unavailable service", async function () {
      sandbox
        .stub(MediaManager, "getBookingDocumentByFileName")
        .resolves(documentFixture());
      const outage = new Error("storage down");
      outage.isStorageError = true;
      sandbox.stub(MediaService, "getBuffer").rejects(outage);

      await assert.rejects(
        () => CancellationService.getCancellation(TENANT, "invoice-1.pdf"),
        (error) => /unavailable/.test(error.message),
      );
    });
  });
});
