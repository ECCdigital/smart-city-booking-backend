/**
 * The contract every access provider adapter has to keep at the seam
 * `AccessService` talks through. One suite, run against every adapter -
 * NUKI, Salto KS and iFBS over fake API clients, plus the in-memory provider
 * that tests use as the fourth implementation.
 *
 * Cases the Provider-Outcomes spec promises but which only hold after the
 * seam is typed are `it.skip` with the ticket that makes them true:
 * (2) OpenOutcome, LockStatus, OpenProgress and the error contract;
 * (3) Grant and Revocation. The spec lives with the effort's map, not in
 * the repo.
 */

const assert = require("assert");
const sinon = require("sinon");

const AccessProvider = require("../src/commons/services/access/providers/access-provider");
const NukiAccessProvider = require("../src/commons/services/access/providers/nuki-access-provider");
const SaltoKsAccessProvider = require("../src/commons/services/access/providers/salto-ks-access-provider");
const IfbsAccessProvider = require("../src/commons/services/access/providers/ifbs-access-provider");
const TenantManager = require("../src/commons/data-managers/tenant-manager");
const {
  AccessPointMode,
} = require("../src/commons/entities/access/access-point");
const { AccessOpenError } = require("../src/errors/AccessOpenError");

const {
  FakeNukiApiClient,
  brokenNukiApiClient,
} = require("./helpers/fake-nuki-api-client");
const {
  FakeSaltoKsApiClient,
  brokenSaltoKsApiClient,
} = require("./helpers/fake-salto-ks-api-client");
const {
  FakeIfbsApiClient,
  brokenIfbsApiClient,
} = require("./helpers/fake-ifbs-api-client");
const {
  InMemoryAccessProvider,
  PROVIDER_ID: IN_MEMORY_PROVIDER_ID,
} = require("./helpers/in-memory-access-provider");
const {
  TENANT,
  SALTO_LOCK_ID,
  IFBS_BOOKING_ID,
  nukiSmartlock,
  saltoLock,
  saltoIq,
  tenantWithSaltoApp,
  bookingContext,
} = require("./helpers/access-provider-fixtures");

const ALL_MODES = Object.values(AccessPointMode);

/**
 * The declared parameters of a method, read from its source: `Function.length`
 * stops counting at the first parameter with a default value, so it cannot
 * compare an adapter's `(rawPayload, headers = {})` with the base class.
 */
function parameterNames(fn) {
  const source = fn.toString();
  const start = source.indexOf("(") + 1;
  let depth = 1;
  let end = start;
  while (end < source.length && depth > 0) {
    if (source[end] === "(") depth += 1;
    if (source[end] === ")") depth -= 1;
    end += 1;
  }
  return source
    .slice(start, end - 1)
    .split(",")
    .map((parameter) => parameter.split("=")[0].trim().replace(/^_/, ""))
    .filter(Boolean);
}

/*
 * Each implementation carries `today`: the facts about its dialect that the
 * active cases pin as they are now, and that the typed seam changes. They
 * choose between `it` and `it.skip` per implementation until then.
 *   openNamesProcess  the open answer carries an open process to poll
 *   mapsClientErrors  a broken client ends in an AccessOpenError
 *   revokeIdempotent  a second revoke of the same grant does not throw
 *   arityDrift        capabilities whose parameter count differs from the base
 */
const IMPLEMENTATIONS = [
  {
    name: "nuki",
    Provider: NukiAccessProvider,
    accessPoint: {
      id: "door-1",
      type: "door",
      provider: "nuki",
      externalId: "1001",
      label: "Main door",
      mode: AccessPointMode.AUTHORIZATION,
    },
    bookingContext: bookingContext(),
    create() {
      const client = new FakeNukiApiClient({ smartlocks: [nukiSmartlock()] });
      return {
        provider: new NukiAccessProvider({ client }),
        client,
        grantsHeld: () => client.authorizations.size,
      };
    },
    createBroken() {
      return new NukiAccessProvider({ client: brokenNukiApiClient() });
    },
    today: {
      openNamesProcess: false,
      mapsClientErrors: false,
      revokeIdempotent: false,
      arityDrift: ["getSupportedModes", "unregisterWebhook"],
    },
  },
  {
    name: "salto-ks",
    Provider: SaltoKsAccessProvider,
    accessPoint: {
      id: "door-2",
      type: "door",
      provider: "salto-ks",
      externalId: SALTO_LOCK_ID,
      label: "Tür 01",
      mode: AccessPointMode.AUTHORIZATION,
    },
    bookingContext: bookingContext(),
    create() {
      const client = new FakeSaltoKsApiClient({
        locks: [saltoLock()],
        iqs: [saltoIq()],
      });
      return {
        provider: new SaltoKsAccessProvider({ client }),
        client,
        grantsHeld: () => client.accesses.size + client.users.size,
      };
    },
    createBroken() {
      return new SaltoKsAccessProvider({ client: brokenSaltoKsApiClient() });
    },
    today: {
      openNamesProcess: false,
      mapsClientErrors: false,
      revokeIdempotent: false,
      arityDrift: ["getSupportedModes", "unregisterWebhook", "parseWebhook"],
    },
  },
  {
    name: "ifbs",
    Provider: IfbsAccessProvider,
    accessPoint: {
      id: "7",
      type: "locker",
      provider: "ifbs",
      mode: AccessPointMode.REMOTE,
    },
    bookingContext: bookingContext({ externalBookingId: IFBS_BOOKING_ID }),
    create() {
      const client = new FakeIfbsApiClient({ bookingIds: [IFBS_BOOKING_ID] });
      return {
        provider: new IfbsAccessProvider({ client }),
        client,
        grantsHeld: () => 0,
      };
    },
    createBroken() {
      return new IfbsAccessProvider({ client: brokenIfbsApiClient() });
    },
    today: {
      openNamesProcess: true,
      mapsClientErrors: false,
      revokeIdempotent: false,
      arityDrift: [],
    },
  },
  {
    name: IN_MEMORY_PROVIDER_ID,
    Provider: InMemoryAccessProvider,
    accessPoint: {
      id: "door-3",
      type: "door",
      provider: IN_MEMORY_PROVIDER_ID,
      externalId: "lock-1",
      label: "Main door",
      mode: AccessPointMode.AUTHORIZATION,
    },
    bookingContext: bookingContext(),
    create() {
      const provider = new InMemoryAccessProvider({
        locks: [{ externalId: "lock-1", label: "Main door" }],
      });
      return {
        provider,
        client: null,
        grantsHeld: () => provider.grants.size,
      };
    },
    createBroken() {
      return new InMemoryAccessProvider({ broken: true });
    },
    today: {
      openNamesProcess: false,
      mapsClientErrors: true,
      revokeIdempotent: true,
      // The base class is what drifts here: it declares `getSupportedModes()`
      // without the parameters every adapter takes.
      arityDrift: ["getSupportedModes"],
    },
  },
];

for (const implementation of IMPLEMENTATIONS) {
  describe(`access provider contract: ${implementation.name}`, function () {
    const { Provider, accessPoint, bookingContext, today } = implementation;
    const capabilities = Provider.capabilities;
    const declares = (capability) => capabilities.includes(capability);
    const when = (capability) => (declares(capability) ? it : it.skip);

    let provider;
    let grantsHeld;

    beforeEach(function () {
      // Only Salto reads the tenant's application besides the client (for
      // the IQ activations behind `listAccessPoints`).
      sinon.stub(TenantManager, "getTenant").resolves(tenantWithSaltoApp());
      ({ provider, grantsHeld } = implementation.create());
    });

    afterEach(function () {
      sinon.restore();
    });

    it("declares its capabilities, and each one is a method it has", function () {
      assert.ok(Array.isArray(capabilities) && capabilities.length > 0);
      for (const capability of capabilities) {
        assert.strictEqual(
          typeof provider[capability],
          "function",
          `capability '${capability}' is not a method of the adapter`,
        );
      }
    });

    it("drifts from the base class in parameter count exactly where it does today", function () {
      const base = AccessProvider.prototype;
      const drift = capabilities.filter(
        (capability) =>
          typeof base[capability] === "function" &&
          parameterNames(base[capability]).length !==
            parameterNames(provider[capability]).length,
      );

      assert.deepStrictEqual(drift, today.arityDrift);
    });

    it.skip("agrees with the base class in the parameter list of every capability (2)", function () {
      const base = AccessProvider.prototype;
      for (const capability of capabilities) {
        assert.deepStrictEqual(
          parameterNames(provider[capability]),
          parameterNames(base[capability]),
          `parameters of '${capability}' differ from the base class`,
        );
      }
    });

    when("listAccessPoints")(
      "lists the access points of the tenant in the shared shape",
      async function () {
        const points = await provider.listAccessPoints(TENANT);

        assert.ok(Array.isArray(points) && points.length > 0);
        for (const point of points) {
          assert.deepStrictEqual(Object.keys(point).sort(), [
            "capabilities",
            "externalId",
            "id",
            "label",
            "locationId",
            "metadata",
            "provider",
            "supportedModes",
            "type",
          ]);
          assert.strictEqual(typeof point.id, "string");
          assert.strictEqual(typeof point.externalId, "string");
          assert.strictEqual(point.provider, implementation.name);
          assert.ok(
            point.supportedModes.every((mode) => ALL_MODES.includes(mode)),
          );
        }
      },
    );

    when("getSupportedModes")(
      "reports the modes of a listed access point exactly as the listing does",
      async function () {
        const points = await provider.listAccessPoints(TENANT);
        const listed = points.find(
          (point) => point.externalId === String(accessPoint.externalId),
        );

        const modes = await provider.getSupportedModes(accessPoint, TENANT);

        assert.deepStrictEqual(modes, listed.supportedModes);
        assert.ok(modes.includes(accessPoint.mode));
      },
    );

    when("open")("opens and answers with a plain object", async function () {
      const outcome = await provider.open(accessPoint, bookingContext);

      assert.strictEqual(typeof outcome, "object");
      assert.notStrictEqual(outcome, null);
    });

    when("open")(
      "names an open process only where the provider opens asynchronously",
      async function () {
        const outcome = await provider.open(accessPoint, bookingContext);

        if (today.openNamesProcess) {
          assert.ok(outcome.openProcessId != null);
        } else {
          assert.strictEqual(outcome.openProcessId ?? null, null);
        }
      },
    );

    it.skip("answers an open with an OpenOutcome (2)", async function () {
      const outcome = await provider.open(accessPoint, bookingContext);

      assert.deepStrictEqual(Object.keys(outcome).sort(), [
        "openProcessId",
        "state",
      ]);
      assert.ok(["opened", "pending"].includes(outcome.state));
      assert.strictEqual(
        outcome.state === "pending",
        outcome.openProcessId !== null,
      );
    });

    when("getStatus")("reads the status without throwing", async function () {
      const status = await provider.getStatus(accessPoint, bookingContext);

      assert.strictEqual(typeof status, "object");
    });

    it.skip("answers the status as a LockStatus of booleans or null (2)", async function () {
      const status = await provider.getStatus(accessPoint, bookingContext);

      assert.deepStrictEqual(Object.keys(status).sort(), [
        "doorOpen",
        "locked",
        "open",
      ]);
      for (const value of Object.values(status)) {
        assert.ok(value === null || typeof value === "boolean");
      }
    });

    it.skip("answers the progress of an open process as an OpenProgress (2)", async function () {
      const outcome = await provider.open(accessPoint, bookingContext);
      const progress = await provider.getOpenProgress(
        accessPoint,
        outcome.openProcessId,
      );

      assert.deepStrictEqual(Object.keys(progress).sort(), [
        "confirmed",
        "confirmedAt",
        "errorCode",
        "errorMessage",
      ]);
    });

    when("grantAuthorization")(
      "grants an authorization with an id and a one-time PIN",
      async function () {
        const grant = await provider.grantAuthorization(
          accessPoint,
          bookingContext,
        );

        assert.ok(grant.authorizationId);
        assert.match(String(grant.pin), /^\d{6}$/);
        assert.strictEqual(grantsHeld() > 0, true);
      },
    );

    when("grantAuthorization")(
      "uses the PIN the booking context brings instead of generating one",
      async function () {
        const grant = await provider.grantAuthorization(accessPoint, {
          ...bookingContext,
          pin: "424242",
        });

        assert.strictEqual(grant.pin, "424242");
      },
    );

    it.skip("answers a grant as a Grant (3)", async function () {
      const grant = await provider.grantAuthorization(
        accessPoint,
        bookingContext,
      );

      assert.deepStrictEqual(Object.keys(grant).sort(), [
        "authorizationId",
        "externalPrincipalId",
        "secret",
      ]);
      assert.strictEqual(typeof grant.authorizationId, "string");
    });

    when("revokeAuthorization")(
      "revokes the authorization it granted",
      async function () {
        const grant = await provider.grantAuthorization(
          accessPoint,
          bookingContext,
        );

        const revocation = await provider.revokeAuthorization(accessPoint, {
          ...bookingContext,
          ...grant,
        });

        assert.strictEqual(typeof revocation, "object");
        assert.strictEqual(grantsHeld(), 0);
      },
    );

    (declares("revokeAuthorization") && today.revokeIdempotent ? it : it.skip)(
      "tolerates revoking the same authorization twice (3)",
      async function () {
        const grant = await provider.grantAuthorization(
          accessPoint,
          bookingContext,
        );
        const context = { ...bookingContext, ...grant };

        await provider.revokeAuthorization(accessPoint, context);
        await provider.revokeAuthorization(accessPoint, context);
      },
    );

    it.skip("answers a revocation as a Revocation (3)", async function () {
      const grant = await provider.grantAuthorization(
        accessPoint,
        bookingContext,
      );

      const revocation = await provider.revokeAuthorization(accessPoint, grant);

      assert.deepStrictEqual(Object.keys(revocation), ["principalRemoved"]);
      assert.ok([true, false, null].includes(revocation.principalRemoved));
    });

    (declares("open") && today.mapsClientErrors ? it : it.skip)(
      "fails an open on a broken client with an AccessOpenError, never a raw error (2)",
      async function () {
        const broken = implementation.createBroken();

        await assert.rejects(
          () => broken.open(accessPoint, bookingContext),
          (error) => {
            assert.ok(error instanceof AccessOpenError);
            assert.ok(
              ["configuration", "temporary"].includes(error.failureClass),
            );
            return true;
          },
        );
      },
    );
  });
}
