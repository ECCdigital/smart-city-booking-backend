# API Layer

## Structure

```
src/platform/
  api/
    controllers/          # Request handlers (one per resource)
    api-router-tenant-related.js
    routes/               # Route definitions
  authentication/
    authentication-router.js
```

## Controller pattern

Controllers are static-method classes:

```javascript
class BookingController {
  static async getBooking(req, res) {
    const { tenantId, bookingId } = req.params;
    // authenticate, authorize, delegate to service/manager, respond
  }
}
```

## Request flow

1. Router matches URL → controller method
2. The route's marker from `src/commons/services/authorization/` runs: `authorize(resource, action)` verifies the JWT and decides the reach (`any | own`) over the rights table (`table.js`), `public(resource?, action?)` decides for the anonymous too, `tokenAuthorized()` marks a route authorized by a secret the handler checks. The handler gets `req.reach` and `req.principal`.
3. Controller hands `scopeOf(req)` to the managers, which translate `own` into their query condition; a handler never branches over rights. (Routers not converted yet still check via `PermissionsService` / `RolePermission`; that goes with the last step of the authorize chain.)
4. Business logic in services (`src/commons/services/`)
5. Response via `api-response.js` helpers

## Tenant scoping

Most tenant routes include `:tenantId` in the path. Always:

- Validate the authenticated user has access to that tenant
- Pass `tenantId` to managers and services
- Never return data from other tenants

## API documentation

- OpenAPI specs: `src/docs/routes/*.yaml`
- Human-readable docs: `docs/api/`
- Update YAML when adding/changing endpoints

## Adding a new endpoint

1. Add controller method in `src/platform/api/controllers/`
2. Register route in the appropriate router file
3. Mark the route with `authorize`/`public`/`tokenAuthorized` and add the `(resource, action)` entry to the rights table if it is new
4. Add OpenAPI YAML in `src/docs/routes/`
5. Add tests in `tests/`

## Response format

Use utilities from `src/commons/utilities/api-response.js` — don't craft raw `res.status().json()` inconsistently.
