const { expect } = require("chai");
const sinon = require("sinon");

const GrantCleanupService = require("../src/commons/services/access/grant-cleanup-service");
const AccessLogService = require("../src/commons/services/access/access-log-service");
const BookingManager = require("../src/commons/data-managers/booking-manager");
const TenantManager = require("../src/commons/data-managers/tenant-manager");
const {
  registerAccessProvider,
} = require("../src/commons/services/access/providers/access-provider-registry");
const {
  InMemoryAccessProvider,
  PROVIDER_ID,
} = require("./helpers/in-memory-access-provider");

const TENANT = "tenant-1";

function entry(overrides = {}) {
  return {
    accessPointId: "door-3",
    accessPointType: "door",
    provider: PROVIDER_ID,
    externalId: "lock-1",
    mode: "authorization",
    isProvisioned: false,
    provisionedAt: 1000,
    revokedAt: 2000,
    grant: {
      authorizationId: "grant-1",
      externalPrincipalId: "principal-1",
      secret: null,
    },
    principalRemovedAt: null,
    principalCleanupAttemptedAt: null,
    principalCleanupError: "The provider could not remove the principal",
    ...overrides,
  };
}

function booking(accessInfo) {
  return { id: "booking-1", tenantId: TENANT, accessInfo };
}

describe("GrantCleanupService", () => {
  let sandbox;
  let provider;

  beforeEach(() => {
    sandbox = sinon.createSandbox();
    provider = new InMemoryAccessProvider({
      locks: [{ externalId: "lock-1" }],
    });
    provider.principals.add("principal-1");
    // The registry constructs the class; answer with the one instance the
    // test holds.
    registerAccessProvider(
      PROVIDER_ID,
      class {
        constructor() {
          return provider;
        }
      },
    );
    sandbox.stub(TenantManager, "getTenants").resolves([{ id: TENANT }]);
    sandbox.stub(BookingManager, "storeBooking").resolves();
    sandbox.stub(AccessLogService, "log").resolves();
  });

  afterEach(() => {
    sandbox.restore();
    GrantCleanupService.stop();
    delete process.env.GRANT_CLEANUP_INTERVAL_MS;
  });

  function stubBookings(...bookings) {
    sandbox.stub(BookingManager, "getBookingsCustomFilter").resolves(bookings);
  }

  it("selects at the database what was revoked, has a principal, and is not removed yet", async () => {
    stubBookings();

    await GrantCleanupService.cleanupPrincipals();

    expect(BookingManager.getBookingsCustomFilter.firstCall.args).to.deep.equal(
      [
        TENANT,
        {
          accessInfo: {
            $elemMatch: {
              revokedAt: { $ne: null },
              "grant.externalPrincipalId": { $ne: null },
              $or: [
                { principalRemovedAt: { $exists: false } },
                { principalRemovedAt: null },
              ],
            },
          },
        },
      ],
    );
  });

  it("revokes the grant again through the provider and records the principal as removed", async () => {
    const info = entry();
    const stored = booking([info]);
    stubBookings(stored);
    sandbox.spy(provider, "revokeAuthorization");

    const result = await GrantCleanupService.cleanupPrincipals();

    expect(result).to.deep.equal({
      tenants: 1,
      bookings: 1,
      principalsRemoved: 1,
      failures: 0,
    });
    expect(provider.revokeAuthorization.firstCall.args).to.deep.equal([
      {
        id: "door-3",
        tenantId: TENANT,
        type: "door",
        provider: PROVIDER_ID,
        externalId: "lock-1",
        mode: "authorization",
      },
      {
        authorizationId: "grant-1",
        externalPrincipalId: "principal-1",
        secret: null,
      },
    ]);
    expect(provider.principals.size).to.equal(0);
    expect(info.principalRemovedAt).to.be.a("number");
    expect(info.principalCleanupAttemptedAt).to.be.a("number");
    expect(info.principalCleanupError).to.equal(null);
    expect(BookingManager.storeBooking.calledOnceWith(stored)).to.be.true;
    expect(AccessLogService.log.firstCall.args[0]).to.deep.include({
      tenantId: TENANT,
      bookingId: "booking-1",
      accessPointId: "door-3",
      provider: PROVIDER_ID,
      externalId: "lock-1",
      action: "revoke",
      actor: { source: "system" },
      result: "success",
      payload: {
        grant: {
          authorizationId: "grant-1",
          externalPrincipalId: "principal-1",
        },
        revocation: { principalRemoved: true },
        cleanup: true,
      },
    });
  });

  it("records a principal the provider still cannot remove, to try again next time", async () => {
    const info = entry();
    stubBookings(booking([info]));
    provider.principalRemovalFails = true;

    const result = await GrantCleanupService.cleanupPrincipals();

    expect(result).to.include({
      bookings: 1,
      principalsRemoved: 0,
      failures: 1,
    });
    expect(info.principalRemovedAt).to.equal(null);
    expect(info.principalCleanupAttemptedAt).to.be.a("number");
    expect(info.principalCleanupError).to.be.a("string");
    expect(provider.principals.size).to.equal(1);
    expect(AccessLogService.log.firstCall.args[0]).to.include({
      result: "failure",
      errorMessage: info.principalCleanupError,
    });
  });

  it("records a provider that fails as the cleanup error", async () => {
    const info = entry();
    stubBookings(booking([info]));
    provider.broken = true;

    const result = await GrantCleanupService.cleanupPrincipals();

    expect(result).to.include({ failures: 1 });
    expect(info.principalCleanupError).to.equal(
      "in-memory access provider is unreachable",
    );
    expect(info.principalRemovedAt).to.equal(null);
    expect(BookingManager.storeBooking.calledOnce).to.be.true;
  });

  it("records a provider this server does not know as the cleanup error", async () => {
    const info = entry({ provider: "not-a-lock" });
    stubBookings(booking([info]));

    await GrantCleanupService.cleanupPrincipals();

    expect(info.principalCleanupError).to.include("No access provider");
  });

  it("leaves the entries alone that need no cleanup", async () => {
    const entries = [
      entry({ grant: null }),
      entry({
        grant: { authorizationId: "grant-2", externalPrincipalId: null },
      }),
      entry({ principalRemovedAt: 3000 }),
      entry({ revokedAt: null }),
    ];
    stubBookings(booking(entries));
    sandbox.spy(provider, "revokeAuthorization");

    const result = await GrantCleanupService.cleanupPrincipals();

    expect(result).to.include({
      bookings: 0,
      principalsRemoved: 0,
      failures: 0,
    });
    expect(provider.revokeAuthorization.called).to.be.false;
    expect(BookingManager.storeBooking.called).to.be.false;
    expect(entries.map((e) => e.principalCleanupAttemptedAt)).to.deep.equal([
      null,
      null,
      null,
      null,
    ]);
  });

  it("runs at the configured interval until stopped", () => {
    const clock = sandbox.useFakeTimers();
    sandbox.stub(GrantCleanupService, "cleanupPrincipals").resolves();
    process.env.GRANT_CLEANUP_INTERVAL_MS = "1000";

    GrantCleanupService.start();
    clock.tick(1000);
    expect(GrantCleanupService.cleanupPrincipals.callCount).to.equal(1);

    GrantCleanupService.stop();
    clock.tick(5000);
    expect(GrantCleanupService.cleanupPrincipals.callCount).to.equal(1);
  });

  it("stays off when the interval is disabled", () => {
    const clock = sandbox.useFakeTimers();
    sandbox.stub(GrantCleanupService, "cleanupPrincipals").resolves();
    process.env.GRANT_CLEANUP_INTERVAL_MS = "0";

    GrantCleanupService.start();
    clock.tick(60 * 60 * 1000);

    expect(GrantCleanupService.cleanupPrincipals.called).to.be.false;
  });
});
