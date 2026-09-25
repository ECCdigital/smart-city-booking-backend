/**
 * The world below every router, for the route characterization and the
 * rights matrix: one record per entity, id `fx`, behind every data manager
 * the booking lifecycle harness leaves alone, plus the owned records a
 * test asks for (`owned`). Installed on top of `installHarness()`; a
 * manager method the harness already stubs stays as it is, except the
 * few named below that the routes need as an entity or within a reach.
 *
 * The default of a method follows its name: a getter answers the record
 * (or a list of it, when the name is plural), a count answers 0, an
 * `exists`/`has` answers true, a write answers the record. The exceptions
 * per manager are listed explicitly. The aim is not a faithful world but
 * one in which every handler gets past its loads, so the status code a
 * principal gets is the authorization's and not a missing record's.
 *
 * The owned entities - bookable, event, coupon, medium, and the group
 * bookings of the harness - answer within the reach a handler passes
 * (ADR 0002), the way the real managers do: `any` and `domain` read
 * every record of the tenant, `own` the records whose owner key names
 * the user, `public` what the real public projection (ADR 0003) lists or
 * reaches of the tenant's offers - the stub knows no rule of its own,
 * it hands its records to the module as the manager does - a record of
 * another tenant is never there, and a read without a reach throws. A
 * handler that forgets to pass `scopeOf(req)` fails here, as it would
 * in production.
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
const DashboardManager = require("../../src/commons/data-managers/dashboard-manager");
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
const SupervisionHistoryManager = require("../../src/commons/data-managers/supervision-history-manager");
const SupervisionNotificationManager = require("../../src/commons/data-managers/supervision-notification-manager");
const TenantManager = require("../../src/commons/data-managers/tenant-manager");
const UserManager = require("../../src/commons/data-managers/user-manager");
const RateLimitEventManager = require("../../src/commons/data-managers/rate-limit-event-manager");
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
const {
  GroupBooking,
} = require("../../src/commons/entities/groupBooking/groupBooking");
const { User } = require("../../src/commons/entities/user/user");
const { Role } = require("../../src/commons/entities/role/role");
const Tenant = require("../../src/commons/entities/tenant/tenant");
const storage = require("../../src/commons/services/storage");
const ExternalPriceService = require("../../src/commons/services/external-price-service");
const {
  ownCondition,
} = require("../../src/commons/services/authorization/reach");
const {
  listed,
  reached,
} = require("../../src/commons/services/supervision/public-projection");
const {
  isTenantPubliclyVisible,
} = require("../../src/commons/services/supervision/offer-gate");
const { bookable: bookableOf } = require("./booking-lifecycle-harness");

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

const isPublic = (scope) => scope?.reach === "public";

/**
 * Whether a record is the tenant's and within the reach, as the real
 * manager's query would decide: `ownCondition` names the condition for
 * the resource, under `public` the query has none (the projection comes
 * after, see `projected`), and a read without a reach is the same
 * programming error here as there - a handler that forgets `scopeOf(req)`
 * turns a test red.
 *
 * @param {Object} record
 * @param {string} resource - The resource of the entity, as the manager names it.
 * @param {string|undefined} tenantId
 * @param {{reach?: string, userId?: string|null}|undefined} scope
 * @returns {boolean}
 */
function reaches(record, resource, tenantId, scope) {
  if (!record || (tenantId !== undefined && record.tenantId !== tenantId)) {
    return false;
  }
  const condition = isPublic(scope) ? {} : ownCondition(resource, scope);
  return Object.entries(condition).every(
    ([field, value]) => record[field] === value,
  );
}

/**
 * The offers as the manager answers them under the reach: under `public`
 * through the real projection - `listed` for a list, `reached` for a
 * read by id - and whole otherwise.
 */
async function projected(offers, tenantId, scope, project) {
  return isPublic(scope) ? project(tenantId, offers) : offers;
}

/**
 * The reads of a manager of offers over a catalogue of a test: `one` by
 * id (reached under `public`), `many` (listed under `public`), each
 * within the reach as `reaches` decides. For a test that keeps its own
 * events or bookables and stubs the manager over them.
 *
 * @param {() => Object[]} recordsOf The catalogue, read at every call
 * @param {"bookable"|"event"} resource
 * @returns {{one: Function, many: Function}}
 */
function offerReads(recordsOf, resource) {
  return {
    one: async (id, tenantId, scope) => {
      const record =
        recordsOf().find(
          (record) =>
            record.id === id && reaches(record, resource, tenantId, scope),
        ) ?? null;
      const [offer = null] = await projected(
        record ? [record] : [],
        tenantId,
        scope,
        reached,
      );
      return offer;
    },
    many: (tenantId, scope) =>
      projected(
        recordsOf().filter((record) =>
          reaches(record, resource, tenantId, scope),
        ),
        tenantId,
        scope,
        listed,
      ),
  };
}

/**
 * Installs the world. Call after `installHarness()`; `sinon.restore()`
 * takes it down with the harness.
 *
 * @param {Object} options
 * @param {string} options.tenantId
 * @param {Object} options.tenant - The tenant record of the harness.
 * @param {string} options.ownerUserId - Who owns the fixture records.
 * @param {Object} options.bookables - The catalogue of the harness; the
 *   owned bookables are added to it.
 * @param {Object<string, Object>} [options.tenants] - Further tenant
 *   records by id (the harness' `tenantB`); the tenant of the fixture is
 *   always known.
 * @param {{id: string, tenantId: string, ownerUserId: string}[]} [options.owned]
 *   - Further owned records: each names a bookable, an event, a coupon
 *   and a medium of that id, in that tenant, owned by that user.
 * @param {Map<string, Object>} [options.groups] - The group bookings of
 *   the harness, for the list within a reach.
 */
function installRouteWorld({
  tenantId,
  tenant,
  ownerUserId,
  bookables,
  tenants = {},
  owned = [],
  groups = new Map(),
}) {
  const tenantRecords = { [tenantId]: tenant, ...tenants };
  /** The fixture and every owned record, as `{ id, tenantId, ownerUserId }`. */
  const OWNED = [{ id: FIXTURE_ID, tenantId, ownerUserId }, ...owned];

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
  const coupon = ({ id, tenantId, ownerUserId } = OWNED[0]) =>
    new Coupon({
      id,
      tenantId,
      type: "percentage",
      discount: 10,
      ownerUserId,
    });
  const event = ({ id, tenantId, ownerUserId } = OWNED[0]) =>
    new Event({
      id,
      tenantId,
      ownerUserId,
      isPublic: true,
      information: {
        name: "Sommerkonzert",
        startDate: "2027-06-21",
        startTime: "19:00",
        endDate: "2027-06-21",
        endTime: "22:00",
        tags: [],
        flags: [],
      },
      eventLocation: { name: "Stadthalle" },
      eventOrganizer: { contactPersonEmailAddress: "orga@example.test" },
    });
  const media = ({ id, tenantId, ownerUserId } = OWNED[0]) =>
    new Media({
      id,
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
  // One role per tenant: the fixture role of the first tenant, and for
  // every further tenant record one named after it (`fx-<tenantId>`), so a
  // list across tenants tells them apart.
  const roles = [
    role(),
    ...Object.keys(tenantRecords)
      .filter((id) => id !== tenantId)
      .map(
        (id) =>
          new Role({ id: `${FIXTURE_ID}-${id}`, name: "Rolle", tenantId: id }),
      ),
  ];
  const tenantEntity = (id = tenantId) =>
    new Tenant(tenantRecords[id] ?? tenant);

  // The owned records: the bookables join the harness' catalogue (the
  // checkout reads it too), the rest live here.
  for (const record of owned) {
    bookables[record.id] ??= bookableOf({
      ...record,
      title: `Eigenes ${record.id}`,
    });
  }
  const events = OWNED.map(event);
  const coupons = OWNED.map(coupon);
  // The media: one per owned record, and the instance's own (no tenant).
  const mediaRecords = [
    ...OWNED.map(media),
    media({ id: FIXTURE_ID, tenantId: null, ownerUserId }),
  ];

  /** The one record of a tenant within a reach, or null. */
  const one = (records, resource) => (id, tenantId, scope) =>
    records.find(
      (record) =>
        record.id === id && reaches(record, resource, tenantId, scope),
    ) ?? null;
  /** The records of a tenant within a reach. */
  const many = (records, resource) => (tenantId, scope) =>
    records.filter((record) => reaches(record, resource, tenantId, scope));
  /** The offers as the manager answers them: projected under `public`. */
  const oneOffer = (records, resource) =>
    offerReads(() => records, resource).one;
  const manyOffers = (records, resource) =>
    offerReads(() => records, resource).many;

  /** Replaces a stub of the harness for the routes. */
  const restub = (Manager, name, impl) => {
    Manager[name].restore();
    sinon.stub(Manager, name).callsFake(impl);
  };
  // The tenant as an entity, a medium as an entity, a role for the fixture
  // id: the harness answers plain records where the lifecycle needs no
  // more, the routes call the entities' methods. The bookable, the event
  // and the medium within the reach and the tenant asked for.
  restub(TenantManager, "getTenant", async (id, scope) => {
    const entity = tenantEntity(id);
    return isPublic(scope) && !isTenantPubliclyVisible(entity) ? null : entity;
  });
  restub(MediaManager, "getMedia", async (id, tenantId, scope) =>
    one(mediaRecords, "media")(id, tenantId, scope),
  );
  restub(EventManager, "getEvent", (id, tenantId, scope) =>
    oneOffer(events, "event")(id, tenantId, scope),
  );
  restub(BookableManager, "getBookable", (id, tenantId, scope) =>
    oneOffer(Object.values(bookables), "bookable")(id, tenantId, scope),
  );
  restub(UserManager, "getRawUser", async () => ({
    _id: "64f1",
    toEntity: () => user(),
  }));
  const roleOfHarness = RoleManager.getRole;
  const roleOf = async (id, tenant) =>
    roles.find((r) => r.id === id && r.tenantId === tenant) ??
    roleOfHarness(id, tenant);
  restub(RoleManager, "getRole", roleOf);
  restub(RoleManager, "getRolesByIds", async (ids, tenant) =>
    (await Promise.all(ids.map((id) => roleOf(id, tenant)))).filter(Boolean),
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
  // The dependent reads of the offers answer within the reach too: the
  // embedded lists (`listed` under `public`), the read by ids (`reached`),
  // the tickets of an event.
  const others = (id) =>
    Object.values(bookables).filter((record) => record.id !== id);
  stubManager(BookableManager, {
    one: () => bookables[FIXTURE_ID],
    many: () => Object.values(bookables),
    only: {
      getBookables: (tenantId, scope) =>
        manyOffers(Object.values(bookables), "bookable")(tenantId, scope),
      getRelatedBookables: (id, tenantId, scope) =>
        manyOffers(others(id), "bookable")(tenantId, scope),
      getAncestorBookables: (id, tenantId, scope) =>
        manyOffers(others(id), "bookable")(tenantId, scope),
      getEventBookables: (tenantId, eventId, scope) =>
        manyOffers(
          Object.values(bookables).filter(
            (record) => record.type === "ticket" && record.eventId === eventId,
          ),
          "bookable",
        )(tenantId, scope),
      getBookablesByIds: (tenantId, ids, scope) =>
        projected(
          Object.values(bookables).filter(
            (record) =>
              ids.includes(record.id) &&
              reaches(record, "bookable", tenantId, scope),
          ),
          tenantId,
          scope,
          reached,
        ),
      getMediaUsage: async () => [],
      getBookableStats: async () => ({}),
      getParentBookables: async () => [],
      detachAccessPoint: async () => 0,
    },
  });
  stubManager(BookingManager, {
    one: () => null,
    many: () => [],
    skip: ["filterConcurrentBookings"],
    only: { getMediaUsage: async () => [] },
  });
  stubManager(CatalogManager, {
    one: catalog,
    only: {
      getHeroSite: async () => null,
      hasHeroLayoutMedia: async () => false,
    },
  });
  stubManager(ChallengeManager, { one: challenge });
  stubManager(CouponManager, {
    one: coupon,
    only: {
      getCoupon: async (id, tenantId, scope) =>
        one(coupons, "coupon")(id, tenantId, scope),
      getCoupons: async (tenantId, scope) =>
        many(coupons, "coupon")(tenantId, scope),
    },
  });
  // The dashboard counts and aggregates by tenant id into maps; an empty
  // map is a dashboard with nothing on it.
  const emptyMap = async () => new Map();
  stubManager(DashboardManager, {
    one: () => new Map(),
    skip: ["getStatusKeys", "isValidStatusKey"],
    only: {
      countUsers: async () => 0,
      countActiveMembershipsByTenant: emptyMap,
      countBookablesByTenant: emptyMap,
      countEventsByTenant: emptyMap,
      countActiveEventsByTenant: emptyMap,
      aggregateByBookable: async () => [],
    },
  });
  stubManager(EventManager, {
    one: event,
    only: {
      getEvents: (tenantId, scope) =>
        manyOffers(events, "event")(tenantId, scope),
      getMediaUsage: async () => [],
    },
  });
  // The groups of the harness within the reach; the harness itself
  // answers the single reads.
  stubManager(GroupBookingManager, {
    one: () => null,
    many: () => [],
    only: {
      getGroupBookings: async (tenantId, scope) =>
        many([...groups.values()], "groupBooking")(tenantId, scope).map(
          (doc) => new GroupBooking(JSON.parse(JSON.stringify(doc))),
        ),
    },
  });
  stubManager(InstanceManager, {
    one: () => null,
    only: {
      getBookableCustomFields: async () => [],
      getBranding: async () => ({ active: false }),
      getPortalConfig: async () => ({ publicOffersEnabled: false }),
      getMediaUsage: async () => [],
      getBrandingMediaUsage: async () => [],
      hasBackgroundMedia: async () => false,
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
  // The library within the reach: the manager builds the own condition
  // from the scope, the way the real one does.
  stubManager(MediaManager, {
    one: media,
    only: {
      getMediaList: async ({ tenantId } = {}, scope) => {
        const { uploadedBy } = ownCondition("media", scope);
        const items = mediaRecords.filter(
          (record) =>
            record.tenantId === tenantId &&
            (!uploadedBy || record.uploadedBy === uploadedBy),
        );
        return { items, total: items.length, page: 1, pageSize: 50 };
      },
      getBookingDocumentByFileName: async () => null,
    },
  });
  stubManager(MembershipManager, {
    one: () => membership(),
    many: () => [membership()],
  });
  stubManager(RoleManager, {
    one: role,
    only: {
      getRoles: async () => roles,
      getTenantRoles: async (id) => roles.filter((r) => r.tenantId === id),
    },
  });
  stubManager(RuleManager, {
    one: rule,
    only: { getExecutionLogs: async () => [] },
  });
  // The supervision history and outbox: insert-only, an empty page to read.
  const historyRow = () => ({
    id: FIXTURE_ID,
    tenantId,
    eventType: "tenant.levelChanged",
    occurredAt: new Date(0),
    actor: { type: "user", userId: ownerUserId },
    from: "free",
    to: "pending",
  });
  stubManager(SupervisionHistoryManager, {
    one: historyRow,
    only: {
      list: async () => ({ items: [], total: 0, page: 1, pageSize: 50 }),
    },
  });
  stubManager(SupervisionNotificationManager, {
    one: () => ({ id: FIXTURE_ID, tenantId, status: "pending" }),
  });
  // The tenants within a reach: on the instance level `own` is the tenant
  // set the scope carries (ADR 0002), as the real manager's `$in` reads
  // it; the public sees the tenants at a public level (ADR 0003).
  const tenantsWithin = (scope) => {
    const condition = isPublic(scope) ? {} : ownCondition("tenant", scope);
    const ids = condition.id?.$in;
    return Object.keys(tenantRecords)
      .filter((id) => !ids || ids.includes(id))
      .map((id) => tenantEntity(id))
      .filter((tenant) => !isPublic(scope) || isTenantPubliclyVisible(tenant));
  };
  stubManager(TenantManager, {
    one: () => tenantEntity(),
    only: {
      getTenants: async (scope) => tenantsWithin(scope),
      countTenants: async (scope) => tenantsWithin(scope).length,
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
  // The rate limits never trip here: every attempt is the first of its key.
  stubManager(RateLimitEventManager, {
    only: {
      record: async () => FIXTURE_ID,
      countSince: async () => 1,
      oldestAtWithin: async () => null,
      remove: async () => {},
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

module.exports = { installRouteWorld, offerReads, FIXTURE_ID };
