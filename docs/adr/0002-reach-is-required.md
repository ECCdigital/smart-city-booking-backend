# A manager reads only with a reach; the domain reads under its own

`ownCondition` answered "everything" to a missing reach, meant for callers inside the domain, so a handler that forgot `scopeOf(req)` read everything too, and nothing tied a handler to the shape of its table entry. We decided that every reading manager call requires a reach: the domain names its own, `domain` (a frozen scope the authorization module exports and no router ever assigns, forbidden under `src/platform`), a missing reach throws at the one place every condition passes through, and a service that reads for a route takes the route's scope instead of reading everything behind a gate the controller built. The reach applies to the resource of the route: once that resource is within reach, its dependent records (the bookings of an event, the event of a bookable) are read by the domain, not filtered again by a second owner key. The alternatives were a lint rule on the call sites (misses services and jobs, and the scope's position varies per method) and separate "in domain" method variants (doubles 17 methods).

## Consequences

- Around a hundred call sites inside `src/commons` say `DOMAIN`; the diff is mechanical and the value is readable where an absence was not.
- The manager names its resource, not its field: `ownCondition("booking", scope)` looks the owner key up in `OWNER_KEY` (ADR 0001), so the table and the manager cannot disagree.
- On the instance level the scope carries the tenant set (`tenantIds`) computed from the principal's tenants; a manager never asks for memberships again.
- `onlyOwn` on the seat count goes: the event is brought within reach, its seats are counted whole.
