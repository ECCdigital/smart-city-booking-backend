# Cutover guide: tenant supervision

How to take an existing installation to the release that carries the tenant
supervision (glossary „Mandanten-Aufsicht“, spec §11). What the data migration
does is described in the
[upgrade notes](migrations/tenant-supervision-upgrade.md); this guide is the
procedure around it.

The rule of the whole cutover: **traffic opens only after the migration and
the acceptance have succeeded, and no version that ignores supervision levels
or review decisions is ever opened again.**

## What the backend guarantees

- **One migration runner.** `runMigrations` holds a lock in MongoDB (one
  document `_id: "migrations"` in the collection `migrationlocks`, with
  `owner` and an `expiresAt` lease the holder renews while it runs). Processes
  that start in parallel migrate once: the others wait, then read the recorded
  migrations under their own lock and find nothing left to do. A lease nobody
  renews any more (the runner died) is taken over after it ran out. A process
  that still finds the lock held after the wait timeout fails with
  `MigrationLockTimeoutError` and runs nothing.
- **Readiness is the gate.** `GET /healthz/ready` answers
  `503 { "status": "unavailable", "details": { "migrations": "pending" } }`
  until the migrations have succeeded in the process asked, and
  `"migrations": "failed"` for good when they failed; after success the
  existing checks (MongoDB ping, rule engine) apply. `GET /healthz/live` is
  unchanged. The HTTP server still listens before the migrations run - the
  liveness probe has to answer during a long or waiting run - so the load
  balancer / orchestrator **must route by `/healthz/ready`**. A setup that
  routes to every listening process is not protected.
- **The migration is repeatable.** A rerun, whole or after an abort, resets
  and doubles nothing.

## Configuration introduced by the feature

All optional, defaults in `.env-example`.

| Variable                                                             | Default       | Meaning                                                                                                             |
| -------------------------------------------------------------------- | ------------- | ------------------------------------------------------------------------------------------------------------------- |
| `MIGRATION_LOCK_LEASE_MS`                                            | `60000`       | Lease of the migration lock; renewed every third of it. After a crashed runner the next one waits at most this long |
| `MIGRATION_LOCK_POLL_MS`                                             | `2000`        | How often a waiting runner asks for the lock                                                                        |
| `MIGRATION_LOCK_WAIT_TIMEOUT_MS`                                     | `600000`      | How long a runner waits before it fails (readiness stays `503`)                                                     |
| `RATE_LIMIT_SIGNUP_PER_IP` / `_WINDOW_SECONDS`                       | `10` / `3600` | Public signups per client IP                                                                                        |
| `RATE_LIMIT_VERIFICATION_MAIL_PER_ACCOUNT_SHORT` / `_WINDOW_SECONDS` | `1` / `60`    | Verification mails per account, short window                                                                        |
| `RATE_LIMIT_VERIFICATION_MAIL_PER_ACCOUNT_LONG` / `_WINDOW_SECONDS`  | `5` / `3600`  | Verification mails per account, long window                                                                         |
| `RATE_LIMIT_VERIFICATION_MAIL_PER_IP` / `_WINDOW_SECONDS`            | `30` / `3600` | Verification mails per client IP                                                                                    |
| `RATE_LIMIT_TENANT_SELF_CREATION_PER_USER` / `_WINDOW_SECONDS`       | `3` / `86400` | Successful tenant self-creations per user                                                                           |

The lock compares the lease with the clock of the process that asks: keep the
servers' clocks in sync (NTP). The rate limits need the client IP, so the
reverse proxy has to hand on `X-Forwarded-For`.

## Procedure

### 1. Prepare

- Back up the database.
- Note the stock the migration has to leave alone, for the comparison in
  step 4 (in `mongosh`):

  ```javascript
  db.bookables.countDocuments({ isPublic: true });
  db.bookables.countDocuments({ isBookable: true });
  db.events.countDocuments({ isPublic: true });
  db.tenants.countDocuments({ "catalogParticipation.visible": true });
  db.bookings.countDocuments();
  db.bookables.countDocuments({ "review.status": "approved" });
  db.events.countDocuments({ "review.status": "approved" });
  ```

- Have the three matching releases at hand: this backend, the
  [Admin UI](https://github.com/ECCdigital/smart-city-booking-vue-app) and the
  [Storefront](https://github.com/ECCdigital/smart-city-booking-store-front)
  versions built for the supervision (direct links, the checkout reason
  `checkout.offer_not_reachable`, the `409`-free registration, the contact
  fields of the tenant creation - see `docs/CHANGELOG.md`).
- Check that the load balancer / orchestrator probes `/healthz/ready`.
- Announce a short maintenance window.

### 2. Close traffic and stop the old writers

- Take the public entrances (Storefront, Admin UI, API) into maintenance.
- Stop **every** old backend process, workers and cron-like side processes
  included. An old server must not write while or after the migration runs: it
  knows neither levels nor reviews and would store offers without them.

### 3. Run the migration once, controlled

- Start **one** process of the new backend with traffic still closed. It seeds,
  takes the lock and runs the pending migrations, among them
  `21-09-2026-tenant-supervision-initial-state`.
- Watch the log for `All migrations completed`, and the probe:

  ```bash
  curl -s -o /dev/null -w "%{http_code}\n" http://<backend>/healthz/ready   # 503 → 200
  ```

- Further processes may be started right away; they wait for the lock and run
  nothing twice. Starting them after the first one is ready keeps the log
  easier to read.

### 4. Verify the data

In `mongosh`, on the application database:

```javascript
// The migration is recorded; the lock is gone once no process is starting
// (a process that starts holds it for a moment).
db.migrations.find({ name: "21-09-2026-tenant-supervision-initial-state" });
db.migrationlocks.find();

// Every instance has an initial level, every tenant a level. Expected: 0 and 0.
db.instances.countDocuments({
  tenantInitialSupervisionLevel: { $nin: ["free", "supervised", "blocked"] },
});
db.tenants.countDocuments({
  supervisionLevel: { $nin: ["free", "supervised", "blocked"] },
});

// No public offer is left without a review status (`null` matches a missing
// field too). Expected: 0 and 0.
db.bookables.countDocuments({ isPublic: true, "review.status": null });
db.events.countDocuments({ isPublic: true, "review.status": null });

// Nothing was approved and the stock stands: the seven counts noted in
// step 1 (publication wish, bookability, catalog participation, bookings,
// approvals) answer the same numbers.

// The initial state is in the history, once per subject, and no mail waits.
db.supervisionhistories.aggregate([
  { $match: { origin: "migration" } },
  { $group: { _id: "$eventType", rows: { $sum: 1 } } },
]);
db.supervisionhistories.aggregate([
  { $match: { origin: "migration" } },
  { $group: { _id: "$dedupeKey", rows: { $sum: 1 } } },
  { $match: { rows: { $gt: 1 } } },
]); // empty
db.supervisionnotifications.countDocuments(); // unchanged by the migration
```

The console output of the migration names documents it had to skip (an offer
without `id` or `tenantId`, a tenant without `id`). Such a document got no
supervision state. The runner does not run a recorded migration again, so
repair the document and set its state by hand, following the rules of the
upgrade notes.

### 5. Deploy the matching frontends and discard the caches

Deploy the Admin UI and Storefront releases that belong to this backend, then
throw away what was delivered before:

- **Storefront server cache.** The bundle handlers of the Storefront cache the
  catalog/tenant bundles with a `swr` of 300 s. Restart the Storefront (or
  clear its cache storage) so that no bundle from before the cutover is
  revalidated into the new version; otherwise allow for at least 300 s after
  the restart before acceptance.
- **Reverse proxy / CDN.** Purge the cached API answers, bundles and HTML
  pages of both frontends.
- **Browser.** The new frontend builds carry new asset hashes; make sure
  `index.html` is not cached beyond the deployment (purge it at the CDN).
  A form that was open before the cutover cannot book what is no longer
  reachable: every checkout entrance checks the current state on the server.

### 6. Acceptance, with traffic still closed

Against the internal address of the new stack:

- `GET /healthz/ready` is `200` on every backend process.
- A stock tenant is `free`: its public list, a direct link to an unlisted
  offer, prices, availability and a test booking work as before.
- Set a test tenant to `supervised`: an unapproved offer disappears from list
  and direct link, and its checkout is refused
  (`checkout.offer_not_reachable`); after approval it is back - listed with
  the publication wish, and by direct link and bookable without it.
- Set a test tenant to `blocked`: it leaves `GET /api/tenants/public`, its
  public paths answer `404`, a new booking is refused; the status page of an
  existing booking still answers, and the tenant's owner still reaches the
  administration.
- The Admin UI shows the supervision level, the review queue and the history;
  the Storefront shows the refusal of an unreachable offer.

The automated counterpart of these checks is
`tests/supervision-acceptance-matrix.test.js` (spec §5.1 for bookables and
events over list, detail, prices, availability, checkout v1/v2 and group); it
runs with `npm test` on the release that is deployed.

### 7. Open traffic

Only now end the maintenance. Because the balancer routes by
`/healthz/ready`, a process that starts later (scale-out, restart) takes
traffic only after its own migration check has succeeded.

## When something fails

- **Keep traffic closed.** A failed migration leaves `/healthz/ready` at `503`
  (`"migrations": "failed"`); the error is in the log
  (`Error during application initialization steps`). Do not route around the
  probe.
- **Never reopen an old version.** A version from before the supervision
  ignores blocks and review decisions that are already stored: it would list
  and book what has been blocked or withdrawn, and write offers without a
  review. This holds from the moment the first new process has taken traffic
  or a level/decision has been set.
- **Fix forward.** Correct the cause (data, configuration, a patched release
  of the _new_ line) and start a process again: the recorded migrations are
  skipped, the supervision migration resumes where it stopped and neither
  resets nor doubles anything. A database restore is an option only while
  traffic was never opened on the new version - and then the old version may
  run again only against that restored state.
- **The lock after a crash.** A runner that died leaves its lock behind until
  the lease runs out (`MIGRATION_LOCK_LEASE_MS`, 60 s by default); the next
  runner takes it over by itself. Remove the document by hand
  (`db.migrationlocks.deleteOne({ _id: "migrations" })`) only when it is
  certain that no runner is alive.
- **`MigrationLockTimeoutError`.** Another runner held the lock for longer
  than `MIGRATION_LOCK_WAIT_TIMEOUT_MS`. Check that runner (its `owner` is
  `<host>:<pid>:<uuid>`); once it has finished or is gone, restart the process
  that timed out.
