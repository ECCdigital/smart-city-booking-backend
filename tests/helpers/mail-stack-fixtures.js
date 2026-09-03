/**
 * The one fixture every mail characterization renders against (mail-stack
 * spec, section 6): a tenant with snippet overrides, after-texts and
 * subject overrides, a booking with custom fields of every mail visibility,
 * a cancelled booking with a refund, a group of three members - one of
 * them a ticket for an event with an organizer - and the instance the
 * account mails go out from.
 *
 * `installMailStackStore` puts that fixture behind the data managers the
 * mail stack reads through, so `MailController` and the lifecycle mail
 * adapter run unchanged over it; the transport is the in-memory one
 * (`in-memory-mail-transport.js`). Nothing here reaches a database.
 */

const fs = require("fs");
const path = require("path");
const sinon = require("sinon");

const TenantManager = require("../../src/commons/data-managers/tenant-manager");
const InstanceManager = require("../../src/commons/data-managers/instance-manager");
const BookingManager = require("../../src/commons/data-managers/booking-manager");
const {
  BookableManager,
} = require("../../src/commons/data-managers/bookable-manager");
const EventManager = require("../../src/commons/data-managers/event-manager");
const GroupBookingManager = require("../../src/commons/data-managers/group-booking-manager");
const UserManager = require("../../src/commons/data-managers/user-manager");
const MembershipManager = require("../../src/commons/data-managers/membership-manager");
const MediaManager = require("../../src/commons/data-managers/media-manager");
const MediaService = require("../../src/commons/services/media/media-service");
const {
  mergeDefaultMailSnippets,
} = require("../../src/commons/mail-service/templates/default-mail-snippets");

const TENANT = "stadthalle";
const TENANT_NAME = "Stadthalle Musterstadt";
const TENANT_MAIL = "buchung@stadthalle.example.test";
const INSTANCE_MAIL = "admin@plattform.example.test";
const CUSTOMER = "erika@example.test";
const BOOKER_USER = "erika@example.test";
const SUPERVISOR = "chef@stadthalle.example.test";
const SECRETARY = "sekretariat@stadthalle.example.test";
const ORGANIZER = "veranstalter@konzerte.example.test";
const FRONTEND_URL = "https://buchung.example.test";
const GROUP = "G-stadthalle";
const GROUP_MEMBER_IDS = ["G-1", "G-2", "G-3"];
const BACKEND_URL = "https://api.example.test";

/** 2026-10-05 10:00 to 12:00 Europe/Berlin, as the store holds the times. */
const TIME_BEGIN = Date.UTC(2026, 9, 5, 8, 0, 0);
const TIME_END = Date.UTC(2026, 9, 5, 10, 0, 0);
/** The instant the mails are rendered at - `currentDate` of the overrides. */
const NOW = Date.UTC(2026, 8, 3, 12, 0, 0);

const GENERIC_MAIL_TEMPLATE = fs.readFileSync(
  path.join(
    __dirname,
    "../../src/commons/mail-service/templates/default-generic-mail-template.temp.html",
  ),
  "utf8",
);

/**
 * The tenant: every overridable snippet at its default, two of them
 * replaced by the tenant's own text, an after-text under the confirmation
 * and the cancellation, two subjects overridden, the support footer on,
 * BCC of receipts on, the tenant's notice of new bookings on, the public
 * status view on (so the QR code is rendered) unless told otherwise.
 */
function tenant(overrides = {}) {
  return {
    id: TENANT,
    name: TENANT_NAME,
    mail: TENANT_MAIL,
    genericMailTemplate: GENERIC_MAIL_TEMPLATE,
    mailSnippets: mergeDefaultMailSnippets({
      "booking-confirmation":
        "<p>Guten Tag {{customerName}},</p>" +
        "<p>vielen Dank für Ihre Buchung im {{tenantName}} am {{currentDate}}.</p>" +
        "<p>{{{customerContact}}}</p>",
      "booking-confirmation__after":
        "<p>Bei Fragen erreichen Sie uns unter {{supportEmail}}.</p>",
      "booking-cancel":
        "<p>Ihre Buchung im {{tenantName}} wurde storniert.</p>" +
        "{{#if hasRefundPreview}}<p>Wir erstatten {{priceFormatted refundAmountEur}} " +
        "von {{priceFormatted originalAmountEur}} ({{refundPercentage}} %, " +
        "{{daysBeforeStart}} Tage vor Beginn).</p>{{/if}}" +
        "{{#if hasCancellationFee}}<p>Einbehalt: {{priceFormatted cancellationFeeEur}}</p>{{/if}}",
      "booking-cancel__after": "<p>Wir hoffen, Sie bald wieder zu sehen.</p>",
    }),
    mailSubjects: {
      "booking-confirmation": "{{tenantName}}: Ihre Buchung, {{customerName}}",
      "booking-cancel": "Storniert: Ihre Buchung im {{tenantName}}",
    },
    mailShowSupportFooter: true,
    mailBookingPeriodFormat: "default",
    useInstanceMail: true,
    receiptEnableBCC: true,
    enablePublicStatusView: true,
    notifyOnNewBooking: true,
    notifySupervisorsOnBooking: true,
    ...overrides,
  };
}

/** The instance: SMTP over the instance's own no-reply account, mail on. */
function instance(overrides = {}) {
  return {
    mailTemplate: GENERIC_MAIL_TEMPLATE,
    mailAddress: INSTANCE_MAIL,
    mailEnabled: true,
    noreplyMail: "noreply@plattform.example.test",
    noreplyDisplayName: "Buchungsplattform",
    noreplyHost: "smtp.plattform.example.test",
    noreplyPort: 465,
    noreplyUser: "noreply",
    noreplyPassword: "instance-secret",
    noreplyStarttls: false,
    noreplyUseGraphApi: false,
    noreplyGraphTenantId: "",
    noreplyGraphClientId: "",
    noreplyGraphClientSecret: null,
    ...overrides,
  };
}

/** A checkout custom field as the booking carries it, value included. */
function customField(overrides = {}) {
  return {
    id: "field-persons",
    caption: "Anzahl Personen",
    inputType: "string",
    usageOptions: { context: "checkout", showInMail: true },
    value: "4 Erwachsene",
    hasValue: true,
    ...overrides,
  };
}

/** A confirmed, paid booking of the room, by the customer. */
function booking(overrides = {}) {
  return {
    id: "B-1",
    tenantId: TENANT,
    status: "confirmed",
    name: "Erika Musterfrau",
    company: "Musterfirma GmbH",
    mail: CUSTOMER,
    phone: "+49 30 1234567",
    street: "Musterstraße 1",
    zipCode: "12345",
    location: "Musterstadt",
    comment: "Bitte klingeln <b>laut</b>",
    priceEur: 120.5,
    timeBegin: TIME_BEGIN,
    timeEnd: TIME_END,
    assignedUserId: BOOKER_USER,
    bookableItems: [{ bookableId: "room", amount: 1 }],
    coupon: { type: "percentage", description: "Frühbucher", value: 10 },
    customFields: [
      customField(),
      customField({
        id: "field-catering",
        caption: "Catering",
        inputType: "select",
        options: [{ value: "veg", caption: "Vegetarisch" }],
        value: "veg",
      }),
      customField({
        id: "field-wishes",
        caption: "Sonderwünsche",
        inputType: "text",
        value: null,
        hasValue: false,
      }),
      customField({
        id: "field-internal",
        caption: "Interner Vermerk",
        usageOptions: { context: "checkout", showInMail: false },
        value: "nicht in der Mail",
      }),
    ],
    cancellationPolicy: { userCancellable: true, contactHint: "" },
    attachments: [
      {
        id: "att-house-rules",
        title: "Hausordnung",
        type: "file",
        reference: { source: "media", mediaId: "M-house-rules" },
        mailAttach: true,
      },
      {
        id: "att-plan",
        title: "Raumplan",
        type: "file",
        reference: { source: "media", mediaId: "M-plan" },
        mailAttach: false,
      },
    ],
    hooks: [],
    ...overrides,
  };
}

/** The refund audit of the cancelled booking: 75 % back, 25 % fee. */
function cancellationRefund(overrides = {}) {
  return {
    originalAmountEur: 120.5,
    refundAmountEur: 90.38,
    cancellationFeeEur: 30.12,
    appliedRefundPercentage: 75,
    daysBeforeStart: 14,
    cancelledFrom: "confirmed",
    ...overrides,
  };
}

/** The room, with a note the booking details print. */
function room(overrides = {}) {
  return {
    id: "room",
    tenantId: TENANT,
    title: "Großer Saal",
    type: "room",
    bookingNotes: "<p>Der Schlüssel liegt an der Rezeption bereit.</p>",
    location: {
      address: {
        street: "Rathausplatz",
        house_number: "1",
        postcode: "12345",
        city: "Musterstadt",
      },
    },
    eventId: undefined,
    ...overrides,
  };
}

/** A ticket for the concert. */
function ticket(overrides = {}) {
  return {
    id: "ticket",
    tenantId: TENANT,
    title: "Konzertkarte",
    type: "ticket",
    bookingNotes: "",
    eventId: "concert",
    ...overrides,
  };
}

/** The concert, with an organizer to tell. */
function concert(overrides = {}) {
  return {
    id: "concert",
    tenantId: TENANT,
    isPublic: true,
    information: {
      name: "Herbstkonzert",
      startDate: "2026-10-05",
      startTime: "19:30",
      endDate: "2026-10-05",
      endTime: "22:00",
    },
    eventLocation: { name: "Großer Saal" },
    location: {
      address: {
        street: "Rathausplatz",
        house_number: "1",
        post_code: "12345",
        city: "Musterstadt",
      },
    },
    eventOrganizer: { contactPersonEmailAddress: ORGANIZER },
    ...overrides,
  };
}

/** The three members of the group: two rooms and a ticket. */
function groupMembers() {
  return [
    booking({ id: "G-1", priceEur: 50 }),
    booking({
      id: "G-2",
      priceEur: 30,
      comment: "",
      coupon: null,
      customFields: [],
      attachments: [],
      timeBegin: TIME_BEGIN + 24 * 60 * 60 * 1000,
      timeEnd: TIME_END + 24 * 60 * 60 * 1000,
    }),
    booking({
      id: "G-3",
      priceEur: 40.5,
      comment: "",
      coupon: null,
      customFields: [],
      attachments: [],
      bookableItems: [{ bookableId: "ticket", amount: 2 }],
      timeBegin: null,
      timeEnd: null,
    }),
  ];
}

/** The customer's account, for the instance's notice of a new user. */
function user(overrides = {}) {
  return {
    id: CUSTOMER,
    firstName: "Erika",
    lastName: "Musterfrau",
    company: "Musterfirma GmbH",
    created: Date.UTC(2026, 8, 1, 9, 30, 0),
    ...overrides,
  };
}

/**
 * The booker's membership: a supervisor by address, one by account, the
 * secretariat by role, and the booker's own address, which the resolution
 * has to drop.
 */
function membership(overrides = {}) {
  return {
    tenantId: TENANT,
    userId: BOOKER_USER,
    status: "active",
    bookingNotificationRecipients: [
      { type: "email", value: SUPERVISOR, label: "" },
      { type: "user", value: SUPERVISOR, label: "" },
      { type: "role", value: "sekretariat", label: "Sekretariat" },
      { type: "email", value: BOOKER_USER, label: "" },
    ],
    ...overrides,
  };
}

/**
 * Stubs the data managers the mail stack reads through with the fixture.
 * Restored by `sinon.restore()`.
 *
 * @param {Object} [options]
 * @param {Object} [options.tenant]
 * @param {Object} [options.instance]
 * @param {Object[]} [options.bookings] Every booking the store knows
 * @param {Object[]} [options.bookables]
 * @param {Object[]} [options.events]
 * @param {Object[]} [options.users]
 * @param {Object|null} [options.membership] The booker's membership
 * @param {Object[]} [options.roleMemberships] Memberships listed for a role
 * @returns {Object} The fixture as installed
 */
function installMailStackStore(options = {}) {
  const store = {
    tenant: options.tenant ?? tenant(),
    instance: options.instance ?? instance(),
    bookings: options.bookings ?? [
      booking(),
      booking({
        id: "B-cancelled",
        status: "cancelled",
        cancellationRefund: cancellationRefund(),
      }),
      ...groupMembers(),
    ],
    bookables: options.bookables ?? [room(), ticket()],
    events: options.events ?? [concert()],
    users: options.users ?? [user(), user({ id: SUPERVISOR })],
    membership:
      options.membership === undefined ? membership() : options.membership,
    roleMemberships: options.roleMemberships ?? [
      { userId: SECRETARY, status: "active" },
      { userId: "ehemalig@stadthalle.example.test", status: "suspended" },
    ],
  };
  const byId = (list, id) => list.find((entry) => entry.id === id) ?? null;

  sinon.stub(TenantManager, "getTenant").callsFake(async (tenantId) => {
    if (tenantId !== store.tenant.id) return null;
    return store.tenant;
  });
  sinon.stub(InstanceManager, "getInstance").resolves(store.instance);
  sinon
    .stub(BookingManager, "getBooking")
    .callsFake(async (id) => byId(store.bookings, id));
  sinon
    .stub(BookingManager, "getBookings")
    .callsFake(async (tenantId, ids) =>
      store.bookings.filter((entry) => ids.includes(entry.id)),
    );
  sinon.stub(BookableManager, "getBookables").resolves(store.bookables);
  sinon
    .stub(BookableManager, "getBookablesByIds")
    .callsFake(async (tenantId, ids) =>
      store.bookables.filter((entry) => ids.includes(entry.id)),
    );
  sinon
    .stub(BookableManager, "getBookable")
    .callsFake(async (id) => byId(store.bookables, id));
  // The group the three members belong to, looked up by any member.
  sinon
    .stub(GroupBookingManager, "getGroupBookingByBookingId")
    .callsFake(async (tenantId, bookingId) =>
      GROUP_MEMBER_IDS.includes(bookingId)
        ? { id: GROUP, tenantId: TENANT, bookingIds: GROUP_MEMBER_IDS }
        : null,
    );
  sinon
    .stub(EventManager, "getEvent")
    .callsFake(async (id) => byId(store.events, id));
  sinon
    .stub(UserManager, "getUser")
    .callsFake(async (id) => byId(store.users, String(id).toLowerCase()));
  sinon
    .stub(MembershipManager, "getMembershipByTenantAndUserID")
    .resolves(store.membership);
  sinon
    .stub(MembershipManager, "getMembershipsByTenantAndRoles")
    .resolves(store.roleMemberships);
  // The `mailAttach` documents: the media library answers the house rules.
  sinon.stub(MediaManager, "getMedia").callsFake(async (mediaId) =>
    mediaId === "M-house-rules"
      ? {
          id: mediaId,
          tenantId: TENANT,
          originalFileName: "hausordnung-2026.pdf",
          mimeType: "application/pdf",
          storage: { key: "stadthalle/media/M-house-rules/original.pdf" },
        }
      : null,
  );
  sinon
    .stub(MediaService, "getBuffer")
    .resolves(Buffer.from("%PDF-1.4 house rules"));

  return store;
}

/** A document a transition issued, as the lifecycle hands it to the mail. */
function issuedFile(name) {
  return { name, buffer: Buffer.from(`%PDF-1.4 ${name}`) };
}

module.exports = {
  TENANT,
  GROUP,
  GROUP_MEMBER_IDS,
  TENANT_NAME,
  TENANT_MAIL,
  INSTANCE_MAIL,
  CUSTOMER,
  BOOKER_USER,
  SUPERVISOR,
  SECRETARY,
  ORGANIZER,
  FRONTEND_URL,
  BACKEND_URL,
  TIME_BEGIN,
  TIME_END,
  NOW,
  tenant,
  instance,
  booking,
  cancellationRefund,
  room,
  ticket,
  concert,
  groupMembers,
  user,
  membership,
  installMailStackStore,
  issuedFile,
};
