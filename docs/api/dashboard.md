# Admin Dashboard KPI API

Protected Admin Dashboard endpoints (JWT required). No storefront access.

Auth: instance owner (all tenants), tenant owner, or role flag `manageBookings.readAny`.

## GET /api/v2/dashboard/summary

Cross-tenant summary for allowed tenants. Always returns full `byTenant[]`.

Query: `from`, `to`, `bookableId`, `status`, `isBookable` (object stock only). Missing `from`/`to` = all time for time-scoped KPIs.

## GET /api/v2/:tenant/dashboard/summary

Tenant detail with `byStatus`, `revenueByMonth` (UTC, zero-filled from tenant creation), and activity-only `byBookable` (default limit 100, max 500 via `byBookableLimit`).

Same filters as instance, plus `byBookableLimit`.

## Metric notes

- Bookings / status: `timeCreated` (bookings include rejected)
- Cancellations: `isRejected`, time via `cancellationRefund.cancelledAt` (fallback `timeCreated`)
- Revenue: `isPayed && !isRejected`, sum `priceEur` on `timePaid`; `status` filter does not constrain revenue
- Stock KPIs (tenants/users/objects/events) ignore time and status; instance `users` = user docs, tenant `users` = active memberships

OpenAPI: `src/docs/routes/dashboard.yaml`.
