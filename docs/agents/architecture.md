# Architecture

## Ecosystem

This repository is the backend API. Related frontend repositories:

| Component  | Repository                                                   |
| ---------- | ------------------------------------------------------------ |
| Admin UI   | https://github.com/ECCdigital/smart-city-booking-vue-app     |
| Storefront | https://github.com/ECCdigital/smart-city-booking-store-front |

Both frontends consume this API. Changes to endpoints, auth, or response shapes may need updates in those repos.

## Stack

- **Runtime:** Node.js 20+ (22 LTS recommended)
- **Framework:** Express 4
- **Database:** MongoDB 6+ via Mongoose 8
- **Auth:** JWT (access + refresh tokens), Passport strategies
- **Templates:** Handlebars (mail), HTML (PDF via microinvoice/playwright)

## Directory layout

```
src/
  server.js              # Entry point
  commons/               # Shared business logic
    entities/            # Domain objects (booking, tenant, user, …)
    data-managers/       # DB access layer (managers + mongoose models)
    schemas/             # JSON Schema validation
    services/            # Business services (checkout, payment, mail, …)
    availability/        # Availability rules & calendar logic
    mail-service/        # Email templates & sending
    pdf-service/         # Receipt/invoice PDF generation
    utilities/           # Helpers (auth, formatters, id generation)
  platform/              # HTTP layer
    api/                 # REST controllers & routers
    authentication/      # Auth routes
    exporters/           # CSV export
    html-engine/         # HTML rendering routes
  rule-engine/           # JSON-logic rule evaluation
  middleware/            # Express middleware (auth, …)
  errors/                # Custom error classes
migrations/              # DB migration runner + scripts
tests/                   # Mocha tests
```

## Multi-tenancy

```
Instance (global deployment config)
  └── Tenant (organization: city, department)
        ├── Membership (user ↔ tenant link with roles)
        ├── Bookable (bookable resource)
        ├── Booking (reservation)
        ├── Event, Coupon, Catalog, Workflow, …
        └── Role (permissions per tenant)
```

- Almost every entity carries a `tenantId`
- Controllers resolve tenant context from route params or auth
- Cross-tenant data access is a security bug

## Key patterns

| Layer      | Pattern                   | Example                                              |
| ---------- | ------------------------- | ---------------------------------------------------- |
| Entity     | Plain JS class with hooks | `src/commons/entities/booking/booking.js`            |
| Manager    | DB CRUD + queries         | `src/commons/data-managers/booking-manager.js`       |
| Service    | Business logic            | `src/commons/services/checkout/booking-service.js`   |
| Controller | HTTP request/response     | `src/platform/api/controllers/booking-controller.js` |

Controllers should stay thin — delegate to services and managers.

## External integrations

- **Payment:** GiroCockpit, PM Payment (provider pattern in `src/commons/services/payment/`)
- **File storage:** Nextcloud/WebDAV (`docs/nextcloud.md`)
- **Lockers:** IFBS, Pareva (adapters in `src/commons/services/access/providers/`, clients in `src/commons/services/access/clients/`; the checkout runs through `AccessService`, only the `/locker` configuration routes still use `src/commons/services/locker/` until the locker fold's migration)
- **SSO:** Keycloak, Azure MSAL

## Version lines

| Branch        | Version     | Notes               |
| ------------- | ----------- | ------------------- |
| `develop`     | v4.x dev    | Active development  |
| `version/4.x` | v4.x stable | Production releases |
| `version/3.x` | v3.x LTS    | Maintenance only    |

Work on `develop` unless told otherwise.
