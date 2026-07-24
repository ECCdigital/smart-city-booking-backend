# Coding Standards

## Language

All project artifacts must be in **English**:

- Source code (identifiers, string literals meant for developers/logs)
- Comments and JSDoc
- Commit messages and PR titles/descriptions
- Changelog entries (`docs/CHANGELOG.md`)
- Test names and descriptions

User-facing copy (emails, PDFs, UI strings) may stay in the project's configured locale — do not translate those unless explicitly asked.

## DRY (Don't Repeat Yourself)

Avoid duplication, but don't over-abstract:

- **Reuse first** — check `src/commons/utilities/`, existing services, and managers before writing new helpers
- **Extract on repetition** — when the same logic appears in 2+ places, move it to a shared function/service
- **Single source of truth** — constants, validation rules, and permission checks should live in one place
- **No copy-paste blocks** — if you're about to duplicate a controller/service block, refactor or call the existing code
- **Pragmatic abstractions** — don't create helpers for one-off logic or a single call site; inline is fine there

```javascript
// ❌ BAD — duplicated tenant lookup in multiple controllers
const tenant = await TenantManager.findById(tenantId);
if (!tenant) throw new NotFoundError("Tenant not found");

// ✅ GOOD — reuse existing method or extract a shared helper once it's needed in multiple places
const tenant = await TenantManager.requireById(tenantId);
```

## Module system

CommonJS throughout:

```javascript
const BookingManager = require("../data-managers/booking-manager");
const { BadRequestError } = require("../../errors/BaseError");

module.exports = { BookingService };
```

## Formatting

- Prettier handles formatting (no semicolons policy follows existing files — check nearby code)
- Run `npm run format:write` only on files you changed
- ESLint config: `eslint.config.js` (flat config, Prettier integration)

## Naming

| Kind | Convention | Example |
|------|------------|---------|
| Files | kebab-case | `booking-controller.js` |
| Classes | PascalCase | `BookingController` |
| Functions/methods | camelCase | `resolveCheckoutId` |
| Constants | UPPER_SNAKE or PascalCase enum | `BOOKING_HOOK_TYPES` |
| Mongoose models | PascalCase singular | `Booking`, `Tenant` |

## Error handling

Use typed errors from `src/errors/`:

```javascript
const { BadRequestError, NotFoundError } = require("../errors/BaseError");

if (!bookable) {
  throw new NotFoundError("Bookable not found");
}
```

Controllers and middleware map these to HTTP status codes via `src/commons/utilities/api-response.js`.

## Logging

```javascript
const bunyan = require("bunyan");

const logger = bunyan.createLogger({
  name: "my-service.js",
  level: process.env.LOG_LEVEL,
});

logger.info({ tenantId, bookingId }, "Booking created");
```

## Data access

- Use **managers** (`src/commons/data-managers/`) for DB operations — don't query Mongoose models directly from controllers
- Use `.lean()` for read-only queries when you don't need Mongoose document methods
- Prefer existing manager methods before writing new queries

## Validation

- JSON Schema definitions in `src/commons/schemas/`
- Validate input at controller or service boundary
- Domain validation (availability, permissions) belongs in services

## Comments

- JSDoc on public controller methods and complex service functions
- No comments that restate obvious code
- Explain non-obvious business rules (e.g. availability edge cases, tenant scoping)

## What to avoid

- Adding TypeScript (project is plain JS)
- Large abstractions for one-off use
- Changing unrelated files in the same PR
- Hardcoded secrets or environment-specific URLs
- `console.log` in production code (use bunyan)
