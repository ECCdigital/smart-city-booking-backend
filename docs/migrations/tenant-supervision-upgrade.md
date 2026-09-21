# Upgrade notes: tenant supervision

What an operator needs to know about the data migration that comes with the
tenant supervision (glossary „Mandanten-Aufsicht“, spec §11).

## The migration `21-09-2026-tenant-supervision-initial-state`

Runs once through the migration runner and gives the stock its initial state:

- an instance without `tenantInitialSupervisionLevel` gets `free`;
- a tenant without `supervisionLevel` gets `free` (`supervisionChangedAt`
  stays empty) and one history row `tenant.levelInitialized`;
- a bookable or event with `isPublic: true` and no review status becomes
  `pending`, waiting from the migration time on, with one history row
  `review.submitted`; an offer nobody wants published keeps no review status.

Nothing is approved. Values that are set, existing review decisions,
`isPublic`, `isBookable`, the catalog participation and all bookings stay as
they are; a tenant without contact data is migrated like any other. No mail
is sent and no notification outbox row is written, so nothing is sent later
either.

The history rows are system rows (`actor.type: "system"`,
`origin: "migration"`) with the actual migration time and a deterministic
`dedupeKey` (`migration:tenant-level:<tenantId>`,
`migration:review:<offerType>:<tenantId>:<offerId>`).

## Consequence for the operator

A stock tenant starts `free`, so its public projection is unchanged right
after the upgrade, and its waiting offers are not in the active review queue
(the queue lists supervised tenants only). They enter it once the tenant is
set to `supervised` - from then on its stock offers are hidden until approved,
so plan the review together with that switch.

A tenant that is `supervised` already when the migration runs gets no stock
approval either: its public offers without a review status wait as `pending`
and are hidden at once, without a mail.

An offer without `id` or `tenantId`, or a tenant without `id`, cannot be named
in the history; it is skipped and reported on the console.

## Rerun and abort

The migration can be run again, whole or after an abort: every write only
hits what is not migrated yet, the history row of a subject is written before
its state, and an existing row is skipped. A rerun resets no `submittedAt`,
repeats no history row and touches no decision made in the meantime.

There is no rollback (`down` is a no-op): it would drop decisions made since.

Run it with traffic held back and a single runner; the runner itself has no
lock against parallel runs yet.
