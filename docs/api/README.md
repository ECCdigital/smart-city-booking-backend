# API Reference

The backend offers public and protected API routes.

- **Public routes** — accessible without authentication (or with optional auth).
- **Protected routes** — require a valid JWT and appropriate permissions.

Routes are mounted as follows:

- `/api/...` — instance-level (`src/platform/api/api-router.js`)
- `/api/:tenant/...` — tenant-scoped (`src/platform/api/api-router-tenant-related.js`)
- `/api/v2/...` — checkout, coupons, booking status (v2 controllers)

Authentication details: [authentication.md](authentication.md)

## Tenants

Instance-level routes under `/api/tenants`.

### GET /api/tenants/public

Returns a public list of tenants. **No authentication required.**

### GET /api/tenants

Returns tenants visible to the authenticated user. **Requires JWT.**

### GET /api/tenants/:id

Returns a single tenant. **Requires JWT.**

### POST /api/tenants

Creates a new tenant. **Requires JWT.**

A tenant can only be created if one of the following conditions is met:

- `instance.allowAllUsersToCreateTenant` is `true`, or
- The user is included in `instance.allowedUsersToCreateTenant`, or
- The user is listed in `instance.ownerUserIds`.

### PUT /api/tenants

Creates or updates a tenant (upsert). **Requires JWT.** Same creation rules as `POST`.

### DELETE /api/tenants/:id

Deletes a tenant. **Requires JWT.**

A tenant can only be deleted if one of the following conditions is met:

- The user has a `Membership` with `owner: true` for that tenant, or
- The user is listed in `instance.ownerUserIds`.

## Roles

### GET /api/roles

Returns all roles (instance-level). **Requires JWT.**

### GET /api/:tenant/roles

Returns all roles for a tenant. **Requires JWT.**

### GET /api/:tenant/roles/tenant

Returns the current user's roles in the tenant. **Requires JWT.**

### GET /api/:tenant/roles/:id

Returns a single role. **Requires JWT.**

### PUT /api/:tenant/roles

Creates or updates a role in the tenant. **Requires JWT.**

_Required permissions:_ `role.allowCreate` / `role.allowUpdate`

> There is no `PUT /api/roles` at instance level. Role writes are always tenant-scoped.

### DELETE /api/:tenant/roles/:id

Deletes a role. **Requires JWT.**

## Bookables

Tenant-scoped routes under `/api/:tenant/bookables`.

### GET /api/:tenant/bookables/public

Returns public bookables for a tenant. Optional auth.

### GET /api/:tenant/bookables/public/:id

Returns a single public bookable. Optional auth.

### GET /api/:tenant/bookables

Returns all bookables (including non-public). **Requires JWT.**

### GET /api/:tenant/bookables/:id

Returns a single bookable. **Requires JWT.**

### PUT /api/:tenant/bookables

Creates or updates a bookable resource. **Requires JWT.**

_Required permissions:_ `bookable.allowCreate` / `bookable.allowUpdate`

### DELETE /api/:tenant/bookables/:id

Deletes a bookable resource. **Requires JWT.**

_Required permission:_ `bookable.allowDelete`

### GET /api/:tenant/bookables/:id/availability

Returns availability intervals for a bookable (V2 engine, shared `availability-rules`).

Optional auth. _Query parameters:_ `amount` (default: 1), `startDate`, `endDate` (ISO dates)

_Response headers:_ `X-Availability-Engine: v2`

_Response body:_ `{ title, availability: [{ timeBegin, timeEnd, available }], _metrics? }`

### GET /api/:tenant/bookables/:id/availability/v2

Alias for the primary `/availability` endpoint (same V2 engine). Optional auth.

### GET /api/:tenant/bookables/:id/availability/v1 _(deprecated)_

Legacy iterative checkout-based availability. Prefer `/availability`. Optional auth.

Response includes `Deprecation: true`, `Sunset`, and `Link` successor headers.

Compare both implementations locally:

```bash
npm run compare:availability -- -t <tenant> -b <bookable> -s 2026-06-01 -e 2026-06-07
```

### GET /api/:tenant/bookables/:id/block-periods

Returns block-period availability for a bookable. Optional auth.

### GET /api/:tenant/bookables/:id/openingHours

Returns opening hours for a bookable. No auth middleware.

### GET /api/:tenant/bookables/:id/prices

Returns price categories for a bookable. No auth middleware.

### GET /api/:tenant/bookables/:id/occupancy

Returns occupancy information for a bookable. No auth middleware (uses `user?.id` when present).

_Parameters:_

- **id** (path) — ID of the bookable resource
- **timeBegin** (query, optional) — Start time for the occupancy check (timestamp)
- **timeEnd** (query, optional) — End time for the occupancy check (timestamp)
- **ignoreRelatedEntities** (query, optional) — If `true`, related entities are ignored in the occupancy calculation (default: `false`)

_Response:_

- **bookableId** — ID of the bookable resource
- **title** — Title of the bookable resource
- **isAvailable** — Whether the bookable is available in the specified time range
- **totalCapacity** — Total capacity of the bookable
- **booked** — Number of booked units
- **remaining** — Number of remaining units

## Cancellation refunds

Tenant owners configure `cancellationRefundTiers` through the existing tenant create/update API. An empty array means a full refund.

### GET /api/:tenant/bookings/:id/cancellation-refund-preview

Returns the current policy proposal for an administrator. **Requires JWT and booking update permission.**

### GET /api/:tenant/bookings/:id/cancellation-refund-preview/public?name=

Returns a customer-safe refund preview for self-cancellation. **Requires matching booking owner name. No JWT.**

### GET /api/:tenant/bookings/:id/hooks/:hookId/cancellation-refund-preview

Returns a customer-safe refund preview for a pending REJECT verification hook. **No JWT.**

### POST /api/:tenant/bookings/:id/reject

Cancels or rejects a booking. Administrators may send an integer `refundPercentage` from 0 through 100. If omitted, the current policy proposal is used.

### GET /api/:tenant/group-bookings/:id/cancellation-refund-preview

Returns per-booking calculations and aggregate amounts for a group booking. **Requires JWT and booking update permission.**

### POST /api/:tenant/group-bookings/:id/reject

Cancels or rejects a group booking. Without an override, each booking uses its policy proposal; an optional `refundPercentage` applies to all bookings in the group. Optional `bankDetails` are rendered on the aggregated cancellation PDF when a refund document is generated.

Customer self-cancellations always use the current tenant policy when the verification link is released. Expected refund amounts are exposed via the public/hook preview endpoints and included in verify-rejection and booking-cancel mails. Rule-engine and workflow cancellations retain a full refund. Refunds are documented for manual processing; payment providers are not called automatically.

## Other categories

Endpoints for events, users, bookings, coupons, checkout, payments, calendars, catalog, workflows, access points, rules, and files follow the same pattern: mostly tenant-scoped paths under `/api/:tenant/...` with permission checks via roles and memberships.

Entity schemas are documented in [entities.md](../entities.md).
