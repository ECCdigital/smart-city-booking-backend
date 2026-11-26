const assert = require("assert");

// Registers the partial `cancellationSettlement` and the mail helpers.
require("../src/commons/mail-service/mail-service");
const { MailType } = require("../src/commons/mail-service/mail-types");
const {
  renderSnippet,
} = require("../src/commons/mail-service/templates/template-loader");

/** The cancellation mail's data for one booking with this refund. */
function cancelData(cancellationRefund) {
  return MailType.BOOKING_CANCEL.templateData(
    { reason: "Verhindert" },
    { bookings: [{ id: "B-1", cancellationRefund }] },
  );
}

function refund(overrides) {
  return {
    cancelledFrom: "confirmed",
    originalAmountEur: 40,
    refundAmountEur: 30,
    cancellationFeeEur: 10,
    suggestedRefundPercentage: 75,
    hoursBeforeStart: 290,
    ...overrides,
  };
}

/** The text of both wrappers, the tenant's own text standing first. */
function texts(data) {
  return ["single-booking-wrapper", "aggregated-booking-wrapper"].map(
    (wrapper) =>
      renderSnippet(wrapper, {
        message: "<p>Eigener Text des Mandanten</p>",
        bookingDetails: "<p>Buchungsdetails</p>",
        cancellationSettlement: data.cancellationSettlement,
      })
        .replace(/<[^>]+>/g, " ")
        .replace(/&nbsp;/g, " ")
        .replace(/\s+/g, " ")
        .trim(),
  );
}

/**
 * The money of a cancellation stands fixed below the booking details of the
 * cancellation mail: a stored text of the tenant used to leave it out.
 */
describe("the cancellation mail's settlement block", function () {
  it("tells a paid booker what comes back, below the booking details", function () {
    for (const text of texts(cancelData(refund()))) {
      assert.match(text, /Buchungsdetails Status Bereits bezahlt : 40,00\s€/);
      assert.match(text, /Erstattung: 30,00\s€ \(75 %\)/);
      assert.match(text, /Einbehaltener Betrag: 10,00\s€/);
      assert.match(text, /Sie bekommen 30,00\s€ zurück\.$/);
    }
  });

  it("says a paid booker gets nothing back where nothing is refunded", function () {
    const data = cancelData(
      refund({
        refundAmountEur: 0,
        cancellationFeeEur: 40,
        suggestedRefundPercentage: 0,
      }),
    );
    for (const text of texts(data)) {
      assert.match(text, /Sie bekommen nichts zurück\.$/);
    }
  });

  it("tells an unpaid booker what is still due", function () {
    const data = cancelData(refund({ cancelledFrom: "payment_due" }));
    for (const text of texts(data)) {
      assert.match(text, /Buchungsdetails Status Noch nicht bezahlt/);
      assert.match(text, /Entfallener Betrag: 30,00\s€ von 40,00\s€ \(75 %\)/);
      assert.match(text, /Noch ausstehend: 10,00\s€/);
      assert.match(text, /Ein Betrag von 10,00\s€ ist noch zu zahlen\.$/);
      assert.doesNotMatch(text, /Erstattung|zurück/);
    }
  });

  it("says an unpaid booker owes nothing where everything drops away", function () {
    const data = cancelData(
      refund({
        cancelledFrom: "payment_due",
        refundAmountEur: 40,
        cancellationFeeEur: 0,
        suggestedRefundPercentage: 100,
      }),
    );
    for (const text of texts(data)) {
      assert.match(text, /Es fallen für Sie keine Kosten an\.$/);
      assert.doesNotMatch(text, /Noch ausstehend/);
    }
  });

  it("leaves the block out of a free booking and one without a refund", function () {
    assert.strictEqual(
      cancelData(refund({ originalAmountEur: 0 })).cancellationSettlement,
      null,
    );
    assert.strictEqual(cancelData(undefined).cancellationSettlement, null);
    for (const text of texts({ cancellationSettlement: null })) {
      assert.strictEqual(text, "Eigener Text des Mandanten Buchungsdetails");
    }
  });
});
