const assert = require("assert");
const sinon = require("sinon");
const BookingService = require("../src/commons/services/checkout/booking-service");
const BookingManager = require("../src/commons/data-managers/booking-manager");
const GroupBookingManager = require("../src/commons/data-managers/group-booking-manager");
const TenantManager = require("../src/commons/data-managers/tenant-manager");
const PdfService = require("../src/commons/pdf-service/pdf-service");
const MediaService = require("../src/commons/services/media/media-service");
const IdGenerator = require("../src/commons/utilities/id-generator");
const WorkflowService = require("../src/commons/services/workflow/workflow-service");
const AccessService = require("../src/commons/services/access/access-service");
const MailController = require("../src/commons/mail-service/mail-controller");
const {
  CANCELLATION_ORIGINS,
} = require("../src/commons/services/payment/cancellation-refund-service");
const {
  BundleCheckoutService,
} = require("../src/commons/services/checkout/bundle-checkout-service");
const { Booking } = require("../src/commons/entities/booking/booking");

function booking(overrides = {}) {
  return {
    id: "booking-1",
    tenantId: "tenant-1",
    name: "Test User",
    mail: "test@example.com",
    street: "Main Street 1",
    zipCode: "12345",
    location: "Test City",
    priceEur: 100,
    vatIncludedEur: 15.97,
    timeBegin: Date.UTC(2026, 7, 21, 8),
    isCommitted: true,
    isPayed: true,
    isRejected: false,
    attachments: [],
    bookableItems: [],
    ...overrides,
  };
}

/**
 * The issuance below the cancellation, at its seams: the number draw, the
 * media store and the attachment push are stubbed, the PDF renderer answers
 * a file. What runs for real is the renderer's reading of the cancelled
 * document and the attachment the issuance builds.
 */
function stubIssuance() {
  sinon.stub(IdGenerator, "next").resolves("2026-0012");
  sinon.stub(MediaService, "createBookingDocument").resolves({ id: "doc" });
  sinon
    .stub(BookingManager, "addAttachment")
    .callsFake(async (tenantId, bookingId, attachment) => attachment);
  return {
    single: sinon
      .stub(PdfService, "generateSingleCancellationReceipt")
      .resolves({ name: "cancellation.pdf", buffer: Buffer.from("pdf") }),
    aggregated: sinon
      .stub(PdfService, "generateAggregatedCancellationReceipt")
      .resolves({ name: "group-cancellation.pdf", buffer: Buffer.from("pdf") }),
  };
}

const INVOICE = {
  type: "invoice",
  invoiceId: "INV-1",
  revision: 1,
  timeCreated: Date.UTC(2026, 6, 1, 8),
};

function cancellationAttachment(entry) {
  return entry.attachments.find((att) => att.type === "cancellation");
}

function stubCancellationSideEffects() {
  sinon.stub(BookingManager, "storeBooking").callsFake(async (value) => value);
  sinon.stub(WorkflowService, "handleWorkflowEvent").resolves();
  sinon.stub(AccessService, "revokeForBooking").resolves([]);
  sinon.stub(MailController, "sendBookingCancel").resolves();
  sinon.stub(MailController, "sendBookingRejection").resolves();
}

describe("BookingService cancellation refunds", function () {
  afterEach(function () {
    sinon.restore();
  });

  it("stores the admin refund calculation on a single cancellation", async function () {
    const storedBooking = booking({ attachments: [INVOICE] });
    sinon.stub(BookingManager, "getBooking").resolves(storedBooking);
    sinon.stub(TenantManager, "getTenant").resolves({
      id: "tenant-1",
      cancellationRefundTiers: [{ daysBeforeStart: 0, refundPercentage: 50 }],
    });
    const pdf = stubIssuance().single;
    stubCancellationSideEffects();

    await BookingService.rejectBooking(
      "tenant-1",
      "booking-1",
      "Customer request",
      null,
      false,
      false,
      null,
      {
        origin: CANCELLATION_ORIGINS.ADMIN,
        refundPercentage: 25,
        cancelledByUserId: "admin-1",
        cancelledAt: Date.UTC(2026, 7, 20, 8),
      },
    );

    const attachment = cancellationAttachment(storedBooking);
    assert.strictEqual(attachment.name, "cancellation.pdf");
    assert.strictEqual(attachment.cancellationId, "2026-0012");
    assert.strictEqual(attachment.revision, 1);
    assert.strictEqual(attachment.timeCreated, Date.UTC(2026, 7, 20, 8));
    assert.strictEqual(attachment.cancellation.refundAmountEur, 25);
    assert.strictEqual(attachment.cancellation.cancellationFeeEur, 75);
    assert.strictEqual(attachment.cancellation.adminOverride, true);
    assert.strictEqual(storedBooking.cancellationRefund.refundAmountEur, 25);
    assert.strictEqual(storedBooking.cancellationRefund.adminOverride, true);
    assert.strictEqual(
      attachment.cancellation.originalDocumentRef.number,
      "INV-1-1",
    );
    assert.strictEqual(pdf.firstCall.args[2], "2026-0012-1");
    assert.strictEqual(pdf.firstCall.args[3], "INV-1-1");
    assert.strictEqual(
      pdf.firstCall.args[4].cancellationReason,
      "Customer request",
    );
  });

  it("stores cancellation refund audit on the booking when skipping the document", async function () {
    const storedBooking = booking();
    sinon.stub(BookingManager, "getBooking").resolves(storedBooking);
    sinon.stub(TenantManager, "getTenant").resolves({
      id: "tenant-1",
      cancellationRefundTiers: [{ daysBeforeStart: 0, refundPercentage: 50 }],
    });
    const pdf = stubIssuance().single;
    stubCancellationSideEffects();

    await BookingService.rejectBooking(
      "tenant-1",
      "booking-1",
      "Customer request",
      null,
      false,
      true,
      null,
      {
        origin: CANCELLATION_ORIGINS.ADMIN,
        cancelledAt: Date.UTC(2026, 7, 20, 8),
      },
    );

    assert.strictEqual(pdf.called, false);
    assert.strictEqual(IdGenerator.next.called, false);
    assert.strictEqual(storedBooking.attachments.length, 0);
    assert.strictEqual(storedBooking.cancellationRefund.refundAmountEur, 50);
    assert.strictEqual(storedBooking.cancellationRefund.originalAmountEur, 100);
  });

  it("returns a group preview with per-booking and aggregate amounts", async function () {
    const cancelledAt = Date.UTC(2026, 6, 15, 8);
    const groupBookings = [
      booking({
        id: "booking-1",
        priceEur: 10,
        timeBegin: cancelledAt + 30 * 86400000,
      }),
      booking({
        id: "booking-2",
        priceEur: 20,
        timeBegin: cancelledAt + 5 * 86400000,
      }),
    ];
    sinon.stub(TenantManager, "getTenant").resolves({
      id: "tenant-1",
      cancellationRefundTiers: [
        { daysBeforeStart: 20, refundPercentage: 100 },
        { daysBeforeStart: 0, refundPercentage: 50 },
      ],
    });
    sinon.stub(GroupBookingManager, "getGroupBooking").resolves({
      id: "group-1",
      bookingIds: groupBookings.map((entry) => entry.id),
    });
    sinon.stub(BookingManager, "getBookings").resolves(groupBookings);
    const clock = sinon.useFakeTimers({ now: cancelledAt, toFake: ["Date"] });

    const preview = await BookingService.getGroupCancellationRefundPreview(
      "tenant-1",
      "group-1",
    );

    clock.restore();

    // The preview lists bookings chronologically, not in bookingIds order.
    assert.deepStrictEqual(
      preview.bookings.map((entry) => entry.bookingId),
      ["booking-2", "booking-1"],
    );
    assert.deepStrictEqual(
      preview.bookings.map((entry) => entry.appliedRefundPercentage),
      [50, 100],
    );
    assert.deepStrictEqual(
      preview.bookings.map((entry) => entry.daysBeforeStart),
      [5, 30],
    );
    assert.strictEqual(preview.originalAmountEur, 30);
    assert.strictEqual(preview.refundAmountEur, 20);
    assert.strictEqual(preview.cancellationFeeEur, 10);
  });

  it("stores per-booking audit data for a group cancellation", async function () {
    const cancelledAt = Date.UTC(2026, 7, 1, 8);
    const bookings = [
      booking({
        id: "booking-1",
        timeBegin: cancelledAt + 30 * 86400000,
      }),
      booking({
        id: "booking-2",
        timeBegin: cancelledAt + 5 * 86400000,
      }),
    ];
    sinon.stub(TenantManager, "getTenant").resolves({
      id: "tenant-1",
      cancellationRefundTiers: [
        { daysBeforeStart: 20, refundPercentage: 100 },
        { daysBeforeStart: 0, refundPercentage: 50 },
      ],
    });
    sinon.stub(GroupBookingManager, "getGroupBooking").resolves({
      id: "group-1",
      bookingIds: bookings.map((entry) => entry.id),
      bookings,
      getTotalPrice: () => 200,
      areSomeBookingsPaid: () => true,
    });
    bookings[0].attachments = [{ ...INVOICE, invoiceId: "INV-GROUP" }];
    stubIssuance();
    stubCancellationSideEffects();

    const result = await BookingService.rejectGroupBooking(
      "tenant-1",
      "group-1",
      "Group cancellation",
      null,
      false,
      false,
      null,
      {
        origin: CANCELLATION_ORIGINS.ADMIN,
        refundPercentage: 25,
        cancelledByUserId: "admin-1",
        cancelledAt,
      },
    );

    assert.strictEqual(result.success, true);
    assert.deepStrictEqual(
      bookings.map(
        (entry) =>
          cancellationAttachment(entry).cancellation.appliedRefundPercentage,
      ),
      [25, 25],
    );
    assert.deepStrictEqual(
      bookings.map(
        (entry) =>
          cancellationAttachment(entry).cancellation.suggestedRefundPercentage,
      ),
      [100, 50],
    );
    assert.deepStrictEqual(
      bookings.map(
        (entry) => cancellationAttachment(entry).cancellation.bookingId,
      ),
      [undefined, undefined],
    );
    assert.deepStrictEqual(
      bookings.map((entry) => entry.cancellationRefund.appliedRefundPercentage),
      [25, 25],
    );
    assert.deepStrictEqual(
      bookings.map(
        (entry) => entry.cancellationRefund.suggestedRefundPercentage,
      ),
      [100, 50],
    );
    assert.strictEqual(
      cancellationAttachment(bookings[0]).cancellation.originalDocumentRef
        .number,
      "INV-GROUP-1",
    );
  });

  it("forwards bank details to aggregated group cancellation documents", async function () {
    const cancelledAt = Date.UTC(2026, 7, 1, 8);
    const bookings = [
      booking({
        id: "booking-1",
        timeBegin: cancelledAt + 30 * 86400000,
      }),
      booking({
        id: "booking-2",
        timeBegin: cancelledAt + 5 * 86400000,
      }),
    ];
    sinon.stub(TenantManager, "getTenant").resolves({
      id: "tenant-1",
      cancellationRefundTiers: [{ daysBeforeStart: 0, refundPercentage: 100 }],
    });
    sinon.stub(GroupBookingManager, "getGroupBooking").resolves({
      id: "group-1",
      bookingIds: bookings.map((entry) => entry.id),
      bookings,
      getTotalPrice: () => 200,
      areSomeBookingsPaid: () => true,
    });
    const pdf = stubIssuance().aggregated;
    stubCancellationSideEffects();

    const result = await BookingService.rejectGroupBooking(
      "tenant-1",
      "group-1",
      "Group cancellation",
      null,
      false,
      false,
      {
        accountHolder: " Max Mustermann ",
        bankName: " Musterbank ",
        iban: "de89 3704 0044 0532 0130 00",
        bic: " coba deff xxx ",
      },
      {
        origin: CANCELLATION_ORIGINS.ADMIN,
        refundPercentage: 100,
        cancelledByUserId: "admin-1",
        cancelledAt,
      },
    );

    assert.strictEqual(result.success, true);
    assert.deepStrictEqual(pdf.firstCall.args[4].bankDetails, {
      accountHolder: "Max Mustermann",
      bankName: "Musterbank",
      iban: "DE89370400440532013000",
      bic: "COBADEFFXXX",
    });
  });

  it("preserves price and bookable items when unrejecting a booking", async function () {
    const oldBooking = booking({
      isRejected: true,
      rejectionReason: "Changed plans",
      cancellationRefund: {
        cancelledAt: Date.UTC(2026, 6, 1, 8),
        daysBeforeStart: 10,
        originalAmountEur: 97.5,
        suggestedRefundPercentage: 50,
        appliedRefundPercentage: 25,
        refundAmountEur: 24.38,
        cancellationFeeEur: 73.12,
        appliedTierDays: 0,
        origin: "admin",
        adminOverride: true,
        cancelledByUserId: "admin-1",
      },
      priceEur: 97.5,
      vatIncludedEur: 10.5,
      paymentProvider: "invoice",
      bookableItems: [
        { bookableId: "room-1", amount: 1, userGrossPriceEur: 97.5 },
      ],
    });
    sinon.stub(BookingManager, "getBooking").resolves(oldBooking);
    const storeBooking = sinon
      .stub(BookingManager, "storeBooking")
      .callsFake(async (value) => value);
    sinon.stub(AccessService, "provisionForBooking").resolves([]);
    sinon.stub(BundleCheckoutService.prototype, "prepareBooking").resolves(
      new Booking({
        ...oldBooking,
        isRejected: false,
        rejectionReason: "",
        priceEur: 0,
        vatIncludedEur: 0,
        bookableItems: [],
      }),
    );

    await BookingService.updateBooking("tenant-1", {
      ...oldBooking,
      isRejected: false,
      rejectionReason: "",
    });

    const storedBooking = storeBooking.firstCall.args[0];
    assert.strictEqual(storedBooking.priceEur, 97.5);
    assert.strictEqual(storedBooking.vatIncludedEur, 10.5);
    assert.strictEqual(storedBooking.bookableItems.length, 1);
    assert.strictEqual(storedBooking.isRejected, false);
    assert.strictEqual(storedBooking.cancellationRefund, undefined);
    assert.deepStrictEqual(storeBooking.firstCall.args[2], {
      unset: ["cancellationRefund"],
    });
  });
});
