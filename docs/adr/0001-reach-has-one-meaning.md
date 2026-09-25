# A reach has one meaning; public gates ask the principal

> Partly superseded by [ADR 0003](0003-public-projection-behind-the-managers.md): the public gates are gone, and with them `managesTenant`. What stays is the first half - a reach has one meaning, `self` reaches no records, `own` names its owner key.

The rights table answered `own` for four different things (own records, "myself", a signed-in projection, a door decided later in the handler), so every reader of `req.reach` had to know which entry stood before it, and the public gates needed `exemptReaches` per route to tell a customer's `own` from staff's. We decided that `own` means own records only, reached through a named owner key (`OWNER_KEY`, checked when the table loads), that "myself" is its own reach `self` which reaches no records at all (`ownCondition` throws on it, like on `public`), and that the public gates (`publicTenantGate`, `publicBookableGate`) ask the principal whether it manages the tenant and never look at the reach. The alternatives were a richer decision (`{ reach, level }`) or keeping `exemptReaches`; both keep the gate's question tied to a value that was never its question.

## Consequences

- `exemptReaches` is gone; a signed-in customer with `own` on their bookings does not open a pending or declined tenant.
- A new level `tenantMember` (the glossary's _Mitglied_) sits between role and signed-in, so membership-based projections live in the table instead of in handlers.
- A route that has to decide two actions (the obsolete upsert PUTs) declares the second one on the marker (`also`), not in the handler.
