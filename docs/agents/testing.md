# Testing

## Framework

- **Runner:** Mocha (`npm test`)
- **Assertions:** Node `assert` or Chai
- **Mocking:** Sinon (`sinon.stub`, `sinon.spy`)
- **HTTP tests:** supertest against the real routers on a bare express app (see `tests/helpers/booking-lifecycle-harness.js`); chai-http is still installed but unused
- **Environment:** `.mocharc.yml` loads `tests/helpers/test-env.js` first, which sets `NODE_ENV=test`; code may throw on a programming error there where production only logs (e.g. a write to a derived booking flag)

## Location

All tests in `tests/`:

```
tests/
  block-period-api.test.js
  lead-time-checkout.test.js
  …
```

## Conventions

```javascript
const assert = require("assert");
const sinon = require("sinon");
const BlockPeriodService = require("../src/commons/services/block-period-service");

describe("BlockPeriodService", function () {
  afterEach(function () {
    sinon.restore();
  });

  it("rejects overlapping periods", async function () {
    // arrange → act → assert
  });
});
```

- Import from `../src/...` (relative to `tests/`)
- Use `describe`/`it` blocks with clear names
- Restore stubs in `afterEach`
- Test behavior, not implementation details
- Use local helper functions for test fixtures (see `blockPeriodBookable()` pattern)

## What to test

- Service logic (availability, checkout, permissions)
- Controller behavior with stubbed dependencies
- Edge cases in utilities and rule engine
- Regression tests for reported bugs

## What not to test

- Trivial getters/setters
- Third-party library internals
- Full end-to-end flows requiring live MongoDB (unless integration test infra exists)

## Snapshots

Characterization tests pin rendered output (the mails under `tests/snapshots/mail/`) through `tests/helpers/snapshot.js`. A missing snapshot is recorded on the first run and committed; a mismatch fails and names the first differing line. `UPDATE_SNAPSHOTS=1 npm test` rewrites them — only for a change made on purpose, named in the changelog.

The authorization is pinned route by route: `tests/authorization-routes-characterization.test.js` calls every route of every router under `src/platform` with five principals (anonymous, signed in without a role, holder of every role level, tenant owner, instance owner) and pins the status codes in `tests/snapshots/authorization/routes.json`. It runs on the lifecycle harness, which mounts all seven routers (`createApp()`) and knows the principals `CUSTOMER`, `ROLE_HOLDER`, `OWNER`, `ADMIN`, with the fixture world of `tests/helpers/route-world.js` behind the remaining data managers; `tests/helpers/route-inventory.js` lists the routes and the authorization markers they carry. The rights table itself is the matrix of `tests/authorization-policy.test.js`.

Mail tests run over the in-memory transport: `installInMemoryMailTransport()` from `tests/helpers/in-memory-mail-transport.js` puts `mail-service/transports/in-memory-transport.js` behind `MailerService.send` and answers the sink of the mails sent; a no-reply host named `broken` refuses every send. The fixture behind the data managers is `installMailStackStore()` from `tests/helpers/mail-stack-fixtures.js`; `compose` is tested at its value (`tests/mail-compose.test.js`), the rendered bodies by the snapshots. The booking lifecycle harness runs `compose` for real and records each mail at the transport as `mail.<type> <to> [<attachments>]`.

## Running

```bash
npm test                              # all tests
npx mocha tests/block-period-api.test.js  # single file
UPDATE_SNAPSHOTS=1 npm test           # accept changed snapshots
```

Add tests for new business logic. Don't add tests that only assert mocks were called unless that IS the behavior under test.
