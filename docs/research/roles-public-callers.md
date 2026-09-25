# Who calls `GET /api/roles?public=true` and `GET /api/:tenant/roles?public=true`

Research for `.scratch/authorization-architecture/issues/06-roles-public-cross-tenant.md`.
Backend at `develop` state of branch `fix/declined-principal` (package version 4.2.6, `package.json:3`);
Admin UI checkout on `version/4.3.x` (package version 4.2.9); Storefront on `version/1.2.x` (1.1.7);
web-integration and cloud-ui on `main`. All statements below come from source code, not docs.

## Answer

Nobody calls the instance route `GET /api/roles` with `?public=true`. The only two callers of the
instance route are the Admin UI's instance-owner views `Instances.vue` and `InstanceUsers.vue`, and
both call it without a public flag (`ApiRolesService.js:4-6`), so they only get data under the reach
`any` (instance owner). The tenant route `GET /api/:tenant/roles?public=true` is called by the Admin
UI only, from role pickers on bookables, tenant payment settings and the tenant overview, always for
the tenant the user currently works in. The Storefront never calls either route; it uses
`GET /api/:tenant/roles/tenant?public=true` (the `readMine` route) to compare role IDs for group
bookings, and never needs role names. web-integration and cloud-ui make no roles request at all.
Restricting the instance route's `own` reach so that `?public=true` yields only roles of the user's
own tenants (or nothing) breaks no known caller. Restricting the tenant route's public projection to
members of that tenant is safe for every caller found, provided the Admin UI's "current tenant" is one
the user is a member of (see Open points).

## Admin UI (`smart-city-booking-vue-app`, branch `version/4.3.x`)

Service layer, `src/services/api/ApiRolesService.js`:

| Line  | Method                                              | URL built                                          | public flag     |
| ----- | --------------------------------------------------- | -------------------------------------------------- | --------------- |
| 4-6   | `getRoles()`                                        | `api/roles` (instance route)                       | none            |
| 7-10  | `getTenantRoles(publicRoles=false)`                 | `api/<currentTenantId>/roles?public=<publicRoles>` | caller-supplied |
| 11-16 | `getUserRolesByTenant(tenantId, publicRoles=false)` | `api/<tenant>/roles/tenant?public=<publicRoles>`   | caller-supplied |

Call sites (all paths relative to `src/`):

| File:line                                                                            | Method / URL                                  | public               | Purpose                                                                                                                                                                                                                                    |
| ------------------------------------------------------------------------------------ | --------------------------------------------- | -------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `views/Management/Instances.vue:374`                                                 | `getRoles()` → `api/roles`                    | no                   | `availableRoles` for the instance's Keycloak/SSO `roleMapping` editor; the pickers filter by `r.tenantId` (`components/Instance/Edit/InstanceEditKeycloak.vue:191`, `InstanceEditSSO.vue:191`), i.e. they need roles of **all** tenants    |
| `views/Management/InstanceUsers.vue:441`                                             | `getRoles()` → `api/roles`                    | no                   | `api.roles` to render role names of instance-wide memberships (`:530`, `:159`) and to feed `UserEdit` (`:295`); needs roles of all tenants                                                                                                 |
| `components/commons/UserRoleSelector.vue:121`                                        | `getTenantRoles(true)`                        | yes                  | Generic role/user picker; mounted by `BookableEditPermissions.vue:176` (`permittedRoles`) and `TenantEditPayments.vue:486` (invoice `permittedRoles`)                                                                                      |
| `components/Bookable/Edit/BookableEditPermissions.vue:90`                            | `getTenantRoles(true)`                        | yes                  | `availableRoles` for `permittedRoles` / `groupBooking.permittedRoles` of a bookable                                                                                                                                                        |
| `components/Tenant/TenantOverview.vue:376`                                           | `getTenantRoles(true)`                        | yes                  | `this.roles` on the tenant overview                                                                                                                                                                                                        |
| `components/Tenant/Edit/TenantEditWorkflow.vue:97`                                   | `getTenantRoles()`                            | no                   | `availableRoles` for workflow recipients                                                                                                                                                                                                   |
| `components/Tenant/TenantEditWorkflowStatusDialog.vue:287`                           | `getTenantRoles()`                            | no                   | same as above                                                                                                                                                                                                                              |
| `views/Management/Roles.vue:188`                                                     | `getTenantRoles()`                            | no                   | Role management list (needs full roles)                                                                                                                                                                                                    |
| `views/Management/TenantUsers.vue:791`                                               | `getTenantRoles(this.tenantId)`               | `?public=<tenantId>` | Tenant user management: role names/options (`:68`, `:374`, `:393`, `:975`). The tenant ID lands in the `publicRoles` slot, so the backend sees `public !== "true"` (`role-controller.js:19-20`) and answers `[]` unless the reach is `any` |
| `router/middlewares/groupBooking.js:21`, `views/BundleCheckout/CheckoutMain.vue:694` | `getUserRolesByTenant(...)` → `/roles/tenant` | –                    | Own roles for group-booking gate; not the routes in question                                                                                                                                                                               |

The two instance-route views are reachable only for instance owners in practice: the instance they
edit is `instance.read/update: { any: "instanceOwner" }` (`table.js:259-260`) and the memberships
`InstanceUsers.vue:450` loads are `membership.read: { any: "instanceOwner" }` (`table.js:286`).

History: the `?public=` parameter appeared in the Admin UI in commit `92306ae` (2025-05-16,
"added mor validation, series options"), the same day as the backend counterpart `7fe7c77c`.

## Storefront (`smart-city-booking-store-front`, branch `version/1.2.x`)

| File:line                                            | URL                                                                                                             | public | Purpose                                                                                                                             |
| ---------------------------------------------------- | --------------------------------------------------------------------------------------------------------------- | ------ | ----------------------------------------------------------------------------------------------------------------------------------- |
| `server/api/tenants/[tenantID]/user-roles.get.js:23` | backend `/api/<tenantID>/roles/tenant?public=<flag>` (default `true`, `:19`); 401/403 mapped to `[]` (`:29-31`) | yes    | Nuxt server proxy                                                                                                                   |
| `app/composables/api/useTenants.js:41-45`            | Nuxt `/api/tenants/<tenantID>/user-roles?public=true`                                                           | yes    | `fetchTenantUserRoles`                                                                                                              |
| `app/pages/checkout/[bookableID].vue:932`            | via `fetchTenantUserRoles(tenantID, { publicRoles: true })`                                                     | yes    | `canCreateGroupBooking` (`:944-950`) intersects the user's role IDs with `groupBooking.permittedRoles` of the bookable (`:902-907`) |

No hit on `/roles` (list) or `/roles?public` in the Storefront. Role names are never displayed:
`normalizeRoleIdentifier` (`[bookableID].vue:878`) reduces everything to an ID string and the only
comparison is by ID (`:948-949`). The Storefront only needs the caller's own roles in the tenant,
which the `readMine` route (`api-router-tenant-related.js:556-560`, `role.readMine: { own: "signedIn" }`,
`table.js:151`) delivers by membership (`role-controller.js:59-67`).

## web-integration and cloud-ui (both `main`)

- `smart-city-booking-web-integration`: no hits for `/roles`, `public=true`, `getRoles`, `permittedRoles`.
- `smart-city-booking-cloud-ui`: no roles request. `useApiClient.ts:47-49` returns `mockRoles` for
  `roles.list(tenantId)` (comment: "Heute Mock; später echtes REST gegen role-/user-controller"). The
  `permittedRoles` hits are bookable fixtures and pickers fed by those mocks
  (`BerechtigungSectionEditor.vue:14`, `SerienSectionEditor.vue:14`, `pages/buchungsobjekte/[id].vue:219-238`).

## Backend behaviour today

- Routes: `router.get("/roles", authorize("role", "list"), RoleController.getRoles)` on the instance
  router (`src/platform/api/api-router.js:263`, mounted at `/api`, `src/server.js:140`) and on the
  tenant router (`src/platform/api/api-router-tenant-related.js:555`, mounted at `/api/:tenant`,
  `src/server.js:146`). Same handler, same table entry
  `role.list: { own: "signedIn", any: "manageRoles.readAny" }` (`src/commons/services/authorization/table.js:147`).
- Reach: `authorize` calls `decide(principal, ...)` and stores `req.reach`
  (`src/commons/services/authorization/middleware.js:144-149`). `satisfies` grants `any` to the instance
  owner or to a principal with `grants.manageRoles.readAny` in the tenant, and `own` to any signed-in
  user (`policy.js:79-101`). A principal without a tenant has empty `grants` (`principal.js:34-36`,
  `:71-89`), so on the instance route only the instance owner reaches `any`.
- Handler order (`src/platform/api/controllers/role-controller.js:15-47`): without `:tenant` it loads
  `RoleManager.getRoles()` = every role of every tenant (`:27`, `role-manager.js:14-17`); with
  `:tenant` only that tenant's roles (`:25`, `role-manager.js:24-27`). Then, **before** the reach is
  consulted, `?public=true` maps to `role.toPublic()` (`:33-34`); otherwise `any` gets the full
  roles and `own` gets `[]` (`:35-39`). `toPublic()` is `{ id, name, tenantId }`
  (`src/commons/entities/role/role.js:32-38`).
- Net effect: any signed-in user, member of nothing, gets `{ id, name, tenantId }` of all roles of
  all tenants via `GET /api/roles?public=true`, and of one tenant via `GET /api/<tenant>/roles?public=true`.
- Tests: `tests/role-controller.test.js:51-62` ("should return all roles for public view") and
  `:91-103` ("answers the public projection under the reach own") pin the current behaviour; `:105-114`
  pins `[]` under `own` without the flag.
- History: `toPublic()` and the public branch arrived in `7fe7c77c` (2025-05-16, "added mor validation,
  series options") together with `/roles/tenant` and the `permittedRoles` check in the checkout
  controller; the commit body carries no rationale. `84e4cf5f` (2026-09-03) replaced the per-role
  `PermissionService._allowRead` loop by the reach but kept the projection-before-reach order.
- Server-side, `SsoService.mapRoles` uses `RoleManager.getRoles()` directly
  (`src/commons/services/sso/sso-service.js:138`), not the HTTP route, so it is unaffected by any route change.
- Docs: the OpenAPI YAML under `src/docs/routes/` has no roles path; only `docs/api/README.md:103-127`
  lists the endpoints and does not mention `public`.

## Consequences for the proposed fix

1. **Instance route, restrict the public projection under `own` to the user's own tenants or to
   nothing:** safe. Both callers (`Instances.vue:374`, `InstanceUsers.vue:441`) send no `public`
   parameter and are instance-owner screens, so they keep the `any` path. Removing the `?public`
   handling from the instance route altogether is equally safe for every caller found.
2. **Tenant route, keep `?public=true` for members:** required. `UserRoleSelector.vue:121`,
   `BookableEditPermissions.vue:90` and `TenantOverview.vue:376` rely on the projection, and a tenant
   member with `manageBookables` but without `manageRoles.readAny` needs it to pick `permittedRoles`.
3. **Tenant route, refuse or empty the projection for non-members:** breaks no caller found. Every
   tenant-route caller uses `store.getters["tenants/currentTenantId"]` (`ApiRolesService.js:8`), the
   tenant the user is working in. Whether that is always a member tenant is runtime state (Open points).
4. **Order "reach first, then projection":** matches the callers. No caller expects the projection
   under a refused reach.
5. The Storefront is untouched by any change to the two `list` routes.

## Open points

- `TenantUsers.vue:791` passes the tenant ID where `getTenantRoles` expects the boolean, so a tenant
  admin without `manageRoles.readAny` already receives `[]` there today (`role-controller.js:19-20`,
  `:37-38`). Either a latent Admin UI bug or evidence that the view is only opened with `any`; not
  decidable from the code.
- Whether the Admin UI's `currentTenantId` (persisted in localStorage, `store/modules/tenants.js:7-8`,
  `:29-33`) can point to a tenant the user is no longer a member of (e.g. after a declination)
  depends on runtime state; if it can, a membership-restricted tenant route turns a populated role
  picker into an empty one (or a 403) on those screens.
- No caller for `?public=true` on the instance route was found in the four checkouts; external API
  consumers or older Admin UI branches were not examined.
