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

## Running

```bash
npm test                              # all tests
npx mocha tests/block-period-api.test.js  # single file
```

Add tests for new business logic. Don't add tests that only assert mocks were called unless that IS the behavior under test.
