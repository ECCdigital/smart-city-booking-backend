/**
 * The rights table (glossary "Rechtetabelle"): data, not code. For every
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
  // --- tenant level (`/api/:tenant`, `/api/v2/:tenant`, `routes/*`) -----

  bookable: {
    ...crud("manageBookables", { publicRead: true }),
    template: { any: "manageBookables.create" },
    // `GET /bookables/:id/bookings`
    relatedBookings: {
      public: true,
      own: "signedIn",
      any: "manageBookings.readAny",
    },
  },

  event: {
    // Stays public on purpose (§7.2): no public projection in this card.
    read: { public: true, any: "manageBookables.readAny" },
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
  },

  booking: {
    // `/status/public` and `/:ids/status` are the public part.
    read: { public: true, own: "signedIn", any: "manageBookings.readAny" },
    // Receipt, invoice, cancellation receipt, reprint.
    document: { own: "signedIn", any: "manageBookings.readAny" },
    // The admin PUT.
    create: { any: "manageBookings.create" },
    update: { any: "manageBookings.updateAny" },
    commit: { any: "manageBookings.updateAny" },
    pay: { any: "manageBookings.updateAny" },
    reject: { any: "manageBookings.updateAny" },
    delete: { any: "manageBookings.deleteAny" },
    // Refund preview and the customer's cancellation; `/public` is public.
    cancel: { public: true, own: "signedIn", any: "manageBookings.updateAny" },
    // Access: open, unlatch, close, status, access points, eligibility.
    operate: { own: "signedIn", any: "manageBookings.updateAny" },
  },

  groupBooking: {
    // The list closes for customers (§7.1).
    read: { own: "signedIn", any: "manageBookings.readAny" },
    update: { any: "manageBookings.updateAny" },
    commit: { any: "manageBookings.updateAny" },
    pay: { any: "manageBookings.updateAny" },
    reject: { any: "manageBookings.updateAny" },
    delete: { any: "manageBookings.deleteAny" },
    document: { own: "signedIn", any: "manageBookings.updateAny" },
  },

  coupon: {
    ...crud("manageCoupons"),
    // `GET /coupons/:id` and v2 `coupon/validate`: redeeming, no check.
    lookup: { public: true },
  },

  role: {
    read: { any: "manageRoles.readAny" },
    create: { any: "manageRoles.create" },
    update: { any: "manageRoles.updateAny" },
    delete: { any: "manageRoles.deleteAny" },
    // `GET /roles/tenant`: the roles of the signed-in user (§7.4).
    readMine: { own: "signedIn" },
  },

  media: {
    // Metadata and usage.
    read: { own: "manageMedia.readOwn", any: "manageMedia.readAny" },
    // Reading the file; the visibility `public | intern` of the medium
    // stays in the media module, in addition to the reach (§5).
    file: {
      public: true,
      own: "manageMedia.readOwn",
      any: "manageMedia.readAny",
    },
    create: { any: "manageMedia.create" },
    update: { own: "manageMedia.updateOwn", any: "manageMedia.updateAny" },
    delete: { own: "manageMedia.deleteOwn", any: "manageMedia.deleteAny" },
    // Reading and replacing a booking document (`media-access.js`, §5).
    bookingDocument: { own: "signedIn", any: "manageBookings.readAny" },
    updateBookingDocument: {
      own: "signedIn",
      any: "manageBookings.updateAny",
    },
  },

  accessPoint: {
    read: { any: "manageBookables.readAny" },
    // store, remove, qr, rotate, location prefill.
    write: { any: "tenantOwner" },
  },

  accessApp: {
    read: { any: "manageBookables.readAny" },
    // store, remove, test, webhook config; `manageTenants` was dead (§7.3).
    manage: { any: "tenantOwner" },
  },

  accessAudit: {
    export: { any: "manageBookings.readAny" },
  },

  accessScan: {
    // `/resolve-scan/:scanCode`
    resolve: { own: "signedIn" },
  },

  // The `/locker/*` facade, one release.
  locker: {
    read: { any: "manageBookables.readAny" },
    test: { any: "manageBookables.readAny" },
  },

  workflow: {
    // workflow, states, backlog
    read: { any: "manageBookings.readAny" },
    // updateTask, archiveTask
    task: { any: "manageBookings.updateAny" },
    // create, update
    manage: { any: "tenantOwner" },
  },

  invitation: {
    manage: { any: "manageUsers.updateAny" },
    // `/invitations/my`
    readMine: { own: "signedIn" },
  },

  tenantUser: {
    // `GET /tenants/:id/users`, `GET /:tenant/users`
    read: { any: "manageUsers.readAny" },
    // add, remove, roles, status, owner, notification recipients
    manage: { any: "manageUsers.updateAny" },
  },

  tenant: {
    read: { any: "tenantOwner" },
    paymentApps: { public: true },
    update: { any: "tenantOwner" },
    delete: { any: "tenantOwner" },
    // read, create, update, delete of challenges (§7.5)
    challenge: { any: "tenantOwner" },
    paymentTest: { any: "tenantOwner" },
    mailTemplates: { any: "tenantOwner" },
    // The tenant catalog, read and store.
    catalog: { any: "tenantOwner" },
    // --- instance level: `GET /tenants` filters to own memberships.
    list: { own: "signedIn", any: "instanceOwner" },
    listPublic: { public: true },
    create: { any: "mayCreateTenant" },
  },

  ical: {
    feed: { public: true },
    bookings: { own: "signedIn", any: "manageBookings.readAny" },
  },

  checkout: { all: { public: true } },
  calendar: { all: { public: true } },
  holidays: { all: { public: true } },
  bookingStatus: { all: { public: true } },
  html: { all: { public: true } },
  json: { all: { public: true } },
  // `isSignedIn` today, and the handler checks nothing further.
  exporter: { export: { own: "signedIn" } },

  // --- instance level (`/api`, `/api/v2/instance`) ---------------------

  instance: {
    // `/instances/public`, `bookable-custom-fields`
    readPublic: { public: true },
    read: { any: "instanceOwner" },
    update: { any: "instanceOwner" },
  },

  rule: {
    read: { any: "instanceOwner" },
    write: { any: "instanceOwner" },
    run: { any: "instanceOwner" },
  },

  user: {
    // `/me`, `PUT /user`
    readSelf: { own: "signedIn" },
    updateSelf: { own: "signedIn" },
    // `GET /users`, `/ids`, `/:id`
    read: { any: "instanceOwner" },
    update: { any: "instanceOwner" },
    delete: { any: "instanceOwner" },
    changeId: { any: "instanceOwner" },
  },

  membership: {
    // `/memberships/my*`
    readMine: { own: "signedIn" },
    read: { any: "instanceOwner" },
  },

  instanceMedia: {
    read: { any: "instanceOwner" },
    // A public instance medium is readable anonymously, an `intern` one
    // by any signed-in user of the instance - the medium's visibility
    // decides, in addition (§5).
    file: { public: true, own: "signedIn", any: "instanceOwner" },
    create: { any: "instanceOwner" },
    update: { any: "instanceOwner" },
    delete: { any: "instanceOwner" },
  },

  instanceCatalog: {
    // `/catalog` for the owner; `/public`, `/:slug`, `/bundle` for anyone.
    read: { public: true, any: "instanceOwner" },
    store: { any: "instanceOwner" },
    mode: { public: true },
    themes: { public: true },
    // `/catalog/availability/:slug`
    slugAvailability: { own: "signedIn" },
  },

  // Tenant-independent access bookings, `?userId=` for the owner.
  accessBookings: {
    read: { own: "signedIn", any: "instanceOwner" },
  },

  auth: { all: { public: true } },
};

module.exports = { TABLE, ROLE_GROUPS, ROLE_LEVELS };
