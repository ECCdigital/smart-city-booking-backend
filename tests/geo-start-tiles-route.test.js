/**
 * The start view and the tile proxy of the map (ECCdigital/tickets#469):
 * `GET /api/v2/:tenant/geo/start` and `GET /api/v2/:tenant/geo/tiles/:z/:x/:y`,
 * over the lifecycle harness. The points of the tenants live in memory
 * behind the models of bookables, events and access points; TopPlusOpen is
 * faked per URL (`helpers/fake-geo-http.js`) and the `RateLimiter` runs in
 * memory. Seam 1 of the spec of map ECCdigital/tickets#372.
 */

const { expect } = require("chai");
const bunyan = require("bunyan");
const sinon = require("sinon");

const {
  installHarness,
  TENANT,
  TENANT_B,
  CUSTOMER,
  OWNER_B,
} = require("./helpers/booking-lifecycle-harness");
const {
  FakeGeoHttp,
  image,
  text,
  timeout,
  unreachable,
} = require("./helpers/fake-geo-http");
const {
  installInMemoryRateLimitEvents,
} = require("./helpers/in-memory-rate-limit-events");
const BookableModel = require("../src/commons/data-managers/models/bookableModel");
const EventModel = require("../src/commons/data-managers/models/eventModel");
const AccessPointModel = require("../src/commons/data-managers/models/accessPointModel");
const TileService = require("../src/commons/services/geo/tile-service");
const { requestLogger } = require("../src/middleware/logger");

/** The tile server of the tests, in the form of the BKG's template. */
const TILES = "https://tiles.example.test/wmts/WEBMERCATOR";
const TEMPLATE = `${TILES}/{z}/{y}/{x}.png`;

/** A tile: the PNG signature and a few bytes that are not text. */
const PNG = Buffer.from([
  0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 1, 2, 255,
]);

/** Cottbus at zoom 12, as `z/x/y` of the route. */
const COTTBUS = { z: 12, x: 2211, y: 1371 };
const upstream = ({ z, x, y }) => `${TILES}/${z}/${y}/${x}.png`;

const OTHER_TENANT = "other-tenant";

/** A location the way the store keeps it: `points` is `[lon, lat]`. */
const at = (lon, lat) => ({
  coordinates: { type: "Point", points: [lon, lat] },
  display_address: "",
});

/** Values of a dotted path of a document, `undefined` where it ends. */
const valueAt = (doc, path) =>
  path.split(".").reduce((value, key) => value?.[key], doc);

/** A document reduced to the paths a projection names (inclusive only). */
function projected(doc, projection) {
  const result = {};
  for (const [path, include] of Object.entries(projection)) {
    if (!include) continue;
    const value = valueAt(doc, path);
    if (value === undefined) continue;
    const keys = path.split(".");
    let target = result;
    for (const key of keys.slice(0, -1)) target = target[key] ??= {};
    target[keys.at(-1)] = value;
  }
  return result;
}

/**
 * The bookables, events and access points of every tenant in memory,
 * behind `Model.find(filter, projection).lean()`. A read must filter by
 * the tenant alone and name a projection; it answers the documents of the
 * tenant reduced to it. Every read is recorded.
 *
 * @param {{bookables?: Object[], events?: Object[], accessPoints?: Object[]}} world
 *   Documents `{ tenantId, location }`
 * @returns {{reads: Object[]}} The reads, `{ model, filter, projection }`
 */
function installPoints({ bookables = [], events = [], accessPoints = [] }) {
  const reads = [];
  const collections = [
    [BookableModel, "Bookable", bookables],
    [EventModel, "Event", events],
    [AccessPointModel, "AccessPoint", accessPoints],
  ];
  for (const [Model, model, docs] of collections) {
    sinon.stub(Model, "find").callsFake((filter, projection) => {
      reads.push({ model, filter, projection });
      if (Object.keys(filter ?? {}).join() !== "tenantId" || !projection) {
        throw new Error(
          `unexpected read of ${model}: ${JSON.stringify(filter)}`,
        );
      }
      const found = docs
        .filter((doc) => doc.tenantId === filter.tenantId)
        .map((doc) => projected(doc, projection));
      return { lean: async () => JSON.parse(JSON.stringify(found)) };
    });
  }
  return { reads };
}

describe("GET /api/v2/:tenant/geo/start and /geo/tiles/:z/:x/:y", function () {
  this.timeout(20000);

  let h;
  let geo;
  const savedEnv = {};
  const ENV = {
    GEO_TILES_URL_TEMPLATE: TEMPLATE,
    GEOCODER_CONTACT_EMAIL: "betrieb@example.test",
    FRONTEND_URL: "https://admin.example.test",
    GEO_TILES_CACHE_TTL_SECONDS: undefined,
    GEO_TILES_CACHE_MAX_TILES: undefined,
    RATE_LIMIT_GEO_TILES_OUTBOUND: undefined,
    RATE_LIMIT_GEO_TILES_OUTBOUND_WINDOW_SECONDS: undefined,
  };

  beforeEach(async function () {
    for (const [key, value] of Object.entries(ENV)) {
      savedEnv[key] = process.env[key];
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
    h = await installHarness();
    geo = new FakeGeoHttp().install();
    installInMemoryRateLimitEvents();
    TileService.clearCache();
  });

  afterEach(async function () {
    sinon.restore();
    await h.close();
    for (const [key, value] of Object.entries(savedEnv)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
    geo.verify();
  });

  const start = (user = CUSTOMER) =>
    h.api().get(`/api/v2/${TENANT}/geo/start`).set(h.as(user));

  describe("geo/start", function () {
    it("centres on the median per axis of the points of bookables, events and access points, at zoom 12", async function () {
      installPoints({
        bookables: [
          { tenantId: TENANT, location: at(14.3, 51.7) },
          { tenantId: TENANT, location: at(14.5, 51.9) },
        ],
        events: [{ tenantId: TENANT, location: at(14.1, 51.8) }],
        accessPoints: [{ tenantId: TENANT, location: at(14.4, 51.6) }],
      });

      const res = await start();

      expect(res.status, res.text).to.equal(200);
      // lon 14.1 14.3 | 14.4 14.5, lat 51.6 51.7 | 51.8 51.9
      expect(res.body.data.zoom).to.equal(12);
      expect(res.body.data.lon).to.be.closeTo(14.35, 1e-9);
      expect(res.body.data.lat).to.be.closeTo(51.75, 1e-9);
    });

    it("stays with the many when one point lies far off", async function () {
      installPoints({
        bookables: [
          { tenantId: TENANT, location: at(14.33, 51.75) },
          { tenantId: TENANT, location: at(14.34, 51.76) },
          { tenantId: TENANT, location: at(14.35, 51.77) },
          // Munich, entered by mistake.
          { tenantId: TENANT, location: at(11.57, 48.13) },
        ],
        events: [{ tenantId: TENANT, location: at(14.32, 51.74) }],
      });

      const res = await start();

      expect(res.body.data).to.deep.equal({ lat: 51.75, lon: 14.33, zoom: 12 });
    });

    it("counts no [null, null] and no record without a location", async function () {
      installPoints({
        bookables: [
          { tenantId: TENANT, location: at(14.3, 51.7) },
          { tenantId: TENANT, location: at(null, null) },
          { tenantId: TENANT },
        ],
        events: [{ tenantId: TENANT, location: at(null, null) }],
        accessPoints: [{ tenantId: TENANT, location: null }],
      });

      const res = await start();

      expect(res.body.data).to.deep.equal({ lat: 51.7, lon: 14.3, zoom: 12 });
    });

    it("counts only the points of its own tenant", async function () {
      installPoints({
        bookables: [
          { tenantId: TENANT, location: at(14.3, 51.7) },
          { tenantId: OTHER_TENANT, location: at(9.99, 53.55) },
          { tenantId: OTHER_TENANT, location: at(10.0, 53.56) },
        ],
        events: [{ tenantId: OTHER_TENANT, location: at(13.4, 52.5) }],
        accessPoints: [{ tenantId: OTHER_TENANT, location: at(13.4, 52.5) }],
      });

      const res = await start();

      expect(res.body.data).to.deep.equal({ lat: 51.7, lon: 14.3, zoom: 12 });
    });

    it("shows all of Germany when the tenant has no point at all", async function () {
      installPoints({
        bookables: [{ tenantId: TENANT, location: at(null, null) }],
        events: [{ tenantId: OTHER_TENANT, location: at(14.3, 51.7) }],
      });

      const res = await start();

      expect(res.status).to.equal(200);
      expect(res.body.data).to.deep.equal({ lat: 51.2, lon: 9.4, zoom: 5 });
    });

    it("computes afresh on every call: a new point counts at once", async function () {
      const bookables = [{ tenantId: TENANT, location: at(14.3, 51.7) }];
      installPoints({ bookables });

      const first = await start();
      bookables.push({ tenantId: TENANT, location: at(14.5, 51.9) });
      const second = await start();

      expect(first.body.data).to.deep.equal({ lat: 51.7, lon: 14.3, zoom: 12 });
      expect(second.body.data.lat).to.be.closeTo(51.8, 1e-9);
      expect(second.body.data.lon).to.be.closeTo(14.4, 1e-9);
    });

    it("reads nothing of a record but its point", async function () {
      const { reads } = installPoints({
        bookables: [{ tenantId: TENANT, location: at(14.3, 51.7) }],
      });

      await start();

      expect(reads.map((read) => read.model).sort()).to.deep.equal([
        "AccessPoint",
        "Bookable",
        "Event",
      ]);
      for (const { projection } of reads) {
        const included = Object.entries(projection)
          .filter(([, include]) => include)
          .map(([path]) => path);
        expect(included).to.deep.equal(["location.coordinates.points"]);
        expect(projection._id).to.equal(0);
      }
    });
  });

  /** Asks the proxy for a tile; reads the body as bytes. */
  const tile = ({ z, x, y }, user = CUSTOMER, tenant = TENANT) =>
    h
      .api()
      .get(`/api/v2/${tenant}/geo/tiles/${z}/${x}/${y}`)
      .set(h.as(user))
      .buffer(true)
      .parse((res, done) => {
        const chunks = [];
        res.on("data", (chunk) => chunks.push(chunk));
        res.on("end", () => done(null, Buffer.concat(chunks)));
      });

  describe("geo/tiles", function () {
    it("answers the tile of TopPlusOpen with its bytes and a private browser cache of a day", async function () {
      geo.on("GET", upstream(COTTBUS), image(PNG));

      const res = await tile(COTTBUS);

      expect(res.status).to.equal(200);
      expect(Buffer.compare(res.body, PNG)).to.equal(0);
      expect(res.headers["content-type"]).to.equal("image/png");
      expect(res.headers["cache-control"]).to.equal("private, max-age=86400");
      expect(geo.requests.map((r) => r.url)).to.deep.equal([upstream(COTTBUS)]);
    });

    it("answers the one tile of zoom 0 and the last tile of zoom 18", async function () {
      const last = 2 ** 18 - 1;
      for (const wanted of [
        { z: 0, x: 0, y: 0 },
        { z: 18, x: last, y: last },
      ]) {
        geo.on("GET", upstream(wanted), image(PNG));
      }

      const first = await tile({ z: 0, x: 0, y: 0 });
      const deepest = await tile({ z: 18, x: last, y: last });

      expect([first.status, deepest.status]).to.deep.equal([200, 200]);
    });

    it("passes a JPEG on with its media type", async function () {
      geo.on(
        "GET",
        upstream(COTTBUS),
        image(PNG, "image/jpeg; charset=binary"),
      );

      const res = await tile(COTTBUS);

      expect(res.status).to.equal(200);
      expect(res.headers["content-type"]).to.equal("image/jpeg");
    });

    const INVALID = {
      "a zoom above the range of the service": { z: 19, x: 0, y: 0 },
      "a negative zoom": { z: -1, x: 0, y: 0 },
      "x at 2^z": { z: 3, x: 8, y: 0 },
      "y at 2^z": { z: 3, x: 0, y: 8 },
      "a negative x": { z: 3, x: -1, y: 0 },
      "a fraction": { z: 3, x: "1.5", y: 0 },
      "a number with a sign": { z: "+3", x: 0, y: 0 },
      "a word": { z: 3, x: "abc", y: 0 },
      "an extension": { z: 3, x: 0, y: "0.png" },
      "a huge number": { z: 3, x: "1e3", y: 0 },
    };

    for (const [name, wanted] of Object.entries(INVALID)) {
      it(`refuses ${name} with 400 geo_tile_invalid, asking nobody`, async function () {
        const res = await h
          .api()
          .get(
            `/api/v2/${TENANT}/geo/tiles/${wanted.z}/${wanted.x}/${wanted.y}`,
          )
          .set(h.as(CUSTOMER));

        expect(res.status).to.equal(400);
        expect(res.body.code).to.equal("geo_tile_invalid");
        expect(geo.requests).to.deep.equal([]);
      });
    }
  });

  describe("the tile cache", function () {
    const SPREEWALD = { z: 12, x: 2212, y: 1372 };

    beforeEach(function () {
      geo.on("GET", upstream(COTTBUS), image(PNG));
      geo.on("GET", upstream(SPREEWALD), image(PNG));
    });

    it("answers a second request for a tile from the cache, whatever the tenant", async function () {
      const first = await tile(COTTBUS);
      const again = await tile(COTTBUS);
      const otherTenant = await tile(COTTBUS, OWNER_B, TENANT_B);

      expect([first.status, again.status, otherTenant.status]).to.deep.equal([
        200, 200, 200,
      ]);
      expect(Buffer.compare(again.body, PNG)).to.equal(0);
      expect(again.headers["content-type"]).to.equal("image/png");
      expect(again.headers["cache-control"]).to.equal("private, max-age=86400");
      expect(geo.requests).to.have.length(1);
    });

    it("keeps a tile for 7 days", async function () {
      const clock = sinon.useFakeTimers({ now: Date.now(), toFake: ["Date"] });

      await tile(COTTBUS);
      clock.tick(7 * 24 * 60 * 60 * 1000 - 1000);
      await tile(COTTBUS);
      clock.tick(2000);
      await tile(COTTBUS);

      expect(geo.requests).to.have.length(2);
    });

    it("keeps a tile as long as GEO_TILES_CACHE_TTL_SECONDS says", async function () {
      process.env.GEO_TILES_CACHE_TTL_SECONDS = "60";
      TileService.clearCache();
      const clock = sinon.useFakeTimers({ now: Date.now(), toFake: ["Date"] });

      await tile(COTTBUS);
      clock.tick(59 * 1000);
      await tile(COTTBUS);
      clock.tick(2000);
      await tile(COTTBUS);

      expect(geo.requests).to.have.length(2);
    });

    it("passes a tile on without keeping it once GEO_TILES_CACHE_MAX_TILES are kept", async function () {
      process.env.GEO_TILES_CACHE_MAX_TILES = "1";
      TileService.clearCache();

      const kept = await tile(COTTBUS);
      const passed = await tile(SPREEWALD);
      const passedAgain = await tile(SPREEWALD);
      const keptAgain = await tile(COTTBUS);

      expect(
        [kept, passed, passedAgain, keptAgain].map((res) => res.status),
      ).to.deep.equal([200, 200, 200, 200]);
      expect(Buffer.compare(passed.body, PNG)).to.equal(0);
      expect(geo.requests.map((r) => r.url)).to.deep.equal([
        upstream(COTTBUS),
        upstream(SPREEWALD),
        upstream(SPREEWALD),
      ]);
    });

    it("keeps at most 2000 tiles by default", async function () {
      process.env.RATE_LIMIT_GEO_TILES_OUTBOUND = "5000";
      const row = (x) => ({ z: 11, x, y: 0 });
      for (let x = 0; x <= 2000; x++) {
        geo.on("GET", upstream(row(x)), image(PNG));
      }

      // 2000 tiles fill the cache, the 2001st is passed on.
      for (let x = 0; x <= 2000; x++) await tile(row(x));
      await tile(row(0));
      await tile(row(2000));

      expect(geo.requests).to.have.length(2002);
      expect(geo.requests.at(-1).url).to.equal(upstream(row(2000)));
    });

    it("keeps no failure: the next request asks again", async function () {
      geo.on("GET", upstream(COTTBUS), text(500, "oops"));
      const failed = await tile(COTTBUS);
      geo.on("GET", upstream(COTTBUS), image(PNG));
      const fetched = await tile(COTTBUS);

      expect([failed.status, fetched.status]).to.deep.equal([503, 200]);
      expect(geo.requests).to.have.length(2);
    });
  });

  describe("the limit towards the tile server", function () {
    const row = (x) => ({ z: 11, x, y: 0 });

    beforeEach(function () {
      for (let x = 0; x < 5; x++) geo.on("GET", upstream(row(x)), image(PNG));
    });

    it("answers 503 geo_tiles_unavailable past the limit of the instance, which only misses of the cache count, with Retry-After", async function () {
      process.env.RATE_LIMIT_GEO_TILES_OUTBOUND = "2";

      const statuses = [];
      statuses.push((await tile(row(0))).status);
      statuses.push((await tile(row(0))).status);
      statuses.push((await tile(row(1), OWNER_B, TENANT_B)).status);
      const refused = await tile(row(2));

      expect(statuses).to.deep.equal([200, 200, 200]);
      expect(refused.status).to.equal(503);
      expect(JSON.parse(refused.body.toString()).code).to.equal(
        "geo_tiles_unavailable",
      );
      expect(Number(refused.headers["retry-after"])).to.be.within(1, 60);
      expect(geo.requests).to.have.length(2);
    });

    it("frees the limit after its window", async function () {
      process.env.RATE_LIMIT_GEO_TILES_OUTBOUND = "1";
      process.env.RATE_LIMIT_GEO_TILES_OUTBOUND_WINDOW_SECONDS = "60";
      const clock = sinon.useFakeTimers({ now: Date.now(), toFake: ["Date"] });

      await tile(row(0));
      const refused = await tile(row(1));
      clock.tick(61 * 1000);
      const again = await tile(row(1));

      expect([refused.status, again.status]).to.deep.equal([503, 200]);
    });

    it("has no limit per person", async function () {
      process.env.RATE_LIMIT_GEO_PER_USER = "1";
      try {
        const statuses = [];
        for (let x = 0; x < 5; x++) statuses.push((await tile(row(x))).status);

        expect(statuses).to.deep.equal([200, 200, 200, 200, 200]);
      } finally {
        delete process.env.RATE_LIMIT_GEO_PER_USER;
      }
    });
  });

  describe("when the tile server fails", function () {
    const FAILURES = {
      timeout: timeout(),
      "a network error": unreachable("ECONNREFUSED"),
      throttling: text(429, "Too Many Requests"),
      "a server error": text(500, "oops"),
      "a missing tile": text(404, "Not Found"),
      "an answer that is no image": text(200, "<html></html>", {
        "content-type": "text/html",
      }),
      "an image without bytes": image(Buffer.alloc(0)),
      "an SVG": image(Buffer.from("<svg/>"), "image/svg+xml"),
      "an image without a media type": text(200, PNG, {}),
      "an answer above the size limit": image(Buffer.alloc(2 * 1024 * 1024)),
    };

    for (const [name, answer] of Object.entries(FAILURES)) {
      it(`answers 503 geo_tiles_unavailable on ${name}`, async function () {
        geo.on("GET", upstream(COTTBUS), answer);

        const res = await tile(COTTBUS);

        expect(res.status).to.equal(503);
        expect(res.headers["content-type"]).to.match(/^application\/json/);
        expect(JSON.parse(res.body.toString()).code).to.equal(
          "geo_tiles_unavailable",
        );
      });
    }
  });

  describe("what goes out", function () {
    beforeEach(function () {
      geo.on("GET", upstream(COTTBUS), image(PNG));
    });

    it("sends the tile and the platform's User-Agent, no header of the browser", async function () {
      await h
        .api()
        .get(`/api/v2/${TENANT}/geo/tiles/12/2211/1371`)
        .set(h.as(CUSTOMER))
        .set("User-Agent", "Mozilla/5.0 (Admin)")
        .set("Referer", "https://admin.example.test/bookables/1")
        .set("Cookie", "connect.sid=secret")
        .set("Accept-Language", "de-DE");

      const { version } = require("../package.json");
      expect(geo.requests).to.have.length(1);
      expect(geo.requests[0].url).to.equal(upstream(COTTBUS));
      expect(geo.requests[0].headers).to.deep.equal({
        "user-agent": `smart-city-booking-backend/${version} (+https://admin.example.test; betrieb@example.test)`,
      });
    });

    it("asks the public service of the BKG without GEO_TILES_URL_TEMPLATE", async function () {
      delete process.env.GEO_TILES_URL_TEMPLATE;
      const BKG =
        "https://sgx.geodatenzentrum.de/wmts_topplus_open/tile/1.0.0/web/default/WEBMERCATOR/12/1371/2211.png";
      geo.on("GET", BKG, image(PNG));

      const res = await tile(COTTBUS);

      expect(res.status).to.equal(200);
      expect(geo.requests.map((r) => r.url)).to.deep.equal([BKG]);
    });
  });

  describe("the logs", function () {
    const LEVELS = ["trace", "debug", "info", "warn", "error", "fatal"];
    /** Where a person looked: the coordinates of the tile, in any order. */
    const WANTED = { z: 17, x: 70831, y: 43771 };
    const SECRETS = ["70831", "43771"];
    let lines;

    beforeEach(function () {
      lines = [];
      for (const level of LEVELS) {
        sinon.stub(bunyan.prototype, level).callsFake((...args) => {
          lines.push(`${level} ${JSON.stringify(args)}`);
        });
      }
    });

    const leaks = () =>
      lines.filter((line) => SECRETS.some((secret) => line.includes(secret)));

    it("name kinds and counts of failures, never the coordinates of a tile", async function () {
      process.env.RATE_LIMIT_GEO_TILES_OUTBOUND = "2";
      geo.on("GET", upstream(WANTED), timeout());

      await tile(WANTED);
      await tile({ ...WANTED, z: 19 });
      await tile(WANTED);
      await tile(WANTED);

      expect(lines.some((l) => l.includes("tiles"))).to.equal(true);
      expect(lines.some((l) => l.includes("outbound"))).to.equal(true);
      expect(leaks()).to.deep.equal([]);
    });

    it("keep the coordinates of a tile out of the request log of development", function () {
      const saved = process.env.NODE_ENV;
      process.env.NODE_ENV = "development";
      try {
        const path = `/api/v2/${TENANT}/geo/tiles/17/70831/43771`;
        requestLogger(
          {
            method: "GET",
            url: "/17/70831/43771",
            originalUrl: path,
            path: "/17/70831/43771",
            baseUrl: `/api/v2/${TENANT}/geo/tiles`,
            query: {},
            params: { z: "17", x: "70831", y: "43771" },
            headers: {},
            ip: "127.0.0.1",
          },
          {},
          () => {},
        );
      } finally {
        process.env.NODE_ENV = saved;
      }

      expect(lines.some((l) => l.includes("geo/tiles"))).to.equal(true);
      expect(leaks()).to.deep.equal([]);
    });
  });

  describe("who may", function () {
    beforeEach(function () {
      installPoints({});
      geo.on("GET", upstream(COTTBUS), image(PNG));
    });

    for (const path of ["start", "tiles/12/2211/1371"]) {
      it(`lets a member use geo/${path.split("/")[0]}, not a stranger or the anonymous`, async function () {
        const url = `/api/v2/${TENANT}/geo/${path}`;

        const member = await h.api().get(url).set(h.as(CUSTOMER));
        const stranger = await h.api().get(url).set(h.as(OWNER_B));
        const anonymous = await h.api().get(url);

        expect(member.status).to.equal(200);
        expect(stranger.status).to.equal(403);
        expect(anonymous.status).to.equal(401);
      });
    }
  });
});
