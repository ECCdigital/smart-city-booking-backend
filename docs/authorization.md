# Authorization: how to apply it

How to protect a route, extend the rights table and read records within a reach. For developers who add or change endpoints. The terms are the glossary's (section "Rechte" in [`GLOSSARY.md`](../GLOSSARY.md)); the German term follows the English one on first use. The decisions behind the model are in the ADRs [0001](adr/0001-reach-has-one-meaning.md) to [0004](adr/0004-membership-picture.md).

Everything lives in `src/commons/services/authorization/` and is exported from its `index.js`:

| Piece                        | File            | What it is                                                                              |
| ---------------------------- | --------------- | --------------------------------------------------------------------------------------- |
| Principal (Prinzipal)        | `principal.js`  | Who asks: user, tenant, owner flags, merged role levels. Loaded once per request.       |
| Rights table (Rechtetabelle) | `table.js`      | Data: per resource and action, the least level that gets each reach. Plus `OWNER_KEY`.  |
| Policy                       | `policy.js`     | `decide(principal, resource, action)`: the widest reach, or `null`. Pure.               |
| Reach (Reichweite)           | `reach.js`      | `ownCondition`, `DOMAIN`, `PUBLIC`: how a manager turns a reach into a query condition. |
| Markers (Berechtigung)       | `middleware.js` | `authorize`, `public`, `tokenAuthorized`, `scopeOf`, `reachesOf`: the Express adapter.  |

## 1. The model in one minute

A request is decided **once**, at the router, by the route's marker. The marker looks up the entry `(resource, action)` in the rights table, asks which reach the principal gets, and hands that reach to the handler as `req.reach`. The handler passes it on as a value; the manager turns it into a query condition. Nobody in between asks about rights again.

The **reaches**, widest first:

| Reach    | Meaning                                                                                 | Who assigns it                                            |
| -------- | --------------------------------------------------------------------------------------- | --------------------------------------------------------- |
| `any`    | Every record of the tenant (or of the instance).                                        | Marker                                                    |
| `own`    | Only the principal's own records, over the resource's owner key (Eigentümer-Schlüssel). | Marker                                                    |
| `self`   | The principal themselves, no records at all (own profile, own invitation, own roles).   | Marker                                                    |
| `public` | Only what anyone sees, anonymous included: the public projection of the offers.         | Marker on a public route                                  |
| `domain` | The domain itself reads, without a principal (payment, receipts, jobs).                 | Never a router. Code inside `src/commons` names `DOMAIN`. |

The **levels** a table entry may name, with the fixed precedence `instanceOwner ⊇ tenantOwner ⊇ role ⊇ tenantMember ⊇ signedIn`:

| Level             | Satisfied by                                                                                |
| ----------------- | ------------------------------------------------------------------------------------------- |
| `signedIn`        | Any signed-in user.                                                                         |
| `tenantMember`    | A member of the tenant (Mitglied): active membership, with or without a role.               |
| `<group>.<step>`  | A role level, e.g. `manageBookings.readAny`. Groups and steps come from the role catalogue. |
| `tenantOwner`     | The owner of the tenant.                                                                    |
| `instanceOwner`   | The owner of the instance. Satisfies every level.                                           |
| `mayCreateTenant` | The instance setting that lets a user open a tenant. Follows the setting alone.             |

An instance owner satisfies everything. A tenant owner satisfies every level in their tenant except `instanceOwner` and `mayCreateTenant`. A membership in a **declined** tenant rests (Ruhende Mitgliedschaft): the principal is no member, no owner and holds no role there, so every decision meets the declination without a check of its own.

The role catalogue (`src/commons/entities/role/role-catalogue.js`) names six groups (`manageUsers`, `manageBookables`, `manageBookings`, `manageCoupons`, `manageMedia`, `manageRoles`) and seven steps (`create`, `readAny`, `readOwn`, `updateAny`, `updateOwn`, `deleteAny`, `deleteOwn`). Actions beyond those seven (`operate`, `reviewSubmit`, `qr`, …) are **entries of the table**, never new steps.

## 2. Marking a route

Every route under `src/platform` carries exactly **one** of three markers. A route without one fails `tests/authorization-invariants.test.js` and names itself.

### `authorize(resource, action)`: signed in, decided

```javascript
const { authorize } = require("../../commons/services/authorization");

router.get(
  "/coupons",
  authorize("coupon", "read"),
  CouponController.getCoupons,
);
router.post(
  "/coupons",
  authorize("coupon", "create"),
  CouponController.createCoupon,
);
```

- Anonymous: `401`.
- No reach for this principal: `403`. A principal whose membership rests gets `403 tenant_declined` with the tenant's supervision.
- Otherwise the handler gets `req.reach` (`any | own | self`) and `req.principal`.
- The entry must not be `public: true`. That is a start-up error, not a request error: use `public()` for it.

The principal is loaded in the tenant `:tenant` of the path. A route that carries its tenant elsewhere says where:

```javascript
router.put(
  "/tenants",
  authorize("tenant", "update", {
    tenantOf: (req) => req.body?.id,
    also: ["create", "media.read"],
  }),
  TenantController.storeTenant,
);
```

### `public(resource, action)`: decided for anonymous too, never refuses

```javascript
const { publicRoute } = require("../../commons/services/authorization");

router.get(
  "/bookables",
  publicRoute("bookable", "readPublic"),
  BookableController.getBookables,
);
router.get(
  "/coupons/:id",
  publicRoute("coupon", "lookup"),
  CouponController.getCoupon,
);
```

- The entry must have `public: true`. Otherwise a start-up error: use `authorize()`.
- The handler gets `req.reach` as `public | self | own | any`: the widest the principal has. Staff of the tenant get `any` at `bookable.readPublic`, the public gets `public`, and the same manager call answers both correctly (section 4).
- `publicRoute()` without arguments is a plainly public route: `req.reach` is `public`, no table entry involved.

`public` is a reserved word in strict mode. The module exports the marker as `public` and as `publicRoute`; destructuring callers need the second name.

### `tokenAuthorized()`: a secret in URL or body

```javascript
router.post(
  "/bookings/:id/request-reject",
  tokenAuthorized(),
  BookingController.requestRejectBooking,
);
```

Declares that the handler checks a secret itself (hooks, webhooks). The marker decides nothing.

### A second question: `also`

A route with two questions names both on its marker and reads the second answer off `req.reaches`. The main action alone refuses; the others may be `null`.

```javascript
// Saving a bookable also needs the right to pick media for it.
router.post(
  "/bookables",
  authorize("bookable", "create", { also: ["media.read"] }),
  BookableController.createBookable,
);

// Removing a tenant user may hit an owner: a second entry of the same resource.
router.post(
  "/tenants/:tenant/remove-user",
  authorize("tenantUser", "manage", { also: ["owner"] }),
  TenantController.removeUser,
);
```

`"owner"` is an action of the same resource; `"media.read"` is `resource.action` of another. Both are checked when the router loads. In the handler, `req.reaches.owner` is `any` or `null`. The media routes bundle all their answers with `reachesOf(req)` and hand them to the media rights (`services/media/media-rights.js`), which picks the rule from the facts of the medium.

## 3. Adding an entry to the rights table

`TABLE` in `table.js` is data. An entry names, per reach slot, the **least** level that gets it. A missing slot means "nobody".

```javascript
// A resource with the seven CRUD entries of a role group:
coupon: {
  ...crud("manageCoupons"),          // read/create/update/delete over the group's levels
  lookup: { public: true },           // an action beyond CRUD: a named entry
},

// Written out, `crud("manageCoupons")` is:
read:   { public: false, own: "manageCoupons.readOwn",   any: "manageCoupons.readAny" },
create: {                                                  any: "manageCoupons.create" },
update: {                own: "manageCoupons.updateOwn", any: "manageCoupons.updateAny" },
delete: {                own: "manageCoupons.deleteOwn", any: "manageCoupons.deleteAny" },
```

Other shapes you will meet:

```javascript
// Public delivery with a management view: everyone gets the public projection,
// staff of the tenant get the records whole (ADR 0003).
readPublic: { public: true, any: "manageBookables.readAny" },

// A customer's own booking, staff's every booking:
booking: { read: { own: "signedIn", any: "manageBookings.readAny" } },

// "Myself": the own roles, no records. `self` and `own` never share an entry.
role: { readMine: { self: "signedIn" } },

// Members of the tenant, whoever else:
role: { list: { own: "tenantMember", any: "manageRoles.readAny" } },

// Owner-only, instance-owner-only, the tenant-creation setting:
tenant: { update: { any: "tenantOwner" }, supervise: { any: "instanceOwner" }, create: { any: "mayCreateTenant" } },
```

### Every `own` needs an owner key

`own` has one meaning: a query condition over the field that names the record's owner (ADR 0001). `OWNER_KEY` in `table.js` names that field per resource, beside the table, so the table stays levels alone:

```javascript
const OWNER_KEY = {
  coupon: { key: "ownerUserId" },
  booking: { key: "assignedUserId" },
  bookable: {
    key: "ownerUserId",
    byAction: {
      // The related bookings of a bookable are the *booking's* own:
      relatedBookings: { key: "assignedUserId" },
    },
  },
  // Instance level: "own" is a tenant set of the principal (section 5).
  tenant: { tenantsOf: "ownership" },
};
```

`assertTable()` in `policy.js` runs when the module loads and fails the start on: an unknown slot, an unknown level, an `own` without an owner key, an owner key for an entry without `own`, `own` and `self` in one entry. A typo in a route's `(resource, action)` fails the start too, because the marker asks `entryOf` when the router loads.

### Checklist for a new endpoint

1. Add the entry to `TABLE`. If it has `own`, add or reuse the resource's `OWNER_KEY`.
2. Mark the route with `authorize` or `public` naming that entry (or `tokenAuthorized`).
3. In the handler, hand `scopeOf(req)` to the managers. Do not read `req.reach`.
4. In the manager, spread `ownCondition(resource, scope)` into the query (section 4).
5. Run the tests. The rights matrix (`tests/authorization-rights-matrix.test.js`) and the route snapshot (`tests/snapshots/authorization/routes.json`) tell you what changed for whom.

## 4. Reading records with a reach

### The handler hands the scope on

```javascript
const { scopeOf } = require("../../../commons/services/authorization");

static async getCoupons(request, response) {
  const tenant = request.params.tenant;
  const coupons = await CouponManager.getCoupons(tenant, scopeOf(request));
  response.status(200).send(coupons);
}
```

`scopeOf(req)` is `{ reach, userId, tenantIds? }`: the reach, the principal's user id, and on the instance level the tenant set `own` means there. The handler never looks inside it.

### The manager turns the reach into a condition

```javascript
const { ownCondition, REACH } = require("../services/authorization");

// The coupon list: `own` is the coupons the user created, `public` an empty
// condition (the handler shapes the public's view of coupons).
const condition = (scope) =>
  scope?.reach === REACH.PUBLIC ? {} : ownCondition("coupon", scope);

static async getCoupons(tenantId, scope) {
  const docs = await CouponModel.find({ tenantId, ...condition(scope) });
  return docs.map((doc) => doc.toEntity());
}
```

`ownCondition(resource, scope)` answers:

| `scope.reach`    | Condition                                                                                       |
| ---------------- | ----------------------------------------------------------------------------------------------- |
| `any`, `domain`  | `{}`: nothing added.                                                                            |
| `own`            | `{ [OWNER_KEY[resource].key]: userId }`, or on the instance level `{ id: { $in: tenantIds } }`. |
| `self`, `public` | **Throws.** Neither is a condition on records.                                                  |
| missing          | **Throws** (ADR 0002). A manager never reads without a reach.                                   |

The manager names its **resource**, not its field: `ownCondition("booking", scope)` looks the key up in `OWNER_KEY`, so the table and the manager cannot disagree about what "own" means.

A manager of the offers (bookables, events) that is asked as `public` applies the public projection instead (ADR 0003, `services/supervision/public-projection.js`): `listed` for a list method, `reached` for one that names an id. A handler that reads through such a manager with `scopeOf(req)` inherits the projection without a line of its own.

### The domain reads under `DOMAIN`

Code inside `src/commons` that reads for itself, not for a route (payment, receipts, jobs, the dependent records of something already in reach), names the reach it reads under:

```javascript
const { DOMAIN } = require("../authorization/reach");

const [tenant, booking] = await Promise.all([
  TenantManager.getTenant(tenantId, DOMAIN),
  BookingManager.getBooking(bookingId, tenantId, DOMAIN),
]);
```

`DOMAIN` never occurs under `src/platform`; a test holds that. The reach applies to the resource of the route. Once that resource is within reach, its dependents (the bookings of an event, the event of a bookable) are read by the domain, not filtered again by a second owner key.

### Narrower than the right: `PUBLIC`

A handler may ask narrower than its right, never wider. The anonymized booking list `?public=true` reads as the public whoever asks:

```javascript
const { PUBLIC } = require("../../../commons/services/authorization");

const bookings = await BookingManager.getTenantBookings(tenant, PUBLIC);
```

### A record already in hand: `withinReach`, `readsRecords`

Rarely, an adapter loads a record before it knows which reach applies (a medium that turns out to be a booking document). `withinReach(record, key, scope)` asks the same question about the record in hand; `readsRecords(scope)` asks whether a reach reaches records at all (`any`, `own`, `domain` do; `self`, `public` do not). Both belong to a short named list in `tests/authorization-handler-decisions.test.js`. A new call elsewhere fails that test.

## 5. Worked example: one route, seven principals

`GET /api/:tenant/coupons`, marked `authorize("coupon", "read")`, entry `{ own: "manageCoupons.readOwn", any: "manageCoupons.readAny" }`, owner key `ownerUserId`:

| Principal in tenant A                                | Reach | Sees                                                 |
| ---------------------------------------------------- | ----- | ---------------------------------------------------- |
| Anonymous                                            | –     | `401`                                                |
| Signed in, no membership in A                        | –     | `403`                                                |
| Member of A without a role                           | –     | `403`                                                |
| Member with `manageCoupons.readOwn`                  | `own` | Coupons whose `ownerUserId` is theirs                |
| Member with `manageCoupons.readAny`                  | `any` | Every coupon of A                                    |
| Owner of A, no role                                  | `any` | Every coupon of A                                    |
| Instance owner                                       | `any` | Every coupon of A                                    |
| Member with `readAny` whose tenant A is **declined** | –     | `403 tenant_declined`                                |
| Owner of tenant B                                    | –     | `403` (a member of A is nobody in B, and vice versa) |

`GET /api/:tenant/bookables`, marked `publicRoute("bookable", "readPublic")`, entry `{ public: true, any: "manageBookables.readAny" }`:

| Principal in tenant A                                | Reach    | Sees                                                                                                                                         |
| ---------------------------------------------------- | -------- | -------------------------------------------------------------------------------------------------------------------------------------------- |
| Anonymous                                            | `public` | The public projection: listed, approved offers of a released tenant                                                                          |
| Member without a role                                | `public` | The same. Signing in does not widen a public entry.                                                                                          |
| Member with `manageBookables.readOwn`                | `public` | The same. The entry has no `own` slot (ADR 0003).                                                                                            |
| Member with `manageBookables.readAny`, owner, admin  | `any`    | Every bookable of A, review status included                                                                                                  |
| Anyone with `public`, tenant A **pending**           | `public` | `404 tenant_not_found`: a tenant without a public projection has nothing to show. Staff keep `any`: nothing rests while approval is pending. |
| Anyone but the instance owner, tenant A **declined** | `public` | `404 tenant_not_found`. The membership of staff and owner rests, so they are the public here too. The instance owner keeps `any`.            |

A record outside the reach does not exist for that user (`404`). A missing reach on the route is a refusal (`403`). What someone may **do** with an own record (cancel a booking, but not rebook it) is not a reach; that is the lifecycle's business.

## 6. The instance level

On routes without a tenant (`/api/tenants`, `/api/instance/...`, the instance dashboard) the principal has no membership, so `own` cannot be a field of the record. There it means a **tenant set** of the principal, named by the owner key:

```javascript
tenant: { tenantsOf: "ownership" },                            // the tenants the user owns
role: { tenantsOf: "membership" },                             // the tenants the user belongs to
instanceDashboard: { tenantsOf: "reach", entry: "dashboard.read" }, // the tenants the user reads a dashboard in
```

`scopeOf(req)` then carries `tenantIds`, and `ownCondition` answers `{ id: { $in: tenantIds } }`. A manager never asks for memberships again.

An instance route that asks a tenant route's question **per tenant** (which tenants may this user operate bookings in?) takes `anyReachIn(userId, resource, action)`, an async predicate that loads once, and hands it to the service. The adapter asks; the service never does:

```javascript
// The access bookings of a person: in which tenants do they manage bookings?
const bookings = await AccessService.getUserBookingsWithAccess(targetUserId, {
  canManageIn: anyReachIn(targetUserId, "booking", "operate"),
});
```

## 7. What a handler does not do any more

These are the mistakes the model removes. Each is held by a test.

- **Branch over rights.** No `if (req.reach === "own")`, no `if (principal.isTenantOwner)`. The reach is a value handed on. If you need two different answers, give the route two entries (`also`) or give the table a second slot. Remaining branches are a named list in `tests/authorization-handler-decisions.test.js`.
- **Ask the table or the policy again.** `decide(...)` and `entryOf(...)` are the marker's. A handler that needs a second decision names it on the marker (`also`).
- **Read without a reach.** A manager call without a scope throws (ADR 0002). Inside the domain, say `DOMAIN`. Inside a handler, say `scopeOf(req)`. Do not pass `{}` or `undefined` to get "everything".
- **Build a gate in front of a public route.** There are no gate middlewares. Staff get their management view of a public delivery from an entry with `any`; an entry without `any` asks everyone as the public (ADR 0003).
- **Filter dependents a second time.** Once the event is within reach, its bookings are the domain's to read. Do not apply the booking's owner key to them.
- **Widen the reach.** A handler may read narrower than its right (`PUBLIC`), never wider than what the marker decided.
- **Add a role step.** `operate`, `reviewSubmit`, `qr` are table entries. The seven steps of the role catalogue stay seven.
- **Assign `domain` from a router.** `scopeOf` and `reachesOf` never answer it; `DOMAIN` under `src/platform` fails the invariants test.

## 8. Tests that hold the model

| Test                                                                         | Holds                                                                                                                                                                       |
| ---------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `tests/authorization-invariants.test.js`                                     | Every route under `src/platform` carries exactly one marker; `DOMAIN` stays out of the platform.                                                                            |
| `tests/authorization-rights-matrix.test.js`                                  | What seven kinds of principal get on the core routes, written from the glossary, not derived from the table.                                                                |
| `tests/authorization-routes-characterization.test.js`                        | Every route under `src/platform` called with five principals, the status codes pinned in `tests/snapshots/authorization/routes.json`. A changed entry shows up in the diff. |
| `tests/authorization-handler-decisions.test.js`                              | The named lists of the branches a handler may still make. A new one elsewhere fails.                                                                                        |
| `tests/authorization-policy.test.js`, `-reach.test.js`, `-principal.test.js` | The pure pieces: `decide`, `ownCondition`, the principal from the membership picture.                                                                                       |

Tests of the rights stub the membership picture (`UserManager.getMembershipPicture`), never the sign-in answer (ADR 0004). The lifecycle harness (`tests/helpers/booking-lifecycle-harness.js`) and the route world (`tests/helpers/route-world.js`) know the seven principals of the matrix: anonymous, customer, reader (the `own` levels alone), staff (every level), owner, admin, foreign owner.
