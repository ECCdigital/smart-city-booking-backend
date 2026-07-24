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

## When to write a migration

- Renaming/moving fields on existing documents
- Backfilling new required fields
- Restructuring embedded documents
- Data cleanup after a schema change

## When NOT to write a migration

- New collections that start empty (schema handles it)
- Changes only affecting new documents with defaults
- Dev-only seed data
