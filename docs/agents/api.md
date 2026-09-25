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
2. The route's marker from `src/commons/services/authorization/` runs: `authorize(resource, action)` verifies the JWT and decides the reach (`any | own | self`) over the rights table (`table.js`), `public(resource?, action?)` decides for the anonymous too, `tokenAuthorized()` marks a route authorized by a secret the handler checks. The handler gets `req.reach` and `req.principal`. The principal is loaded in the tenant `:tenant` of the route - a route about one tenant names it so, on the instance router too (`/api/tenants/:tenant/...`); a route that carries its tenant elsewhere passes `{ tenantOf: (req) => ... }` (`PUT /api/tenants` reads it from the body). A declined tenant needs no gate of its own: the membership in it rests in the principal (glossary „Ruhende Mitgliedschaft“), and `authorize` names the declination when it refuses. A route of the instance that asks a tenant route's question per tenant takes `anyReachIn(userId, resource, action)` and hands the answer to the service, never the service asking.
3. Controller hands `scopeOf(req)` to the managers, which translate `own` into their query condition over the owner key the table names for the resource the manager reads (`ownCondition("booking", scope)`, `OWNER_KEY` in `table.js`); a manager never reads without a reach (a missing one throws, ADR 0002), the domain reads under `DOMAIN` (never under `src/platform`), and under `public` the managers of the offers apply the public projection (ADR 0003, `services/supervision/public-projection.js`: `listed` for a list method, `reached` for one that names an id, `404 tenant_not_found` for a tenant without a public projection) - a handler never projects itself; a handler that asks narrower than its right (the anonymized booking list `?public=true`, the public calendar without `includePrivate`) reads as `PUBLIC`, the public's view, whoever asks. On the instance level the scope carries the tenant set `own` means there (`tenantIds`, from the principal's tenants). A handler never branches over rights: the few that still do (the roles list, the refusal of a booking list without `?public=true` and of `?includePrivate` without a reach) are a named list in `tests/authorization-handler-decisions.test.js`. A service that reads for a route takes the route's scope; the reach applies to the resource of the route, and its dependent records (the bookings of an event, the event of a bookable) the domain reads. A route with a second question names it on its marker, `authorize(resource, "update", { also: ["create"] })`, and reads the answer off `req.reaches.create` (the obsolete PUT store routes, the user removal that may hit an owner, the tenant catalog that may be the instance's); the booking lists with an anonymized `?public=true` projection answer the reach `public` themselves. `publicRoute(resource, action, { also })` names second questions the same way, never refusing. The media routes name every question on the marker (`authorize("media", "metadata", { also: ["read", "bookingDocument"] })`, `publicRoute("media", "file", { also: ["bookingDocument", "intern"] })`) and hand `reachesOf(req)` - the decided reaches by action, plus `userId` - to one verb of the media rights (`services/media/media-rights.js`: `readable`, `updatable`, `deletable`, `fileReadable`, `legacyFileReadable`), which loads the medium, picks the rule it follows and throws: `401` anonymous, `404 media_not_found` out of reach, `403` for a rule of the facts. The savers of media references name the picker right on their marker too (`authorize("bookable", "update", { also: ["create", "media.read"] })`, on the instance `["instanceMedia.read"]`) and hand `reachesOf(req)` to the reference guard (`services/media/media-reference-guard.js`), which asks `referenceable` of the media rights per medium; a handler never asks the table a second time (`scopeFor` is gone, `tests/authorization-handler-decisions.test.js` holds it). The Hero's media are checked for their facts alone (`services/hero-layout/hero-media.js`), the right to save a Hero is the route's. There are no gate middlewares on the public paths: staff get their management view of a public delivery from an entry with `any` (`bookable.readPublic`, `bookable.prices`, `calendar.all`, the tags and counters), and an entry without `any` (`html`, `json`, `checkout`, `ical.feed`) asks everyone as the public (ADR 0003). Every route under `src/platform` carries exactly one marker - `tests/authorization-invariants.test.js` fails on one that does not - and `PermissionService` is gone: nothing in the domain asks about rights, it takes the reach as a value.
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
