# Migrations

## Location

```
migrations/
  migrationsManager.js    # Runner
  scripts/                # Individual migration files
    04-02-2025-create-roles.js
    …
```

## Migration file format

```javascript
module.exports = {
  name: "04-02-2025-create-roles",

  up: async function (mongoose) {
    const User = mongoose.model("User");
    // migration logic
  },

  down: async function (mongoose) {
    // rollback logic (if feasible)
  },
};
```

## Naming

- File: `DD-MM-YYYY-short-description.js`
- `name` field matches filename without extension

## Rules

- Migrations run once — tracked by `migrationsManager.js`
- Use existing Mongoose models via `mongoose.model("ModelName")`
- Prefer batch operations over per-document loops for large datasets
- Make migrations **idempotent** where possible (check before insert)
- Test on a copy of production data when changes are destructive
- Document breaking schema changes in `docs/CHANGELOG.md`

## Lock and readiness

- `runMigrations` holds a Mongo-backed lock (`migrations/lib/migration-lock.js`: one document `_id: "migrations"` in `migrationlocks`, owner + `expiresAt` lease, heartbeat, released in `finally`). A second runner waits, then reads the recorded migrations under its own lock, so nothing runs twice; it throws `MigrationLockTimeoutError` when the lock is still held after `MIGRATION_LOCK_WAIT_TIMEOUT_MS`
- A migration that runs longer than the lease is fine (the heartbeat renews it); one that blocks the event loop for longer than `MIGRATION_LOCK_LEASE_MS` is not — keep long loops asynchronous
- `/healthz/ready` answers `503 { details: { migrations: "pending" | "failed" } }` until `runMigrations` has succeeded in this process (`src/commons/utilities/migration-state.js`), so a failing migration keeps the instance out of traffic
- Tests pass fakes through the second argument: `runMigrations(connection, { migrations, migrationModel, lockModel, … })` — see `tests/migration-lock.test.js`

## When to write a migration

- Renaming/moving fields on existing documents
- Backfilling new required fields
- Restructuring embedded documents
- Data cleanup after a schema change

## When NOT to write a migration

- New collections that start empty (schema handles it)
- Changes only affecting new documents with defaults
- Dev-only seed data
