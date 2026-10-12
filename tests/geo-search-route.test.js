/**
 * Search and reverse search over the backend (ECCdigital/tickets#468):
 * `GET /api/v2/:tenant/geo/search` and `GET /api/v2/:tenant/geo/reverse`,
 * over the lifecycle harness with Photon faked per URL
 * (`helpers/fake-geo-http.js`) and the `RateLimiter` in memory. Seam 1 of
 * the spec of map ECCdigital/tickets#372.
 */

const { expect } = require("chai");
const bunyan = require("bunyan");
const sinon = require("sinon");

const {
  installHarness,
  TENANT,
  CUSTOMER,
  OWNER_B,
} = require("./helpers/booking-lifecycle-harness");
const {
  FakeGeoHttp,
  json,
  text,
  timeout,
  unreachable,
} = require("./helpers/fake-geo-http");
const {
  installInMemoryRateLimitEvents,
} = require("./helpers/in-memory-rate-limit-events");
const GeoService = require("../src/commons/services/geo/geo-service");
const {
  warnIfContactMissing,
} = require("../src/commons/services/geo/user-agent");
const { requestLogger } = require("../src/middleware/logger");

const PHOTON = "https://photon.example.test";

/** A Photon feature: GeoJSON point plus the properties Photon names. */
function feature([lon, lat], properties) {
  return {
    type: "Feature",
    geometry: { type: "Point", coordinates: [lon, lat] },
    properties: { osm_type: "N", osm_id: 1, ...properties },
  };
}

const featureCollection = (features) => ({
  type: "FeatureCollection",
  features,
});

/** The house of the Sporthalle in Cottbus, as Photon has it. */
const GASSTRASSE = feature([14.33412, 51.75634], {
  osm_key: "building",
  osm_value: "yes",
  type: "house",
  housenumber: "4",
  street: "Gasstraße",
  postcode: "03046",
  city: "Cottbus",
  countrycode: "DE",
  country: "Deutschland",
});

/** Gubin, across the Neisse: Photon names the country in lower case at times. */
const GUBIN = feature([14.72561, 51.94942], {
  osm_key: "place",
  osm_value: "town",
  type: "city",
  name: "Gubin",
  postcode: "66-620",
  countrycode: "pl",
  country: "Polen",
});

/** A park: a place without a house address. */
const SPREEAUENPARK = feature([14.3475, 51.7801], {
  osm_key: "leisure",
  osm_value: "park",
  type: "other",
  name: "Spreeauenpark",
  postcode: "03042",
  city: "Cottbus",
  countrycode: "DE",
});

/** A street without a house number: Photon names the street `name`. */
const BERLINER_STRASSE = feature([14.3301, 51.7602], {
  osm_key: "highway",
  osm_value: "residential",
  type: "street",
  name: "Berliner Straße",
  postcode: "03046",
  city: "Cottbus",
  countrycode: "DE",
});

/** `n` hits, one house number each. */
const houses = (n) =>
  Array.from({ length: n }, (_, i) =>
    feature([14.3 + i / 100, 51.7], {
      type: "house",
      street: "Gasstraße",
      housenumber: String(i + 1),
      postcode: "03046",
      city: "Cottbus",
      countrycode: "DE",
    }),
  );

describe("GET /api/v2/:tenant/geo/search and /geo/reverse", function () {
  this.timeout(20000);

  let h;
  let geo;
  const savedEnv = {};
  const ENV = {
    GEOCODER_BASE_URL: PHOTON,
    GEOCODER_CONTACT_EMAIL: "betrieb@example.test",
    FRONTEND_URL: "https://admin.example.test",
  };

  beforeEach(async function () {
    for (const [key, value] of Object.entries(ENV)) {
      savedEnv[key] = process.env[key];
      process.env[key] = value;
    }
    h = await installHarness();
    geo = new FakeGeoHttp().install();
    installInMemoryRateLimitEvents();
    GeoService.clearCache();
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

  const search = (query, user = CUSTOMER) =>
    h.api().get(`/api/v2/${TENANT}/geo/search`).query(query).set(h.as(user));

  describe("search", function () {
    it("answers a Photon hit in the form of the stored location", async function () {
      geo.on(
        "GET",
        `${PHOTON}/api`,
        json(200, featureCollection([GASSTRASSE])),
      );

      const res = await search({ q: "Gasstraße 4" });

      expect(res.status, res.text).to.equal(200);
      expect(res.body.data).to.deep.equal([
        {
          address: {
            street: "Gasstraße",
            house_number: "4",
            postcode: "03046",
            city: "Cottbus",
            country_code: "DE",
          },
          coordinates: { type: "Point", points: [14.33412, 51.75634] },
          display_address: "Gasstraße 4, 03046 Cottbus",
        },
      ]);
    });

    it("answers a hit abroad with the country code in upper case", async function () {
      geo.on("GET", `${PHOTON}/api`, json(200, featureCollection([GUBIN])));

      const res = await search({ q: "Gubin" });

      expect(res.body.data).to.deep.equal([
        {
          address: {
            street: null,
            house_number: null,
            postcode: "66-620",
            city: "Gubin",
            country_code: "PL",
          },
          coordinates: { type: "Point", points: [14.72561, 51.94942] },
          display_address: "66-620 Gubin",
        },
      ]);
    });

    it("names a place without a house address in the display text and leaves out the street", async function () {
      geo.on(
        "GET",
        `${PHOTON}/api`,
        json(200, featureCollection([SPREEAUENPARK])),
      );

      const res = await search({ q: "Spreeauenpark" });

      const [hit] = res.body.data;
      expect(hit.address.street).to.equal(null);
      expect(hit.display_address).to.equal("Spreeauenpark, 03042 Cottbus");
      expect(hit.coordinates.points).to.deep.equal([14.3475, 51.7801]);
    });

    it("takes a street's name as its street", async function () {
      geo.on(
        "GET",
        `${PHOTON}/api`,
        json(200, featureCollection([BERLINER_STRASSE])),
      );

      const res = await search({ q: "Berliner Straße" });

      expect(res.body.data[0].address).to.include({
        street: "Berliner Straße",
        house_number: null,
        city: "Cottbus",
      });
      expect(res.body.data[0].display_address).to.equal(
        "Berliner Straße, 03046 Cottbus",
      );
    });

    it("answers at most 5 hits and asks for no more", async function () {
      geo.on("GET", `${PHOTON}/api`, json(200, featureCollection(houses(7))));

      const res = await search({ q: "Gasstraße" });

      expect(res.body.data).to.have.length(5);
      expect(geo.requests[0].query.limit).to.equal("5");
    });

    it("answers no hits as an empty list", async function () {
      geo.on("GET", `${PHOTON}/api`, json(200, featureCollection([])));

      const res = await search({ q: "Nirgendwo" });

      expect(res.status).to.equal(200);
      expect(res.body.data).to.deep.equal([]);
    });

    it("sends the search text and the focus rounded to 0.1°, without a country filter", async function () {
      geo.on("GET", `${PHOTON}/api`, json(200, featureCollection([])));

      await search({ q: "Gasstraße 4", lat: "51.75634", lon: "14.33412" });

      expect(geo.requests).to.have.length(1);
      expect(geo.requests[0].query).to.deep.equal({
        q: "Gasstraße 4",
        limit: "5",
        lang: "de",
        lat: "51.8",
        lon: "14.3",
      });
    });

    it("asks in the language of the interface", async function () {
      geo.on("GET", `${PHOTON}/api`, json(200, featureCollection([])));

      await search({ q: "Gasstraße 4", lang: "en" });

      expect(geo.requests[0].query.lang).to.equal("en");
    });

    it("refuses a search text under 3 characters with 400, asking nobody", async function () {
      const res = await search({ q: "  Ga  " });

      expect(res.status).to.equal(400);
      expect(res.body.code).to.equal("geo_query_invalid");
      expect(geo.requests).to.have.length(0);
    });

    it("refuses half a focus or one out of range with 400", async function () {
      const half = await search({ q: "Gasstraße", lat: "51.7" });
      const outOfRange = await search({ q: "Gasstraße", lat: "91", lon: "1" });

      expect(half.status).to.equal(400);
      expect(outOfRange.status).to.equal(400);
      expect(outOfRange.body.code).to.equal("geo_point_invalid");
    });
  });

  describe("reverse search", function () {
    const reverse = (query, user = CUSTOMER) =>
      h.api().get(`/api/v2/${TENANT}/geo/reverse`).query(query).set(h.as(user));

    it("sends the point rounded to 5 decimals and answers its one hit", async function () {
      geo.on(
        "GET",
        `${PHOTON}/reverse`,
        json(200, featureCollection([GASSTRASSE, SPREEAUENPARK])),
      );

      const res = await reverse({ lat: "51.756344999", lon: "14.334117" });

      expect(res.status, res.text).to.equal(200);
      expect(geo.requests[0].query).to.deep.equal({
        lat: "51.75634",
        lon: "14.33412",
        lang: "de",
        limit: "1",
      });
      expect(res.body.data.display_address).to.equal(
        "Gasstraße 4, 03046 Cottbus",
      );
    });

    it("answers no hit as null", async function () {
      geo.on("GET", `${PHOTON}/reverse`, json(200, featureCollection([])));

      const res = await reverse({ lat: "54.5", lon: "6.1" });

      expect(res.status).to.equal(200);
      expect(res.body.data).to.equal(null);
    });

    it("refuses a reverse search without a point with 400", async function () {
      const res = await reverse({ lat: "51.7" });

      expect(res.status).to.equal(400);
      expect(res.body.code).to.equal("geo_point_invalid");
    });
  });

  describe("the cache", function () {
    beforeEach(function () {
      geo.on(
        "GET",
        `${PHOTON}/api`,
        json(200, featureCollection([GASSTRASSE])),
      );
      geo.on("GET", `${PHOTON}/reverse`, json(200, featureCollection([])));
    });

    it("answers a second equal search from the cache: the same normalized text, rounded focus and language", async function () {
      const first = await search({
        q: "Gasstraße 4",
        lat: "51.76",
        lon: "14.33",
      });
      const second = await search({
        q: "  GASSTRAßE   4 ",
        lat: "51.81",
        lon: "14.26",
      });

      expect(geo.requests).to.have.length(1);
      expect(second.body.data).to.deep.equal(first.body.data);
    });

    it("asks again for another focus or another language", async function () {
      await search({ q: "Gasstraße 4", lat: "51.76", lon: "14.33" });
      await search({ q: "Gasstraße 4", lat: "52.76", lon: "14.33" });
      await search({ q: "Gasstraße 4" });
      await search({ q: "Gasstraße 4", lang: "en" });

      expect(geo.requests).to.have.length(4);
    });

    it("answers a second reverse search at the same rounded point from the cache, a found nothing included", async function () {
      await h
        .api()
        .get(`/api/v2/${TENANT}/geo/reverse`)
        .query({ lat: "51.756341", lon: "14.334119" })
        .set(h.as(CUSTOMER));
      const second = await h
        .api()
        .get(`/api/v2/${TENANT}/geo/reverse`)
        .query({ lat: "51.756339", lon: "14.334121" })
        .set(h.as(CUSTOMER));

      expect(second.status).to.equal(200);
      expect(second.body.data).to.equal(null);
      expect(geo.requests).to.have.length(1);
    });

    it("keeps no failure: the next equal search asks again", async function () {
      geo.on("GET", `${PHOTON}/api`, timeout());
      await search({ q: "Gasstraße 4" });
      geo.on(
        "GET",
        `${PHOTON}/api`,
        json(200, featureCollection([GASSTRASSE])),
      );

      const res = await search({ q: "Gasstraße 4" });

      expect(res.status).to.equal(200);
      expect(geo.requests).to.have.length(2);
    });

    it("keeps an answer for 24 hours", async function () {
      const clock = sinon.useFakeTimers({
        now: Date.now(),
        toFake: ["Date"],
      });
      await search({ q: "Gasstraße 4" });
      clock.tick(24 * 60 * 60 * 1000 - 1000);
      await search({ q: "Gasstraße 4" });
      clock.tick(2000);
      await search({ q: "Gasstraße 4" });

      expect(geo.requests).to.have.length(2);
    });
  });

  describe("the limits", function () {
    const LIMIT_ENV = [
      "RATE_LIMIT_GEO_PER_USER",
      "RATE_LIMIT_GEO_PER_USER_WINDOW_SECONDS",
      "RATE_LIMIT_GEO_OUTBOUND",
      "RATE_LIMIT_GEO_OUTBOUND_WINDOW_SECONDS",
    ];
    let savedLimits;

    beforeEach(function () {
      savedLimits = Object.fromEntries(
        LIMIT_ENV.map((k) => [k, process.env[k]]),
      );
      geo.on(
        "GET",
        `${PHOTON}/api`,
        json(200, featureCollection([GASSTRASSE])),
      );
      geo.on("GET", `${PHOTON}/reverse`, json(200, featureCollection([])));
    });

    afterEach(function () {
      for (const key of LIMIT_ENV) {
        if (savedLimits[key] === undefined) delete process.env[key];
        else process.env[key] = savedLimits[key];
      }
    });

    const reverse = (user = CUSTOMER) =>
      h
        .api()
        .get(`/api/v2/${TENANT}/geo/reverse`)
        .query({ lat: "51.7", lon: "14.3" })
        .set(h.as(user));

    it("answers 503 geo_search_unavailable past the limit of the person, cache hits counted, with Retry-After", async function () {
      process.env.RATE_LIMIT_GEO_PER_USER = "3";

      const statuses = [];
      for (let i = 0; i < 2; i++) {
        statuses.push((await search({ q: "Gasstraße 4" })).status);
      }
      statuses.push((await reverse()).status);
      const refused = await search({ q: "Gasstraße 4" });

      expect(statuses).to.deep.equal([200, 200, 200]);
      expect(refused.status).to.equal(503);
      expect(refused.body.code).to.equal("geo_search_unavailable");
      expect(Number(refused.headers["retry-after"])).to.be.within(1, 60);
    });

    it("counts each person on their own", async function () {
      process.env.RATE_LIMIT_GEO_PER_USER = "1";

      const first = await search({ q: "Gasstraße 4" }, CUSTOMER);
      const second = await search({ q: "Gasstraße 4" }, "rolle@example.test");

      expect([first.status, second.status]).to.deep.equal([200, 200]);
    });

    it("answers 503 past the limit of the instance towards the provider, which only misses of the cache count", async function () {
      process.env.RATE_LIMIT_GEO_OUTBOUND = "2";

      const hit = [];
      hit.push((await search({ q: "Gasstraße 4" })).status);
      hit.push((await search({ q: "Gasstraße 4" })).status);
      hit.push((await reverse()).status);
      const refused = await search({ q: "Gasstraße 5" }, "rolle@example.test");

      expect(hit).to.deep.equal([200, 200, 200]);
      expect(refused.status).to.equal(503);
      expect(refused.body.code).to.equal("geo_search_unavailable");
      expect(geo.requests).to.have.length(2);
    });

    it("frees the limit after its window", async function () {
      process.env.RATE_LIMIT_GEO_PER_USER = "1";
      process.env.RATE_LIMIT_GEO_PER_USER_WINDOW_SECONDS = "60";
      const clock = sinon.useFakeTimers({ now: Date.now(), toFake: ["Date"] });

      await search({ q: "Gasstraße 4" });
      const refused = await search({ q: "Gasstraße 4" });
      clock.tick(61 * 1000);
      const again = await search({ q: "Gasstraße 4" });

      expect([refused.status, again.status]).to.deep.equal([503, 200]);
    });
  });

  describe("when the provider fails", function () {
    const FAILURES = {
      timeout: timeout(),
      "a network error": unreachable("ECONNREFUSED"),
      throttling: text(429, "Too Many Requests"),
      "a server error": text(500, "oops"),
      "an answer that is no GeoJSON": text(200, "<html></html>", {
        "content-type": "text/html",
      }),
      "an answer above the size limit": text(200, "x".repeat(300 * 1024)),
    };

    for (const [name, answer] of Object.entries(FAILURES)) {
      it(`answers 503 geo_search_unavailable to search and reverse search on ${name}`, async function () {
        geo.on("GET", `${PHOTON}/api`, answer);
        geo.on("GET", `${PHOTON}/reverse`, answer);

        const found = await search({ q: "Gasstraße 4" });
        const reversed = await h
          .api()
          .get(`/api/v2/${TENANT}/geo/reverse`)
          .query({ lat: "51.7", lon: "14.3" })
          .set(h.as(CUSTOMER));

        for (const res of [found, reversed]) {
          expect(res.status).to.equal(503);
          expect(res.body.code).to.equal("geo_search_unavailable");
        }
      });
    }

    it("never falls back to a second provider", async function () {
      geo.on("GET", `${PHOTON}/api`, text(503));

      await search({ q: "Gasstraße 4" });

      expect(geo.requests.map((r) => r.path)).to.deep.equal([`${PHOTON}/api`]);
    });
  });

  describe("what goes out", function () {
    beforeEach(function () {
      geo.on("GET", `${PHOTON}/api`, json(200, featureCollection([])));
    });

    it("sends the platform's User-Agent and no header of the browser", async function () {
      await h
        .api()
        .get(`/api/v2/${TENANT}/geo/search`)
        .query({ q: "Gasstraße 4" })
        .set(h.as(CUSTOMER))
        .set("User-Agent", "Mozilla/5.0 (Admin)")
        .set("Referer", "https://admin.example.test/bookables/1")
        .set("Cookie", "connect.sid=secret")
        .set("Accept-Language", "de-DE");

      const { headers } = geo.requests[0];
      const { version } = require("../package.json");
      expect(headers).to.deep.equal({
        "user-agent": `smart-city-booking-backend/${version} (+https://admin.example.test; betrieb@example.test)`,
      });
    });

    it("leaves the mail out of the User-Agent without GEOCODER_CONTACT_EMAIL", async function () {
      delete process.env.GEOCODER_CONTACT_EMAIL;

      await search({ q: "Gasstraße 4" });

      const { version } = require("../package.json");
      expect(geo.requests[0].headers["user-agent"]).to.equal(
        `smart-city-booking-backend/${version} (+https://admin.example.test)`,
      );
    });

    it("asks Photon at its public address without GEOCODER_BASE_URL", async function () {
      delete process.env.GEOCODER_BASE_URL;
      geo.on(
        "GET",
        "https://photon.komoot.io/api",
        json(200, featureCollection([])),
      );

      const res = await search({ q: "Gasstraße 4" });

      expect(res.status).to.equal(200);
      expect(geo.requests[0].path).to.equal("https://photon.komoot.io/api");
    });
  });

  describe("the logs", function () {
    const LEVELS = ["trace", "debug", "info", "warn", "error", "fatal"];
    /** What a search names: text, focus and point, exact and rounded. */
    const SECRETS = ["Geheimweg", "geheimweg", "48.1", "11.5", "11.6"];
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

    it("name kinds and counts of requests and failures, never a search text or a point", async function () {
      process.env.RATE_LIMIT_GEO_PER_USER = "4";
      try {
        geo.on("GET", `${PHOTON}/api`, json(200, featureCollection([])));
        geo.on("GET", `${PHOTON}/reverse`, timeout());
        const focus = { lat: "48.13719", lon: "11.57538" };

        await search({ q: "Geheimweg 7", ...focus });
        await search({ q: "Geheimweg 7", ...focus });
        await h
          .api()
          .get(`/api/v2/${TENANT}/geo/reverse`)
          .query(focus)
          .set(h.as(CUSTOMER));
        await search({ q: "Geheimweg 8", ...focus });
        await search({ q: "Geheimweg 9", ...focus });
        await search({ q: "Ge" });
      } finally {
        delete process.env.RATE_LIMIT_GEO_PER_USER;
      }

      expect(lines.some((l) => l.includes("reverse"))).to.equal(true);
      expect(lines.some((l) => l.includes("perUser"))).to.equal(true);
      expect(leaks()).to.deep.equal([]);
    });

    it("keep the query of a geo route out of the request log of development", function () {
      const saved = process.env.NODE_ENV;
      process.env.NODE_ENV = "development";
      try {
        const url = `/api/v2/${TENANT}/geo/search?q=Geheimweg%207&lat=48.13719&lon=11.57538`;
        requestLogger(
          {
            method: "GET",
            url,
            originalUrl: url,
            path: `/api/v2/${TENANT}/geo/search`,
            baseUrl: "",
            query: { q: "Geheimweg 7", lat: "48.13719", lon: "11.57538" },
            params: {},
            headers: {},
            ip: "127.0.0.1",
          },
          {},
          () => {},
        );
      } finally {
        process.env.NODE_ENV = saved;
      }

      expect(lines.some((l) => l.includes("geo/search"))).to.equal(true);
      expect(leaks()).to.deep.equal([]);
    });

    it("warn once at boot without GEOCODER_CONTACT_EMAIL, not with it", function () {
      warnIfContactMissing();
      delete process.env.GEOCODER_CONTACT_EMAIL;
      warnIfContactMissing();

      const warnings = lines.filter((l) => l.startsWith("warn"));
      expect(warnings).to.have.length(1);
      expect(warnings[0]).to.include("GEOCODER_CONTACT_EMAIL");
    });
  });

  describe("who may", function () {
    beforeEach(function () {
      geo.on("GET", `${PHOTON}/api`, json(200, featureCollection([])));
      geo.on("GET", `${PHOTON}/reverse`, json(200, featureCollection([])));
    });

    for (const path of [
      "search?q=Gasstra%C3%9Fe",
      "reverse?lat=51.7&lon=14.3",
    ]) {
      it(`lets a member use geo/${path.split("?")[0]}, not a stranger or the anonymous`, async function () {
        const url = `/api/v2/${TENANT}/geo/${path}`;

        const member = await h.api().get(url).set(h.as(CUSTOMER));
        const stranger = await h.api().get(url).set(h.as(OWNER_B));
        const anonymous = await h.api().get(url);

        expect(member.status).to.equal(200);
        expect(stranger.status).to.equal(403);
        expect(anonymous.status).to.equal(401);
        expect(geo.requests).to.have.length(1);
      });
    }
  });
});
