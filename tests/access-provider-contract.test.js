/**
 * The contract every access provider adapter has to keep at the seam
 * `AccessService` talks through. One suite, run against every adapter -
 * NUKI, Salto KS, iFBS and Pareva over fake API clients, plus the in-memory
 * provider that tests use as the fifth implementation.
 */

const assert = require("assert");
const sinon = require("sinon");

const AccessProvider = require("../src/commons/services/access/providers/access-provider");
const NukiAccessProvider = require("../src/commons/services/access/providers/nuki-access-provider");
const SaltoKsAccessProvider = require("../src/commons/services/access/providers/salto-ks-access-provider");
const IfbsAccessProvider = require("../src/commons/services/access/providers/ifbs-access-provider");
const ParevaAccessProvider = require("../src/commons/services/access/providers/pareva-access-provider");
const TenantManager = require("../src/commons/data-managers/tenant-manager");
const UserManager = require("../src/commons/data-managers/user-manager");
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
  FakeParevaApiClient,
  brokenParevaApiClient,
} = require("./helpers/fake-pareva-api-client");
const {
  InMemoryAccessProvider,
  PROVIDER_ID: IN_MEMORY_PROVIDER_ID,
} = require("./helpers/in-memory-access-provider");
const {
  TENANT,
  SALTO_LOCK_ID,
  IFBS_BOOKING_ID,
  IFBS_LOCATION_ID,
  IFBS_BOX_NUMBER,
  PAREVA_LOCKER_ID,
  PAREVA_SIZE,
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

/**
 * One entry per adapter. `secretBearing` says whether a grant of the adapter
 * hands out a secret the person types - a keypad code, a PIN - or none,
 * because the provider keeps the code to itself (Pareva) or the box opens
 * through the API (iFBS).
 */
const IMPLEMENTATIONS = [
  {
    name: "nuki",
    Provider: NukiAccessProvider,
    secretBearing: true,
    accessPoint: {
      id: "door-1",
      tenantId: TENANT,
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
  },
  {
    name: "salto-ks",
    Provider: SaltoKsAccessProvider,
    secretBearing: true,
    accessPoint: {
      id: "door-2",
      tenantId: TENANT,
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
  },
  {
    name: "ifbs",
    Provider: IfbsAccessProvider,
    secretBearing: false,
    accessPoint: {
      id: "location-7",
      tenantId: TENANT,
      type: "locker",
      provider: "ifbs",
      externalId: IFBS_LOCATION_ID,
      mode: AccessPointMode.REMOTE,
    },
    bookingContext: bookingContext({ externalBookingId: IFBS_BOOKING_ID }),
    create() {
      const client = new FakeIfbsApiClient({
        locations: [
          {
            LocationID: IFBS_LOCATION_ID,
            boxes: [IFBS_BOX_NUMBER, "62100104"],
          },
        ],
        bookingIds: [IFBS_BOOKING_ID],
      });
      return {
        provider: new IfbsAccessProvider({ client }),
        client,
        // The pre-seeded booking is the one opened, not one granted here.
        grantsHeld: () =>
          client
            .bookingsInState("booked")
            .filter((booking) => booking.LocationID === IFBS_LOCATION_ID)
            .length,
      };
    },
    createBroken() {
      return new IfbsAccessProvider({ client: brokenIfbsApiClient() });
    },
  },
  {
    name: "pareva",
    Provider: ParevaAccessProvider,
    secretBearing: false,
    accessPoint: {
      id: "size-s",
      tenantId: TENANT,
      type: "locker",
      provider: "pareva",
      externalId: PAREVA_SIZE,
      mode: AccessPointMode.AUTHORIZATION,
    },
    bookingContext: bookingContext(),
    create() {
      const client = new FakeParevaApiClient({
        lockerId: PAREVA_LOCKER_ID,
        sizes: [PAREVA_SIZE],
      });
      return {
        provider: new ParevaAccessProvider({ client }),
        client,
        grantsHeld: () => client.rentalsInState("open").length,
      };
    },
    createBroken() {
      return new ParevaAccessProvider({ client: brokenParevaApiClient() });
    },
  },
  {
    name: IN_MEMORY_PROVIDER_ID,
    Provider: InMemoryAccessProvider,
    secretBearing: true,
    accessPoint: {
      id: "door-3",
      tenantId: TENANT,
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
  },
];

for (const implementation of IMPLEMENTATIONS) {
  describe(`access provider contract: ${implementation.name}`, function () {
    const { Provider, accessPoint, bookingContext } = implementation;
    const capabilities = Provider.capabilities;
    const declares = (capability) => capabilities.includes(capability);
    const when = (capability) => (declares(capability) ? it : it.skip);
    const whenSecretBearing = (capability) =>
      declares(capability) && implementation.secretBearing ? it : it.skip;

    let provider;
    let grantsHeld;

    beforeEach(function () {
      // Salto reads the tenant's application besides the client (for the
      // IQ activations behind `listAccessPoints`), Pareva the tenant's mail
      // address, iFBS the booking's user.
      sinon.stub(TenantManager, "getTenant").resolves(tenantWithSaltoApp());
      sinon.stub(UserManager, "getRawUser").resolves(null);
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

    it("agrees with the base class in the parameter list of every capability", function () {
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

    when("open")("answers an open with an OpenOutcome", async function () {
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
      if (outcome.openProcessId !== null) {
        assert.strictEqual(typeof outcome.openProcessId, "string");
      }
    });

    when("unlatch")(
      "answers an unlatch with an OpenOutcome",
      async function () {
        const outcome = await provider.unlatch(accessPoint, bookingContext);

        assert.deepStrictEqual(Object.keys(outcome).sort(), [
          "openProcessId",
          "state",
        ]);
        assert.strictEqual(
          outcome.state === "pending",
          outcome.openProcessId !== null,
        );
      },
    );

    when("getStatus")(
      "answers the status as a LockStatus of booleans or null",
      async function () {
        const status = await provider.getStatus(accessPoint, bookingContext);

        assert.deepStrictEqual(Object.keys(status).sort(), [
          "doorOpen",
          "locked",
          "open",
        ]);
        for (const value of Object.values(status)) {
          assert.ok(value === null || typeof value === "boolean");
        }
      },
    );

    when("getOpenProgress")(
      "answers the progress of an open process as an OpenProgress",
      async function () {
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
        assert.ok([true, false, null].includes(progress.confirmed));
      },
    );

    when("getOpenProgress")(
      "answers a failed poll with the reason instead of throwing",
      async function () {
        const broken = implementation.createBroken();

        const progress = await broken.getOpenProgress(accessPoint, "1");

        assert.strictEqual(progress.confirmed, null);
        assert.strictEqual(typeof progress.errorMessage, "string");
      },
    );

    when("close")("closes and answers nothing", async function () {
      const answer = await provider.close(accessPoint, bookingContext);

      assert.strictEqual(answer, undefined);
    });

    when("hold")(
      "answers a hold as a Hold: a handle, when it lapses and the compartment, each or null",
      async function () {
        const hold = await provider.hold(accessPoint, bookingContext);

        assert.deepStrictEqual(Object.keys(hold).sort(), [
          "compartment",
          "expiresAt",
          "holdId",
        ]);
        assert.ok(hold.holdId === null || typeof hold.holdId === "string");
        assert.ok(
          hold.expiresAt === null || typeof hold.expiresAt === "number",
        );
        assert.ok(
          hold.compartment === null || typeof hold.compartment === "string",
        );
      },
    );

    when("hold")(
      "declares refreshHold with hold, and answers the renewal as a Hold again",
      async function () {
        assert.ok(declares("refreshHold"));
        const hold = await provider.hold(accessPoint, bookingContext);

        const renewed = await provider.refreshHold(accessPoint, {
          ...bookingContext,
          hold,
        });

        assert.deepStrictEqual(Object.keys(renewed).sort(), [
          "compartment",
          "expiresAt",
          "holdId",
        ]);
      },
    );

    when("hold")(
      "grants after a hold, consuming the hold the booking context brings",
      async function () {
        const hold = await provider.hold(accessPoint, bookingContext);

        const grant = await provider.grantAuthorization(accessPoint, {
          ...bookingContext,
          hold,
        });

        assert.strictEqual(typeof grant.authorizationId, "string");
        assert.strictEqual(grantsHeld() > 0, true);
      },
    );

    when("grantAuthorization")(
      "answers a grant as a Grant: an id, an external principal or none, and a one-time secret or none",
      async function () {
        const grant = await provider.grantAuthorization(
          accessPoint,
          bookingContext,
        );

        const { compartment, ...core } = grant;
        assert.deepStrictEqual(Object.keys(core).sort(), [
          "authorizationId",
          "externalPrincipalId",
          "secret",
        ]);
        assert.strictEqual(typeof grant.authorizationId, "string");
        assert.ok(
          grant.externalPrincipalId === null ||
            typeof grant.externalPrincipalId === "string",
        );
        // Only a locker provider names the compartment the grant is for.
        assert.ok(
          compartment === undefined ||
            compartment === null ||
            typeof compartment === "string",
        );
        if (implementation.secretBearing) {
          assert.match(String(grant.secret), /^\d{6}$/);
        } else {
          assert.strictEqual(grant.secret, null);
        }
        assert.strictEqual(grantsHeld() > 0, true);
      },
    );

    whenSecretBearing("grantAuthorization")(
      "uses the PIN the booking context brings as the secret instead of generating one",
      async function () {
        const grant = await provider.grantAuthorization(accessPoint, {
          ...bookingContext,
          pin: "424242",
        });

        assert.strictEqual(grant.secret, "424242");
      },
    );

    when("revokeAuthorization")(
      "revokes the grant it made and answers a Revocation",
      async function () {
        const grant = await provider.grantAuthorization(
          accessPoint,
          bookingContext,
        );

        const revocation = await provider.revokeAuthorization(
          accessPoint,
          grant,
        );

        assert.deepStrictEqual(Object.keys(revocation), ["principalRemoved"]);
        // A grant without an external principal has none to remove.
        assert.strictEqual(
          revocation.principalRemoved,
          grant.externalPrincipalId === null ? null : true,
        );
        assert.strictEqual(grantsHeld(), 0);
      },
    );

    when("revokeAuthorization")(
      "tolerates revoking the same grant twice",
      async function () {
        const grant = await provider.grantAuthorization(
          accessPoint,
          bookingContext,
        );

        await provider.revokeAuthorization(accessPoint, grant);
        const again = await provider.revokeAuthorization(accessPoint, grant);

        assert.deepStrictEqual(Object.keys(again), ["principalRemoved"]);
        assert.ok([true, false, null].includes(again.principalRemoved));
        assert.strictEqual(grantsHeld(), 0);
      },
    );

    when("open")(
      "fails an open on a broken client with an AccessOpenError, never a raw error",
      async function () {
        const broken = implementation.createBroken();

        await assert.rejects(
          () => broken.open(accessPoint, bookingContext),
          (error) => {
            assert.ok(
              error instanceof AccessOpenError,
              `expected an AccessOpenError, got ${error.constructor.name}: ${error.message}`,
            );
            assert.ok(
              ["configuration", "temporary"].includes(error.failureClass),
            );
            return true;
          },
        );
      },
    );

    when("unlatch")(
      "fails an unlatch on a broken client with an AccessOpenError, never a raw error",
      async function () {
        const broken = implementation.createBroken();

        await assert.rejects(
          () => broken.unlatch(accessPoint, bookingContext),
          (error) => {
            assert.ok(error instanceof AccessOpenError);
            return true;
          },
        );
      },
    );
  });
}
