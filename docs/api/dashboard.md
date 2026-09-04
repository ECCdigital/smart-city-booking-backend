# Admin Dashboard KPI API

Protected Admin Dashboard endpoints (JWT required). No storefront access.

Auth: instance owner (all tenants), tenant owner, or role flag `manageBookings.readAny`.

## GET /api/v2/dashboard/summary

Cross-tenant Instance Summary for allowed tenants. Always returns full `byTenant[]`.

Query: `from`, `to`, `bookableId`, `status` (multi: repeated and/or comma-separated; OR), `granularity` (`day` | `week` | `month` | `year`), `isBookable` (object stock only). Missing `from`/`to` = all time for time-scoped KPIs.

Response always echoes `status` (`string[] | null`) and `granularity` (`null` when omitted), and includes `byPeriod` (empty when `granularity` is null). Root `byPeriod` only — not inside `byTenant[]`.

## GET /api/v2/:tenant/dashboard/summary

Tenant Summary with `byStatus` (all five keys), `byPeriod`, and activity-only `byBookable` (default limit 100, max 500 via `byBookableLimit`).

Same filters as instance, plus `byBookableLimit`.

## Metric notes

- Bookings / status: `timeCreated` (bookings include rejected); multi-`status` OR filters booking-side KPIs only
- Cancellations: `isRejected`, time via `cancellationRefund.cancelledAt` (fallback `timeCreated`); zero when status filter omits rejected
- Revenue: `isPayed && !isRejected`, time via `timePaid`; `status` does not constrain revenue (totals or `byPeriod`). `revenueEur` is invoice (`priceEur` / user gross). `regularRevenueEur` is catalog/full gross (`bookableItems.regularGrossPriceEur × amount`) as if no user/role discounts or coupons applied; never below `revenueEur` (legacy bookings without a snapshot use `priceEur`).
- Stock KPIs (tenants/users/objects/`events`) ignore time and status; instance `users` = user docs, tenant `users` = active memberships
- `activeEvents`: now-snapshot via `isEventBookable`; ignores `from`/`to`; undated events count as active
- `byPeriod`: Europe/Berlin keys (`YYYY-MM-DD`, `YYYY-Www`, `YYYY-MM`, `YYYY`); zero-filled over effective range; max 366 buckets else 400. Replaces `revenueByMonth`.

OpenAPI: `src/docs/routes/dashboard.yaml`.
