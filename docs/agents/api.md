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
    const { tenant, id } = req.params;
    // authenticate, authorize, delegate to service/manager, respond
  }
}
```

## Request flow

1. Router matches URL → controller method
2. The route's marker from `src/commons/services/authorization/` runs: `authorize(resource, action)` verifies the JWT and decides the reach (`any | own`) over the rights table (`table.js`), `public(resource?, action?)` decides for the anonymous too, `tokenAuthorized()` marks a route authorized by a secret the handler checks. The handler gets `req.reach` and `req.principal`. The principal is loaded in the tenant `:tenant` of the route - a route about one tenant names it so, on the instance router too (`/api/tenants/:tenant/...`); a route that carries its tenant elsewhere passes `{ tenantOf: (req) => ... }` (`PUT /api/tenants` reads it from the body).
3. Controller hands `scopeOf(req)` to the managers, which translate `own` into their query condition; a handler never branches over rights. Two adapter-level exceptions (authorize spec §5, §12): the obsolete PUT store routes decide the creation with `decide(req.principal, resource, "create")`, and the booking lists with an anonymized `?public=true` projection answer the reach `public` themselves. Every route under `src/platform` carries exactly one marker - `tests/authorization-invariants.test.js` fails on one that does not - and `PermissionService` is gone: nothing in the domain asks about rights, it takes the reach as a value.
4. Business logic in services (`src/commons/services/`)
5. Response via `api-response.js` helpers

## Tenant scoping

A route about one tenant names it `:tenant` in the path; the authorization loads the principal in that tenant. Always:

- Let the route's marker decide the reach in that tenant
- Pass `req.params.tenant` to managers and services
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
