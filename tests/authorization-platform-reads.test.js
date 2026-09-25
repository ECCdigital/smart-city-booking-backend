/**
 * The platform reads no record without a reach (ADR 0002, ticket 22 of
 * the authorization architecture, decision 4): a manager hands out
 * records only within a reach, so a handler under `src/platform` calls a
 * read of the managers of the owned things - bookings, bookables, events,
 * coupons, group bookings, tenants, media - with the route's scope, or
 * the read is one of the named few that hand out no record: a counter,
 * a yes/no, a piece of configuration. Those are the allowlist, each with
 * its reason; a read without a scope parameter called from the platform
 * that is not on it fails here and names its file, and an entry nobody
 * calls any more fails too.
 *
 * Whether a read takes a scope is read off its parameter list: the
 * managers name the parameter `scope` throughout.
 */

const { expect } = require("chai");
const fs = require("fs");
const path = require("path");

const BookingManager = require("../src/commons/data-managers/booking-manager");
const {
  BookableManager,
} = require("../src/commons/data-managers/bookable-manager");
const EventManager = require("../src/commons/data-managers/event-manager");
const CouponManager = require("../src/commons/data-managers/coupon-manager");
const GroupBookingManager = require("../src/commons/data-managers/group-booking-manager");
const TenantManager = require("../src/commons/data-managers/tenant-manager");
const MediaManager = require("../src/commons/data-managers/media-manager");
const { RoleManager } = require("../src/commons/data-managers/role-manager");

const PLATFORM = path.join(__dirname, "..", "src", "platform");

/** The managers of the things with an owner key (glossary "Eigentümer-Schlüssel"). */
const MANAGERS = {
  BookingManager,
  BookableManager,
  EventManager,
  CouponManager,
  GroupBookingManager,
  TenantManager,
  MediaManager,
  RoleManager,
};

/** A method that reads, by its name; the writes are not this test's. */
const READ = /^(get|find|count|exists|has|is|list|search)/;

/**
 * The reads without a reach the platform may call, with the reason each
 * hands out no record.
 */
const ALLOWED = {
  "BookableManager.getCustomFieldDefinitions":
    "configuration: the custom field definitions of the tenant",
  "CouponManager.exists": "yes/no: whether a coupon id is taken",
  "TenantManager.getTenantApp":
    "configuration: whether the invoice app is active",
  "TenantManager.getTenantAppByType":
    "configuration: the payment apps as { id, title }",
  // The roles are configuration (ticket 22/4, decided in ticket 05): the
  // rights of a tenant, not its records. The role list handler still
  // branches over the reach itself
  // (`tests/authorization-handler-decisions.test.js`).
  "RoleManager.getRoles": "configuration: the roles of every tenant",
  "RoleManager.getTenantRoles": "configuration: the roles of a tenant",
  "RoleManager.getRole": "configuration: one role of a tenant",
};

function* files(dir) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      yield* files(full);
    } else if (entry.name.endsWith(".js")) {
      yield full;
    }
  }
}

/** The source without its comments: what is said, not what is explained. */
const code = (source) =>
  source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/.*$/gm, "$1");

/** The parameter list of a function, as its source names it. */
function parametersOf(fn) {
  const source = fn.toString();
  const start = source.indexOf("(");
  let depth = 0;
  for (let i = start; i < source.length; i++) {
    if (source[i] === "(") depth++;
    if (source[i] === ")" && --depth === 0) {
      return source.slice(start + 1, i);
    }
  }
  throw new Error(`no parameter list in ${source.slice(0, 40)}`);
}

const takesScope = (fn) => /\bscope\b/.test(parametersOf(fn));

/** `Manager.method` for every read of the managers a platform file calls. */
function readsOf(source) {
  const reads = new Set();
  for (const [, manager, method] of source.matchAll(
    /\b([A-Z]\w*Manager)\.(\w+)\(/g,
  )) {
    if (manager in MANAGERS && READ.test(method)) {
      reads.add(`${manager}.${method}`);
    }
  }
  return reads;
}

describe("authorization: the platform reads no record without a reach (ADR 0002)", function () {
  const called = new Map();
  for (const file of files(PLATFORM)) {
    for (const read of readsOf(code(fs.readFileSync(file, "utf8")))) {
      if (!called.has(read)) called.set(read, []);
      called.get(read).push(path.relative(PLATFORM, file));
    }
  }

  it("calls reads that exist", function () {
    const unknown = [...called.keys()].filter((read) => {
      const [manager, method] = read.split(".");
      return typeof MANAGERS[manager][method] !== "function";
    });
    expect(unknown).to.deep.equal([]);
  });

  it("calls a read without a scope only from the allowlist, and every entry of it", function () {
    const withoutScope = {};
    for (const [read, where] of called) {
      const [manager, method] = read.split(".");
      const fn = MANAGERS[manager][method];
      if (typeof fn === "function" && !takesScope(fn)) {
        withoutScope[read] = where;
      }
    }
    expect(Object.keys(withoutScope).sort()).to.deep.equal(
      Object.keys(ALLOWED).sort(),
    );
  });

  it("names a reason for every allowed read", function () {
    // A reason names what the read hands out instead of records - or the
    // ticket of the map that still owes the reach.
    for (const [read, reason] of Object.entries(ALLOWED)) {
      expect(reason, read).to.match(
        /^(counter|yes\/no|configuration|ticket \d\d): /,
      );
    }
  });
});
