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
