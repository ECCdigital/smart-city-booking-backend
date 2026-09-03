/**
 * Characterization of the access provider seam: how NUKI, Salto KS, iFBS
 * and Pareva answer, and what `AccessService` makes of it. The
 * result-bearing methods - open, unlatch, close, getStatus, getOpenProgress,
 * hold, grantAuthorization, revokeAuthorization - answer in the typed shapes
 * of `access-provider.js`
 * and every open failure is an `AccessOpenError`; the expectations on those
 * are the contract. What lands in `accessInfo` is the Grant as the service
 * stores it, its secret encrypted, with the principal fields the cleanup
 * job works on.
 *
 * The adapters run for real over fake API clients that replace only the
 * HTTP transport (`tests/helpers/fake-*-api-client.js`). The target contract
 * is the Provider-Outcomes spec, kept with the effort's map, not in the repo.
 */

const assert = require("assert");
const { expect } = require("chai");
const sinon = require("sinon");

process.env.CRYPTO_SECRET =
  process.env.CRYPTO_SECRET || "0123456789abcdef0123456789abcdef";

const AccessService = require("../src/commons/services/access/access-service");
const AccessLogService = require("../src/commons/services/access/access-log-service");
const NukiAccessProvider = require("../src/commons/services/access/providers/nuki-access-provider");
const SaltoKsAccessProvider = require("../src/commons/services/access/providers/salto-ks-access-provider");
const IfbsAccessProvider = require("../src/commons/services/access/providers/ifbs-access-provider");
const ParevaAccessProvider = require("../src/commons/services/access/providers/pareva-access-provider");
const {
  registerAccessProvider,
} = require("../src/commons/services/access/providers/access-provider-registry");
const IfbsApiClient = require("../src/commons/services/access/clients/ifbs-api-client");
const IfbsApiError = require("../src/commons/services/access/clients/ifbs-api-error");
const ParevaApiClient = require("../src/commons/services/access/clients/pareva-api-client");
const {
  NUKI_ACTIONS,
  NUKI_AUTH_TYPES,
} = require("../src/commons/services/access/clients/nuki-api-client");
const BookingManager = require("../src/commons/data-managers/booking-manager");
const {
  BookableManager,
} = require("../src/commons/data-managers/bookable-manager");
const AccessPointManager = require("../src/commons/data-managers/access-point-manager");
const TenantManager = require("../src/commons/data-managers/tenant-manager");
const UserManager = require("../src/commons/data-managers/user-manager");
const PermissionsService = require("../src/commons/services/permission-service");
const mailModule = require("../src/commons/mail-service");
const SecurityUtils = require("../src/commons/utilities/security-utils");
const { Booking } = require("../src/commons/entities/booking/booking");
const {
  AccessPointMode,
} = require("../src/commons/entities/access/access-point");
const { AccessOpenError } = require("../src/errors/AccessOpenError");

const {
  FakeNukiApiClient,
  brokenNukiApiClient,
  nukiHttpError,
} = require("./helpers/fake-nuki-api-client");
const {
  FakeSaltoKsApiClient,
  brokenSaltoKsApiClient,
  saltoHttpError,
} = require("./helpers/fake-salto-ks-api-client");
const {
  FakeIfbsApiClient,
  brokenIfbsApiClient,
  ERR_NO_WAIT_PROCESS_NOT_FOUND,
} = require("./helpers/fake-ifbs-api-client");
const {
  FakeParevaApiClient,
  brokenParevaApiClient,
  parevaHttpError,
} = require("./helpers/fake-pareva-api-client");
const {
  InMemoryAccessProvider,
  PROVIDER_ID: IN_MEMORY_PROVIDER_ID,
} = require("./helpers/in-memory-access-provider");
const {
  TENANT,
  TENANT_MAIL,
  MINUTE,
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
  bookingContext: doorContext,
} = require("./helpers/access-provider-fixtures");

function createClients({ nukiSmartlocks, saltoLocks } = {}) {
  return {
    nuki: new FakeNukiApiClient({
      smartlocks: nukiSmartlocks || [nukiSmartlock()],
    }),
    "salto-ks": new FakeSaltoKsApiClient({
      locks: saltoLocks || [saltoLock()],
      iqs: [saltoIq()],
    }),
    ifbs: new FakeIfbsApiClient({
      locations: [
        {
          LocationID: IFBS_LOCATION_ID,
          Name: "Bahnhof",
          boxes: [IFBS_BOX_NUMBER],
        },
      ],
      bookingIds: [IFBS_BOOKING_ID],
    }),
    pareva: new FakeParevaApiClient({
      lockerId: PAREVA_LOCKER_ID,
      sizes: [PAREVA_SIZE],
    }),
  };
}

const NUKI_DOOR = {
  id: "door-1",
  tenantId: TENANT,
  type: "door",
  provider: "nuki",
  externalId: "1001",
  label: "Main door",
  mode: AccessPointMode.AUTHORIZATION,
  validationRules: [],
};

const SALTO_DOOR = {
  id: "door-2",
  tenantId: TENANT,
  type: "door",
  provider: "salto-ks",
  externalId: SALTO_LOCK_ID,
  label: "Tür 01",
  mode: AccessPointMode.AUTHORIZATION,
  validationRules: [],
};

const IFBS_LOCKER = {
  id: "location-7",
  tenantId: TENANT,
  type: "locker",
  provider: "ifbs",
  externalId: IFBS_LOCATION_ID,
  mode: AccessPointMode.REMOTE,
  validationRules: [],
};

/** The booked box of `lockerBooking`, by the id a client operates it under. */
const IFBS_COMPARTMENT = `${IFBS_LOCKER.id}:${IFBS_BOOKING_ID}`;

const PAREVA_LOCKER = {
  id: "size-s",
  tenantId: TENANT,
  type: "locker",
  provider: "pareva",
  externalId: PAREVA_SIZE,
  mode: AccessPointMode.AUTHORIZATION,
};

const HOLD_TTL_MS = 2 * MINUTE;

/**
 * The same doors with a remote way in: opening through the API is refused at
 * a door that only takes a code, so the open dialects are exercised at doors
 * that take both.
 */
const REMOTE_NUKI_DOOR = { ...NUKI_DOOR, mode: AccessPointMode.BOTH };
const REMOTE_SALTO_DOOR = { ...SALTO_DOOR, mode: AccessPointMode.BOTH };

const IN_MEMORY_DOOR = {
  id: "door-3",
  tenantId: TENANT,
  type: "door",
  provider: IN_MEMORY_PROVIDER_ID,
  externalId: "lock-1",
  label: "Main door",
  mode: AccessPointMode.REMOTE,
  validationRules: [],
};

/** Asserts a rejection with the given error class and message. */
function rejects(promise, ErrorClass, message) {
  return assert.rejects(promise, (error) => {
    expect(error).to.be.instanceOf(ErrorClass);
    expect(error.message).to.include(message);
    return true;
  });
}

/** Asserts a rejection with an AccessOpenError of the given failure class. */
function rejectsOpen(promise, failureClass, message = "") {
  return assert.rejects(promise, (error) => {
    expect(error).to.be.instanceOf(AccessOpenError);
    expect(error.failureClass).to.equal(failureClass);
    expect(error.message).to.include(message);
    return true;
  });
}

/** Asserts a rejection with a client error the adapter did not map. */
function rejectsRaw(promise, check) {
  return assert.rejects(promise, (error) => {
    expect(error).not.to.be.instanceOf(AccessOpenError);
    check(error);
    return true;
  });
}

describe("access provider dialects: the adapters as they answer", () => {
  let clients;

  beforeEach(() => {
    clients = createClients();
  });

  describe("NUKI", () => {
    let provider;

    beforeEach(() => {
      provider = new NukiAccessProvider({ client: clients.nuki });
    });

    afterEach(() => {
      sinon.restore();
    });

    it("answers an open as opened, with no process to poll", async () => {
      const outcome = await provider.open(NUKI_DOOR, doorContext());

      expect(outcome).to.deep.equal({ state: "opened", openProcessId: null });
      expect(clients.nuki.actions).to.deep.equal([
        { smartlockId: "1001", action: NUKI_ACTIONS.UNLATCH },
      ]);
    });

    it("answers the status as a LockStatus read off the smartlock state", async () => {
      const status = await provider.getStatus(NUKI_DOOR, doorContext());

      expect(status).to.deep.equal({
        open: false,
        locked: true,
        doorOpen: null,
      });
    });

    it("answers a smartlock without a state as unknown on every count", async () => {
      provider = new NukiAccessProvider({
        client: new FakeNukiApiClient({
          smartlocks: [nukiSmartlock({ state: undefined })],
        }),
      });

      const status = await provider.getStatus(NUKI_DOOR, doorContext());

      expect(status).to.deep.equal({
        open: null,
        locked: null,
        doorOpen: null,
      });
    });

    it("answers a grant as a Grant, with the id Nuki lists for the keypad code it created", async () => {
      const context = doorContext({ pin: "424242" });

      const grant = await provider.grantAuthorization(NUKI_DOOR, context);

      expect(grant).to.deep.equal({
        authorizationId: "auth-1",
        externalPrincipalId: null,
        secret: "424242",
      });
      expect(clients.nuki.authorizationRequests).to.deep.equal([
        {
          smartlockId: "1001",
          name: "Booking booking-1 Main door",
          type: NUKI_AUTH_TYPES.KEYPAD,
          allowedFromDate: new Date(context.accessFrom).toISOString(),
          allowedUntilDate: new Date(context.accessTo).toISOString(),
          code: 424242,
        },
      ]);
    });

    it("waits for the listing when Nuki has not created the authorization yet", async () => {
      provider = new NukiAccessProvider({
        client: new FakeNukiApiClient({
          smartlocks: [nukiSmartlock()],
          authorizationListingsUntilVisible: 2,
        }),
        authorizationLookup: { attempts: 3, delayMs: 0 },
      });

      const grant = await provider.grantAuthorization(NUKI_DOOR, doorContext());

      expect(grant.authorizationId).to.equal("auth-1");
    });

    it("fails a grant whose authorization Nuki never lists", async () => {
      provider = new NukiAccessProvider({
        client: new FakeNukiApiClient({
          smartlocks: [nukiSmartlock()],
          authorizationListingsUntilVisible: 5,
        }),
        authorizationLookup: { attempts: 2, delayMs: 0 },
      });

      await rejects(
        provider.grantAuthorization(NUKI_DOOR, doorContext()),
        Error,
        "did not list the keypad authorization",
      );
    });

    it("keeps the authorization name within the 32 characters Nuki allows", async () => {
      await provider.grantAuthorization(
        NUKI_DOOR,
        doorContext({ bookingId: "0f6c1d2e-3a4b-4c5d-8e9f-0a1b2c3d4e5f" }),
      );

      const [request] = clients.nuki.authorizationRequests;
      expect(request.name).to.have.length(32);
      expect(request.name).to.equal("Booking 0f6c1d2e-3a4b-4c5d-8e9f-");
    });

    it("generates keypad codes Nuki accepts: six digits without a zero, never starting with 12", async () => {
      for (let i = 0; i < 40; i += 1) {
        const grant = await provider.grantAuthorization(
          NUKI_DOOR,
          doorContext(),
        );

        expect(grant.secret).to.match(/^[1-9]{6}$/);
        expect(grant.secret).not.to.match(/^12/);
      }
    });

    it("refuses a PIN from the booking context that Nuki's keypad would not take", async () => {
      await rejects(
        provider.grantAuthorization(NUKI_DOOR, doorContext({ pin: "042042" })),
        Error,
        "is not a Nuki keypad code",
      );
      expect(clients.nuki.authorizationRequests).to.deep.equal([]);
    });

    it("answers a revoke with no principal to remove, the keypad code deleted", async () => {
      const grant = await provider.grantAuthorization(NUKI_DOOR, doorContext());

      const revocation = await provider.revokeAuthorization(NUKI_DOOR, grant);

      expect(revocation).to.deep.equal({ principalRemoved: null });
      expect(clients.nuki.authorizations.size).to.equal(0);
    });

    it("tolerates revoking a keypad code Nuki no longer has", async () => {
      const revocation = await provider.revokeAuthorization(NUKI_DOOR, {
        authorizationId: "auth-gone",
        externalPrincipalId: null,
        secret: null,
      });

      expect(revocation).to.deep.equal({ principalRemoved: null });
    });

    it("throws Nuki's own error when the revoke fails for any other reason", async () => {
      const broken = new NukiAccessProvider({
        client: brokenNukiApiClient(nukiHttpError(500)),
      });

      await rejectsRaw(
        broken.revokeAuthorization(NUKI_DOOR, {
          authorizationId: "auth-1",
          externalPrincipalId: null,
          secret: null,
        }),
        (err) => expect(err.response.status).to.equal(500),
      );
    });

    it("maps a broken client to a temporary AccessOpenError on an open", async () => {
      const broken = new NukiAccessProvider({ client: brokenNukiApiClient() });

      await rejectsOpen(broken.open(NUKI_DOOR, doorContext()), "temporary");
    });

    it("maps a smartlock Nuki does not know to a configuration AccessOpenError", async () => {
      await rejectsOpen(
        provider.open({ ...NUKI_DOOR, externalId: "9999" }, doorContext()),
        "configuration",
        "does not know smartlock '9999'",
      );
    });

    it("maps a refused token to a configuration AccessOpenError", async () => {
      const broken = new NukiAccessProvider({
        client: brokenNukiApiClient(nukiHttpError(401)),
      });

      await rejectsOpen(broken.open(NUKI_DOOR, doorContext()), "configuration");
    });

    it("maps a missing Nuki application to a configuration AccessOpenError", async () => {
      sinon.stub(TenantManager, "getTenant").resolves(tenantWithSaltoApp());
      const unconfigured = new NukiAccessProvider();

      await rejectsOpen(
        unconfigured.open(NUKI_DOOR, doorContext()),
        "configuration",
        "nuki_application_not_found",
      );
    });
  });

  describe("NUKI getSmartlockState: the states the client reports", () => {
    // Lock states of the Nuki Web API (`state.state`) and what the client
    // makes of them. `open` says whether the lock grants access.
    const lockStates = [
      { code: 0, lockState: "uncalibrated", locked: false, open: false },
      { code: 1, lockState: "locked", locked: true, open: false },
      { code: 2, lockState: "unlocking", locked: false, open: false },
      { code: 3, lockState: "unlocked", locked: false, open: true },
      { code: 4, lockState: "locking", locked: false, open: false },
      { code: 5, lockState: "unlatched", locked: false, open: true },
      { code: 6, lockState: "unlocked_lock_n_go", locked: false, open: true },
      { code: 7, lockState: "unlatching", locked: false, open: true },
      { code: 254, lockState: "motor_blocked", locked: false, open: false },
      { code: 255, lockState: "undefined", locked: false, open: false },
      { code: 99, lockState: "unknown", locked: false, open: false },
    ];

    for (const { code, lockState, locked, open } of lockStates) {
      it(`maps lock state ${code} to ${lockState} (locked ${locked}, open ${open})`, async () => {
        const client = new FakeNukiApiClient({
          smartlocks: [nukiSmartlock({ state: { state: code } })],
        });

        const state = await client.getSmartlockState("1001");

        expect(state).to.include({
          lockState,
          lockStateCode: code,
          locked,
          open,
        });
      });
    }

    // Door sensor states (`state.doorState`): only closed and open are
    // known positions, everything else is "no position".
    const doorStates = [
      { code: 0, doorSensorState: "unavailable", doorOpen: null },
      { code: 1, doorSensorState: "deactivated", doorOpen: null },
      { code: 2, doorSensorState: "closed", doorOpen: false },
      { code: 3, doorSensorState: "open", doorOpen: true },
      { code: 4, doorSensorState: "unknown", doorOpen: null },
      { code: 5, doorSensorState: "calibrating", doorOpen: null },
    ];

    for (const { code, doorSensorState, doorOpen } of doorStates) {
      it(`maps door state ${code} to ${doorSensorState} (doorOpen ${doorOpen})`, async () => {
        const client = new FakeNukiApiClient({
          smartlocks: [nukiSmartlock({ state: { state: 1, doorState: code } })],
        });

        const state = await client.getSmartlockState("1001");

        expect(state).to.include({
          doorSensorState,
          doorStateCode: code,
          doorOpen,
        });
      });
    }

    it("reports nothing about a smartlock without a state", async () => {
      const client = new FakeNukiApiClient({
        smartlocks: [nukiSmartlock({ state: undefined })],
      });

      const state = await client.getSmartlockState("1001");

      expect(state).to.include({
        locked: null,
        open: null,
        lockState: null,
        lockStateCode: null,
        doorOpen: null,
        doorSensorState: null,
        state: null,
      });
    });
  });

  describe("Salto KS", () => {
    let provider;

    beforeEach(() => {
      provider = new SaltoKsAccessProvider({ client: clients["salto-ks"] });
    });

    afterEach(() => {
      sinon.restore();
    });

    it("answers an open as opened, with no process to poll", async () => {
      const outcome = await provider.open(SALTO_DOOR, doorContext());

      expect(outcome).to.deep.equal({ state: "opened", openProcessId: null });
      // An IQ without OTP: the lock is opened without one.
      expect(clients["salto-ks"].openings).to.deep.equal([
        { lockId: SALTO_LOCK_ID, otp: undefined },
      ]);
    });

    const lockedStates = [
      { lockedState: "locked", expected: { open: false, locked: true } },
      { lockedState: "unlocked", expected: { open: true, locked: false } },
      { lockedState: undefined, expected: { open: null, locked: null } },
    ];

    for (const { lockedState, expected } of lockedStates) {
      it(`answers a lock in locked_state '${lockedState}' as a LockStatus`, async () => {
        provider = new SaltoKsAccessProvider({
          client: new FakeSaltoKsApiClient({
            locks: [saltoLock({ locked_state: lockedState })],
            iqs: [saltoIq()],
          }),
        });

        const status = await provider.getStatus(SALTO_DOOR, doorContext());

        expect(status).to.deep.equal({ ...expected, doorOpen: null });
      });
    }

    it("answers a lock Salto does not list as unknown on every count", async () => {
      const status = await provider.getStatus(
        { ...SALTO_DOOR, externalId: "no-such-lock" },
        doorContext(),
      );

      expect(status).to.deep.equal({
        open: null,
        locked: null,
        doorOpen: null,
      });
    });

    it("answers a grant as a Grant: the access as its id, the guest as its external principal", async () => {
      const context = doorContext({ pin: "424242" });

      const grant = await provider.grantAuthorization(SALTO_DOOR, context);

      expect(grant).to.deep.equal({
        authorizationId: "access-2",
        externalPrincipalId: "user-1",
        secret: "424242",
      });
      expect([...clients["salto-ks"].users.values()]).to.deep.equal([
        {
          id: "user-1",
          firstName: "Erika",
          lastName: "Muster",
          email: "erika@example.test",
        },
      ]);
      expect([...clients["salto-ks"].accesses.values()]).to.deep.equal([
        {
          id: "access-2",
          userId: "user-1",
          lockIds: [SALTO_LOCK_ID],
          validFrom: new Date(context.accessFrom).toISOString(),
          validTo: new Date(context.accessTo).toISOString(),
          pin: "424242",
        },
      ]);
    });

    it("answers a revoke with the guest removed, holding neither access nor guest afterwards", async () => {
      const grant = await provider.grantAuthorization(
        SALTO_DOOR,
        doorContext(),
      );

      const revocation = await provider.revokeAuthorization(SALTO_DOOR, grant);

      expect(revocation).to.deep.equal({ principalRemoved: true });
      expect(clients["salto-ks"].accesses.size).to.equal(0);
      expect(clients["salto-ks"].users.size).to.equal(0);
    });

    it("answers a guest that could not be deleted as not removed, the access revoked all the same", async () => {
      const grant = await provider.grantAuthorization(
        SALTO_DOOR,
        doorContext(),
      );
      sinon
        .stub(clients["salto-ks"], "deleteUser")
        .rejects(saltoHttpError(500, { Message: "Internal error" }));

      const revocation = await provider.revokeAuthorization(SALTO_DOOR, grant);

      expect(revocation).to.deep.equal({ principalRemoved: false });
      expect(clients["salto-ks"].accesses.size).to.equal(0);
      expect(clients["salto-ks"].users.size).to.equal(1);
    });

    it("tolerates revoking an access Salto no longer has, and still removes the guest", async () => {
      const grant = await provider.grantAuthorization(
        SALTO_DOOR,
        doorContext(),
      );
      clients["salto-ks"].accesses.clear();

      const revocation = await provider.revokeAuthorization(SALTO_DOOR, grant);

      expect(revocation).to.deep.equal({ principalRemoved: true });
      expect(clients["salto-ks"].users.size).to.equal(0);
    });

    it("answers a revoke of a guest Salto already deleted as removed", async () => {
      const grant = await provider.grantAuthorization(
        SALTO_DOOR,
        doorContext(),
      );
      clients["salto-ks"].users.clear();

      const revocation = await provider.revokeAuthorization(SALTO_DOOR, grant);

      expect(revocation).to.deep.equal({ principalRemoved: true });
    });

    it("throws Salto's own error when the access revoke fails for any other reason, leaving the guest", async () => {
      const grant = await provider.grantAuthorization(
        SALTO_DOOR,
        doorContext(),
      );
      sinon
        .stub(clients["salto-ks"], "revokeAccess")
        .rejects(saltoHttpError(500, { Message: "Internal error" }));

      await rejectsRaw(provider.revokeAuthorization(SALTO_DOOR, grant), (err) =>
        expect(err.response.status).to.equal(500),
      );
      expect(clients["salto-ks"].users.size).to.equal(1);
    });

    it("answers a grant without any id as nothing to revoke", async () => {
      const revocation = await provider.revokeAuthorization(SALTO_DOOR, {
        authorizationId: null,
        externalPrincipalId: null,
        secret: null,
      });

      expect(revocation).to.deep.equal({ principalRemoved: null });
    });

    it("maps a failure of the open call itself to an AccessOpenError", async () => {
      clients["salto-ks"].openError = saltoHttpError(500, {
        Message: "Internal error",
      });

      try {
        await provider.open(SALTO_DOOR, doorContext());
        throw new Error("expected open to throw");
      } catch (err) {
        expect(err).to.be.instanceOf(AccessOpenError);
        expect(err.failureClass).to.equal("temporary");
      }
    });

    it("maps a client failure before the open call to a temporary AccessOpenError", async () => {
      const broken = new SaltoKsAccessProvider({
        client: brokenSaltoKsApiClient(),
      });

      await rejectsOpen(broken.open(SALTO_DOOR, doorContext()), "temporary");
    });

    it("maps a refused lock listing to a configuration AccessOpenError", async () => {
      const broken = new SaltoKsAccessProvider({
        client: brokenSaltoKsApiClient(
          saltoHttpError(403, { Message: "Forbidden" }),
        ),
      });

      await rejectsOpen(
        broken.open(SALTO_DOOR, doorContext()),
        "configuration",
      );
    });

    it("maps a lock Salto does not list to a configuration AccessOpenError", async () => {
      await rejectsOpen(
        provider.open(
          { ...SALTO_DOOR, externalId: "no-such-lock" },
          doorContext(),
        ),
        "configuration",
        "does not list lock",
      );
    });
  });

  describe("iFBS", () => {
    let provider;
    const lockerContext = (overrides = {}) =>
      doorContext({ externalBookingId: IFBS_BOOKING_ID, ...overrides });
    const futureContext = () => {
      const now = Date.now();
      return lockerContext({
        timeBegin: now + 10 * MINUTE,
        timeEnd: now + 70 * MINUTE,
        accessFrom: now + 10 * MINUTE,
        accessTo: now + 70 * MINUTE,
      });
    };

    beforeEach(() => {
      provider = new IfbsAccessProvider({ client: clients.ifbs });
      sinon.stub(UserManager, "getRawUser").resolves(null);
    });

    afterEach(() => {
      sinon.restore();
    });

    it("answers an open as pending, with the open-box process to poll", async () => {
      const outcome = await provider.open(IFBS_LOCKER, lockerContext());

      expect(outcome).to.deep.equal({ state: "pending", openProcessId: "1" });
    });

    it("declares no close: iFBS has no command to close a box", async () => {
      expect(IfbsAccessProvider.capabilities).not.to.include("close");

      await rejects(
        provider.close(IFBS_LOCKER, lockerContext()),
        Error,
        "close() is not supported by",
      );
    });

    it("declares no getStatus: without an open process iFBS knows nothing about a box", async () => {
      expect(IfbsAccessProvider.capabilities).not.to.include("getStatus");

      await rejects(
        provider.getStatus(IFBS_LOCKER, lockerContext()),
        Error,
        "getStatus() is not supported by",
      );
    });

    it("answers the progress of an open process as an OpenProgress", async () => {
      const outcome = await provider.open(IFBS_LOCKER, lockerContext());

      const progress = await provider.getOpenProgress(
        IFBS_LOCKER,
        outcome.openProcessId,
      );

      expect(progress).to.deep.equal({
        confirmed: true,
        confirmedAt: "2026-09-02 10:00:02",
        errorCode: null,
        errorMessage: null,
      });
    });

    it("answers a box that has not confirmed yet as not confirmed", async () => {
      clients.ifbs.confirmsOnWait = false;
      const outcome = await provider.open(IFBS_LOCKER, lockerContext());

      const progress = await provider.getOpenProgress(
        IFBS_LOCKER,
        outcome.openProcessId,
      );

      expect(progress).to.deep.equal({
        confirmed: false,
        confirmedAt: null,
        errorCode: null,
        errorMessage: null,
      });
    });

    it("answers a failed poll with confirmed unknown and the iFBS error number and message", async () => {
      const progress = await provider.getOpenProgress(IFBS_LOCKER, "99");

      expect(progress).to.deep.equal({
        confirmed: null,
        confirmedAt: null,
        errorCode: ERR_NO_WAIT_PROCESS_NOT_FOUND,
        errorMessage: "OpenBox process not found",
      });
    });

    it("answers an unreachable API on a poll as confirmed unknown, with the network error", async () => {
      const broken = new IfbsAccessProvider({ client: brokenIfbsApiClient() });

      const progress = await broken.getOpenProgress(IFBS_LOCKER, "1");

      expect(progress).to.deep.equal({
        confirmed: null,
        confirmedAt: null,
        errorCode: null,
        errorMessage: "connect ECONNREFUSED",
      });
    });

    it("maps a broken client to a temporary AccessOpenError on an open", async () => {
      const broken = new IfbsAccessProvider({ client: brokenIfbsApiClient() });

      await rejectsOpen(
        broken.open(IFBS_LOCKER, lockerContext()),
        "temporary",
        "ECONNREFUSED",
      );
    });

    it("maps an iFBS refusal to a temporary AccessOpenError carrying the error number", async () => {
      await rejectsOpen(
        provider.open(IFBS_LOCKER, doorContext({ externalBookingId: "gone" })),
        "temporary",
        "(1701): Booking not found",
      );
    });

    it("answers a hold with the box iFBS chose, lapsing in two minutes", async () => {
      const context = lockerContext();
      const before = Date.now();

      const hold = await provider.hold(IFBS_LOCKER, context);

      expect(hold).to.include({ holdId: "100", compartment: IFBS_BOX_NUMBER });
      expect(hold.metadata).to.deep.equal({
        boxId: `box-${IFBS_BOX_NUMBER}`,
        price: "1.50",
      });
      expect(hold.expiresAt).to.be.within(
        before + HOLD_TTL_MS,
        Date.now() + HOLD_TTL_MS,
      );
      const [held] = clients.ifbs.bookingsInState("held");
      expect(held).to.include({
        Booking_ID: "100",
        nummer: IFBS_BOX_NUMBER,
        LocationID: IFBS_LOCATION_ID,
        from: IfbsApiClient.formatDate(context.timeBegin),
        to: IfbsApiClient.formatDate(context.timeEnd),
        userId: 1,
      });
    });

    it("asks iFBS for the box in the name of the booking's user, by the user's database id", async () => {
      UserManager.getRawUser.resolves({ _id: "64f1" });

      await provider.hold(
        IFBS_LOCKER,
        lockerContext({
          booking: { assignedUserId: "erika@example.test" },
        }),
      );

      expect(UserManager.getRawUser.firstCall.args).to.deep.equal([
        "erika@example.test",
      ]);
      expect(clients.ifbs.bookingsInState("held")[0].userId).to.equal("0164f1");
    });

    it("throws iFBS' own refusal when the location has no box left", async () => {
      await provider.hold(IFBS_LOCKER, lockerContext());

      await rejectsRaw(provider.hold(IFBS_LOCKER, lockerContext()), (err) => {
        expect(err).to.be.instanceOf(IfbsApiError);
        expect(err.errNo).to.equal(1201);
      });
    });

    it("renews a hold by holding again: a fresh Booking_ID, the box iFBS chooses", async () => {
      clients.ifbs.locations.get(IFBS_LOCATION_ID).boxes.push("62100104");
      const context = lockerContext();
      const first = await provider.hold(IFBS_LOCKER, context);

      const renewed = await provider.refreshHold(IFBS_LOCKER, {
        ...context,
        hold: first,
      });

      expect(renewed.holdId).to.equal("101");
      expect(renewed.compartment).to.equal("62100104");
    });

    it("confirms the held box on a grant, proving it with the checksum, and answers the Booking_ID as the grant", async () => {
      const context = lockerContext();
      const hold = await provider.hold(IFBS_LOCKER, context);

      const grant = await provider.grantAuthorization(IFBS_LOCKER, {
        ...context,
        hold,
      });

      expect(grant).to.deep.equal({
        authorizationId: "100",
        externalPrincipalId: null,
        secret: null,
        compartment: IFBS_BOX_NUMBER,
        metadata: { boxId: `box-${IFBS_BOX_NUMBER}`, price: "1.50" },
      });
      expect(clients.ifbs.bookings.get("100").state).to.equal("booked");
    });

    it("takes a fresh box on a grant when the hold lapsed", async () => {
      const clock = sinon.useFakeTimers({
        now: Date.now(),
        toFake: ["Date"],
      });
      const context = lockerContext();
      const hold = await provider.hold(IFBS_LOCKER, context);
      clock.tick(HOLD_TTL_MS + 1);

      const grant = await provider.grantAuthorization(IFBS_LOCKER, {
        ...context,
        hold,
      });

      expect(grant.authorizationId).to.equal("101");
      expect(clients.ifbs.bookings.get("101").state).to.equal("booked");
      clock.restore();
    });

    it("grants without a hold by taking a box first", async () => {
      const grant = await provider.grantAuthorization(
        IFBS_LOCKER,
        lockerContext(),
      );

      expect(grant.authorizationId).to.equal("100");
      expect(clients.ifbs.bookingsInState("booked")).to.have.length(2);
    });

    it("throws iFBS' own refusal when it rejects the confirmation", async () => {
      const context = lockerContext();
      const hold = await provider.hold(IFBS_LOCKER, context);

      await rejectsRaw(
        provider.grantAuthorization(IFBS_LOCKER, {
          ...context,
          hold: { ...hold, compartment: "wrong" },
        }),
        (err) => {
          expect(err).to.be.instanceOf(IfbsApiError);
          expect(err.errMsg).to.equal("Invalid checksum");
        },
      );
    });

    it("revokes a booking that has not begun by cancelling the usage", async () => {
      const grant = await provider.grantAuthorization(
        IFBS_LOCKER,
        futureContext(),
      );

      const revocation = await provider.revokeAuthorization(IFBS_LOCKER, grant);

      expect(revocation).to.deep.equal({ principalRemoved: null });
      expect(clients.ifbs.bookings.get(grant.authorizationId).state).to.equal(
        "cancelled",
      );
    });

    it("revokes a booking that has begun by ending the usage as of now", async () => {
      const grant = await provider.grantAuthorization(
        IFBS_LOCKER,
        lockerContext(),
      );

      const revocation = await provider.revokeAuthorization(IFBS_LOCKER, grant);

      expect(revocation).to.deep.equal({ principalRemoved: null });
      const booking = clients.ifbs.bookings.get(grant.authorizationId);
      expect(booking.state).to.equal("ended");
      expect(booking.endedAt).to.equal(IfbsApiClient.formatDate(Date.now()));
    });

    it("tolerates revoking a booking iFBS no longer has", async () => {
      const grant = await provider.grantAuthorization(
        IFBS_LOCKER,
        futureContext(),
      );
      await provider.revokeAuthorization(IFBS_LOCKER, grant);

      const again = await provider.revokeAuthorization(IFBS_LOCKER, grant);
      const never = await provider.revokeAuthorization(IFBS_LOCKER, {
        authorizationId: "unknown",
        externalPrincipalId: null,
        secret: null,
      });

      expect(again).to.deep.equal({ principalRemoved: null });
      expect(never).to.deep.equal({ principalRemoved: null });
    });

    it("throws the network error when iFBS cannot be reached on a revoke", async () => {
      const broken = new IfbsAccessProvider({ client: brokenIfbsApiClient() });

      await rejectsRaw(
        broken.revokeAuthorization(IFBS_LOCKER, {
          authorizationId: "100",
          externalPrincipalId: null,
          secret: null,
        }),
        (err) => expect(err.code).to.equal("ECONNREFUSED"),
      );
    });

    it("lists the locations as locker access points that open remotely", async () => {
      const points = await provider.listAccessPoints(TENANT);

      expect(points).to.deep.equal([
        {
          id: IFBS_LOCATION_ID,
          type: "locker",
          provider: "ifbs",
          externalId: IFBS_LOCATION_ID,
          locationId: IFBS_LOCATION_ID,
          label: "Bahnhof",
          capabilities: ["remote"],
          supportedModes: [AccessPointMode.REMOTE],
          metadata: { LocationID: IFBS_LOCATION_ID, Name: "Bahnhof" },
        },
      ]);
    });

    const ifbsApplication = (type) => ({
      id: TENANT,
      applications: [
        {
          type,
          id: "ifbs",
          active: true,
          serverUrl: "https://ifbs.example.test/api",
          apiKey: "key",
          secretPhrase: "phrase",
        },
      ],
    });

    it("builds its client from the tenant's iFBS access application", async () => {
      sinon
        .stub(TenantManager, "getTenant")
        .resolves(ifbsApplication("access"));

      const client = await new IfbsAccessProvider()._getClient(TENANT);

      expect(client).to.be.instanceOf(IfbsApiClient);
      expect(client).to.include({ apiKey: "key", secretPhrase: "phrase" });
    });

    it("no longer looks under the locker application type the migration retired", async () => {
      sinon
        .stub(TenantManager, "getTenant")
        .resolves(ifbsApplication("locker"));

      await rejects(
        new IfbsAccessProvider()._getClient(TENANT),
        Error,
        "ifbs_application_not_found",
      );
    });

    it("maps a missing iFBS application to a configuration AccessOpenError", async () => {
      sinon.stub(TenantManager, "getTenant").resolves(tenantWithSaltoApp());

      await rejectsOpen(
        new IfbsAccessProvider().open(IFBS_LOCKER, lockerContext()),
        "configuration",
        "ifbs_application_not_found",
      );
    });
  });

  describe("Pareva", () => {
    let provider;

    beforeEach(() => {
      provider = new ParevaAccessProvider({ client: clients.pareva });
      sinon.stub(TenantManager, "getTenant").resolves(tenantWithSaltoApp());
    });

    afterEach(() => {
      sinon.restore();
    });

    it("declares neither open nor getStatus nor hold: Pareva hands out the code itself, and the stored booking is the claim", () => {
      expect(ParevaAccessProvider.capabilities).to.deep.equal([
        "grantAuthorization",
        "revokeAuthorization",
        "listAccessPoints",
      ]);
    });

    it("answers a grant as a Grant: the rental's process, no principal, no secret", async () => {
      const context = doorContext();

      const grant = await provider.grantAuthorization(PAREVA_LOCKER, context);

      expect(grant).to.deep.equal({
        authorizationId: "process-1",
        externalPrincipalId: null,
        secret: null,
      });
      expect(clients.pareva.rentalsInState("open")).to.deep.equal([
        {
          processId: "process-1",
          size: PAREVA_SIZE,
          state: "open",
          managerAssignment: false,
          email: "erika@example.test",
          plannedBegin: String(context.timeBegin),
          date_estimate_delivery: String(context.timeEnd - context.timeBegin),
          fromEmail: TENANT_MAIL,
          itemName: "",
          additionalInfo: {},
        },
      ]);
    });

    it("throws Pareva's own error when it does not offer the size", async () => {
      await rejectsRaw(
        provider.grantAuthorization(
          { ...PAREVA_LOCKER, externalId: "XXL" },
          doorContext(),
        ),
        (err) => expect(err.response.status).to.equal(404),
      );
    });

    it("throws when Pareva answers a rental without a process", async () => {
      sinon.stub(clients.pareva, "startRental").resolves({});

      await rejects(
        provider.grantAuthorization(PAREVA_LOCKER, doorContext()),
        Error,
        "without a processId",
      );
    });

    it("revokes by cancelling the rental, with no principal to remove", async () => {
      const grant = await provider.grantAuthorization(
        PAREVA_LOCKER,
        doorContext(),
      );

      const revocation = await provider.revokeAuthorization(
        PAREVA_LOCKER,
        grant,
      );

      expect(revocation).to.deep.equal({ principalRemoved: null });
      expect(clients.pareva.rentals.get("process-1").state).to.equal(
        "cancelled",
      );
    });

    it("tolerates revoking a rental Pareva no longer has", async () => {
      const grant = await provider.grantAuthorization(
        PAREVA_LOCKER,
        doorContext(),
      );
      await provider.revokeAuthorization(PAREVA_LOCKER, grant);

      const again = await provider.revokeAuthorization(PAREVA_LOCKER, grant);

      expect(again).to.deep.equal({ principalRemoved: null });
    });

    it("throws when Pareva refuses the cancel, since the person keeps the compartment", async () => {
      sinon
        .stub(clients.pareva, "cancelRental")
        .resolves({ success: false, reason: "already picked up" });

      await rejects(
        provider.revokeAuthorization(PAREVA_LOCKER, {
          authorizationId: "process-1",
          externalPrincipalId: null,
          secret: null,
        }),
        Error,
        "refused to cancel rental 'process-1': already picked up",
      );
    });

    it("throws Pareva's own error when the cancel fails for any other reason", async () => {
      const broken = new ParevaAccessProvider({
        client: brokenParevaApiClient(parevaHttpError(500)),
      });

      await rejectsRaw(
        broken.revokeAuthorization(PAREVA_LOCKER, {
          authorizationId: "process-1",
          externalPrincipalId: null,
          secret: null,
        }),
        (err) => expect(err.response.status).to.equal(500),
      );
    });

    it("lists the sizes as locker access points that take a code, located at the locker system", async () => {
      const points = await provider.listAccessPoints(TENANT);

      expect(points).to.deep.equal([
        {
          id: PAREVA_SIZE,
          type: "locker",
          provider: "pareva",
          externalId: PAREVA_SIZE,
          locationId: PAREVA_LOCKER_ID,
          label: PAREVA_SIZE,
          capabilities: ["authorization"],
          supportedModes: [AccessPointMode.AUTHORIZATION],
          metadata: { size: PAREVA_SIZE },
        },
      ]);
    });

    const parevaApplication = (type) => ({
      id: TENANT,
      applications: [
        {
          type,
          id: "pareva",
          active: true,
          serverUrl: "https://pareva.example.test",
          lockerId: "L1",
          user: "user",
          password: "password",
        },
      ],
    });

    it("builds its client from the tenant's Pareva access application", async () => {
      TenantManager.getTenant.resolves(parevaApplication("access"));

      const client = await new ParevaAccessProvider()._getClient(TENANT);

      expect(client).to.be.instanceOf(ParevaApiClient);
      expect(client.lockerId).to.equal("L1");
    });

    it("no longer looks under the locker application type the migration retired", async () => {
      TenantManager.getTenant.resolves(parevaApplication("locker"));

      await rejects(
        new ParevaAccessProvider()._getClient(TENANT),
        Error,
        "pareva_application_not_found",
      );
    });

    it("throws pareva_application_not_found for a tenant without one", async () => {
      await rejects(
        new ParevaAccessProvider().grantAuthorization(
          PAREVA_LOCKER,
          doorContext(),
        ),
        Error,
        "pareva_application_not_found",
      );
    });
  });
});

describe("access provider dialects: what AccessService makes of them", () => {
  let sandbox;
  let clients;

  function registerFakeProviders() {
    registerAccessProvider(
      "nuki",
      class extends NukiAccessProvider {
        constructor() {
          super({ client: clients.nuki });
        }
      },
    );
    registerAccessProvider(
      "salto-ks",
      class extends SaltoKsAccessProvider {
        constructor() {
          super({ client: clients["salto-ks"] });
        }
      },
    );
    registerAccessProvider(
      "ifbs",
      class extends IfbsAccessProvider {
        constructor() {
          super({ client: clients.ifbs });
        }
      },
    );
    registerAccessProvider(
      "pareva",
      class extends ParevaAccessProvider {
        constructor() {
          super({ client: clients.pareva });
        }
      },
    );
    registerAccessProvider(
      IN_MEMORY_PROVIDER_ID,
      class extends InMemoryAccessProvider {
        constructor() {
          super({ locks: [{ externalId: "lock-1", label: "Main door" }] });
        }
      },
    );
  }

  after(() => {
    registerAccessProvider("nuki", NukiAccessProvider);
    registerAccessProvider("salto-ks", SaltoKsAccessProvider);
    registerAccessProvider("ifbs", IfbsAccessProvider);
    registerAccessProvider("pareva", ParevaAccessProvider);
  });

  beforeEach(() => {
    sandbox = sinon.createSandbox();
    clients = createClients();
    registerFakeProviders();
  });

  afterEach(() => {
    sandbox.restore();
  });

  function createBooking(overrides = {}) {
    const now = Date.now();
    return new Booking({
      id: "booking-1",
      tenantId: TENANT,
      assignedUserId: "user-1",
      isCommitted: true,
      isPayed: true,
      priceEur: 0,
      timeBegin: now - 5 * MINUTE,
      timeEnd: now + 55 * MINUTE,
      bookableItems: [{ bookableId: "room" }],
      accessInfo: [],
      lockerInfo: [],
      mail: "erika@example.test",
      name: "Erika Muster",
      ...overrides,
    });
  }

  /**
   * Answers every read the service makes to resolve the access points of a
   * booking, at the data-manager boundary: one bookable with the given doors.
   */
  function stubBooking(booking, doors = []) {
    sandbox.stub(BookingManager, "getBooking").resolves(booking);
    sandbox.stub(BookingManager, "storeBooking").resolves(booking);
    sandbox.stub(BookableManager, "getBookablesByIds").resolves([
      {
        id: "room",
        title: "Room",
        accessPointDetails: {
          active: true,
          accessPointIds: doors.map((door) => door.id),
        },
      },
    ]);
    sandbox.stub(BookableManager, "getRelatedBookables").resolves([]);
    sandbox.stub(BookableManager, "getAllParentBookables").resolves([]);
    sandbox.stub(AccessPointManager, "getAccessPointsByIds").resolves(doors);
    sandbox
      .stub(AccessPointManager, "getAccessPoint")
      .callsFake(async (id) => doors.find((door) => door.id === id) || null);
    sandbox.stub(AccessLogService, "log").resolves();
    sandbox.stub(mailModule, "notify").resolves([]);
    sandbox.stub(PermissionsService, "_isOwner").returns(true);
    sandbox.stub(TenantManager, "getTenant").resolves(tenantWithSaltoApp());
  }

  /**
   * A booking with one box booked at the iFBS location: the compartment's
   * entry at the location's row, granted under the iFBS booking id.
   */
  function lockerBooking() {
    return createBooking({
      accessInfo: [
        {
          accessPointId: IFBS_LOCKER.id,
          accessPointType: "locker",
          provider: "ifbs",
          externalId: IFBS_LOCATION_ID,
          mode: AccessPointMode.REMOTE,
          bookableId: "room",
          hold: null,
          compartment: IFBS_BOX_NUMBER,
          externalBookingId: IFBS_BOOKING_ID,
          isProvisioned: true,
          revokedAt: null,
          grant: {
            authorizationId: IFBS_BOOKING_ID,
            externalPrincipalId: null,
            secret: null,
          },
        },
      ],
    });
  }

  function loggedPayload(action) {
    return AccessLogService.log.args
      .map(([entry]) => entry)
      .find((entry) => entry.action === action);
  }

  describe("open", () => {
    it("answers a NUKI open with no process to poll and audits the outcome", async () => {
      stubBooking(createBooking(), [REMOTE_NUKI_DOOR]);

      const outcome = await AccessService.open(
        TENANT,
        "booking-1",
        "door-1",
        "user-1",
      );

      expect(outcome).to.deep.equal({
        success: true,
        data: { openProcessId: null },
      });
      expect(loggedPayload("open").payload).to.deep.equal({
        state: "opened",
        openProcessId: null,
        validatedEvidence: [],
      });
    });

    it("answers an iFBS open with the open-box process to poll and audits the outcome", async () => {
      stubBooking(lockerBooking(), [IFBS_LOCKER]);

      const outcome = await AccessService.open(
        TENANT,
        "booking-1",
        IFBS_COMPARTMENT,
        "user-1",
      );

      expect(outcome).to.deep.equal({
        success: true,
        data: { openProcessId: "1" },
      });
      expect(loggedPayload("open").payload).to.deep.equal({
        state: "pending",
        openProcessId: "1",
        validatedEvidence: [],
      });
    });

    it("answers a Salto open with no process to poll and audits the outcome", async () => {
      stubBooking(createBooking(), [REMOTE_SALTO_DOOR]);

      const outcome = await AccessService.open(
        TENANT,
        "booking-1",
        "door-2",
        "user-1",
      );

      expect(outcome).to.deep.equal({
        success: true,
        data: { openProcessId: null },
      });
      expect(loggedPayload("open").payload).to.deep.equal({
        state: "opened",
        openProcessId: null,
        validatedEvidence: [],
      });
    });

    it("opens through the in-memory provider like any other", async () => {
      stubBooking(createBooking(), [IN_MEMORY_DOOR]);

      const outcome = await AccessService.open(
        TENANT,
        "booking-1",
        "door-3",
        "user-1",
      );

      expect(outcome).to.deep.equal({
        success: true,
        data: { openProcessId: null },
      });
      expect(loggedPayload("open")).to.include({ result: "success" });
    });

    it("rethrows NUKI's classified AccessOpenError after auditing the failure", async () => {
      clients.nuki = brokenNukiApiClient();
      registerFakeProviders();
      stubBooking(createBooking(), [REMOTE_NUKI_DOOR]);

      await rejectsOpen(
        AccessService.open(TENANT, "booking-1", "door-1", "user-1"),
        "temporary",
      );
      expect(loggedPayload("open")).to.include({ result: "failure" });
      expect(loggedPayload("open").errorMessage).to.include(
        "Request failed with status code 500",
      );
    });

    it("rethrows Salto's classified AccessOpenError after auditing the failure", async () => {
      clients["salto-ks"].openError = saltoHttpError(403, {
        ErrorCode: 1001,
        Message: "Forbidden",
      });
      stubBooking(createBooking(), [REMOTE_SALTO_DOOR]);

      await assert.rejects(
        AccessService.open(TENANT, "booking-1", "door-2", "user-1"),
        (err) => {
          expect(err).to.be.instanceOf(AccessOpenError);
          expect(err.failureClass).to.equal("configuration");
          return true;
        },
      );
      expect(loggedPayload("open")).to.include({ result: "failure" });
      expect(loggedPayload("open").errorMessage).to.include("Forbidden");
    });
  });

  describe("getStatus", () => {
    it("answers NUKI's LockStatus with its source, and audits the LockStatus", async () => {
      stubBooking(createBooking(), [NUKI_DOOR]);

      const status = await AccessService.getStatus(
        TENANT,
        "booking-1",
        "door-1",
      );

      expect(status).to.deep.equal({
        open: false,
        locked: true,
        doorOpen: null,
        statusSource: "provider_status",
      });
      expect(loggedPayload("status").payload).to.deep.equal({
        open: false,
        locked: true,
        doorOpen: null,
      });
    });

    it("passes NUKI's door sensor through", async () => {
      clients = createClients({
        nukiSmartlocks: [nukiSmartlock({ state: { state: 3, doorState: 3 } })],
      });
      registerFakeProviders();
      stubBooking(createBooking(), [NUKI_DOOR]);

      const status = await AccessService.getStatus(
        TENANT,
        "booking-1",
        "door-1",
      );

      expect(status).to.deep.equal({
        open: true,
        locked: false,
        doorOpen: true,
        statusSource: "provider_status",
      });
    });

    const saltoStates = [
      { lockedState: "locked", expected: { open: false, locked: true } },
      { lockedState: "unlocked", expected: { open: true, locked: false } },
      { lockedState: undefined, expected: { open: null, locked: null } },
    ];

    for (const { lockedState, expected } of saltoStates) {
      it(`answers Salto's locked_state '${lockedState}' as the adapter maps it`, async () => {
        clients = createClients({
          saltoLocks: [saltoLock({ locked_state: lockedState })],
        });
        registerFakeProviders();
        stubBooking(createBooking(), [SALTO_DOOR]);

        const status = await AccessService.getStatus(
          TENANT,
          "booking-1",
          "door-2",
        );

        expect(status).to.deep.equal({
          ...expected,
          doorOpen: null,
          statusSource: "provider_status",
        });
      });
    }

    it("answers unknown for an iFBS locker without asking, since its provider declares no getStatus", async () => {
      clients.ifbs = brokenIfbsApiClient();
      registerFakeProviders();
      stubBooking(lockerBooking(), [IFBS_LOCKER]);

      const status = await AccessService.getStatus(
        TENANT,
        "booking-1",
        IFBS_COMPARTMENT,
      );

      expect(status).to.deep.equal({
        open: null,
        locked: null,
        doorOpen: null,
        statusSource: "provider_status",
      });
      expect(loggedPayload("status").payload).to.deep.equal({
        open: null,
        locked: null,
        doorOpen: null,
      });
    });

    it("reads the in-memory provider's booleans as they are", async () => {
      stubBooking(createBooking(), [IN_MEMORY_DOOR]);

      const status = await AccessService.getStatus(
        TENANT,
        "booking-1",
        "door-3",
      );

      expect(status).to.deep.equal({
        open: false,
        locked: true,
        doorOpen: null,
        statusSource: "provider_status",
      });
    });
  });

  describe("getOpenStatus", () => {
    it("polls the iFBS open process where the provider declares getOpenProgress", async () => {
      stubBooking(lockerBooking(), [IFBS_LOCKER]);
      await clients.ifbs.openBox("booking-17");

      const status = await AccessService.getOpenStatus(
        TENANT,
        "booking-1",
        IFBS_COMPARTMENT,
        "1",
      );

      expect(status).to.deep.equal({
        open: true,
        locked: false,
        doorOpen: null,
        statusSource: "open_process",
        confirmed: true,
        errorCode: null,
        errorMessage: null,
      });
    });

    it("reports a failed iFBS poll as unknown, with the error", async () => {
      stubBooking(lockerBooking(), [IFBS_LOCKER]);

      const status = await AccessService.getOpenStatus(
        TENANT,
        "booking-1",
        IFBS_COMPARTMENT,
        "99",
      );

      expect(status).to.deep.equal({
        open: null,
        locked: null,
        doorOpen: null,
        statusSource: "open_process",
        confirmed: null,
        errorCode: ERR_NO_WAIT_PROCESS_NOT_FOUND,
        errorMessage: "OpenBox process not found",
      });
    });

    it("ignores an open process id where the provider declares no getOpenProgress", async () => {
      stubBooking(createBooking(), [NUKI_DOOR]);

      const status = await AccessService.getOpenStatus(
        TENANT,
        "booking-1",
        "door-1",
        "42",
      );

      expect(status).to.deep.equal({
        open: false,
        locked: true,
        doorOpen: null,
        statusSource: "provider_status",
        confirmed: null,
        errorCode: null,
        errorMessage: null,
      });
    });

    it("reads a failed last webhook event as not open, unknown whether locked", async () => {
      const booking = createBooking({
        accessInfo: [
          {
            accessPointId: "door-1",
            lastEvent: { success: false, timestamp: 1725270000000 },
          },
        ],
      });
      stubBooking(booking, [NUKI_DOOR]);

      const status = await AccessService.getOpenStatus(
        TENANT,
        "booking-1",
        "door-1",
        null,
      );

      expect(status).to.deep.equal({
        open: false,
        locked: null,
        doorOpen: null,
        statusSource: "last_event",
        confirmed: false,
        errorCode: null,
        errorMessage: null,
      });
    });

    it("prefers the last webhook event over the lock's state", async () => {
      const booking = createBooking({
        accessInfo: [
          {
            accessPointId: "door-1",
            lastEvent: { success: true, timestamp: 1725270000000 },
          },
        ],
      });
      stubBooking(booking, [NUKI_DOOR]);

      const status = await AccessService.getOpenStatus(
        TENANT,
        "booking-1",
        "door-1",
        null,
      );

      expect(status).to.deep.equal({
        open: true,
        locked: false,
        doorOpen: null,
        statusSource: "last_event",
        confirmed: true,
        errorCode: null,
        errorMessage: null,
      });
    });
  });

  describe("the projection of an open's progress onto the status endpoint", () => {
    it("reports an iFBS open the box has not confirmed yet as not open, unknown whether locked", async () => {
      clients.ifbs.confirmsOnWait = false;
      stubBooking(lockerBooking(), [IFBS_LOCKER]);
      await clients.ifbs.openBox("booking-17");

      const status = await AccessService.getOpenStatus(
        TENANT,
        "booking-1",
        IFBS_COMPARTMENT,
        "1",
      );

      expect(status).to.deep.equal({
        open: false,
        locked: null,
        doorOpen: null,
        statusSource: "open_process",
        confirmed: false,
        errorCode: null,
        errorMessage: null,
      });
    });

    it("audits the OpenProgress of a polled process, and the event behind a last-event answer", async () => {
      stubBooking(lockerBooking(), [IFBS_LOCKER]);
      await clients.ifbs.openBox("booking-17");

      await AccessService.getOpenStatus(
        TENANT,
        "booking-1",
        IFBS_COMPARTMENT,
        "1",
      );

      expect(loggedPayload("status").payload).to.deep.equal({
        confirmed: true,
        confirmedAt: "2026-09-02 10:00:02",
        errorCode: null,
        errorMessage: null,
      });
    });
  });

  describe("close", () => {
    it("locks a NUKI door and answers with the state read afterwards", async () => {
      clients = createClients({
        nukiSmartlocks: [nukiSmartlock({ state: { state: 3 } })],
      });
      registerFakeProviders();
      stubBooking(createBooking(), [NUKI_DOOR]);

      const status = await AccessService.close(
        TENANT,
        "booking-1",
        "door-1",
        "user-1",
      );

      expect(clients.nuki.actions).to.deep.equal([
        { smartlockId: "1001", action: NUKI_ACTIONS.LOCK },
      ]);
      expect(status).to.deep.equal({
        open: false,
        locked: true,
        doorOpen: null,
        statusSource: "provider_status",
      });
    });

    it("fails on a Salto door, which declares no close", async () => {
      stubBooking(createBooking(), [SALTO_DOOR]);

      await rejects(
        AccessService.close(TENANT, "booking-1", "door-2", "user-1"),
        Error,
        "close() is not supported by",
      );
      expect(loggedPayload("close")).to.include({ result: "failure" });
    });

    it("fails on an iFBS locker, which declares no close", async () => {
      stubBooking(lockerBooking(), [IFBS_LOCKER]);

      await rejects(
        AccessService.close(TENANT, "booking-1", IFBS_COMPARTMENT, "user-1"),
        Error,
        "close() is not supported by",
      );
      expect(loggedPayload("close")).to.include({ result: "failure" });
    });
  });

  describe("provisionForBooking", () => {
    it("stores a NUKI grant in accessInfo with its secret encrypted, and mails the secret once", async () => {
      const booking = createBooking();
      stubBooking(booking, [NUKI_DOOR]);

      const accessInfo = await AccessService.provisionForBooking(
        TENANT,
        "booking-1",
      );

      expect(accessInfo).to.have.length(1);
      const [entry] = accessInfo;
      expect(Object.keys(entry).sort()).to.deep.equal([
        "accessPointId",
        "accessPointType",
        "externalId",
        "grant",
        "isProvisioned",
        "mode",
        "principalCleanupAttemptedAt",
        "principalCleanupError",
        "principalRemovedAt",
        "provider",
        "provisionedAt",
        "revokedAt",
      ]);
      expect(entry).to.include({
        accessPointId: "door-1",
        accessPointType: "door",
        provider: "nuki",
        externalId: "1001",
        mode: AccessPointMode.AUTHORIZATION,
        isProvisioned: true,
        revokedAt: null,
        principalRemovedAt: null,
        principalCleanupAttemptedAt: null,
        principalCleanupError: null,
      });
      expect(entry.provisionedAt).to.be.a("number");
      expect(entry.grant).to.include({
        authorizationId: "auth-1",
        externalPrincipalId: null,
      });

      const secret = SecurityUtils.decrypt(entry.grant.secret);
      expect(secret).to.match(/^\d{6}$/);

      expect(mailModule.notify.calledOnce).to.be.true;
      expect(mailModule.notify.firstCall.args).to.deep.equal([
        "ACCESS_PROVISIONED",
        {
          tenantId: TENANT,
          bookingIds: ["booking-1"],
          accessPoints: [
            {
              accessPointId: "door-1",
              label: "Main door",
              provider: "nuki",
              bookableTitle: "Room",
              pin: secret,
            },
          ],
        },
      ]);
      expect(BookingManager.storeBooking.calledOnceWith(booking)).to.be.true;
    });

    it("audits the grant without its secret", async () => {
      stubBooking(createBooking(), [NUKI_DOOR]);

      await AccessService.provisionForBooking(TENANT, "booking-1");

      expect(loggedPayload("provision").payload).to.deep.equal({
        grant: { authorizationId: "auth-1", externalPrincipalId: null },
      });
    });

    it("stores a Salto grant with the guest as its external principal", async () => {
      stubBooking(createBooking(), [SALTO_DOOR]);

      const [entry] = await AccessService.provisionForBooking(
        TENANT,
        "booking-1",
      );

      expect(entry).to.include({ provider: "salto-ks", isProvisioned: true });
      expect(entry.grant).to.include({
        authorizationId: "access-2",
        externalPrincipalId: "user-1",
      });
      expect(SecurityUtils.decrypt(entry.grant.secret)).to.match(/^\d{6}$/);
      expect(loggedPayload("provision").payload).to.deep.equal({
        grant: { authorizationId: "access-2", externalPrincipalId: "user-1" },
      });
    });

    it("leaves a door alone that already holds a grant", async () => {
      stubBooking(createBooking(), [NUKI_DOOR]);
      await AccessService.provisionForBooking(TENANT, "booking-1");

      await AccessService.provisionForBooking(TENANT, "booking-1");

      expect(clients.nuki.authorizations.size).to.equal(1);
    });

    it("grants nothing at a door whose lock does not support the mode, and audits why", async () => {
      clients = createClients({
        nukiSmartlocks: [nukiSmartlock({ config: {} })],
      });
      registerFakeProviders();
      stubBooking(createBooking(), [NUKI_DOOR]);

      const accessInfo = await AccessService.provisionForBooking(
        TENANT,
        "booking-1",
      );

      expect(accessInfo).to.deep.equal([]);
      expect(clients.nuki.authorizations.size).to.equal(0);
      expect(loggedPayload("provision")).to.include({
        result: "failure",
        errorMessage:
          "Access mode 'authorization' is not supported by access point 'door-1'",
      });
    });
  });

  describe("revokeForBooking", () => {
    it("records a Salto revoke with the guest removed, keeping the grant for the record", async () => {
      const booking = createBooking();
      stubBooking(booking, [SALTO_DOOR]);
      await AccessService.provisionForBooking(TENANT, "booking-1");

      const [entry] = await AccessService.revokeForBooking(TENANT, "booking-1");

      expect(entry).to.include({
        isProvisioned: false,
        principalCleanupError: null,
      });
      expect(entry.revokedAt).to.be.a("number");
      expect(entry.principalRemovedAt).to.be.a("number");
      expect(entry.grant).to.include({
        authorizationId: "access-2",
        externalPrincipalId: "user-1",
      });
      expect(clients["salto-ks"].accesses.size).to.equal(0);
      expect(clients["salto-ks"].users.size).to.equal(0);
      expect(loggedPayload("revoke").payload).to.deep.equal({
        grant: { authorizationId: "access-2", externalPrincipalId: "user-1" },
        revocation: { principalRemoved: true },
      });
    });

    it("keeps a guest that could not be removed as a cleanup error for the job", async () => {
      stubBooking(createBooking(), [SALTO_DOOR]);
      await AccessService.provisionForBooking(TENANT, "booking-1");
      sandbox
        .stub(clients["salto-ks"], "deleteUser")
        .rejects(saltoHttpError(500, { Message: "Internal error" }));

      const [entry] = await AccessService.revokeForBooking(TENANT, "booking-1");

      expect(entry).to.include({
        isProvisioned: false,
        principalRemovedAt: null,
      });
      expect(entry.revokedAt).to.be.a("number");
      expect(entry.principalCleanupError).to.be.a("string");
      expect(loggedPayload("revoke").payload.revocation).to.deep.equal({
        principalRemoved: false,
      });
    });

    it("records a NUKI revoke, which has no principal to remove", async () => {
      stubBooking(createBooking(), [NUKI_DOOR]);
      await AccessService.provisionForBooking(TENANT, "booking-1");

      const [entry] = await AccessService.revokeForBooking(TENANT, "booking-1");

      expect(entry).to.include({
        isProvisioned: false,
        principalRemovedAt: null,
        principalCleanupError: null,
      });
      expect(entry.revokedAt).to.be.a("number");
      expect(clients.nuki.authorizations.size).to.equal(0);
      expect(loggedPayload("revoke").payload).to.deep.equal({
        grant: { authorizationId: "auth-1", externalPrincipalId: null },
        revocation: { principalRemoved: null },
      });
    });

    it("records the revoke of a grant the provider no longer has", async () => {
      stubBooking(createBooking(), [NUKI_DOOR]);
      await AccessService.provisionForBooking(TENANT, "booking-1");
      clients.nuki.authorizations.clear();

      const [entry] = await AccessService.revokeForBooking(TENANT, "booking-1");

      expect(entry.isProvisioned).to.be.false;
      expect(entry.revokedAt).to.be.a("number");
      expect(loggedPayload("revoke").result).to.equal("success");
    });

    it("leaves a grant provisioned when the provider refuses the revoke, and only audits it", async () => {
      stubBooking(createBooking(), [NUKI_DOOR]);
      await AccessService.provisionForBooking(TENANT, "booking-1");
      sandbox
        .stub(clients.nuki, "deleteAuthorization")
        .rejects(nukiHttpError(500));

      const [entry] = await AccessService.revokeForBooking(TENANT, "booking-1");

      expect(entry).to.include({ isProvisioned: true, revokedAt: null });
      expect(entry.grant.authorizationId).to.equal("auth-1");
      expect(loggedPayload("revoke")).to.include({
        result: "failure",
        errorMessage: "Request failed with status code 500",
      });
    });

    it("revokes nothing at a door that holds no grant", async () => {
      stubBooking(
        createBooking({
          accessInfo: [
            {
              accessPointId: "door-1",
              provider: "nuki",
              externalId: "1001",
              isProvisioned: false,
              grant: null,
            },
          ],
        }),
        [NUKI_DOOR],
      );

      const [entry] = await AccessService.revokeForBooking(TENANT, "booking-1");

      expect(entry).to.not.have.property("revokedAt");
      expect(loggedPayload("revoke")).to.equal(undefined);
    });
  });
});
