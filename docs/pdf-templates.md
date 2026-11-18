# PDF Templates

Tenant PDF templates use Handlebars. Cancellation templates receive the existing booking, item, total, address, and document-number values plus the following refund fields:

- `cancellationDate` — exact cancellation date and time
- `daysBeforeStart` / `daysBeforeStartLabel` — calendar days before the booking starts
- `suggestedRefundPercentage` — tenant-policy proposal
- `refundPercentage` — applied percentage
- `refundAmount` — formatted refund amount
- `cancellationFee` — formatted retained amount
- `calculationMode` — policy/admin/system explanation
- `adminOverride` — whether an administrator changed the proposal
- `isFullRefund` / `hasCancellationFee` — template conditions
- `refundCalculations` — per-booking values for group cancellations

Custom cancellation templates are not rewritten automatically. Tenants using a custom `cancellationTemplate` must update wording that promises a full refund or complete invoice reversal before enabling partial refunds.

## Withdrawal receipt („Widerrufbeleg“)

`withdrawalTemplate` replaces the default `default-withdrawal-receipt.temp.html`; `withdrawalNumberPrefix` prefixes the number (`WB` where empty). A withdrawal costs nothing, so the template has no fee or tier values. It receives the booking, item, total and address values plus:

- `title` — „Widerrufbeleg“
- `withdrawalNumber` — the full document number
- `bookingId` — the withdrawn booking
- `withdrawalDate` — date and time the withdrawal was accepted
- `hasOriginalDocument` — whether the booking had an invoice or receipt; then `originalInvoiceNumber` and `originalInvoiceDate`
- `alreadyPaid` — whether the booking was paid: the amount is refunded in full, otherwise the invoiced amount lapses
- `refundAmount` / `totalAmount` — formatted amount credited (`totalAmount` negative)
- `mainContent` — the credited positions as a table
