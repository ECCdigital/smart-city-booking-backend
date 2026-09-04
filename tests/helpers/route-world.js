/**
 * The world below every router, for the route characterization: one
 * record per entity, id `fx`, behind every data manager the booking
 * lifecycle harness leaves alone. Installed on top of `installHarness()`;
 * a manager method the harness already stubs stays as it is.
 *
 * The default of a method follows its name: a getter answers the record
 * (or a list of it, when the name is plural), a count answers 0, an
 * `exists`/`has` answers true, a write answers the record. The exceptions
 * per manager are listed explicitly. The aim is not a faithful world but
 * one in which every handler gets past its loads, so the status code a
 * principal gets is the authorization's and not a missing record's.
 */

const { Readable } = require("stream");
const sinon = require("sinon");

const AccessLogManager = require("../../src/commons/data-managers/access-log-manager");
const AccessPointManager = require("../../src/commons/data-managers/access-point-manager");
const {
  BookableManager,
} = require("../../src/commons/data-managers/bookable-manager");
const BookingManager = require("../../src/commons/data-managers/booking-manager");
const CatalogManager = require("../../src/commons/data-managers/catalog-manager");
const ChallengeManager = require("../../src/commons/data-managers/challenge-manager");
const CouponManager = require("../../src/commons/data-managers/coupon-manager");
const {
  FileManager,
  NextcloudManager,
} = require("../../src/commons/data-managers/file-manager");
const EventManager = require("../../src/commons/data-managers/event-manager");
const GroupBookingManager = require("../../src/commons/data-managers/group-booking-manager");
const InstanceManager = require("../../src/commons/data-managers/instance-manager");
const InvitationManager = require("../../src/commons/data-managers/invitation-manager");
const MediaManager = require("../../src/commons/data-managers/media-manager");
const MembershipManager = require("../../src/commons/data-managers/membership-manager");
const { RoleManager } = require("../../src/commons/data-managers/role-manager");
const RuleManager = require("../../src/commons/data-managers/rule-manager");
const TenantManager = require("../../src/commons/data-managers/tenant-manager");
const UserManager = require("../../src/commons/data-managers/user-manager");
const WorkflowManager = require("../../src/commons/data-managers/workflow-manager");
const {
  AccessPoint,
} = require("../../src/commons/entities/access/access-point");
const { Catalog } = require("../../src/commons/entities/catalog/catalog");
const Challenge = require("../../src/commons/entities/tenant/challenge");
const { Coupon } = require("../../src/commons/entities/coupon/coupon");
const { Event } = require("../../src/commons/entities/event/event");
const Invitation = require("../../src/commons/entities/tenant/invitation");
const { Media } = require("../../src/commons/entities/media/media");
const Workflow = require("../../src/commons/entities/workflow/workflow");
const { User } = require("../../src/commons/entities/user/user");
const { Role } = require("../../src/commons/entities/role/role");
const Tenant = require("../../src/commons/entities/tenant/tenant");
const storage = require("../../src/commons/services/storage");
const ExternalPriceService = require("../../src/commons/services/external-price-service");

/** The id every fixture record carries, and every `:id` of a route names. */
const FIXTURE_ID = "fx";

const PLURAL = /s(By|With|For|Of|Custom|Filtered|Batch|$)|List$/;
const GETTER = /^(get|find|search|query|list|resolve|populate)/;

function defaultOf(name, one, many) {
  if (/^(count|check)/.test(name)) return async () => true;
  if (/^(exists|has)/.test(name)) return async () => true;
  if (GETTER.test(name)) {
    return PLURAL.test(name) ? async () => many() : async () => one();
  }
  return async () => one();
}

/**
 * Stubs every public static method of a manager that is not stubbed yet.
 *
 * @param {Function} Manager
 * @param {{one: Function, many?: Function, only?: Object}} fixtures - `one`
 *   builds the record, `many` the list, `only` names the exceptions by
 *   method name; `skip` names sync helpers left alone.
 */
function stubManager(
  Manager,
  { one, many = () => [one()], only = {}, skip = [] },
) {
  for (const name of Object.getOwnPropertyNames(Manager)) {
    const method = Manager[name];
    if (
      typeof method !== "function" ||
      name.startsWith("_") ||
      skip.includes(name) ||
      method.restore
    ) {
      continue;
    }
    sinon
      .stub(Manager, name)
      .callsFake(only[name] ?? defaultOf(name, one, many));
  }
}

/**
 * Installs the world. Call after `installHarness()`; `sinon.restore()`
 * takes it down with the harness.
 *
 * @param {Object} options
 * @param {string} options.tenantId
 * @param {Object} options.tenant - The tenant record of the harness.
 * @param {string} options.ownerUserId - Who owns the owned records.
 * @param {Object} options.bookables - The catalogue of the harness.
 */
function installRouteWorld({ tenantId, tenant, ownerUserId, bookables }) {
  const accessPoint = () =>
    new AccessPoint({
      id: FIXTURE_ID,
      tenantId,
      type: "door",
      provider: "nuki",
      externalId: "ext-1",
      label: "Tür",
      mode: "remote",
      scanCode: "scan-fx",
    });
  const coupon = () =>
    new Coupon({
      id: FIXTURE_ID,
      tenantId,
      type: "percentage",
      discount: 10,
      ownerUserId,
    });
  const event = () =>
    new Event({
      id: FIXTURE_ID,
      tenantId,
      ownerUserId,
      isPublic: true,
      information: {
        name: "Sommerkonzert",
        startDate: "2027-06-21",
        startTime: "19:00",
        endDate: "2027-06-21",
        endTime: "22:00",
      },
      eventLocation: { name: "Stadthalle" },
      eventOrganizer: { contactPersonEmailAddress: "orga@example.test" },
    });
  const media = () =>
    new Media({
      id: FIXTURE_ID,
      tenantId,
      kind: "image",
      mimeType: "image/png",
      size: 7,
      originalFileName: "bild.png",
      uploadedBy: ownerUserId,
      visibility: "public",
      storage: { provider: "s3", key: "fx" },
    });
  const catalog = () =>
    new Catalog({
      id: FIXTURE_ID,
      slug: "fx-slug",
      name: "Katalog",
      tenantId,
      tenantIds: [tenantId],
    });
  const challenge = () =>
    new Challenge({ id: FIXTURE_ID, tenantId, key: "frage", type: "manual" });
  const invitation = () =>
    new Invitation({
      tenantId,
      token: FIXTURE_ID,
      type: "single",
      intendedUserId: ownerUserId,
    });
  const workflow = () =>
    new Workflow({
      id: FIXTURE_ID,
      tenantId,
      name: "Workflow",
      states: [{ id: "s1", name: "Neu", actions: [], tasks: [] }],
      active: true,
    });
  const user = (id = FIXTURE_ID) =>
    new User({ id, firstName: "Max", lastName: "Muster", isVerified: true });
  const rule = () => ({ _id: FIXTURE_ID, name: "Regel", enabled: true });
  const membership = (userId = ownerUserId) => ({
    userId,
    tenantId,
    status: "active",
    source: "manually",
    owner: false,
    roles: [],
    bookingNotificationRecipients: [],
    invitations: [],
  });

  const role = () => new Role({ id: FIXTURE_ID, name: "Rolle", tenantId });
  const tenantEntity = () => new Tenant(tenant);

  /** Replaces a stub of the harness for the routes. */
  const restub = (Manager, name, impl) => {
    Manager[name].restore();
    sinon.stub(Manager, name).callsFake(impl);
  };
  // The tenant as an entity, a medium as an entity, a role for the fixture
  // id: the harness answers plain records where the lifecycle needs no
  // more, the routes call the entities' methods.
  restub(TenantManager, "getTenant", async () => tenantEntity());
  restub(MediaManager, "getMedia", async () => media());
  restub(EventManager, "getEvent", async () => event());
  restub(UserManager, "getRawUser", async () => ({
    _id: "64f1",
    toEntity: () => user(),
  }));
  const roleOfHarness = RoleManager.getRole;
  restub(RoleManager, "getRole", async (id, tenant) =>
    id === FIXTURE_ID ? role() : roleOfHarness(id, tenant),
  );

  // The two seams below the managers that would go to the network: the
  // storage of the media and the external price providers.
  sinon.stub(storage, "getStorageProvider").returns({
    name: "s3",
    put: async () => ({ key: "fx", size: 7 }),
    getStream: async () => Readable.from([Buffer.from("%PDF-fx")]),
    getBuffer: async () => Buffer.from("%PDF-fx"),
    stat: async () => ({ size: 7 }),
    delete: async () => {},
    deleteMany: async () => {},
    deletePrefix: async () => {},
  });
  sinon.stub(ExternalPriceService, "resolve").resolves(null);

  stubManager(AccessLogManager, {
    one: () => ({}),
    many: () => [],
    only: { query: async () => [] },
  });
  stubManager(AccessPointManager, { one: accessPoint });
  stubManager(BookableManager, {
    one: () => bookables[FIXTURE_ID],
    many: () => Object.values(bookables),
    only: {
      getMediaUsage: async () => [],
      getBookableStats: async () => ({}),
      getParentBookables: async () => [],
      getDirectRelatedBookables: async () => [],
      detachAccessPoint: async () => 0,
    },
  });
  stubManager(BookingManager, {
    one: () => null,
    many: () => [],
    skip: ["filterConcurrentBookings"],
    only: { getMediaUsage: async () => [] },
  });
  stubManager(CatalogManager, { one: catalog });
  stubManager(ChallengeManager, { one: challenge });
  stubManager(CouponManager, { one: coupon });
  stubManager(EventManager, {
    one: event,
    only: { getMediaUsage: async () => [] },
  });
  stubManager(GroupBookingManager, { one: () => null, many: () => [] });
  stubManager(InstanceManager, {
    one: () => null,
    only: {
      getBookableCustomFields: async () => [],
      getBranding: async () => ({ active: false }),
      getPortalConfig: async () => ({ publicOffersEnabled: false }),
      getMediaUsage: async () => [],
    },
  });
  for (const Manager of [FileManager, NextcloudManager]) {
    stubManager(Manager, {
      one: () => Buffer.from("%PDF-fx"),
      many: () => [],
    });
  }
  stubManager(InvitationManager, {
    one: invitation,
    only: { getInvitationByUserID: async () => [invitation()] },
  });
  stubManager(MediaManager, {
    one: media,
    only: {
      getMediaList: async () => ({ items: [media()], total: 1 }),
      getBookingDocumentByFileName: async () => null,
    },
  });
  stubManager(MembershipManager, {
    one: () => membership(),
    many: () => [membership()],
  });
  stubManager(RoleManager, { one: role });
  stubManager(RuleManager, {
    one: rule,
    only: { getExecutionLogs: async () => [] },
  });
  stubManager(TenantManager, {
    one: tenantEntity,
    only: {
      getTenantApps: async () => tenant.applications,
      getTenantAppByType: async () => tenant.applications,
      getTenantAppById: async () => tenant.applications[0],
      getMediaUsage: async () => [],
      incrementDocumentCounter: async () => 1,
    },
  });
  stubManager(UserManager, {
    one: () => user(),
    // The rights run for real: the principal is loaded from this.
    skip: ["getUserPermissions"],
    only: {
      getUserByHookID: async () => null,
      getUserByCard: async () => null,
    },
  });
  stubManager(WorkflowManager, {
    one: workflow,
    only: {
      getWorkflowStates: async () => [],
      getTasks: async () => [],
      populateTasksWithBookings: async () => [],
    },
  });
}

module.exports = { installRouteWorld, FIXTURE_ID };
