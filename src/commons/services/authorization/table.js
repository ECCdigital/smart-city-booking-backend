/**
 * The rights table: data, not code. For every
 * protected thing (`resource`) and action, the entry names the least level
 * of the principal that gets each reach (glossary "Reichweite"):
 *
 *   public: true                  anyone, anonymous included
 *   own:    "<level>"             the principal's own records, over the
 *                                 owner key of the resource (`OWNER_KEY`)
 *   self:   "<level>"             the principal themselves, no records
 *                                 (the own profile, the own invitation)
 *   any:    "<level>"             every record of the tenant (or instance)
 *
 * A missing slot means "nobody". The levels are:
 *
 *   "signedIn"                    any signed-in user
 *   "tenantMember"                a member of the tenant (glossary
 *                                 "Mitglied"); nobody without a tenant
 *   "<group>.<step>"              a role level, e.g. "manageBookings.readAny"
 *   "tenantOwner"                 the owner of the tenant
 *   "instanceOwner"               the owner of the instance
 *   "mayCreateTenant"             the instance setting that lets a user open
 *                                 a tenant
 *
 * with the fixed precedence instanceOwner ⊇ tenantOwner ⊇ role ⊇
 * tenantMember ⊇ signedIn: an instance owner satisfies every level, a
 * tenant owner every level but `instanceOwner` and `mayCreateTenant` (that
 * one follows the instance setting alone). Actions beyond create, read,
 * update and delete (`qr`, `operate`, `document`, `challenge`, ...) are
 * named entries here, never new role steps: the role steps stay the seven
 * of the role schema.
 *
 * A reach has one meaning (ADR 0001): `own` is always a query condition
 * over the owner key the directory `OWNER_KEY` names for the entry, "the
 * signed-in user for themselves" is `self`. The one door left -
 * `media.metadata`, signed in - names its questions on the marker
 * (`also: ["read", "bookingDocument"]`), and the media rights pick the
 * one that applies from the facts of the medium
 * (`services/media/media-rights.js`).
 *
 * Staff get their management view of a public delivery from the table
 * alone (ADR 0003): a public entry with `any` (`bookable.readPublic`,
 * `bookable.prices`, `calendar.all`, the tags and counters) answers
 * everyone the public projection and the role holders the tenant's
 * records whole; a public entry without `any` (`html`, `json`,
 * `checkout`, `ical.feed`) asks everyone as the public, staff included.
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
    readPublic: { public: true, any: "manageBookables.readAny" },
    prices: { public: true, any: "manageBookables.readAny" },
    template: { any: "manageBookables.create" },
    meta: { public: true, any: "manageBookables.readAny" },
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
    meta: { public: true, any: "manageBookables.readAny" },
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
    list: { own: "tenantMember", any: "manageRoles.readAny" },
    create: { any: "manageRoles.create" },
    update: { any: "manageRoles.updateAny" },
    delete: { any: "manageRoles.deleteAny" },
    readMine: { self: "signedIn" },
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
    // Who reads an internal file beyond the library's `file`: a member.
    intern: { any: "tenantMember" },
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
    resolve: { self: "signedIn" },
  },

  workflow: {
    read: { any: "manageBookings.readAny" },
    task: { any: "manageBookings.updateAny" },
    manage: { any: "tenantOwner" },
  },

  invitation: {
    manage: { any: "manageUsers.updateAny" },
    readMine: { self: "signedIn" },
    respond: { self: "signedIn" },
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
    countCheck: { self: "signedIn" },
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
  calendar: { all: { public: true, any: "manageBookables.readAny" } },
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
    readSelf: { self: "signedIn" },
    updateSelf: { self: "signedIn" },
    read: { any: "instanceOwner" },
    create: { any: "instanceOwner" },
    update: { any: "instanceOwner" },
    delete: { any: "instanceOwner" },
    changeId: { any: "instanceOwner" },
  },

  membership: {
    readMine: { self: "signedIn" },
    read: { any: "instanceOwner" },
  },

  instanceMedia: {
    read: { any: "instanceOwner" },
    file: { public: true, any: "signedIn" },
    // An internal instance file: any signed-in user, no membership narrows it.
    intern: { any: "signedIn" },
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
    slugAvailability: { self: "signedIn" },
  },

  accessBookings: {
    read: { own: "signedIn", any: "instanceOwner" },
  },

  instanceDashboard: {
    read: { own: "signedIn", any: "instanceOwner" },
  },

  auth: { all: { public: true } },
};

/**
 * The owner key (glossary "Eigentümer-Schlüssel") of every entry with an
 * `own` slot: what "own" means for the resource, beside the table so the
 * table stays levels alone. Two kinds:
 *
 *   { key: "<field>" }        the field of the record that names its owner;
 *                             the manager turns `own` into `{ [key]: userId }`
 *                             (`ownCondition`)
 *   { tenantsOf: "<set>" }    on the instance level, the tenant set of the
 *                             principal (`principal.tenants`): "membership"
 *                             (the tenants they belong to), "ownership" (the
 *                             ones they own), "reach" (the ones they hold
 *                             `any` in for the tenant entry `entry` names -
 *                             the instance dashboard lists the tenants whose
 *                             own dashboard the user reads). `scopeOf` puts
 *                             the set on the scope as `tenantIds`, and the
 *                             manager turns `own` into `{ id: { $in } }`
 *
 * A resource names one key for all its `own` entries, or `byAction` where
 * its entries own different things (a bookable's related bookings are the
 * booking's, a medium that is a booking document follows the booking).
 * `assertTable` in `policy.js` checks when the module loads that every
 * `own` has exactly one key and no key names an entry without `own`.
 */
const OWNER_KEY = {
  bookable: {
    key: "ownerUserId",
    byAction: {
      relatedBookings: { key: "assignedUserId" },
      reviewSubmit: { tenantsOf: "ownership" },
    },
  },
  event: {
    key: "ownerUserId",
    byAction: { reviewSubmit: { tenantsOf: "ownership" } },
  },
  booking: { key: "assignedUserId" },
  groupBooking: { key: "assignedUserId" },
  coupon: { key: "ownerUserId" },
  role: { tenantsOf: "membership" },
  media: {
    key: "uploadedBy",
    byAction: {
      bookingDocument: { key: "assignedUserId" },
      updateBookingDocument: { key: "assignedUserId" },
    },
  },
  tenant: { tenantsOf: "ownership" },
  ical: {
    byAction: {
      events: { key: "ownerUserId" },
      bookings: { key: "assignedUserId" },
    },
  },
  exporter: { key: "ownerUserId" },
  accessBookings: { key: "assignedUserId" },
  instanceDashboard: { tenantsOf: "reach", entry: "dashboard.read" },
};

/**
 * The owner key of an entry: what `own` means at `(resource, action)`.
 *
 * @param {string} resource
 * @param {string} action
 * @returns {{key: string}|{tenantsOf: "membership"|"ownership"|"reach"}}
 * @throws {Error} for an entry without `own`, or one whose key is missing
 */
function ownerKeyOf(resource, action) {
  const where = `${resource}.${action}`;
  if (!TABLE[resource]?.[action]?.own) {
    throw new Error(`authorization: no own at ${where}, so no owner key`);
  }
  const directory = OWNER_KEY[resource];
  const { byAction, ...shared } = directory ?? {};
  const key =
    byAction?.[action] ?? (Object.keys(shared).length ? shared : null);
  if (!key) {
    throw new Error(`authorization: no owner key for ${where}`);
  }
  return key;
}

module.exports = { TABLE, OWNER_KEY, ownerKeyOf, ROLE_GROUPS, ROLE_LEVELS };
