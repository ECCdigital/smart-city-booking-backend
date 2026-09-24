/**
 * The rights table: data, not code. For every
 * protected thing (`resource`) and action, the entry names the least level
 * of the principal that gets each reach (glossary "Reichweite"):
 *
 *   public: true                  anyone, anonymous included
 *   own:    "<level>"             the principal's own records
 *   any:    "<level>"             every record of the tenant (or instance)
 *
 * A missing slot means "nobody". The levels are:
 *
 *   "signedIn"                    any signed-in user
 *   "<group>.<step>"              a role level, e.g. "manageBookings.readAny"
 *   "tenantOwner"                 the owner of the tenant
 *   "instanceOwner"               the owner of the instance
 *   "mayCreateTenant"             the instance setting that lets a user open
 *                                 a tenant
 *
 * with the fixed precedence instanceOwner ⊇ tenantOwner ⊇ role ⊇ signedIn:
 * an instance owner satisfies every level, a tenant owner every level but
 * `instanceOwner` and `mayCreateTenant` (that one follows the instance
 * setting alone). Actions beyond create, read, update and delete (`qr`,
 * `operate`, `document`, `challenge`, ...) are named entries here, never
 * new role steps: the role steps stay the seven of the role schema.
 * `own: "signedIn"` at an entry whose handler has no owner key
 * (`bookable.meta`, `event.meta`, `role.list`,
 * `invitation.respond`, `tenant.countCheck`) means "any signed-in user,
 * for themselves": the reach `own` is then the handler's to read as
 * "self", not a query condition (§11, §12).
 *
 * Transcribed from the authorize spec §3, behaviour-equal to today except
 * the changes of §7; ticket 2 to 5 of the chain put the routers on it.
 */

const ROLE_GROUPS = Object.freeze([
  "manageBookables",
  "manageUsers",
  "manageRoles",
  "manageBookings",
  "manageCoupons",
  "manageMedia",
]);

const ROLE_LEVELS = Object.freeze([
  "create",
  "readAny",
  "readOwn",
  "updateAny",
  "updateOwn",
  "deleteAny",
  "deleteOwn",
]);

/** The seven CRUD entries of a role group, shared by bookables, coupons, ... */
function crud(group, { publicRead = false } = {}) {
  return {
    read: {
      public: publicRead,
      own: `${group}.readOwn`,
      any: `${group}.readAny`,
    },
    create: { any: `${group}.create` },
    update: { own: `${group}.updateOwn`, any: `${group}.updateAny` },
    delete: { own: `${group}.deleteOwn`, any: `${group}.deleteAny` },
  };
}

const TABLE = {
  bookable: {
    ...crud("manageBookables"),
    readPublic: { public: true },
    prices: {
      public: true,
      own: "manageBookables.readOwn",
      any: "manageBookables.readAny",
    },
    template: { any: "manageBookables.create" },
    meta: { own: "signedIn" },
    relatedBookings: {
      public: true,
      own: "signedIn",
      any: "manageBookings.readAny",
    },
    reviewSubmit: { own: "tenantOwner", any: "instanceOwner" },
    reviewDecide: { any: "instanceOwner" },
  },

  event: {
    read: {
      public: true,
      own: "manageBookables.readOwn",
      any: "manageBookables.readAny",
    },
    create: { any: "manageBookables.create" },
    update: {
      own: "manageBookables.updateOwn",
      any: "manageBookables.updateAny",
    },
    delete: {
      own: "manageBookables.deleteOwn",
      any: "manageBookables.deleteAny",
    },
    seatCount: {
      own: "manageBookables.readOwn",
      any: "manageBookables.readAny",
    },
    meta: { own: "signedIn" },
    reviewSubmit: { own: "tenantOwner", any: "instanceOwner" },
    reviewDecide: { any: "instanceOwner" },
  },

  booking: {
    read: { own: "signedIn", any: "manageBookings.readAny" },
    list: { public: true, own: "signedIn", any: "manageBookings.readAny" },
    lookup: { public: true },
    document: { own: "signedIn", any: "manageBookings.readAny" },
    reprint: { own: "signedIn", any: "manageBookings.updateAny" },
    invoice: { any: "manageBookings.updateAny" },
    create: { any: "manageBookings.create" },
    update: { any: "manageBookings.updateAny" },
    commit: { any: "manageBookings.updateAny" },
    pay: { any: "manageBookings.updateAny" },
    reject: { any: "manageBookings.updateAny" },
    delete: { any: "manageBookings.deleteAny" },
    cancel: { own: "signedIn", any: "manageBookings.updateAny" },
    operate: { own: "signedIn", any: "manageBookings.updateAny" },
  },

  groupBooking: {
    read: { own: "signedIn", any: "manageBookings.readAny" },
    update: { any: "manageBookings.updateAny" },
    commit: { any: "manageBookings.updateAny" },
    pay: { any: "manageBookings.updateAny" },
    reject: { any: "manageBookings.updateAny" },
    delete: { any: "manageBookings.deleteAny" },
    document: { own: "signedIn", any: "manageBookings.updateAny" },
    invoice: { any: "manageBookings.updateAny" },
  },

  coupon: {
    ...crud("manageCoupons"),
    lookup: { public: true },
  },

  role: {
    read: { any: "manageRoles.readAny" },
    list: { own: "signedIn", any: "manageRoles.readAny" },
    create: { any: "manageRoles.create" },
    update: { any: "manageRoles.updateAny" },
    delete: { any: "manageRoles.deleteAny" },
    readMine: { own: "signedIn" },
  },

  media: {
    read: { own: "manageMedia.readOwn", any: "manageMedia.readAny" },
    metadata: { own: "signedIn" },
    file: {
      public: true,
      own: "manageMedia.readOwn",
      any: "manageMedia.readAny",
    },
    create: { any: "manageMedia.create" },
    update: { own: "manageMedia.updateOwn", any: "manageMedia.updateAny" },
    delete: { own: "manageMedia.deleteOwn", any: "manageMedia.deleteAny" },
    bookingDocument: { own: "signedIn", any: "manageBookings.readAny" },
    updateBookingDocument: {
      own: "signedIn",
      any: "manageBookings.updateAny",
    },
  },

  accessPoint: {
    read: { any: "manageBookables.readAny" },
    bookings: { any: "manageBookings.readAny" },
    write: { any: "tenantOwner" },
  },

  accessApp: {
    read: { any: "manageBookables.readAny" },
    manage: { any: "tenantOwner" },
  },

  accessAudit: {
    export: { any: "manageBookings.readAny" },
  },

  dashboard: {
    read: { any: "manageBookings.readAny" },
  },

  accessScan: {
    resolve: { own: "signedIn" },
  },

  workflow: {
    read: { any: "manageBookings.readAny" },
    task: { any: "manageBookings.updateAny" },
    manage: { any: "tenantOwner" },
  },

  invitation: {
    manage: { any: "manageUsers.updateAny" },
    readMine: { own: "signedIn" },
    respond: { own: "signedIn" },
  },

  tenantUser: {
    read: { any: "manageUsers.readAny" },
    manage: { any: "manageUsers.updateAny" },
    owner: { any: "tenantOwner" },
  },

  tenant: {
    read: { any: "tenantOwner" },
    paymentApps: { public: true },
    update: { any: "tenantOwner" },
    delete: { any: "tenantOwner" },
    challenge: { any: "tenantOwner" },
    paymentTest: { any: "tenantOwner" },
    mailTemplates: { any: "tenantOwner" },
    pdfPreview: { any: "tenantOwner" },
    readiness: { own: "tenantOwner", any: "instanceOwner" },
    catalog: { any: "tenantOwner" },
    list: { own: "signedIn", any: "instanceOwner" },
    listPublic: { public: true },
    create: { any: "mayCreateTenant" },
    countCheck: { own: "signedIn" },
    supervise: { any: "instanceOwner" },

    supervisionHistory: { own: "tenantOwner", any: "instanceOwner" },
  },

  ical: {
    feed: { public: true },
    events: {
      public: true,
      own: "manageBookables.readOwn",
      any: "manageBookables.readAny",
    },
    bookings: { own: "signedIn", any: "manageBookings.readAny" },
  },

  checkout: { all: { public: true } },
  calendar: { all: { public: true } },
  holidays: { all: { public: true } },
  bookingStatus: { all: { public: true } },
  html: { all: { public: true } },
  json: { all: { public: true } },
  exporter: {
    export: {
      own: "manageBookables.updateOwn",
      any: "manageBookables.updateAny",
    },
  },


  instance: {
    readPublic: { public: true },
    read: { any: "instanceOwner" },
    update: { any: "instanceOwner" },
    supervisionHistory: { any: "instanceOwner" },
    reviewQueue: { any: "instanceOwner" },
    tenantApprovalQueue: { any: "instanceOwner" },
    supervisionNotifications: { any: "instanceOwner" },
    supervisionNotificationRetry: { any: "instanceOwner" },
  },

  rule: {
    read: { any: "instanceOwner" },
    write: { any: "instanceOwner" },
    run: { any: "instanceOwner" },
  },

  user: {
    readSelf: { own: "signedIn" },
    updateSelf: { own: "signedIn" },
    read: { any: "instanceOwner" },
    create: { any: "instanceOwner" },
    update: { any: "instanceOwner" },
    delete: { any: "instanceOwner" },
    changeId: { any: "instanceOwner" },
  },

  membership: {
    readMine: { own: "signedIn" },
    read: { any: "instanceOwner" },
  },

  instanceMedia: {
    read: { any: "instanceOwner" },
    file: { public: true, own: "signedIn", any: "instanceOwner" },
    create: { any: "instanceOwner" },
    update: { any: "instanceOwner" },
    delete: { any: "instanceOwner" },
  },

  instanceCatalog: {
    read: { any: "instanceOwner" },
    readPublic: { public: true },
    store: { any: "instanceOwner" },
    mode: { public: true },
    themes: { public: true },
    slugAvailability: { own: "signedIn" },
  },

  accessBookings: {
    read: { own: "signedIn", any: "instanceOwner" },
  },

  instanceDashboard: {
    read: { own: "signedIn", any: "instanceOwner" },
  },

  auth: { all: { public: true } },
};

module.exports = { TABLE, ROLE_GROUPS, ROLE_LEVELS };
