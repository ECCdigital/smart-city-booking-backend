/**
 * Open Locker as the fifth provider (ECCdigital/tickets#970): a compartment
 * is a door in mode `remote`, opened through the tenant's technical account.
 * The adapter runs for real over the fake Open Locker in
 * `tests/helpers/fake-open-locker-api-client.js`, which replaces only the
 * HTTP transport.
 */

const assert = require("assert");
const { expect } = require("chai");
const sinon = require("sinon");

process.env.CRYPTO_SECRET =
  process.env.CRYPTO_SECRET || "0123456789abcdef0123456789abcdef";

const OpenLockerAccessProvider = require("../src/commons/services/access/providers/open-locker-access-provider");
const {
  OpenLockerApiClient,
} = require("../src/commons/services/access/clients/open-locker-api-client");
const {
  getAccessProvider,
  getAccessProviderCapabilities,
} = require("../src/commons/services/access/providers/access-provider-registry");
const {
  createClient,
} = require("../src/commons/services/access/clients/access-client-registry");
const {
  testProvider,
} = require("../src/commons/services/access/clients/access-test-registry");
const {
  OpenLockerAccessApplication,
  createAccessApplication,
} = require("../src/commons/entities/application/accessApplication");
const TenantManager = require("../src/commons/data-managers/tenant-manager");
const {
  AccessPointMode,
} = require("../src/commons/entities/access/access-point");
const { AccessOpenError } = require("../src/errors/AccessOpenError");
const { ValidationError } = require("../src/errors/ValidationError");
const {
  FakeOpenLockerApiClient,
  brokenOpenLockerApiClient,
  openLockerNetworkError,
  FAKE_SERVER_URL,
  FAKE_EMAIL,
  FAKE_PASSWORD,
  NEIGHBOUR_EMAIL,
  NEIGHBOUR_PASSWORD,
  LOCKER_BANK_ID,
  SECOND_LOCKER_BANK_ID,
  COMPARTMENT_ID,
  OTHER_COMPARTMENT_ID,
  SECOND_COMPARTMENT_ID,
} = require("./helpers/fake-open-locker-api-client");
const {
  TENANT,
  bookingContext,
} = require("./helpers/access-provider-fixtures");

require("../src/commons/services/access/providers/register-access-providers");

const COMPARTMENT = Object.freeze({
  id: "compartment-1",
  tenantId: TENANT,
  type: "door",
  provider: "open-locker",
  externalId: COMPARTMENT_ID,
  label: "Fach 1",
  mode: AccessPointMode.REMOTE,
  validationRules: [],
});

/** Asserts a rejection with an AccessOpenError of the given failure class. */
function rejectsOpen(promise, failureClass, message = "") {
  return assert.rejects(promise, (error) => {
    expect(error).to.be.instanceOf(AccessOpenError);
    expect(error.failureClass).to.equal(failureClass);
    expect(error.message).to.include(message);
    return true;
  });
}

describe("Open Locker access provider", () => {
  let client;
  let provider;

  beforeEach(() => {
    client = new FakeOpenLockerApiClient();
    provider = new OpenLockerAccessProvider({ client });
  });

  afterEach(() => {
    sinon.restore();
  });

  describe("registration", () => {
    it("is registered as a provider, with its API client and its application", () => {
      expect(getAccessProvider("open-locker")).to.be.instanceOf(
        OpenLockerAccessProvider,
      );
      expect(
        createClient({
          type: "access",
          id: "open-locker",
          serverUrl: FAKE_SERVER_URL,
          email: FAKE_EMAIL,
          password: FAKE_PASSWORD,
        }),
      ).to.be.instanceOf(OpenLockerApiClient);
      expect(
        createAccessApplication({ type: "access", id: "open-locker" }),
      ).to.be.instanceOf(OpenLockerAccessApplication);
    });

    it("declares open, getOpenProgress, listAccessPoints and validateAccessPoint, and neither grant, revoke nor hold", () => {
      const capabilities = getAccessProviderCapabilities("open-locker");

      expect(capabilities).to.include.members([
        "open",
        "getOpenProgress",
        "listAccessPoints",
        "validateAccessPoint",
      ]);
      for (const capability of [
        "grantAuthorization",
        "revokeAuthorization",
        "hold",
        "refreshHold",
        "getStatus",
        "close",
      ]) {
        expect(capabilities).not.to.include(capability);
      }
    });

    it("opens its compartments without a QR scan unless one is configured", () => {
      expect(OpenLockerAccessProvider.requiresScanByDefault).to.equal(false);
    });
  });

  describe("application", () => {
    it("stores the password encrypted and reads it back in clear", () => {
      const app = new OpenLockerAccessApplication({
        type: "access",
        id: "open-locker",
        serverUrl: FAKE_SERVER_URL,
        email: FAKE_EMAIL,
        password: FAKE_PASSWORD,
      });

      app.encrypt();
      expect(app.password).to.be.an("object");
      expect(JSON.stringify(app.password)).not.to.include(FAKE_PASSWORD);
      expect(app.email).to.equal(FAKE_EMAIL);

      app.decrypt();
      expect(app.password).to.equal(FAKE_PASSWORD);
    });

    it("builds the API client from the stored, encrypted application", async () => {
      const app = new OpenLockerAccessApplication({
        type: "access",
        id: "open-locker",
        serverUrl: `${FAKE_SERVER_URL}/`,
        email: FAKE_EMAIL,
        password: FAKE_PASSWORD,
      });
      app.encrypt();

      const built = createClient({ ...app });

      expect(built.baseUrl).to.equal(FAKE_SERVER_URL);
      expect(built.email).to.equal(FAKE_EMAIL);
      expect(built.password).to.equal(FAKE_PASSWORD);
    });
  });

  describe("client per tenant", () => {
    const {
      releaseTenantClients,
    } = require("../src/commons/services/access/clients/tenant-client-cache");

    function tenantWithOpenLocker(password = FAKE_PASSWORD) {
      return {
        id: TENANT,
        applications: [
          {
            type: "access",
            id: "open-locker",
            active: true,
            serverUrl: FAKE_SERVER_URL,
            email: FAKE_EMAIL,
            password,
          },
        ],
      };
    }

    afterEach(() => {
      releaseTenantClients(TENANT);
    });

    it("keeps the tenant's client, and with it the token, while the credentials stay the same", async () => {
      sinon.stub(TenantManager, "getTenant").resolves(tenantWithOpenLocker());
      const unregistered = new OpenLockerAccessProvider();

      const first = await unregistered._getClient(TENANT);
      const second = await unregistered._getClient(TENANT);

      expect(first).to.be.instanceOf(OpenLockerApiClient);
      expect(second).to.equal(first);
    });

    it("builds a new client when the password changes", async () => {
      const getTenant = sinon
        .stub(TenantManager, "getTenant")
        .resolves(tenantWithOpenLocker());
      const unregistered = new OpenLockerAccessProvider();
      const first = await unregistered._getClient(TENANT);
      getTenant.resolves(tenantWithOpenLocker("rotated"));

      const second = await unregistered._getClient(TENANT);

      expect(second).not.to.equal(first);
      expect(second.password).to.equal("rotated");
    });

    it("drops the client when the tenant is stored without an active Open Locker application", async () => {
      sinon.stub(TenantManager, "getTenant").resolves(tenantWithOpenLocker());
      const unregistered = new OpenLockerAccessProvider();
      const first = await unregistered._getClient(TENANT);

      releaseTenantClients(TENANT, { id: TENANT, applications: [] });

      expect(await unregistered._getClient(TENANT)).not.to.equal(first);
    });

    it("keeps the client when the tenant is stored with its application still active", async () => {
      sinon.stub(TenantManager, "getTenant").resolves(tenantWithOpenLocker());
      const unregistered = new OpenLockerAccessProvider();
      const first = await unregistered._getClient(TENANT);

      releaseTenantClients(TENANT, tenantWithOpenLocker());

      expect(await unregistered._getClient(TENANT)).to.equal(first);
    });
  });

  describe("open", () => {
    it("answers pending with the command_id as the process to poll", async () => {
      const outcome = await provider.open(COMPARTMENT, bookingContext());

      const request = client.lastOpenRequest();
      expect(outcome).to.deep.equal({
        state: "pending",
        openProcessId: request.command_id,
      });
      expect(request.compartment_id).to.equal(COMPARTMENT_ID);
    });

    it("signs in once and keeps the token for the next call", async () => {
      await provider.open(COMPARTMENT, bookingContext());
      await provider.open(COMPARTMENT, bookingContext());

      expect(client.logins).to.have.length(1);
    });

    it("signs in again after a 401 and repeats the call exactly once", async () => {
      await provider.open(COMPARTMENT, bookingContext());
      client.expireTokens();

      const outcome = await provider.open(COMPARTMENT, bookingContext());

      expect(outcome.state).to.equal("pending");
      expect(client.logins).to.have.length(2);
      expect(
        client.requests.filter(
          (route) => route === `POST /api/compartments/${COMPARTMENT_ID}/open`,
        ),
      ).to.have.length(3);
    });

    it("gives up after the one repetition when the fresh token is refused too", async () => {
      await provider.open(COMPARTMENT, bookingContext());
      // Every token is forgotten the moment it is handed out.
      const login = client._answerLogin.bind(client);
      client._answerLogin = (data) => {
        const answer = login(data);
        client.expireTokens();
        return answer;
      };
      client.expireTokens();
      const before = client.requests.length;

      await rejectsOpen(
        provider.open(COMPARTMENT, bookingContext()),
        "configuration",
        "401",
      );
      expect(client.requests.slice(before)).to.deep.equal([
        `POST /api/compartments/${COMPARTMENT_ID}/open`,
        "POST /api/login",
        `POST /api/compartments/${COMPARTMENT_ID}/open`,
      ]);
    });

    it("reports a compartment the account may not open (denied) as a configuration failure, naming the command_id", async () => {
      const denied = { ...COMPARTMENT, externalId: OTHER_COMPARTMENT_ID };

      let error;
      await assert.rejects(provider.open(denied, bookingContext()), (err) => {
        error = err;
        return true;
      });

      const request = client.lastOpenRequest();
      expect(request.state).to.equal("denied");
      expect(error).to.be.instanceOf(AccessOpenError);
      expect(error.failureClass).to.equal("configuration");
      expect(error.message).to.include("denied");
      expect(error.message).to.include(request.command_id);
    });

    it("reports an account blocked for terms not accepted as a configuration failure", async () => {
      client.account.termsAccepted = false;

      await rejectsOpen(
        provider.open(COMPARTMENT, bookingContext()),
        "configuration",
        "terms",
      );
      expect(client.openRequests.size).to.equal(0);
    });

    it("reports an account without a verified e-mail address as a configuration failure", async () => {
      client.account.emailVerified = false;

      await rejectsOpen(
        provider.open(COMPARTMENT, bookingContext()),
        "configuration",
        "blocked",
      );
    });

    it("reports a compartment Open Locker does not know as a configuration failure", async () => {
      await rejectsOpen(
        provider.open(
          { ...COMPARTMENT, externalId: "no-such-compartment" },
          bookingContext(),
        ),
        "configuration",
        "no-such-compartment",
      );
    });

    it("reports wrong credentials as a configuration failure", async () => {
      client.password = "wrong";

      await rejectsOpen(
        provider.open(COMPARTMENT, bookingContext()),
        "configuration",
        "credentials",
      );
    });

    it("reports an unreachable Open Locker as a temporary failure", async () => {
      const broken = new OpenLockerAccessProvider({
        client: brokenOpenLockerApiClient(openLockerNetworkError()),
      });

      await rejectsOpen(
        broken.open(COMPARTMENT, bookingContext()),
        "temporary",
        "ECONNREFUSED",
      );
    });

    it("reports a server error as a temporary failure", async () => {
      const broken = new OpenLockerAccessProvider({
        client: brokenOpenLockerApiClient(),
      });

      await rejectsOpen(
        broken.open(COMPARTMENT, bookingContext()),
        "temporary",
        "500",
      );
    });

    it("reports a tenant without an Open Locker application as a configuration failure", async () => {
      sinon.stub(TenantManager, "getTenant").resolves({
        id: TENANT,
        applications: [],
      });

      await rejectsOpen(
        new OpenLockerAccessProvider().open(COMPARTMENT, bookingContext()),
        "configuration",
      );
    });
  });

  describe("getOpenProgress", () => {
    async function openAndAdvance(state, fields = {}) {
      const { openProcessId } = await provider.open(
        COMPARTMENT,
        bookingContext(),
      );
      if (state) client.advance(openProcessId, state, fields);
      return provider.getOpenProgress(COMPARTMENT, openProcessId);
    }

    for (const state of ["requested", "accepted", "sent", "acknowledged"]) {
      it(`answers ${state} as not confirmed yet, without an error, so the storefront polls on`, async () => {
        const progress = await openAndAdvance(state);

        expect(progress).to.deep.equal({
          confirmed: false,
          confirmedAt: null,
          errorCode: null,
          errorMessage: null,
        });
      });
    }

    it("answers opened as confirmed, at the time Open Locker saw the door open", async () => {
      const progress = await openAndAdvance("opened", {
        opened_at: "2026-11-11T10:00:03.000000Z",
      });

      expect(progress).to.deep.equal({
        confirmed: true,
        confirmedAt: "2026-11-11T10:00:03.000000Z",
        errorCode: null,
        errorMessage: null,
      });
    });

    it("answers already_open as confirmed", async () => {
      const progress = await openAndAdvance("already_open");

      expect(progress.confirmed).to.equal(true);
      expect(progress.errorCode).to.equal(null);
    });

    it("answers door_jammed as an error: the door is jammed", async () => {
      const progress = await openAndAdvance("door_jammed");

      expect(progress.confirmed).to.equal(false);
      expect(progress.errorCode).to.equal("door_jammed");
      expect(progress.errorMessage).to.be.a("string").and.not.empty;
    });

    it("answers failed as an error: the compartment did not open", async () => {
      const progress = await openAndAdvance("failed", {
        error_code: "modbus_timeout",
        error_message: "No answer from the relay board",
      });

      expect(progress.confirmed).to.equal(false);
      expect(progress.errorCode).to.equal("open_failed");
      expect(progress.errorMessage).to.include(
        "No answer from the relay board",
      );
    });

    it("answers denied as an error of the setup", async () => {
      const progress = await openAndAdvance("denied", {
        denied_reason: "no_access",
      });

      expect(progress.confirmed).to.equal(false);
      expect(progress.errorCode).to.equal("configuration");
      expect(progress.errorMessage).to.include("no_access");
    });

    it("keeps a request that hangs on sent unconfirmed, poll after poll, without an error", async () => {
      const { openProcessId } = await provider.open(
        COMPARTMENT,
        bookingContext(),
      );
      client.advance(openProcessId, "sent");

      for (let poll = 0; poll < 15; poll += 1) {
        const progress = await provider.getOpenProgress(
          COMPARTMENT,
          openProcessId,
        );
        expect(progress).to.include({ confirmed: false, errorCode: null });
      }
    });

    it("answers door_jammed after acknowledged as the error, not as the earlier progress", async () => {
      const { openProcessId } = await provider.open(
        COMPARTMENT,
        bookingContext(),
      );
      client.advance(openProcessId, "acknowledged");
      const first = await provider.getOpenProgress(COMPARTMENT, openProcessId);
      client.advance(openProcessId, "door_jammed");

      const second = await provider.getOpenProgress(COMPARTMENT, openProcessId);

      expect(first).to.include({ confirmed: false, errorCode: null });
      expect(second).to.include({
        confirmed: false,
        errorCode: "door_jammed",
      });
    });

    it("signs in again after a 401 on a poll and repeats it once", async () => {
      const { openProcessId } = await provider.open(
        COMPARTMENT,
        bookingContext(),
      );
      client.advance(openProcessId, "opened");
      client.expireTokens();

      const progress = await provider.getOpenProgress(
        COMPARTMENT,
        openProcessId,
      );

      expect(progress.confirmed).to.equal(true);
      expect(client.logins).to.have.length(2);
    });

    it("answers a state it does not know as a poll it cannot read", async () => {
      const progress = await openAndAdvance("teleported");

      expect(progress.confirmed).to.equal(null);
      expect(progress.errorMessage).to.include("teleported");
    });

    it("answers a failed poll with the reason instead of throwing", async () => {
      const broken = new OpenLockerAccessProvider({
        client: brokenOpenLockerApiClient(openLockerNetworkError()),
      });

      const progress = await broken.getOpenProgress(COMPARTMENT, "cmd-1");

      expect(progress.confirmed).to.equal(null);
      expect(progress.errorMessage).to.include("ECONNREFUSED");
    });

    it("answers an unknown command as a poll it cannot read", async () => {
      const progress = await provider.getOpenProgress(COMPARTMENT, "cmd-404");

      expect(progress.confirmed).to.equal(null);
      expect(progress.errorMessage).to.be.a("string").and.not.empty;
    });
  });

  describe("listAccessPoints", () => {
    it("lists only the compartments the technical account holds a permission on, each with its locker bank and number", async () => {
      const points = await provider.listAccessPoints(TENANT);

      expect(
        points.map(({ externalId, label, locationId }) => ({
          externalId,
          label,
          locationId,
        })),
      ).to.deep.equal([
        {
          externalId: COMPARTMENT_ID,
          label: "Labor Fachbank 1 · Fach 1",
          locationId: LOCKER_BANK_ID,
        },
        {
          externalId: SECOND_COMPARTMENT_ID,
          label: "Quartiersschrank Hafen · Fach 3",
          locationId: SECOND_LOCKER_BANK_ID,
        },
      ]);
    });

    it("lists a compartment as a door opened remotely, its UUID the id", async () => {
      const [point] = await provider.listAccessPoints(TENANT);

      expect(point).to.deep.include({
        id: COMPARTMENT_ID,
        type: "door",
        provider: "open-locker",
        externalId: COMPARTMENT_ID,
        capabilities: ["remote"],
        supportedModes: [AccessPointMode.REMOTE],
      });
      expect(point.metadata).to.deep.include({
        number: 1,
        lockerBank: {
          id: LOCKER_BANK_ID,
          name: "Labor Fachbank 1",
          locationDescription: "Labor, Regal links",
        },
      });
    });

    it("lists the neighbour's compartments to the neighbour's account alone", async () => {
      const neighbour = new OpenLockerAccessProvider({
        client: new FakeOpenLockerApiClient({
          credentials: { email: NEIGHBOUR_EMAIL, password: NEIGHBOUR_PASSWORD },
        }),
      });

      const points = await neighbour.listAccessPoints(TENANT);

      expect(points.map((point) => point.externalId)).to.deep.equal([
        OTHER_COMPARTMENT_ID,
      ]);
    });

    it("lists nothing for an account without a permission", async () => {
      client.revokePermission(COMPARTMENT_ID);
      client.revokePermission(SECOND_COMPARTMENT_ID);

      expect(await provider.listAccessPoints(TENANT)).to.deep.equal([]);
    });

    it("lists the compartments of an account blocked for terms not accepted - reading stays open to it", async () => {
      client.account.termsAccepted = false;

      const points = await provider.listAccessPoints(TENANT);

      expect(points).to.have.length(2);
    });

    it("signs in again after a 401 and lists once more", async () => {
      await provider.listAccessPoints(TENANT);
      client.expireTokens();

      const points = await provider.listAccessPoints(TENANT);

      expect(points).to.have.length(2);
      expect(client.logins).to.have.length(2);
    });
  });

  describe("validateAccessPoint", () => {
    it("lets a compartment through that the listing names", async () => {
      const points = await provider.listAccessPoints(TENANT);
      const listed = points.find((p) => p.externalId === COMPARTMENT_ID);

      expect(() =>
        provider.validateAccessPoint(COMPARTMENT, listed, { asked: true }),
      ).not.to.throw();
    });

    it("refuses a compartment the technical account holds no permission on", () => {
      const neighbours = { ...COMPARTMENT, externalId: OTHER_COMPARTMENT_ID };

      expect(() =>
        provider.validateAccessPoint(neighbours, null, { asked: true }),
      )
        .to.throw(ValidationError)
        .with.property("errors")
        .that.deep.equals([
          {
            field: "externalId",
            code: "compartment_not_accessible",
            params: { externalId: OTHER_COMPARTMENT_ID },
          },
        ]);
    });

    it("lets a compartment through when Open Locker could not be asked - the tenant has not switched it on (tickets#311)", () => {
      expect(() =>
        provider.validateAccessPoint(COMPARTMENT, null, { asked: false }),
      ).not.to.throw();
    });
  });

  describe("connection test", () => {
    it("passes with credentials of an account that may open compartments", async () => {
      const result = await client.checkConnection();

      expect(result).to.deep.equal({
        success: true,
        message: "Connection successful",
      });
    });

    it("reports wrong credentials as a clear failure", async () => {
      client.password = "wrong";

      const result = await client.checkConnection();

      expect(result).to.deep.include({
        success: false,
        code: "invalid_credentials",
      });
      expect(result.message).to.include("credentials");
    });

    it("reports an account blocked for terms not accepted as a clear failure", async () => {
      client.account.termsAccepted = false;

      const result = await client.checkConnection();

      expect(result).to.deep.include({
        success: false,
        code: "terms_not_accepted",
      });
      expect(result.message).to.include("terms");
    });

    it("reports an account without a verified e-mail address as a clear failure", async () => {
      client.account.emailVerified = false;

      const result = await client.checkConnection();

      expect(result).to.deep.include({
        success: false,
        code: "email_not_verified",
      });
    });

    it("reports an unreachable server as a failure", async () => {
      const result = await brokenOpenLockerApiClient(
        openLockerNetworkError("ENOTFOUND"),
      ).checkConnection();

      expect(result).to.deep.equal({
        success: false,
        message: "Server not found",
      });
    });

    it("is registered for the admin form and asks for every field", async () => {
      const result = await testProvider("open-locker", {
        serverUrl: FAKE_SERVER_URL,
      });

      expect(result).to.deep.equal({
        success: false,
        message: "Missing required fields: email, password",
      });
    });

    it("runs the registered test against the server the form names", async () => {
      const checkConnection = sinon
        .stub(OpenLockerApiClient.prototype, "checkConnection")
        .callsFake(async function () {
          return { success: true, message: `${this.baseUrl} ${this.email}` };
        });

      const result = await testProvider("open-locker", {
        serverUrl: FAKE_SERVER_URL,
        email: FAKE_EMAIL,
        password: FAKE_PASSWORD,
      });

      expect(checkConnection.calledOnce).to.equal(true);
      expect(result.message).to.equal(`${FAKE_SERVER_URL} ${FAKE_EMAIL}`);
    });
  });
});

describe("Open Locker through AccessService", () => {
  const AccessService = require("../src/commons/services/access/access-service");
  const AccessLogService = require("../src/commons/services/access/access-log-service");
  const {
    registerAccessProvider,
  } = require("../src/commons/services/access/providers/access-provider-registry");
  const BookingManager = require("../src/commons/data-managers/booking-manager");
  const {
    BookableManager,
  } = require("../src/commons/data-managers/bookable-manager");
  const AccessPointManager = require("../src/commons/data-managers/access-point-manager");
  const mailModule = require("../src/commons/mail-service");
  const { Booking } = require("../src/commons/entities/booking/booking");
  const { MINUTE } = require("./helpers/access-provider-fixtures");

  let client;
  let sandbox;

  after(() => {
    registerAccessProvider("open-locker", OpenLockerAccessProvider);
  });

  beforeEach(() => {
    sandbox = sinon.createSandbox();
    client = new FakeOpenLockerApiClient();
    // The registry keeps one instance; a new one reads the new fake.
    registerAccessProvider(
      "open-locker",
      class extends OpenLockerAccessProvider {
        constructor() {
          super({ client });
        }
      },
    );
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

  function stubBooking(booking, doors = [COMPARTMENT]) {
    sandbox.stub(BookingManager, "getBooking").resolves(booking);
    sandbox.stub(BookingManager, "storeBooking").resolves(booking);
    sandbox.stub(BookableManager, "getBookablesByIds").resolves([
      {
        id: "room",
        title: "Schrank",
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
  }

  function logged(action) {
    return AccessLogService.log.args
      .map(([entry]) => entry)
      .filter((entry) => entry.action === action);
  }

  it("opens a compartment and stores the command_id with the open in the audit", async () => {
    stubBooking(createBooking());

    const outcome = await AccessService.open(
      TENANT,
      "booking-1",
      COMPARTMENT.id,
      "user-1",
    );

    const commandId = client.lastOpenRequest().command_id;
    expect(outcome).to.deep.equal({
      success: true,
      data: { openProcessId: commandId },
    });
    const [entry] = logged("open");
    expect(entry.result).to.equal("success");
    expect(entry.payload).to.deep.include({
      state: "pending",
      openProcessId: commandId,
    });
  });

  it("audits an open the account may not make as a failure naming the command_id", async () => {
    const denied = { ...COMPARTMENT, externalId: OTHER_COMPARTMENT_ID };
    stubBooking(createBooking(), [denied]);

    await assert.rejects(
      AccessService.open(TENANT, "booking-1", denied.id, "user-1"),
      AccessOpenError,
    );

    const [entry] = logged("open");
    expect(entry.result).to.equal("failure");
    expect(entry.errorMessage).to.include(client.lastOpenRequest().command_id);
  });

  it("audits every poll, an unconfirmed one and a failed one included", async () => {
    stubBooking(createBooking());
    const {
      data: { openProcessId },
    } = await AccessService.open(TENANT, "booking-1", COMPARTMENT.id, "user-1");
    client.advance(openProcessId, "sent");
    await AccessService.getOpenStatus(
      TENANT,
      "booking-1",
      COMPARTMENT.id,
      openProcessId,
      "user-1",
    );
    client.advance(openProcessId, "door_jammed");

    const status = await AccessService.getOpenStatus(
      TENANT,
      "booking-1",
      COMPARTMENT.id,
      openProcessId,
      "user-1",
    );

    expect(status).to.include({ confirmed: false, errorCode: "door_jammed" });
    const [pending, jammed] = logged("status");
    expect(pending).to.include({ result: "success" });
    expect(pending.payload).to.deep.equal({
      confirmed: false,
      confirmedAt: null,
      errorCode: null,
      errorMessage: null,
    });
    expect(jammed).to.include({
      result: "failure",
      errorCode: "door_jammed",
      errorMessage: "Open Locker reports the compartment door as jammed",
    });
    expect(jammed.payload).to.deep.include({
      confirmed: false,
      errorCode: "door_jammed",
    });
  });

  for (const [state, errorCode] of [
    ["door_jammed", "door_jammed"],
    ["failed", "open_failed"],
    ["denied", "configuration"],
  ]) {
    it(`audits a poll that ends in ${state} as a failure, not a success`, async () => {
      stubBooking(createBooking());
      const {
        data: { openProcessId },
      } = await AccessService.open(
        TENANT,
        "booking-1",
        COMPARTMENT.id,
        "user-1",
      );
      client.advance(openProcessId, state);

      await AccessService.getOpenStatus(
        TENANT,
        "booking-1",
        COMPARTMENT.id,
        openProcessId,
        "user-1",
      );

      const [entry] = logged("status");
      expect(entry.result).to.equal("failure");
      expect(entry.errorCode).to.equal(errorCode);
      expect(entry.errorMessage).to.be.a("string").and.not.empty;
    });
  }

  for (const state of ["sent", "opened", "already_open"]) {
    it(`audits a poll that answers ${state} as a success`, async () => {
      stubBooking(createBooking());
      const {
        data: { openProcessId },
      } = await AccessService.open(
        TENANT,
        "booking-1",
        COMPARTMENT.id,
        "user-1",
      );
      client.advance(openProcessId, state);

      await AccessService.getOpenStatus(
        TENANT,
        "booking-1",
        COMPARTMENT.id,
        openProcessId,
        "user-1",
      );

      const [entry] = logged("status");
      expect(entry.result).to.equal("success");
      expect(entry.errorCode ?? null).to.equal(null);
    });
  }

  it("tells Open Locker nothing when access is provisioned, revoked or updated", async () => {
    const booking = createBooking();
    stubBooking(booking);

    await AccessService.provisionForBooking(TENANT, "booking-1");
    await AccessService.revokeForBooking(TENANT, "booking-1");
    const moved = createBooking({
      timeBegin: booking.timeBegin + 60 * MINUTE,
      timeEnd: booking.timeEnd + 60 * MINUTE,
    });
    await AccessService.updateForBooking(TENANT, booking, moved);

    expect(client.requests).to.deep.equal([]);
  });

  // The decision names a cancelled booking `rejected`; it is refused the
  // same way at every provider, and Open Locker is never asked.
  it("refuses to open a compartment of a cancelled booking, without asking Open Locker", async () => {
    stubBooking(createBooking({ status: "cancelled" }));

    const outcome = await AccessService.open(
      TENANT,
      "booking-1",
      COMPARTMENT.id,
      "user-1",
    );

    expect(outcome.success).to.equal(false);
    expect(outcome.blockingReasons).to.include("rejected");
    expect(client.requests).to.deep.equal([]);
  });

  it("opens in the new window after a rebooking from later to now", async () => {
    const now = Date.now();
    const booking = createBooking({
      timeBegin: now + 120 * MINUTE,
      timeEnd: now + 180 * MINUTE,
    });
    stubBooking(booking);
    const early = await AccessService.open(
      TENANT,
      "booking-1",
      COMPARTMENT.id,
      "user-1",
    );
    booking.timeBegin = now - 5 * MINUTE;
    booking.timeEnd = now + 55 * MINUTE;

    const moved = await AccessService.open(
      TENANT,
      "booking-1",
      COMPARTMENT.id,
      "user-1",
    );

    expect(early.blockingReasons).to.include("outside_access_window");
    expect(moved).to.deep.equal({
      success: true,
      data: { openProcessId: client.lastOpenRequest().command_id },
    });
  });

  it("refuses to open in the old window after a rebooking to later, without asking Open Locker", async () => {
    const now = Date.now();
    stubBooking(
      createBooking({
        timeBegin: now + 120 * MINUTE,
        timeEnd: now + 180 * MINUTE,
      }),
    );

    const early = await AccessService.open(
      TENANT,
      "booking-1",
      COMPARTMENT.id,
      "user-1",
    );

    expect(early.success).to.equal(false);
    expect(early.blockingReasons).to.include("outside_access_window");
    expect(client.requests).to.deep.equal([]);
  });
});
