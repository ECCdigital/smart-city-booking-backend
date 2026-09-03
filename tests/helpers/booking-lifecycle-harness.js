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
 * effect seams - access, the document renderers and number draw, mail,
 * workflow, payment provider, supervisor mail - which record a row and,
 * when told to, fail. The issuance itself (`document-issuance.js`: number,
 * revision, storage, push) runs for real; the numbers are the harness'
 * (`RE-1`, `RG-2`, `ST-1`, ...), not the tenant's.
 *
 * The rows are the effect table of a transition (spec part 1, 4.3):
 *
 *   store.save B1 payment_due [receipt]     a store write, state and documents
 *   store.attach B1 receipt                 a document pushed to a booking
 *   access.provision B1                     an access seam call
 *   documents.receipt B1                    a document rendered
 *   mail.sendBookingConfirmation B1 [RE-1.pdf]   a mail with its attachments
 *   workflow.onPay B1                       a workflow event
 *   payment.paymentRequest B1               the payment provider asked
 *
 * Booking ids are random; the table names bookings B1, B2, ... in the
 * order their first write happened.
 */

const express = require("express");
const http = require("http");
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
const PermissionsService = require("../../src/commons/services/permission-service");
const CouponService = require("../../src/commons/services/coupon-service");
const WorkflowService = require("../../src/commons/services/workflow/workflow-service");
const MailController = require("../../src/commons/mail-service/mail-controller");
const AccessService = require("../../src/commons/services/access/access-service");
const AccessLogService = require("../../src/commons/services/access/access-log-service");
const ReceiptService = require("../../src/commons/services/payment/receipt-service");
const CancellationService = require("../../src/commons/services/payment/cancellation-service");
const InvoiceService = require("../../src/commons/services/payment/invoice-service");
const MediaService = require("../../src/commons/services/media/media-service");
const IdGenerator = require("../../src/commons/utilities/id-generator");
const SupervisorNotificationService = require("../../src/commons/services/supervisor-notification-service");
const PaymentService = require("../../src/commons/services/payment/providers/payment-service");
const { Bookable } = require("../../src/commons/entities/bookable/bookable");
const { Booking } = require("../../src/commons/entities/booking/booking");
const {
  GroupBooking,
} = require("../../src/commons/entities/groupBooking/groupBooking");

const TENANT = "tenant-1";
const TENANT_MAIL = "stadt@example.test";
const ADMIN = "admin@example.test";
const CUSTOMER = "erika@example.test";
const ORGANIZER = "orga@example.test";
const CUSTOMER_DB_ID = "64f1";

const HOUR = 60 * 60 * 1000;
const DAY = 24 * HOUR;
// A weekday slot well in the future: what a customer books today.
const TIME_BEGIN = Date.UTC(2027, 5, 21, 10, 0, 0);
const TIME_END = Date.UTC(2027, 5, 21, 12, 0, 0);

const ROUTER = "../../src/platform/api/api-router-tenant-related";
const ROUTER_V2 = "../../src/platform/api/v2/routes";

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
    mail: TENANT_MAIL,
    notifyOnNewBooking: true,
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
  // The same mounting order as `server.js`.
  app.use("/api/v2", require(ROUTER_V2));
  app.use("/api/:tenant", require(ROUTER));
  app.use(errorHandler);
  return app;
}

/**
 * Installs every stub, starts the app on the IPv4 loopback and returns the
 * handles the tests use. Call from `beforeEach`; `sinon.restore()` and
 * `close()` in `afterEach` take it all down.
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
  sinon
    .stub(UserManager, "hasPermission")
    .callsFake(async (userId) => userId === ADMIN);
  sinon
    .stub(PermissionsService, "_isInstanceOwner")
    .callsFake(async (userId) => userId === ADMIN);
  sinon.stub(PermissionsService, "_isTenantOwner").resolves(false);
  sinon
    .stub(MembershipManager, "getMembershipByTenantAndUserID")
    .callsFake(async (tenantId, userId) => ({ userId, roles: [] }));
  sinon.stub(MembershipManager, "getMembershipsByTenantAndRoles").resolves([]);
  sinon.stub(EventManager, "getEvent").resolves({
    id: "E1",
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

  // Every `send*` of the mail controller takes the booking id(s) second
  // and, where it sends files, one array of nodemailer attachments; the
  // row is read off the arguments by that shape.
  for (const name of Object.getOwnPropertyNames(MailController)) {
    if (
      typeof MailController[name] !== "function" ||
      !name.startsWith("send")
    ) {
      continue;
    }
    sinon.stub(MailController, name).callsFake(async (...args) => {
      const ids = args[1];
      const attachments = args.find(
        (arg) => Array.isArray(arg) && arg.length > 0 && arg[0]?.filename,
      );
      const files = attachments
        ? ` [${attachments.map((att) => att.filename).join(",")}]`
        : "";
      record(`mail.${name}`, `${labelsOf(ids)}${files}`);
    });
  }
  sinon
    .stub(SupervisorNotificationService, "notifySupervisorsOnBookingCreated")
    .callsFake(async ({ bookingIds }) => {
      record("supervisor.notify", labelsOf(bookingIds));
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
   * The payment provider at its seam: records the payment request and the
   * payment link. A webhook counts as a successful payment and goes the
   * base class' way from there - `handleSuccessfulPayment` is the one
   * thing of `PaymentService` that runs for real.
   */
  class FakePaymentProvider extends PaymentService {
    async paymentRequest() {
      record(
        "payment.paymentRequest",
        `${labelsOf(this.bookingIds)}${this.aggregated ? " aggregated" : ""}`,
      );
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
  bookable,
  checkoutBody,
  adminForm,
  stateOf,
  request,
  TENANT,
  ADMIN,
  CUSTOMER,
  TIME_BEGIN,
  TIME_END,
  DAY,
};
