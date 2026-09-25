/**
 * The named lists of what a handler decides beyond its marker (ADR 0001,
 * ADR 0002). A route gets a complete decision from its marker, and a
 * handler under `src/platform` - or a service that reads for a route -
 * asks the table again (`scopeFor`, gone since ticket 17), the policy
 * directly (`decide` on the principal) or branches over the reach it was handed (`req.reach`,
 * `withinReach`, `readsRecords`) only where these lists say so. Every
 * entry names the ticket of the authorization architecture that removes
 * it; a new call elsewhere fails here and names its file.
 */

const { expect } = require("chai");
const fs = require("fs");
const path = require("path");

const SRC = path.join(__dirname, "..", "src");
const PLATFORM = path.join(SRC, "platform");
const SERVICES = path.join(SRC, "commons", "services");

/**
 * The second decisions a handler may make, by file and count: none. The
 * last ones, the media picker right of the reference guard, went onto the
 * markers of the store routes (`also: ["media.read"]`, ticket 17); a
 * second question a route has goes on its marker.
 */
const SECOND_DECISIONS = {};

/**
 * The branches over the reach outside the authorization module, by file
 * and count, with the ticket that removes each (02, decision 11):
 *
 *   - the media rights, the one place that reads the bundle of decided
 *     reaches a media route hands in and picks the rule from the medium
 *     (ticket 04) - stays
 *   - the roles list, whose projection follows the reach - ticket 05
 *   - `managesUnder` in the access service: the one place the reach
 *     `any` of `booking.operate` becomes the manager's yes (02,
 *     decision 12) - stays
 *   - the booking lists whose marker is public for the anonymized
 *     `?public=true` projection alone: without the flag the public is
 *     refused, and the public sees no bookings of an event - stays, a
 *     refusal of a request that asks beyond the public's right, no
 *     projection (the projections themselves are the managers', ADR 0003)
 *   - `?includePrivate` on the public event calendar, the one place a
 *     reach beyond `public` is asked for on a public route - stays
 */
const REACH_BRANCHES = {
  platform: {
    "api/controllers/booking-controller.js": { reach: 3 }, // stays: ?public=true
    "api/controllers/ical-controller.js": { readsRecords: 1 }, // stays: ?includePrivate
    "api/controllers/role-controller.js": { reach: 1 }, // 05
  },
  services: {
    "access/access-service.js": { reach: 1 }, // stays: managesUnder
    "media/media-rights.js": { readsRecords: 4, withinReach: 5 }, // stays: the bundle
  },
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

const count = (source, pattern) => (source.match(pattern) || []).length;

const relative = (root, file) =>
  path.relative(root, file).split(path.sep).join("/");

/** The reach branches of a file, by kind, or null without any. */
function reachBranchesOf(source) {
  const found = {
    reach: count(
      source,
      /\b(?:req|request)\.reach\b|\.reach\s*[!=]==|\breach\s*[!=]==\s*"/g,
    ),
    withinReach: count(source, /\bwithinReach\(/g),
    readsRecords: count(source, /\breadsRecords\(/g),
  };
  const kept = Object.fromEntries(
    Object.entries(found).filter(([, n]) => n > 0),
  );
  return Object.keys(kept).length ? kept : null;
}

describe("authorization: the handlers that decide a second time", function () {
  it("are the named ones, and no other", function () {
    const found = {};
    for (const file of files(PLATFORM)) {
      const source = code(fs.readFileSync(file, "utf8"));
      const scopeFor = count(source, /\bscopeFor\(/g);
      const decide = count(source, /\bdecide\(\s*(req|request)\b/g);
      if (scopeFor || decide) {
        found[relative(PLATFORM, file)] = {
          ...(scopeFor && { scopeFor }),
          ...(decide && { decide }),
        };
      }
    }
    expect(found).to.deep.equal(SECOND_DECISIONS);
  });

  it("import decide nowhere: the policy is the markers' to ask", function () {
    const offenders = [];
    const imports =
      /const\s*\{([^}]*)\}\s*=\s*require\(\s*"[^"]*authorization[^"]*"\s*\)/g;
    for (const file of files(PLATFORM)) {
      const source = fs.readFileSync(file, "utf8");
      for (const [, names] of source.matchAll(imports)) {
        if (/\bdecide\b/.test(names)) {
          offenders.push(relative(PLATFORM, file));
        }
      }
    }
    expect(offenders).to.deep.equal([]);
  });
});

describe("authorization: the handlers and services that branch over the reach (ADR 0002)", function () {
  it("are the named ones under src/platform, and no other", function () {
    const found = {};
    for (const file of files(PLATFORM)) {
      const branches = reachBranchesOf(code(fs.readFileSync(file, "utf8")));
      if (branches) {
        found[relative(PLATFORM, file)] = branches;
      }
    }
    expect(found).to.deep.equal(REACH_BRANCHES.platform);
  });

  it("are the named ones among the services, and no other", function () {
    const found = {};
    for (const file of files(SERVICES)) {
      if (relative(SERVICES, file).startsWith("authorization/")) {
        continue;
      }
      const branches = reachBranchesOf(code(fs.readFileSync(file, "utf8")));
      if (branches) {
        found[relative(SERVICES, file)] = branches;
      }
    }
    expect(found).to.deep.equal(REACH_BRANCHES.services);
  });
});
