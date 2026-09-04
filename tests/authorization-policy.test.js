/**
 * Table tests of the authorization policy (authorize spec §8.1): the
 * rights table is the test matrix. For every `(resource, action)` of the
 * table and each of the five kinds of principal - anonymous, signed in
 * without a role, holder of exactly one role level, tenant owner, instance
 * owner - the reach `decide` answers is derived a second way from the
 * table's levels, plus the hand cases the spec names and the invariants of
 * the table: the precedence of the principal levels and the shape of its
 * entries.
 */

const { expect } = require("chai");

const {
  decide,
  entryOf,
  REACH,
  LEVEL_KEYWORDS,
} = require("../src/commons/services/authorization/policy");
const {
  TABLE,
  ROLE_GROUPS,
  ROLE_LEVELS,
} = require("../src/commons/services/authorization/table");

const ROLE_LEVEL = /^([a-zA-Z]+)\.([a-zA-Z]+)$/;

function principal(overrides = {}) {
  return {
    userId: "user-1",
    tenantId: "tenant-1",
    isInstanceOwner: false,
    isTenantOwner: false,
    grants: {},
    mayCreateTenant: false,
    ...overrides,
  };
}

const anonymous = () => principal({ userId: null });
const signedIn = () => principal();
const tenantOwner = () => principal({ isTenantOwner: true });
const instanceOwner = () => principal({ isInstanceOwner: true });

/** A principal holding exactly the given levels, e.g. `manageBookings.readAny`. */
function roleHolder(...levels) {
  const grants = {};
  for (const level of levels) {
    const [, group, step] = level.match(ROLE_LEVEL);
    grants[group] = { ...(grants[group] || {}), [step]: true };
  }
  return principal({ grants });
}

/**
 * Which levels each kind of principal satisfies, written down independently
 * of `decide`: the order of the spec (§2.3), instance owner above tenant
 * owner above role above the signed-in user.
 */
const SATISFIES = {
  anonymous: () => false,
  signedIn: (level) => level === "signedIn",
  roleHolder: (level, granted) => level === "signedIn" || level === granted,
  tenantOwner: (level) => !["instanceOwner", "mayCreateTenant"].includes(level),
  instanceOwner: () => true,
};

function expectedReach(entry, kind, granted) {
  if (entry.any && SATISFIES[kind](entry.any, granted)) return REACH.ANY;
  if (entry.own && SATISFIES[kind](entry.own, granted)) return REACH.OWN;
  if (entry.public === true) return REACH.PUBLIC;
  return null;
}

/** Every `(resource, action, entry)` of the table. */
function entries() {
  const rows = [];
  for (const [resource, actions] of Object.entries(TABLE)) {
    for (const [action, entry] of Object.entries(actions)) {
      rows.push({ resource, action, entry });
    }
  }
  return rows;
}

/** The role levels an entry names. */
function roleLevelsOf(entry) {
  return [entry.own, entry.any].filter(
    (level) => typeof level === "string" && ROLE_LEVEL.test(level),
  );
}

const ORDER = [null, REACH.PUBLIC, REACH.OWN, REACH.ANY];
const rank = (reach) => ORDER.indexOf(reach);

describe("authorization policy: the table as the matrix", function () {
  it("has entries to test", function () {
    expect(entries().length).to.be.greaterThan(50);
  });

  for (const { resource, action, entry } of entries()) {
    describe(`${resource}.${action}`, function () {
      it("anonymous", function () {
        expect(decide(anonymous(), resource, action)).to.equal(
          expectedReach(entry, "anonymous"),
        );
      });

      it("signed in without a role", function () {
        expect(decide(signedIn(), resource, action)).to.equal(
          expectedReach(entry, "signedIn"),
        );
      });

      for (const level of roleLevelsOf(entry)) {
        it(`holder of exactly ${level}`, function () {
          expect(decide(roleHolder(level), resource, action)).to.equal(
            expectedReach(entry, "roleHolder", level),
          );
        });
      }

      it("tenant owner", function () {
        expect(decide(tenantOwner(), resource, action)).to.equal(
          expectedReach(entry, "tenantOwner"),
        );
      });

      it("instance owner", function () {
        expect(decide(instanceOwner(), resource, action)).to.equal(
          expectedReach(entry, "instanceOwner"),
        );
      });
    });
  }
});

describe("authorization policy: hand cases", function () {
  it("answers the widest reach a mixed role holds", function () {
    const holder = roleHolder(
      "manageBookables.readOwn",
      "manageBookables.updateAny",
    );
    expect(decide(holder, "bookable", "read")).to.equal(REACH.OWN);
    expect(decide(holder, "bookable", "update")).to.equal(REACH.ANY);
    expect(decide(holder, "bookable", "delete")).to.equal(null);
  });

  it("a grant of another level is not the one asked for", function () {
    expect(
      decide(roleHolder("manageBookings.readAny"), "booking", "update"),
    ).to.equal(null);
    expect(
      decide(roleHolder("manageBookings.readAny"), "coupon", "read"),
    ).to.equal(null);
  });

  it("a principal without a tenant has no grants and is no tenant owner", function () {
    const noTenant = principal({ tenantId: null });
    expect(decide(noTenant, "coupon", "read")).to.equal(null);
    expect(decide(noTenant, "bookable", "read")).to.equal(null);
    expect(decide(noTenant, "bookable", "readPublic")).to.equal(REACH.PUBLIC);
    expect(decide(noTenant, "booking", "read")).to.equal(REACH.OWN);
    expect(decide(noTenant, "user", "readSelf")).to.equal(REACH.OWN);
  });

  it("mayCreateTenant follows the instance setting, not the tenant ownership", function () {
    expect(
      decide(principal({ mayCreateTenant: true }), "tenant", "create"),
    ).to.equal(REACH.ANY);
    expect(decide(tenantOwner(), "tenant", "create")).to.equal(null);
    expect(decide(instanceOwner(), "tenant", "create")).to.equal(REACH.ANY);
  });

  it("an anonymous principal reaches public entries only", function () {
    expect(decide(anonymous(), "event", "read")).to.equal(REACH.PUBLIC);
    expect(decide(anonymous(), "booking", "read")).to.equal(null);
    expect(decide(anonymous(), "booking", "list")).to.equal(REACH.PUBLIC);
    expect(decide(anonymous(), "booking", "document")).to.equal(null);
    expect(decide(anonymous(), "checkout", "all")).to.equal(REACH.PUBLIC);
  });

  it("a signed-in user without a role reaches own where the level is signedIn", function () {
    expect(decide(signedIn(), "booking", "read")).to.equal(REACH.OWN);
    expect(decide(signedIn(), "booking", "operate")).to.equal(REACH.OWN);
    expect(decide(signedIn(), "booking", "update")).to.equal(null);
    expect(decide(signedIn(), "bookable", "read")).to.equal(null);
    expect(decide(signedIn(), "bookable", "readPublic")).to.equal(REACH.PUBLIC);
  });

  it("a tenant owner reaches any of the tenant, but not the instance", function () {
    expect(decide(tenantOwner(), "accessPoint", "write")).to.equal(REACH.ANY);
    expect(decide(tenantOwner(), "instance", "update")).to.equal(null);
    expect(decide(tenantOwner(), "instanceMedia", "create")).to.equal(null);
  });

  it("an unknown resource or action is a programming error", function () {
    expect(() => decide(signedIn(), "unicorn", "read")).to.throw(/unicorn/);
    expect(() => decide(signedIn(), "booking", "fly")).to.throw(/booking\.fly/);
    expect(() => entryOf("booking", "fly")).to.throw(/booking\.fly/);
  });
});

describe("authorization policy: invariants of the table", function () {
  it("names only known levels in known slots", function () {
    for (const { resource, action, entry } of entries()) {
      const where = `${resource}.${action}`;
      expect(Object.keys(entry), where).to.satisfy((keys) =>
        keys.every((key) => ["public", "own", "any"].includes(key)),
      );
      if ("public" in entry) {
        expect(entry.public, where).to.be.a("boolean");
      }
      for (const level of [entry.own, entry.any].filter(Boolean)) {
        const match = level.match(ROLE_LEVEL);
        if (match) {
          expect(ROLE_GROUPS, `${where}: ${level}`).to.include(match[1]);
          expect(ROLE_LEVELS, `${where}: ${level}`).to.include(match[2]);
        } else {
          expect(LEVEL_KEYWORDS, `${where}: ${level}`).to.include(level);
        }
      }
      expect(
        entry.public === true || entry.own || entry.any,
        `${where} grants nothing`,
      ).to.be.ok;
    }
  });

  it("keeps the precedence: instance owner ⊇ tenant owner ⊇ role ⊇ signed in ⊇ anonymous", function () {
    for (const { resource, action, entry } of entries()) {
      const where = `${resource}.${action}`;
      const chain = [
        anonymous(),
        signedIn(),
        ...roleLevelsOf(entry).map((level) => roleHolder(level)),
        tenantOwner(),
        instanceOwner(),
      ].map((who) => rank(decide(who, resource, action)));
      for (let i = 1; i < chain.length; i += 1) {
        expect(chain[i], where).to.be.at.least(chain[i - 1]);
      }
    }
  });

  it("an entry with a role level for own names a resource whose manager knows its owner key (§4.1)", function () {
    // The manager of each of these entities translates `own` into its own
    // query condition; `own` with the level `signedIn` means "self" and
    // needs no key. The calendar `ical.events` and the attendee list
    // `exporter.export` are the events' own reach, translated by the
    // `EventManager` like every other event read.
    const OWNED = [
      "bookable",
      "event",
      "coupon",
      "booking",
      "media",
      "ical",
      "exporter",
    ];
    for (const { resource, entry } of entries()) {
      if (typeof entry.own === "string" && ROLE_LEVEL.test(entry.own)) {
        expect(OWNED, `${resource} has own=${entry.own}`).to.include(resource);
      }
    }
  });

  it("never lets an instance owner reach less than a tenant owner", function () {
    for (const { resource, action } of entries()) {
      expect(
        rank(decide(instanceOwner(), resource, action)),
        `${resource}.${action}`,
      ).to.be.at.least(rank(decide(tenantOwner(), resource, action)));
    }
  });
});
