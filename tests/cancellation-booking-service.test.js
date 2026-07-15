const assert = require("assert");
const sinon = require("sinon");
const BookingService = require("../src/commons/services/checkout/booking-service");
const BookingManager = require("../src/commons/data-managers/booking-manager");
const GroupBookingManager = require("../src/commons/data-managers/group-booking-manager");
const TenantManager = require("../src/commons/data-managers/tenant-manager");
const CancellationService = require("../src/commons/services/payment/cancellation-service");
const WorkflowService = require("../src/commons/services/workflow/workflow-service");
const LockerService = require("../src/commons/services/locker/locker-service");
const MailController = require("../src/commons/mail-service/mail-controller");
const {
  CANCELLATION_ORIGINS,
} = require("../src/commons/services/payment/cancellation-refund-service");

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

function stubCancellationSideEffects() {
  sinon.stub(BookingManager, "storeBooking").callsFake(async (value) => value);
  sinon.stub(WorkflowService, "handleWorkflowEvent").resolves();
  sinon.stub(LockerService, "getInstance").returns({
    handleCancel: sinon.stub().resolves(),
  });
  sinon.stub(MailController, "sendBookingCancel").resolves();
  sinon.stub(MailController, "sendBookingRejection").resolves();
}

describe("BookingService cancellation refunds", function () {
  afterEach(function () {
    sinon.restore();
  });

  it("stores the admin refund calculation on a single cancellation", async function () {
    const storedBooking = booking();
    sinon.stub(BookingManager, "getBooking").resolves(storedBooking);
    sinon.stub(TenantManager, "getTenant").resolves({
      id: "tenant-1",
      cancellationRefundTiers: [{ daysBeforeStart: 0, refundPercentage: 50 }],
    });
    const createCancellation = sinon
      .stub(CancellationService, "createSingleCancellation")
      .resolves({
        cancellation: { name: "cancellation.pdf", buffer: Buffer.from("pdf") },
        name: "cancellation.pdf",
        cancellationId: "12",
        revision: 1,
        timeCreated: Date.UTC(2026, 7, 20, 8),
        originalInvoiceNumber: "INV-1-1",
        originalInvoiceDate: Date.UTC(2026, 6, 1, 8),
      });
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

    const attachment = storedBooking.attachments[0];
    assert.strictEqual(attachment.name, "cancellation.pdf");
    assert.strictEqual(attachment.cancellation.refundAmountEur, 25);
    assert.strictEqual(attachment.cancellation.cancellationFeeEur, 75);
    assert.strictEqual(attachment.cancellation.adminOverride, true);
    assert.strictEqual(
      attachment.cancellation.originalDocumentRef.number,
      "INV-1-1",
    );
    assert.strictEqual(
      createCancellation.firstCall.args[0].options.cancellationReason,
      "Customer request",
    );
  });

  it("returns a group preview with per-booking and aggregate amounts", async function () {
    sinon.stub(TenantManager, "getTenant").resolves({
      id: "tenant-1",
      cancellationRefundTiers: [
        { daysBeforeStart: 20, refundPercentage: 100 },
        { daysBeforeStart: 0, refundPercentage: 50 },
      ],
    });
    sinon.stub(GroupBookingManager, "getGroupBooking").resolves({
      id: "group-1",
      bookings: [
        booking({
          id: "booking-1",
          priceEur: 10,
          timeBegin: Date.now() + 30 * 86400000,
        }),
        booking({
          id: "booking-2",
          priceEur: 20,
          timeBegin: Date.now() + 5 * 86400000,
        }),
      ],
    });

    const preview = await BookingService.getGroupCancellationRefundPreview(
      "tenant-1",
      "group-1",
    );

    assert.deepStrictEqual(
      preview.bookings.map((entry) => entry.appliedRefundPercentage),
      [100, 50],
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
    sinon.stub(CancellationService, "createAggregatedCancellation").resolves({
      cancellation: {
        name: "group-cancellation.pdf",
        buffer: Buffer.from("pdf"),
      },
      name: "group-cancellation.pdf",
      cancellationId: "13",
      revision: 1,
      timeCreated: cancelledAt,
      originalInvoiceNumber: "INV-GROUP-1",
      originalInvoiceDate: Date.UTC(2026, 6, 1, 8),
    });
    stubCancellationSideEffects();

    const result = await BookingService.rejectGroupBooking(
      "tenant-1",
      "group-1",
      "Group cancellation",
      null,
      false,
      false,
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
        (entry) => entry.attachments[0].cancellation.appliedRefundPercentage,
      ),
      [25, 25],
    );
    assert.deepStrictEqual(
      bookings.map(
        (entry) => entry.attachments[0].cancellation.suggestedRefundPercentage,
      ),
      [100, 50],
    );
    assert.strictEqual(
      bookings[0].attachments[0].cancellation.originalDocumentRef.number,
      "INV-GROUP-1",
    );
  });
});
