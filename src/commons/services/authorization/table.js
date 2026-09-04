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
  // --- tenant level (`/api/:tenant`, `/api/v2/:tenant`, `routes/*`) -----

  // An entry that is public *and* has own/any belongs only to a route with
  // a public projection (`GET /bookings?public=true`, the bookings of an
  // event or a bookable); a read route without one has its own entry
  // without `public`, else the handler would have to turn the anonymous
  // away itself (§11, ticket 2).
  bookable: {
    ...crud("manageBookables"),
    // `/bookables/public*`, `openingHours`, `occupancy`, `prices`
    readPublic: { public: true },
    template: { any: "manageBookables.create" },
    // `_meta/tags`, `count/check`: signed in, nothing further (as today).
    meta: { own: "signedIn" },
    // `GET /bookables/:id/bookings`: the anonymized projection (`?public`)
    // for anyone; without it, the public has nothing and the handler
    // answers 403 (§12).
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
    // `_meta/tags`, `count/check`: signed in, nothing further (as today).
    meta: { own: "signedIn" },
  },

  booking: {
    // `GET /bookings/:id`, `/bookings/assigned`
    read: { own: "signedIn", any: "manageBookings.readAny" },
    // `GET /bookings` (`?public=true` is the anonymized projection; without
    // it the public has nothing and the handler answers 403) and
    // `GET /events/:id/bookings` (the public gets an empty list, as today).
    list: { public: true, own: "signedIn", any: "manageBookings.readAny" },
    // The customer's lookups by id and name: `/:ids/status`,
    // `/:id/status/public`, `/:id/cancellation-refund-preview/public`.
    lookup: { public: true },
    // Reading a receipt, invoice or cancellation receipt.
    document: { own: "signedIn", any: "manageBookings.readAny" },
    // Reprinting the receipt or the cancellation receipt (as today: the
    // owner, or `updateAny`; §12).
    reprint: { own: "signedIn", any: "manageBookings.updateAny" },
    // The administration's manual invoice.
    invoice: { any: "manageBookings.updateAny" },
    // The admin PUT.
    create: { any: "manageBookings.create" },
    update: { any: "manageBookings.updateAny" },
    commit: { any: "manageBookings.updateAny" },
    pay: { any: "manageBookings.updateAny" },
    reject: { any: "manageBookings.updateAny" },
    delete: { any: "manageBookings.deleteAny" },
    // The refund preview of the customer's cancellation.
    cancel: { own: "signedIn", any: "manageBookings.updateAny" },
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
    // Receipt and cancellation receipt reprint.
    document: { own: "signedIn", any: "manageBookings.updateAny" },
    // The administration's manual invoice.
    invoice: { any: "manageBookings.updateAny" },
  },

  coupon: {
    ...crud("manageCoupons"),
    // `GET /coupons/:id` and v2 `coupon/validate`: redeeming, no check.
    lookup: { public: true },
  },

  role: {
    read: { any: "manageRoles.readAny" },
    // `GET /roles`: the roles under any; under own, the public projection
    // (`?public=true`) or none - a role has no owner (§4.1).
    list: { own: "signedIn", any: "manageRoles.readAny" },
    create: { any: "manageRoles.create" },
    update: { any: "manageRoles.updateAny" },
    delete: { any: "manageRoles.deleteAny" },
    // `GET /roles/tenant`: the roles of the signed-in user (§7.4).
    readMine: { own: "signedIn" },
  },

  media: {
    // Metadata and usage.
    read: { own: "manageMedia.readOwn", any: "manageMedia.readAny" },
    // The door of the metadata routes (`GET /media/:id`, `/usage`,
    // `PATCH /media/:id`), which serve two populations: the library, whose
    // rule is `read`/`update`, and the booking documents, whose rule is the
    // receipt rule below. One route carries one marker, so the marker is the
    // door both come through - signed in, as today - and the handler asks the
    // table again for the rule that applies (§5, like the creation over the
    // obsolete PUTs in §12).
    metadata: { own: "signedIn" },
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
    // `/:token/verify`, `/accept`, `/reject`: the invitee's own token; the
    // service checks the intended user.
    respond: { own: "signedIn" },
  },

  tenantUser: {
    // `GET /tenants/:tenant/users`, `GET /:tenant/users`
    read: { any: "manageUsers.readAny" },
    // add, remove, roles, status, notification recipients
    manage: { any: "manageUsers.updateAny" },
    // `add-owner`, `remove-owner`: the owners name the owners (as today;
    // §10 read this as `manageUsers.updateAny`, the code never did).
    owner: { any: "tenantOwner" },
  },

  tenant: {
    read: { any: "tenantOwner" },
    paymentApps: { public: true },
    // `PUT /tenants` (the tenant in the body), `DELETE /tenants/:tenant`
    update: { any: "tenantOwner" },
    delete: { any: "tenantOwner" },
    // read, create, update, delete of challenges (§7.5)
    challenge: { any: "tenantOwner" },
    paymentTest: { any: "tenantOwner" },
    mailTemplates: { any: "tenantOwner" },
    // `POST /tenants/:tenant/pdf-preview`
    pdfPreview: { any: "tenantOwner" },
    // The tenant catalog, read and store.
    catalog: { any: "tenantOwner" },
    // --- instance level: `GET /tenants` lists the user's own memberships
    // (the owned tenants in full, the joined ones as the public projection).
    list: { own: "signedIn", any: "instanceOwner" },
    listPublic: { public: true },
    create: { any: "mayCreateTenant" },
    // `GET /tenants/count/check`: whether the instance has room for one
    // more; signed in, nothing further (as today).
    countCheck: { own: "signedIn" },
  },

  ical: {
    // `/ical/feed/events*`: the subscribable calendar, public events only.
    feed: { public: true },
    // `/ical/events*`: the same public calendar for everyone; the reach says
    // which private events `?includePrivate=true` may add - the public
    // projection that lets the entry be a mixed one (§12).
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
  // `GET /csv/:tenant/events/:id/bookings`: the attendee list of an event.
  // The route carried `isSignedIn` and the controller the same two levels
  // behind it - whoever may change an event may read who booked it. It
  // checked them through the raw `UserManager.hasPermission`, the one
  // helper without an instance-owner branch, so the standing precedence
  // now reaches this route too (§15).
  exporter: {
    export: {
      own: "manageBookables.updateOwn",
      any: "manageBookables.updateAny",
    },
  },

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
    // The obsolete `PUT /users` carries `update`; the creation is the
    // adapter's second decision (§12).
    create: { any: "instanceOwner" },
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
    // `GET /catalog`: the owner's view, no public projection (§12).
    read: { any: "instanceOwner" },
    // `/catalog/public`, `/:slug`, `/bundle`: the catalog decides its own
    // visibility (`private` needs a session), in addition.
    readPublic: { public: true },
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
