/**
 * The harness of the booking lifecycle characterization tests: the real
 * routers of the API on a bare express app, driven with `supertest`, with
 * the world below the services stubbed at the data managers and every
 * effect at the seam recorded as one row.
 *
 * What runs for real: the routers (with the JWT middleware, its token
 * verification stubbed), the controllers, `BookingService`, the checkout
 * (`BundleCheckoutService`, `ItemCheckoutService`), the entities, the
 * refund calculation and the base `PaymentService` webhook path.
 *
 * What is a fake: the booking and group booking stores (in memory, with
 * the `$set` semantics of `updateOne`, so a restore leaves behind what the
 * old document did not carry, and the `$push` of an attachment), and the
 * effect seams - access, the document renderers and number draw, the mail
 * transport, workflow, payment provider - which record a row and, when
 * told to, fail. The issuance itself (`document-issuance.js`: number,
 * revision, storage, push) runs for real; the numbers are the harness'
 * (`RE-1`, `RG-2`, `ST-1`, ...), not the tenant's. The mail module runs
 * for real too - `compose` loads, resolves the recipients and renders over
 * the stubbed managers - and the transport (`MailerService.send`) records
 * the finished mail: its type, its recipient and the names of its
 * attachments.
 *
 * The rows are the effect table of a transition (spec part 1, 4.3):
 *
 *   store.save B1 payment_due [receipt]     a store write, state and documents
 *   store.attach B1 receipt                 a document pushed to a booking
 *   access.provision B1                     an access seam call
 *   documents.receipt B1                    a document rendered
 *   mail.BOOKING_CONFIRMATION erika@example.test [RE-1.pdf,buchung-B1.ics]
 *                                           a mail sent, with its attachments
 *   workflow.onPay B1                       a workflow event
 *   payment.paymentRequest B1               the payment provider asked; it
 *                                           answers a link, which the next
 *                                           row mails to the customer
 *
 * Booking ids are random; the table names bookings B1, B2, ... in the
 * order their first write happened.
 */

const express = require("express");
const fs = require("fs");
const http = require("http");
const path = require("path");
const jwt = require("jsonwebtoken");
const sinon = require("sinon");
const request = require("supertest");

process.env.CRYPTO_SECRET =
  process.env.CRYPTO_SECRET || "0123456789abcdef0123456789abcdef";
process.env.JWT_SECRET = process.env.JWT_SECRET || "characterization-secret";

const { errorHandler } = require("../../src/middleware/error-handler");
const JwtHelper = require("../../src/commons/utilities/jwt-helper");
const BookingManager = require("../../src/commons/data-managers/booking-manager");
const GroupBookingManager = require("../../src/commons/data-managers/group-booking-manager");
const {
  BookableManager,
} = require("../../src/commons/data-managers/bookable-manager");
const TenantManager = require("../../src/commons/data-managers/tenant-manager");
const UserManager = require("../../src/commons/data-managers/user-manager");
const EventManager = require("../../src/commons/data-managers/event-manager");
const MembershipManager = require("../../src/commons/data-managers/membership-manager");
const AccessPointManager = require("../../src/commons/data-managers/access-point-manager");
const MediaManager = require("../../src/commons/data-managers/media-manager");
const WorkflowManager = require("../../src/commons/data-managers/workflow-manager");
const OpeningHoursManager = require("../../src/commons/utilities/opening-hours-manager");
const PaymentUtils = require("../../src/commons/utilities/payment-utils");
const InstanceManager = require("../../src/commons/data-managers/instance-manager");
const { RoleManager } = require("../../src/commons/data-managers/role-manager");
const CouponService = require("../../src/commons/services/coupon-service");
const WorkflowService = require("../../src/commons/services/workflow/workflow-service");
const MailerService = require("../../src/commons/mail-service/mail-service");
const AccessService = require("../../src/commons/services/access/access-service");
const AccessLogService = require("../../src/commons/services/access/access-log-service");
const ReceiptService = require("../../src/commons/services/payment/receipt-service");
const CancellationService = require("../../src/commons/services/payment/cancellation-service");
const InvoiceService = require("../../src/commons/services/payment/invoice-service");
const MediaService = require("../../src/commons/services/media/media-service");
const IdGenerator = require("../../src/commons/utilities/id-generator");
const PaymentService = require("../../src/commons/services/payment/providers/payment-service");
const { Bookable } = require("../../src/commons/entities/bookable/bookable");
const { Role } = require("../../src/commons/entities/role/role");
const Instance = require("../../src/commons/entities/instance/instance");
const {
  ROLE_GROUPS,
  ROLE_LEVELS,
} = require("../../src/commons/services/authorization/table");
const { Booking } = require("../../src/commons/entities/booking/booking");
const {
  GroupBooking,
} = require("../../src/commons/entities/groupBooking/groupBooking");

const TENANT = "tenant-1";
const TENANT_MAIL = "stadt@example.test";
/**
 * The principals (glossary "Prinzipal") of the tenant, one per level:
 * the instance owner, who also holds the all-role in the tenant; the
 * tenant owner without a role; the holder of every level of every role
 * group; and the customer, signed in without any role.
 */
const ADMIN = "admin@example.test";
const OWNER = "owner@example.test";
const ROLE_HOLDER = "rolle@example.test";
const CUSTOMER = "erika@example.test";
/** The one role of the tenant: every level of every group. */
const ROLE_ALL = "role-all";
const ORGANIZER = "orga@example.test";
/** The one supervisor named at the customer's membership. */
const SUPERVISOR = "chef@example.test";
const CUSTOMER_DB_ID = "64f1";

/** The tenant's shell template: the platform's default. */
const GENERIC_MAIL_TEMPLATE = fs.readFileSync(
  path.join(
    __dirname,
    "../../src/commons/mail-service/templates/default-generic-mail-template.temp.html",
  ),
  "utf8",
);

const HOUR = 60 * 60 * 1000;
const DAY = 24 * HOUR;
// A weekday slot well in the future: what a customer books today.
const TIME_BEGIN = Date.UTC(2027, 5, 21, 10, 0, 0);
const TIME_END = Date.UTC(2027, 5, 21, 12, 0, 0);

const ROUTER = require.resolve(
  "../../src/platform/api/api-router-tenant-related",
);
const ROUTER_V2 = require.resolve("../../src/platform/api/v2/routes");
const ROUTER_AUTH = require.resolve(
  "../../src/platform/authentication/authentication-router",
);
const ROUTER_API = require.resolve("../../src/platform/api/api-router");
const ROUTER_HTML = require.resolve(
  "../../src/platform/html-engine/html-router-tenant-related",
);
const ROUTER_JSON = require.resolve(
  "../../src/platform/json-engine/json-router-tenant-related",
);
const ROUTER_CSV =
  "../../src/platform/exporters/exporters-router-tenant-related";

/** Every router of the platform with its mount, in the order of `server.js`. */
const MOUNTS = Object.freeze([
  ["/auth", ROUTER_AUTH],
  ["/api", ROUTER_API],
  ["/api/v2", ROUTER_V2],
  ["/api/:tenant", ROUTER],
  ["/html/:tenant", ROUTER_HTML],
  ["/json/:tenant", ROUTER_JSON],
  ["/csv/:tenant", ROUTER_CSV],
]);

/**
 * The state a booking is in, read off its three flags the way the spec's
 * table (part 1, 3.2) reads them. `paid_unconfirmed` is the combination
 * the spec abolishes; since ticket 2 the entity reads it as confirmed, so
 * it can no longer show in the table. A free booking carries `isPayed`
 * whatever its state, so the flag only counts where there is a price.
 */
function stateOf(booking) {
  if (booking.isRejected) {
    return booking.isCommitted ? "cancelled" : "rejected";
  }
  if (!booking.isCommitted) {
    return booking.isPayed && booking.priceEur > 0
      ? "paid_unconfirmed"
      : "requested";
  }
  if (booking.priceEur > 0 && !booking.isPayed) {
    return "payment_due";
  }
  return "confirmed";
}

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function bookable(overrides = {}) {
  return new Bookable({
    tenantId: TENANT,
    type: "room",
    isBookable: true,
    isScheduleRelated: true,
    autoCommitBooking: false,
    amount: 10,
    permittedUsers: [],
    permittedRoles: [],
    bookingDiscounts: { users: [], roles: [] },
    checkoutBookableIds: [],
    externalProviders: [],
    attachments: [],
    priceType: "per-item",
    priceValueAddedTax: 0,
    priceCategories: [{ priceEur: 40, interval: { start: null, end: null } }],
    cancellationPolicy: { userCancellable: true, contactHint: "" },
    groupBooking: { enabled: true, permittedRoles: [] },
    ...overrides,
  });
}

/** The bookables of the tenant, keyed by id. */
function defaultBookables() {
  return {
    // A room that has to be confirmed by the administration.
    room: bookable({ id: "room", title: "Raum" }),
    // A room confirmed at once, to be paid.
    "auto-room": bookable({
      id: "auto-room",
      title: "Raum (sofort)",
      autoCommitBooking: true,
    }),
    // A free room, confirmed at once.
    "free-room": bookable({
      id: "free-room",
      title: "Freier Raum",
      autoCommitBooking: true,
      priceCategories: [{ priceEur: 0, interval: { start: null, end: null } }],
    }),
    // A free room that has to be confirmed.
    "free-request-room": bookable({
      id: "free-request-room",
      title: "Freier Raum (Anfrage)",
      priceCategories: [{ priceEur: 0, interval: { start: null, end: null } }],
    }),
    // A ticket of an event with an organizer.
    ticket: bookable({
      id: "ticket",
      title: "Ticket",
      type: "ticket",
      eventId: "E1",
      isScheduleRelated: false,
    }),
    // A room confirmed at once, priced on weekdays and free at the weekend:
    // a group over both starts in two states.
    "weekend-free-room": bookable({
      id: "weekend-free-room",
      title: "Raum (Wochenende frei)",
      autoCommitBooking: true,
      priceCategories: [
        {
          priceEur: 40,
          interval: { start: null, end: null },
          weekdays: [1, 2, 3, 4, 5],
          holidays: [],
        },
        {
          priceEur: 0,
          interval: { start: null, end: null },
          weekdays: [6, 0],
          holidays: [],
        },
      ],
    }),
    // A room with a document the mail path attaches (`mailAttach`).
    "room-with-doc": bookable({
      id: "room-with-doc",
      title: "Raum mit Hausordnung",
      autoCommitBooking: true,
      attachments: [
        {
          id: "att-1",
          title: "Hausordnung",
          type: "file",
          reference: { source: "media", mediaId: "M1" },
          mailAttach: true,
        },
      ],
    }),
  };
}

function tenant(overrides = {}) {
  return {
    id: TENANT,
    name: "Stadt Musterhausen",
    mail: TENANT_MAIL,
    genericMailTemplate: GENERIC_MAIL_TEMPLATE,
    notifyOnNewBooking: true,
    notifySupervisorsOnBooking: true,
    cancellationRefundTiers: [],
    applications: [
      { type: "payment", id: "giroCockpit", active: true },
      { type: "payment", id: "invoice", active: true },
    ],
    ...overrides,
  };
}

function createApp() {
  const app = express();
  app.use(express.json());
  app.use(express.urlencoded({ extended: true }));
  // The same mounting order as `server.js`.
  for (const [mount, router] of MOUNTS) {
    app.use(mount, require(router));
  }
  app.use(errorHandler);
  return app;
}

/** The role holding every level of every group. */
function roleAll() {
  return new Role({
    id: ROLE_ALL,
    name: "Alles",
    tenantId: TENANT,
    adminInterfaces: [],
    ...Object.fromEntries(
      ROLE_GROUPS.map((group) => [
        group,
        Object.fromEntries(ROLE_LEVELS.map((level) => [level, true])),
      ]),
    ),
  });
}

/**
 * The active membership of a user in the tenant: the owner is the tenant
 * owner, the admin and the role holder carry the all-role, the customer
 * names one supervisor; nobody else's does.
 */
function membershipOf(userId, tenantId = TENANT) {
  return {
    userId,
    tenantId,
    status: "active",
    source: "manually",
    owner: userId === OWNER,
    roles: userId === ADMIN || userId === ROLE_HOLDER ? [ROLE_ALL] : [],
    bookingNotificationRecipients:
      userId === CUSTOMER
        ? [{ type: "email", value: SUPERVISOR, label: "" }]
        : [],
    invitations: [],
  };
}

/** The instance: the admin owns it, nobody else may open a tenant. */
function instance() {
  return new Instance({
    id: "instance",
    ownerUserIds: [ADMIN],
    allowAllUsersToCreateTenant: false,
    allowedUsersToCreateTenant: [],
    mailEnabled: true,
  });
}

/**
 * Installs every stub, starts the app on the IPv4 loopback and returns the
 * handles the tests use. Call from `beforeEach` (or `before`, for a suite
 * that reads only); `sinon.restore()` and `close()` in the matching
 * `afterEach`/`after` take it all down.
 *
 * The server is the harness' own, bound to `127.0.0.1`: supertest's
 * server-per-request listens on `::` and connects to `127.0.0.1`, which on
 * macOS now and then reaches a foreign process holding the same port on
 * the IPv4 loopback.
 *
 * @param {Object} [options]
 * @param {Object} [options.tenant] - Overrides of the tenant.
 * @param {Object} [options.bookables] - Additional or replaced bookables.
 */
async function installHarness({ tenant: tenantOverrides, bookables } = {}) {
  const store = new Map();
  const groups = new Map();
  const labels = new Map();
  const effects = [];
  /** Effect names that throw when called, e.g. "access.provision". */
  const failing = new Set();
  const counters = { receipt: 0, cancellation: 0, invoice: 0 };
  const catalogue = { ...defaultBookables(), ...(bookables || {}) };
  const tenantRecord = tenant(tenantOverrides);
  const paymentSettings = { available: true };

  const label = (id) => {
    if (!labels.has(id)) {
      labels.set(id, `B${labels.size + 1}`);
    }
    return labels.get(id);
  };
  const labelsOf = (ids) =>
    (Array.isArray(ids) ? ids : [ids]).map(label).join(",");

  /** Whether an effect is told to fail: by name, or by name and booking. */
  const shouldFail = (name, detail) =>
    failing.has(name) || failing.has(`${name} ${detail.split(" ")[0]}`);

  function record(name, detail = "") {
    const row = detail ? `${name} ${detail}` : name;
    if (shouldFail(name, detail)) {
      effects.push(`${row} FAILED`);
      throw new Error(`${name} failed`);
    }
    effects.push(row);
  }

  // --- the booking store -------------------------------------------------

  sinon
    .stub(BookingManager, "getBooking")
    .callsFake(async (id) =>
      store.has(id) ? new Booking(clone(store.get(id))) : null,
    );
  sinon
    .stub(BookingManager, "getBookings")
    .callsFake(async (tenantId, ids) =>
      [...store.values()]
        .filter((doc) => ids.includes(doc.id))
        .map((doc) => new Booking(clone(doc))),
    );
  sinon
    .stub(BookingManager, "storeBooking")
    .callsFake(async (booking, upsert, options = {}) => {
      const entity =
        booking instanceof Booking ? booking : new Booking(booking);
      entity.validate();
      const unset = Array.isArray(options.unset) ? options.unset : [];
      for (const field of unset) {
        delete entity[field];
      }
      // A write told to fail fails before anything is written.
      if (shouldFail("store.save", label(entity.id))) {
        record("store.save", label(entity.id));
      }
      // `updateOne(filter, document)` is a `$set` of the document's fields:
      // what the document does not carry stays as it was.
      const merged = { ...(store.get(entity.id) || {}), ...clone(entity) };
      for (const field of unset) {
        delete merged[field];
      }
      store.set(entity.id, merged);
      const docs = merged.attachments
        .filter((att) =>
          ["receipt", "invoice", "cancellation"].includes(att.type),
        )
        .map((att) => att.type);
      record(
        "store.save",
        `${label(entity.id)} ${stateOf(merged)}${docs.length ? ` [${docs.join(",")}]` : ""}`,
      );
      return entity;
    });
  /**
   * The conditional write of the lifecycle (spec part 2, section 5): writes
   * only where the stored state is the expected one and answers the row as
   * it was; no match answers null, and the store adapter raises the guard.
   */
  sinon
    .stub(BookingManager, "storeBookingIfStatus")
    .callsFake(async (booking, expectStatus, options = {}) => {
      const entity =
        booking instanceof Booking ? booking : new Booking(booking);
      entity.validate();
      const unset = Array.isArray(options.unset) ? options.unset : [];
      for (const field of unset) {
        delete entity[field];
      }
      const previous = store.get(entity.id);
      if (!previous || previous.status !== expectStatus) {
        return null;
      }
      if (shouldFail("store.save", label(entity.id))) {
        record("store.save", label(entity.id));
      }
      const merged = { ...previous, ...clone(entity) };
      for (const field of unset) {
        delete merged[field];
      }
      store.set(entity.id, merged);
      const docs = merged.attachments
        .filter((att) =>
          ["receipt", "invoice", "cancellation"].includes(att.type),
        )
        .map((att) => att.type);
      record(
        "store.save",
        `${label(entity.id)} ${stateOf(merged)}${docs.length ? ` [${docs.join(",")}]` : ""}`,
      );
      return clone(previous);
    });
  sinon.stub(BookingManager, "replaceBooking").callsFake(async (document) => {
    store.set(document.id, clone(document));
    record("store.restore", `${label(document.id)} ${stateOf(document)}`);
  });
  sinon
    .stub(BookingManager, "addAttachment")
    .callsFake(async (tenantId, id, attachment) => {
      const doc = store.get(id);
      if (!doc) throw new Error(`no booking ${id}`);
      doc.attachments = [...(doc.attachments || []), clone(attachment)];
      record("store.attach", `${label(id)} ${attachment.type}`);
      return attachment;
    });
  sinon.stub(BookingManager, "removeBooking").callsFake(async (id) => {
    store.delete(id);
    record("store.remove", label(id));
  });
  sinon.stub(BookingManager, "getConcurrentBookings").resolves([]);
  sinon.stub(BookingManager, "getRelatedBookings").resolves([]);
  sinon.stub(BookingManager, "getEventBookings").resolves([]);

  // --- the group booking store -------------------------------------------

  const populated = (doc) =>
    new GroupBooking({
      ...clone(doc),
      bookings: doc.bookingIds
        .filter((id) => store.has(id))
        .map((id) => clone(store.get(id))),
    });
  sinon
    .stub(GroupBookingManager, "getGroupBooking")
    .callsFake(async (tenantId, id, populate = false) => {
      const doc = groups.get(id);
      if (!doc) return null;
      return populate ? populated(doc) : new GroupBooking(clone(doc));
    });
  sinon
    .stub(GroupBookingManager, "getGroupBookingByBookingId")
    .callsFake(async (tenantId, bookingId, populate = false) => {
      const doc = [...groups.values()].find((group) =>
        group.bookingIds.includes(bookingId),
      );
      if (!doc) return null;
      return populate ? populated(doc) : new GroupBooking(clone(doc));
    });
  sinon
    .stub(GroupBookingManager, "storeGroupBooking")
    .callsFake(async (groupBooking) => {
      const entity =
        groupBooking instanceof GroupBooking
          ? groupBooking
          : new GroupBooking(groupBooking);
      entity.validate();
      const doc = clone(entity);
      delete doc.bookings;
      groups.set(entity.id, doc);
      return entity;
    });
  sinon
    .stub(GroupBookingManager, "deleteGroupBooking")
    .callsFake(async (tenantId, id) => {
      groups.delete(id);
    });

  // --- everything else the checkout reads --------------------------------

  sinon
    .stub(BookableManager, "getBookable")
    .callsFake(async (id) => catalogue[id] || null);
  sinon
    .stub(BookableManager, "getBookablesByIds")
    .callsFake(async (tenantId, ids) =>
      ids.map((id) => catalogue[id]).filter(Boolean),
    );
  sinon.stub(BookableManager, "getAncestorBookables").resolves([]);
  sinon.stub(BookableManager, "getAllParentBookables").resolves([]);
  sinon.stub(BookableManager, "getRelatedBookables").resolves([]);
  sinon.stub(BookableManager, "getCustomFieldDefinitions").resolves({
    instanceFields: [],
    tenantFields: [],
  });

  sinon.stub(TenantManager, "getTenant").resolves(tenantRecord);
  sinon
    .stub(TenantManager, "getTenantApp")
    .callsFake(
      async (tenantId, appId) =>
        tenantRecord.applications.find((app) => app.id === appId) || null,
    );
  sinon.stub(UserManager, "getRawUser").resolves({ _id: CUSTOMER_DB_ID });
  sinon.stub(UserManager, "getUser").callsFake(async (id) => ({ id }));
  // The rights run for real over the instance, the memberships and the
  // one role: `PermissionService`, `UserManager.hasPermission` and
  // `getUserPermissions` read these.
  sinon.stub(InstanceManager, "getInstance").callsFake(async () => instance());
  sinon
    .stub(MembershipManager, "getMembershipByTenantAndUserID")
    .callsFake(async (tenantId, userId) => membershipOf(userId, tenantId));
  sinon
    .stub(MembershipManager, "getMembershipsByUserID")
    .callsFake(async (userId) => [membershipOf(userId)]);
  sinon
    .stub(RoleManager, "getRole")
    .callsFake(async (id) => (id === ROLE_ALL ? roleAll() : null));
  sinon.stub(MembershipManager, "getMembershipsByTenantAndRoles").resolves([]);
  // The event of the ticket, with what the organizer's notice prints.
  sinon.stub(EventManager, "getEvent").resolves({
    id: "E1",
    information: {
      name: "Sommerkonzert",
      startDate: "2027-06-21",
      startTime: "19:00",
      endDate: "2027-06-21",
      endTime: "22:00",
    },
    eventLocation: { name: "Stadthalle" },
    eventOrganizer: { contactPersonEmailAddress: ORGANIZER },
  });
  sinon.stub(OpeningHoursManager, "hasOpeningHoursConflict").resolves(false);
  sinon.stub(AccessPointManager, "getAccessPointsByIds").resolves([]);
  sinon.stub(MediaManager, "getBookingDocuments").resolves([]);
  sinon.stub(MediaManager, "getMedia").resolves({
    id: "M1",
    tenantId: TENANT,
    originalFileName: "hausordnung.pdf",
    mimeType: "application/pdf",
    storage: { provider: "local", key: "m1" },
  });
  sinon.stub(MediaService, "getBuffer").resolves(Buffer.from("%PDF-house"));
  sinon.stub(MediaService, "createBookingDocument").resolves({ id: "doc" });
  sinon.stub(WorkflowManager, "getWorkflow").resolves(null);
  sinon.stub(CouponService, "incrementCouponUsage").resolves();
  sinon.stub(CouponService, "decrementCouponUsage").resolves();
  sinon.stub(PaymentUtils, "checkInvoicePermission").resolves(true);
  sinon.stub(AccessLogService, "log").resolves();

  // --- the JWT middleware: any signed token names its user ---------------

  sinon.stub(JwtHelper, "verifyToken").callsFake((token) => ({
    sub: jwt.decode(token).sub,
    v: 2,
    type: "access",
  }));

  // --- the effect seams --------------------------------------------------

  for (const op of [
    "holdForBooking",
    "provisionForBooking",
    "revokeForBooking",
  ]) {
    sinon.stub(AccessService, op).callsFake(async (tenantId, bookingId) => {
      record(`access.${op.replace("ForBooking", "")}`, label(bookingId));
      return [];
    });
  }
  sinon
    .stub(AccessService, "updateForBooking")
    .callsFake(async (tenantId, oldBooking, newBooking) => {
      record("access.update", label(newBooking.id));
      return [];
    });
  sinon
    .stub(AccessService, "refreshHolds")
    .callsFake(async (tenantId, bookingIds) => {
      record("access.refreshHolds", labelsOf(bookingIds));
      return [];
    });

  sinon
    .stub(WorkflowService, "handleWorkflowEvent")
    .callsFake(async (tenantId, bookingId, event, skipBookingStatus) => {
      record(
        `workflow.${event}`,
        `${label(bookingId)}${skipBookingStatus ? "" : " without skipBookingStatus"}`,
      );
      return true;
    });

  /**
   * The transport: records the finished mail as `mail.<type> <to>
   * [<attachments>]`. A booking id inside an attachment name (the
   * calendar file `buchung-<id>.ics`) is written as the booking's label.
   */
  const labelledName = (filename) =>
    [...labels.keys()].reduce(
      (name, id) => name.split(id).join(labels.get(id)),
      filename,
    );
  sinon.stub(MailerService, "send").callsFake(async (mail) => {
    const files = (mail.attachments || []).map((att) =>
      labelledName(att.filename),
    );
    record(
      `mail.${mail.type}`,
      `${mail.to}${files.length ? ` [${files.join(",")}]` : ""}`,
    );
    return { status: "sent", transport: "instance" };
  });

  const pdf = (name) => ({ name, buffer: Buffer.from(`%PDF-${name}`) });
  /** The number draw: `RE-1`, `RG-2`, `ST-1`, ... per type. */
  const PREFIX = { receipt: "RE", invoice: "RG", cancellation: "ST" };
  sinon
    .stub(IdGenerator, "next")
    .callsFake(
      async (tenantId, width, type) => `${PREFIX[type]}-${++counters[type]}`,
    );
  /**
   * A renderer of receipts, invoices or cancellations, single or
   * aggregated: names the file after the document id (`RE-1.pdf`, and
   * `RE-1-r2.pdf` for a revision) and records the row.
   */
  const renderer =
    (row) =>
    async ({ bookingIds, documentId, revision, groupBookingId }) => {
      record(
        groupBookingId
          ? `documents.aggregated${row}`
          : `documents.${row.toLowerCase()}`,
        labelsOf(bookingIds),
      );
      const name = `${documentId}${revision > 1 ? `-r${revision}` : ""}.pdf`;
      return pdf(name);
    };
  sinon.stub(ReceiptService, "render").callsFake(renderer("Receipt"));
  sinon.stub(InvoiceService, "render").callsFake(renderer("Invoice"));
  sinon.stub(CancellationService, "render").callsFake(async (input) => {
    const rendered = await renderer("Cancellation")(input);
    const { options = {} } = input;
    const cancelledAt =
      options.refundCalculation?.cancelledAt ??
      options.refundCalculations?.[0]?.cancelledAt;
    return {
      ...rendered,
      attachmentFields:
        cancelledAt !== undefined ? { timeCreated: cancelledAt } : {},
    };
  });
  /**
   * The payment provider at its seam: records the payment request, which
   * it answers as a link (the lifecycle mails it), and the payment page.
   * A webhook counts as a successful payment and goes the base class' way
   * from there - `handleSuccessfulPayment` is the one thing of
   * `PaymentService` that runs for real.
   */
  class FakePaymentProvider extends PaymentService {
    async paymentRequest() {
      record(
        "payment.paymentRequest",
        `${labelsOf(this.bookingIds)}${this.aggregated ? " aggregated" : ""}`,
      );
      return { form: "link", paymentUrl: "https://pay.example.test" };
    }

    async createPayment() {
      record(
        "payment.createPayment",
        `${labelsOf(this.bookingIds)}${this.aggregated ? " aggregated" : ""}`,
      );
      return { url: "https://pay.example.test" };
    }

    async paymentNotification() {
      await this.handleSuccessfulPayment({
        bookingIds: this.bookingIds,
        tenantId: this.tenantId,
        paymentMethod: "CREDIT_CARD",
      });
      return true;
    }
  }
  sinon
    .stub(PaymentUtils, "getPaymentService")
    .callsFake(async (tenantId, bookingIds, paymentProvider, options) =>
      paymentSettings.available
        ? new FakePaymentProvider(tenantId, bookingIds, options)
        : null,
    );

  const app = createApp();
  const server = http.createServer(app);
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const api = () => request(server);
  /** The authorization header of a signed-in user. */
  const as = (userId) => ({
    Authorization: `Bearer ${jwt.sign({ sub: userId }, "irrelevant")}`,
  });

  /** The administration books manually with the flags it chooses. */
  async function manualBooking(bookableId, flags = {}, overrides = {}) {
    const res = await api()
      .put(`/api/${TENANT}/bookings`)
      .set(as(ADMIN))
      .send({
        tenantId: TENANT,
        ...checkoutBody(bookableId, overrides),
        ...flags,
      });
    if (res.status !== 200) {
      throw new Error(`manual booking answered ${res.status}: ${res.text}`);
    }
    return res.body;
  }

  /** A payment provider's webhook, e.g. `id=<bookingId>`. */
  const webhook = (query, body = {}) =>
    api().post(`/api/${TENANT}/payments/notify?${query}`).send(body);

  return {
    /** The express app, every router mounted. */
    app,
    /** A supertest request against the app. */
    api,
    /** Stops the server. */
    close: () =>
      new Promise((resolve) => {
        server.closeAllConnections();
        server.close(() => resolve());
      }),
    store,
    groups,
    effects,
    failing,
    /** Whether `PaymentUtils.getPaymentService` finds a provider. */
    payment: paymentSettings,
    tenant: tenantRecord,
    bookables: catalogue,
    as,
    manualBooking,
    webhook,
    /** The stored document of a booking. */
    stored: (id) => store.get(id),
    /** The stored documents of a group's members, in group order. */
    members: (groupId) =>
      groups.get(groupId).bookingIds.map((id) => store.get(id)),
    /** Forgets the rows so far; the store stays. */
    clearEffects: () => {
      effects.length = 0;
    },
    /** Every row so far, then forgets them. */
    takeEffects: () => effects.splice(0, effects.length),
  };
}

/** A customer's checkout body for one bookable. */
function checkoutBody(bookableId, overrides = {}) {
  return {
    timeBegin: TIME_BEGIN,
    timeEnd: TIME_END,
    bookableItems: [{ bookableId, amount: 1 }],
    name: "Erika Muster",
    mail: CUSTOMER,
    paymentProvider: "giroCockpit",
    attachmentStatus: [],
    ...overrides,
  };
}

/** A stored booking as the admin form sends it back, with changes. */
function adminForm(stored, changes = {}) {
  const form = { ...stored };
  for (const field of [
    "_couponUsed",
    "attachments",
    "accessInfo",
    "hooks",
    "cancellationRefund",
    "lockerInfo",
  ]) {
    delete form[field];
  }
  return { ...form, ...changes };
}

module.exports = {
  installHarness,
  createApp,
  bookable,
  checkoutBody,
  adminForm,
  stateOf,
  request,
  TENANT,
  TENANT_MAIL,
  MOUNTS,
  ADMIN,
  OWNER,
  ROLE_HOLDER,
  ROLE_ALL,
  CUSTOMER,
  ORGANIZER,
  SUPERVISOR,
  TIME_BEGIN,
  TIME_END,
  DAY,
};
