/**
 * The issuance of booking documents (spec part 2, section 6): one module
 * that draws the number, renders, stores the bytes and attaches the
 * document to every booking with an atomic push - so a document number
 * exists exactly when its attachment does.
 */

const assert = require("assert");
const sinon = require("sinon");

const IdGenerator = require("../src/commons/utilities/id-generator");
const TenantModel = require("../src/commons/data-managers/models/tenantModel");

const TENANT = "tenant-1";
const YEAR = new Date().getFullYear();

/**
 * A tenant row whose `findOneAndUpdate` applies `$inc` the way MongoDB
 * does: in one step, so parallel draws can never read the same value.
 */
function tenantRow(counters = {}) {
  const row = { id: TENANT, ...counters };
  const findOneAndUpdate = sinon
    .stub(TenantModel, "findOneAndUpdate")
    .callsFake((filter, update) => {
      const updated = filter.id === row.id ? applyInc(row, update) : null;
      const query = {
        select: () => query,
        lean: async () => updated,
      };
      return query;
    });
  return { row, findOneAndUpdate };
}

function applyInc(row, update) {
  for (const [path, by] of Object.entries(update.$inc)) {
    const [field, key] = path.split(".");
    row[field] = row[field] || {};
    row[field][key] = (row[field][key] || 0) + by;
  }
  return JSON.parse(JSON.stringify(row));
}

describe("IdGenerator.next: unique, not gapless", function () {
  afterEach(function () {
    sinon.restore();
  });

  it("draws the next number of the type and year in one atomic increment", async function () {
    const { row, findOneAndUpdate } = tenantRow({
      receiptCount: { [YEAR]: 41 },
    });

    const number = await IdGenerator.next(TENANT, 4, "receipt");

    assert.strictEqual(number, `${YEAR}-0042`);
    assert.strictEqual(row.receiptCount[YEAR], 42);
    assert.deepStrictEqual(findOneAndUpdate.firstCall.args[1], {
      $inc: { [`receiptCount.${YEAR}`]: 1 },
    });
  });

  it("gives ten parallel draws ten distinct numbers", async function () {
    tenantRow();

    const numbers = await Promise.all(
      Array.from({ length: 10 }, () => IdGenerator.next(TENANT, 4, "invoice")),
    );

    assert.strictEqual(new Set(numbers).size, 10);
    assert.deepStrictEqual(
      [...numbers].sort(),
      Array.from(
        { length: 10 },
        (_, i) => `${YEAR}-${String(i + 1).padStart(4, "0")}`,
      ).sort(),
    );
  });

  it("counts each type on its own and pads only when asked", async function () {
    const { row } = tenantRow({ invoiceCount: { [YEAR]: 7 } });

    assert.strictEqual(
      await IdGenerator.next(TENANT, 0, "cancellation"),
      `${YEAR}-1`,
    );
    assert.strictEqual(row.invoiceCount[YEAR], 7);
  });

  it("refuses an unknown type before touching the tenant", async function () {
    const { findOneAndUpdate } = tenantRow();

    await assert.rejects(() => IdGenerator.next(TENANT, 4, "voucher"), {
      message: /unknown document type/i,
    });
    assert.strictEqual(findOneAndUpdate.called, false);
  });

  it("names a tenant that does not exist", async function () {
    tenantRow();

    await assert.rejects(() => IdGenerator.next("other", 4, "receipt"), {
      code: "tenant_not_found",
    });
  });
});

// ---------------------------------------------------------------------------

const BookingManager = require("../src/commons/data-managers/booking-manager");
const TenantManager = require("../src/commons/data-managers/tenant-manager");
const MediaService = require("../src/commons/services/media/media-service");
const ReceiptService = require("../src/commons/services/payment/receipt-service");
const {
  issue,
} = require("../src/commons/services/documents/document-issuance");

function booking(id, attachments = []) {
  return { id, tenantId: TENANT, attachments, mail: "erika@example.test" };
}

/** The world below `issue`, stubbed at its seams. */
function world({ bookings, tenant = {} } = {}) {
  const store = new Map(bookings.map((b) => [b.id, b]));
  const pushed = [];
  sinon.stub(TenantManager, "getTenant").resolves({
    id: TENANT,
    receiptNumberPrefix: "RE",
    invoiceNumberPrefix: "RG",
    cancellationNumberPrefix: "ST",
    ...tenant,
  });
  sinon
    .stub(BookingManager, "getBookings")
    .callsFake(async (tenantId, ids) =>
      ids.map((id) => store.get(id)).filter(Boolean),
    );
  const addAttachment = sinon
    .stub(BookingManager, "addAttachment")
    .callsFake(async (tenantId, bookingId, attachment) => {
      pushed.push({ bookingId, attachment });
      return attachment;
    });
  const storeBooking = sinon.stub(BookingManager, "storeBooking");
  const createBookingDocument = sinon
    .stub(MediaService, "createBookingDocument")
    .resolves({ id: "media-1" });
  const draw = sinon.stub(IdGenerator, "next").resolves(`${YEAR}-0001`);
  return { pushed, addAttachment, storeBooking, createBookingDocument, draw };
}

describe("issue: a document number exists exactly when its attachment does", function () {
  afterEach(function () {
    sinon.restore();
  });

  it("draws the number, renders, stores the bytes and attaches with one atomic push", async function () {
    const w = world({ bookings: [booking("B1")] });
    const render = sinon
      .stub(ReceiptService, "render")
      .resolves({ name: "receipt.pdf", buffer: Buffer.from("%PDF") });

    const result = await issue({
      tenantId: TENANT,
      bookingIds: ["B1"],
      type: "receipt",
    });

    assert.deepStrictEqual(w.draw.firstCall.args, [TENANT, 4, "receipt"]);
    assert.strictEqual(render.firstCall.args[0].number, `RE-${YEAR}-0001-1`);
    assert.deepStrictEqual(render.firstCall.args[0].bookingIds, ["B1"]);
    assert.strictEqual(render.firstCall.args[0].groupBookingId, null);

    const stored = w.createBookingDocument.firstCall.args[0];
    assert.deepStrictEqual(stored.bookingIds, ["B1"]);
    assert.deepStrictEqual(stored.tags, ["receipt"]);
    assert.strictEqual(stored.file.name, "receipt.pdf");

    assert.strictEqual(w.pushed.length, 1);
    assert.strictEqual(w.pushed[0].bookingId, "B1");
    const attachment = w.pushed[0].attachment;
    assert.strictEqual(attachment.type, "receipt");
    assert.strictEqual(attachment.name, "receipt.pdf");
    assert.strictEqual(attachment.title, "receipt.pdf");
    assert.strictEqual(attachment.receiptId, `${YEAR}-0001`);
    assert.strictEqual(attachment.revision, 1);
    assert.ok(typeof attachment.timeCreated === "number");
    // Never a whole-document write: it would race the state write.
    assert.strictEqual(w.storeBooking.called, false);

    assert.deepStrictEqual(result.attachment, attachment);
    assert.strictEqual(result.file.name, "receipt.pdf");
    assert.ok(Buffer.isBuffer(result.file.buffer));
  });
});

describe("issue: revisions, aggregation and gaps", function () {
  const bunyan = require("bunyan");
  const InvoiceService = require("../src/commons/services/payment/invoice-service");
  const CancellationService = require("../src/commons/services/payment/cancellation-service");
  const {
    remove,
    groupBookingIdOf,
  } = require("../src/commons/services/documents/document-issuance");
  const MediaManager = require("../src/commons/data-managers/media-manager");
  const GroupBookingManager = require("../src/commons/data-managers/group-booking-manager");

  afterEach(function () {
    sinon.restore();
  });

  it("issues the second document of a type under the same number as the next revision", async function () {
    const w = world({
      bookings: [
        booking("B1", [
          { type: "receipt", receiptId: `${YEAR}-0007`, revision: 1 },
          { type: "invoice", invoiceId: `${YEAR}-0003`, revision: 4 },
          { type: "receipt", receiptId: `${YEAR}-0007`, revision: 2 },
        ]),
      ],
    });
    const render = sinon
      .stub(ReceiptService, "render")
      .resolves({ name: "receipt.pdf", buffer: Buffer.from("%PDF") });

    const { attachment } = await issue({
      tenantId: TENANT,
      bookingIds: ["B1"],
      type: "receipt",
    });

    assert.strictEqual(w.draw.called, false);
    assert.strictEqual(render.firstCall.args[0].number, `RE-${YEAR}-0007-3`);
    assert.strictEqual(attachment.receiptId, `${YEAR}-0007`);
    assert.strictEqual(attachment.revision, 3);
  });

  it("draws a number for a booking whose earlier attachment of the type has none", async function () {
    world({
      bookings: [booking("B1", [{ type: "invoice", revision: 1 }])],
    });
    sinon
      .stub(InvoiceService, "render")
      .resolves({ name: "invoice.pdf", buffer: Buffer.from("%PDF") });

    const { attachment } = await issue({
      tenantId: TENANT,
      bookingIds: ["B1"],
      type: "invoice",
    });

    assert.strictEqual(attachment.invoiceId, `${YEAR}-0001`);
    assert.strictEqual(attachment.revision, 2);
  });

  it("issues an aggregated document as one medium, attached to every booking of the group", async function () {
    const w = world({
      bookings: [booking("B1"), booking("B2"), booking("B3")],
    });
    const render = sinon
      .stub(InvoiceService, "render")
      .resolves({ name: "group.pdf", buffer: Buffer.from("%PDF") });

    const { attachment } = await issue({
      tenantId: TENANT,
      bookingIds: ["B1", "B2", "B3"],
      type: "invoice",
      groupBookingId: "G1",
    });

    assert.strictEqual(render.firstCall.args[0].groupBookingId, "G1");
    assert.strictEqual(render.firstCall.args[0].number, `RG-${YEAR}-0001-1`);
    assert.strictEqual(w.createBookingDocument.callCount, 1);
    assert.deepStrictEqual(
      w.createBookingDocument.firstCall.args[0].bookingIds,
      ["B1", "B2", "B3"],
    );
    assert.deepStrictEqual(
      w.pushed.map((push) => push.bookingId),
      ["B1", "B2", "B3"],
    );
    for (const push of w.pushed) {
      assert.deepStrictEqual(push.attachment, attachment);
    }
  });

  it("never guesses aggregation from the number of bookings", async function () {
    const w = world({ bookings: [booking("B1"), booking("B2")] });
    sinon.stub(InvoiceService, "render");

    await assert.rejects(
      () =>
        issue({ tenantId: TENANT, bookingIds: ["B1", "B2"], type: "invoice" }),
      { code: "aggregated_document_needs_group" },
    );
    assert.strictEqual(w.draw.called, false);
  });

  it("refuses a group whose bookings carry different numbers of the type", async function () {
    const w = world({
      bookings: [
        booking("B1", [{ type: "receipt", receiptId: "A", revision: 1 }]),
        booking("B2", [{ type: "receipt", receiptId: "B", revision: 1 }]),
      ],
    });
    sinon.stub(ReceiptService, "render");

    await assert.rejects(
      () =>
        issue({
          tenantId: TENANT,
          bookingIds: ["B1", "B2"],
          type: "receipt",
          groupBookingId: "G1",
        }),
      { code: "document_numbers_differ", statusCode: 409 },
    );
    assert.strictEqual(w.draw.called, false);
    assert.strictEqual(w.pushed.length, 0);
  });

  it("leaves a rendering failure as a logged gap: no bytes, no attachment", async function () {
    const w = world({ bookings: [booking("B1")] });
    const failure = new Error("template broken");
    sinon.stub(ReceiptService, "render").rejects(failure);
    const log = sinon.stub(bunyan.prototype, "error");

    await assert.rejects(
      () => issue({ tenantId: TENANT, bookingIds: ["B1"], type: "receipt" }),
      failure,
    );

    assert.strictEqual(w.draw.callCount, 1);
    assert.strictEqual(w.createBookingDocument.called, false);
    assert.strictEqual(w.pushed.length, 0);
    const gap = log.getCalls().find((call) => call.args[0]?.number);
    assert.ok(gap, "the gap is logged");
    assert.strictEqual(gap.args[0].number, `RE-${YEAR}-0001-1`);
    assert.strictEqual(gap.args[0].type, "receipt");
    assert.deepStrictEqual(gap.args[0].bookingIds, ["B1"]);
    assert.strictEqual(gap.args[0].err, failure);
  });

  it("reports a storage outage as an unavailable service, without attachment", async function () {
    const w = world({ bookings: [booking("B1")] });
    sinon
      .stub(InvoiceService, "render")
      .resolves({ name: "invoice.pdf", buffer: Buffer.from("%PDF") });
    w.createBookingDocument.rejects(
      Object.assign(new Error("502"), { isStorageError: true }),
    );
    sinon.stub(bunyan.prototype, "error");

    await assert.rejects(
      () => issue({ tenantId: TENANT, bookingIds: ["B1"], type: "invoice" }),
      { message: /Failed to save invoice/ },
    );
    assert.strictEqual(w.pushed.length, 0);
  });

  it("gives each booking of a cancelled group its own refund audit and the reference to the cancelled document", async function () {
    const cancelledAt = Date.UTC(2026, 7, 20, 8);
    const w = world({
      bookings: [
        booking("B1", [
          {
            type: "invoice",
            invoiceId: `${YEAR}-0009`,
            revision: 1,
            timeCreated: 1000,
          },
        ]),
        booking("B2"),
      ],
    });
    const PdfService = require("../src/commons/pdf-service/pdf-service");
    const pdf = sinon
      .stub(PdfService, "generateAggregatedCancellationReceipt")
      .resolves({ name: "cancel.pdf", buffer: Buffer.from("%PDF") });

    const refundCalculations = [
      { bookingId: "B1", cancelledAt, refundAmountEur: 10, origin: "admin" },
      { bookingId: "B2", cancelledAt, refundAmountEur: 20, origin: "admin" },
    ];
    await issue({
      tenantId: TENANT,
      bookingIds: ["B1", "B2"],
      type: "cancellation",
      groupBookingId: "G1",
      options: { refundCalculations, cancellationReason: "storm" },
    });

    assert.deepStrictEqual(pdf.firstCall.args.slice(0, 4), [
      TENANT,
      ["B1", "B2"],
      `ST-${YEAR}-0001-1`,
      `${YEAR}-0009-1`,
    ]);
    assert.strictEqual(pdf.firstCall.args[4].groupBookingId, "G1");
    assert.strictEqual(pdf.firstCall.args[4].originalInvoiceDate, 1000);

    const byBooking = Object.fromEntries(
      w.pushed.map((push) => [push.bookingId, push.attachment]),
    );
    assert.strictEqual(byBooking.B1.cancellationId, `${YEAR}-0001`);
    assert.strictEqual(byBooking.B1.timeCreated, cancelledAt);
    assert.deepStrictEqual(byBooking.B1.cancellation, {
      cancelledAt,
      refundAmountEur: 10,
      origin: "admin",
      originalDocumentRef: { number: `${YEAR}-0009-1`, timeCreated: 1000 },
    });
    assert.strictEqual(byBooking.B2.cancellation.refundAmountEur, 20);
    assert.strictEqual(byBooking.B2.cancellation.bookingId, undefined);
  });

  it("keeps the entities the caller holds in step, so a later whole write carries the attachment", async function () {
    const held = booking("B1", [
      { type: "receipt", receiptId: "X", revision: 1 },
    ]);
    const w = world({ bookings: [booking("B1")] });
    sinon
      .stub(ReceiptService, "render")
      .resolves({ name: "receipt.pdf", buffer: Buffer.from("%PDF") });

    await issue({
      tenantId: TENANT,
      bookingIds: ["B1"],
      type: "receipt",
      bookings: [held],
    });

    // The number comes off the held entity, not off a second read.
    assert.strictEqual(BookingManager.getBookings.called, false);
    assert.strictEqual(w.pushed[0].attachment.receiptId, "X");
    assert.strictEqual(w.pushed[0].attachment.revision, 2);
    assert.strictEqual(held.attachments.length, 2);
    assert.deepStrictEqual(held.attachments[1], w.pushed[0].attachment);
  });

  it("remove takes every document of a booking with it", async function () {
    sinon
      .stub(MediaManager, "getBookingDocuments")
      .resolves([{ id: "m1" }, { id: "m2" }]);
    const pull = sinon
      .stub(MediaManager, "removeBookingReference")
      .callsFake(async (id) => ({ id, bookingIds: id === "m1" ? [] : ["B2"] }));
    const del = sinon.stub(MediaService, "deleteMedia").resolves();

    const count = await remove({ tenantId: TENANT, booking: { id: "B1" } });

    assert.strictEqual(count, 2);
    assert.deepStrictEqual(
      pull.getCalls().map((call) => call.args),
      [
        ["m1", TENANT, "B1"],
        ["m2", TENANT, "B1"],
      ],
    );
    assert.deepStrictEqual(del.firstCall.args[0], { id: "m1", bookingIds: [] });
  });

  it("groupBookingIdOf looks the group up by its first booking where the caller does not know it", async function () {
    const lookup = sinon
      .stub(GroupBookingManager, "getGroupBookingByBookingId")
      .resolves({ id: "G7" });

    assert.strictEqual(
      await groupBookingIdOf({
        tenantId: TENANT,
        bookingIds: ["B1", "B2"],
        groupBookingId: "G1",
      }),
      "G1",
    );
    assert.strictEqual(lookup.called, false);
    assert.strictEqual(
      await groupBookingIdOf({ tenantId: TENANT, bookingIds: ["B1", "B2"] }),
      "G7",
    );
    lookup.resolves(null);
    await assert.rejects(
      () => groupBookingIdOf({ tenantId: TENANT, bookingIds: ["B9"] }),
      { code: "group_booking_not_found" },
    );
  });
});
