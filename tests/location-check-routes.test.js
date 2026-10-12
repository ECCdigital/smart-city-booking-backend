/**
 * The location (glossary "Standort") is checked when a bookable, an event or
 * an access point is created or changed over the API (ECCdigital/tickets#467):
 * a new or changed location needs a point, an old one without a point blocks
 * nothing as long as it stays as stored, and the stored form stays as it is.
 */

const { expect } = require("chai");
const sinon = require("sinon");

const {
  installHarness,
  bookable,
  TENANT,
  OWNER,
} = require("./helpers/booking-lifecycle-harness");
const { installRouteWorld } = require("./helpers/route-world");
const {
  BookableManager,
} = require("../src/commons/data-managers/bookable-manager");
const EventManager = require("../src/commons/data-managers/event-manager");
const AccessPointManager = require("../src/commons/data-managers/access-point-manager");
const AccessInfoService = require("../src/commons/services/access/access-info-service");
const { Event } = require("../src/commons/entities/event/event");
const { AccessPoint } = require("../src/commons/entities/access/access-point");

const STORED_ID = "mit-standort";

/** A location as the new input stores it: address, point and its source. */
const withPoint = () => ({
  display_address: "Gasstraße 4, 03172 Guben",
  address: {
    street: "Gasstraße",
    house_number: "4",
    postcode: "03172",
    city: "Guben",
    country_code: "DE",
  },
  coordinates: { type: "Point", points: [14.714485, 51.950438] },
  meta: { source: "photon", additional: "Halle 2, Hintereingang" },
});

/** An address without a point, as the old input stored it. */
const withoutPoint = () => ({
  display_address: "Gasstraße 4, 03172 Guben",
  address: {
    street: "Gasstraße",
    house_number: "4",
    postcode: "03172",
    city: "Guben",
  },
  coordinates: { type: "Point", points: [null, null] },
  meta: {},
});

describe("location check on the create and update routes", function () {
  this.timeout(30000);

  let h;
  /** Every location the managers were asked to write. */
  let written;
  /** The stored events and access points, by id. */
  let events;
  let accessPoints;

  before(async function () {
    h = await installHarness({});
    installRouteWorld({
      tenantId: TENANT,
      tenant: h.tenant,
      ownerUserId: OWNER,
      bookables: h.bookables,
    });
    const restub = (Manager, name, impl) => {
      Manager[name].restore();
      sinon.stub(Manager, name).callsFake(impl);
    };
    restub(BookableManager, "storeBookable", async (entity) => {
      written.push(entity.location);
      h.bookables[entity.id] = bookable({ ...entity });
      return entity;
    });
    restub(EventManager, "getEvent", async (id) => events[id] ?? null);
    restub(EventManager, "storeEvent", async (entity) => {
      written.push(entity.location);
      return entity;
    });
    restub(
      AccessPointManager,
      "getAccessPoint",
      async (id) => accessPoints[id] ?? null,
    );
    restub(AccessPointManager, "storeAccessPoint", async (entity) => {
      written.push(entity.location);
      return entity;
    });
    // The provider is not asked: it lists nothing, so nothing is refused.
    sinon.stub(AccessInfoService, "findListedAccessPoint").resolves(null);
  });

  after(async function () {
    sinon.restore();
    await h.close();
  });

  beforeEach(function () {
    written = [];
    events = {};
    accessPoints = {};
  });

  const call = (method, path, body) =>
    h
      .api()
      [method](`/api/${TENANT}${path}`)
      .timeout({ response: 5000 })
      .set(h.as(OWNER))
      .send(body);

  /** A body that leaves the location out when it is `undefined`. */
  const withLocation = (body, location) =>
    location === undefined ? body : { ...body, location };

  /**
   * Each site: `create` posts a new thing with a location, `update` stores
   * one with the location `stored` and sends it back with `location`.
   */
  const SITES = {
    bookable: {
      create: (location) =>
        call(
          "post",
          "/bookables",
          withLocation({ title: "Neu", type: "room" }, location),
        ),
      update: (stored, location) => {
        h.bookables[STORED_ID] = bookable({
          id: STORED_ID,
          title: "Mit Standort",
          ownerUserId: OWNER,
          location: stored,
        });
        const body = JSON.parse(JSON.stringify(h.bookables[STORED_ID]));
        delete body.location;
        return call("put", "/bookables", withLocation(body, location));
      },
    },
    event: {
      create: (location) =>
        call(
          "post",
          "/events",
          withLocation({ information: { name: "Neu" } }, location),
        ),
      update: (stored, location) => {
        events[STORED_ID] = new Event({
          id: STORED_ID,
          tenantId: TENANT,
          ownerUserId: OWNER,
          information: { name: "Mit Standort" },
          location: stored,
        });
        const body = JSON.parse(JSON.stringify(events[STORED_ID]));
        delete body.location;
        return call("put", "/events", withLocation(body, location));
      },
    },
    "access point": {
      create: (location) =>
        call(
          "put",
          "/accesspoints/",
          withLocation({ provider: "nuki", externalId: "lock-1" }, location),
        ),
      update: (stored, location) => {
        accessPoints[STORED_ID] = new AccessPoint({
          id: STORED_ID,
          tenantId: TENANT,
          provider: "nuki",
          externalId: "lock-1",
          scanCode: "scan-1",
          location: stored,
        });
        // A client that leaves the location out keeps the stored one.
        return call(
          "put",
          "/accesspoints/",
          withLocation({ id: STORED_ID, label: "Tür" }, location),
        );
      },
    },
  };

  for (const [site, { create, update }] of Object.entries(SITES)) {
    describe(site, function () {
      it("refuses a new location without a point", async function () {
        const res = await create(withoutPoint());

        expect(res.status).to.equal(400);
        expect(res.body).to.include({
          error: "ValidationError",
          statusCode: 400,
        });
        expect(res.body.details.map((d) => d.field)).to.deep.equal([
          "location.coordinates",
        ]);
        expect(written).to.deep.equal([]);
      });

      it("stores a new location with a point", async function () {
        const res = await create(withPoint());

        expect(res.status).to.equal(201);
        expect(written).to.deep.equal([withPoint()]);
      });

      it("stores a point without an address", async function () {
        const pointOnly = {
          coordinates: { type: "Point", points: [14.7198, 51.953] },
          meta: { source: "manual" },
        };

        const res = await create(pointOnly);

        expect(res.status).to.equal(201);
        expect(written).to.deep.equal([pointOnly]);
      });

      const EMPTY = {
        null: null,
        "the default with empty fields and [null, null]": {
          coordinates: { type: "Point", points: [null, null] },
          display_address: "",
          address: {
            street: null,
            house_number: null,
            postcode: null,
            city: null,
            suburb: null,
            state: null,
            country: null,
            country_code: null,
          },
          meta: {},
        },
        "an object without address, addition and point": {
          display_address: null,
          address: null,
          coordinates: null,
          meta: { source: null, additional: null },
        },
      };
      for (const [what, empty] of Object.entries(EMPTY)) {
        it(`stores an empty location: ${what}`, async function () {
          const res = await create(empty);

          expect(res.status).to.equal(201);
          expect(written).to.deep.equal([empty]);
        });
      }

      it("refuses a new location given as text only", async function () {
        const res = await create("Rathausplatz 1, Kiel");

        // The access point's schema already refuses text as its location.
        expect(res.status).to.equal(400);
        expect(res.body.details.map((d) => d.field).join()).to.be.oneOf([
          "location.coordinates",
          "location",
        ]);
        expect(written).to.deep.equal([]);
      });

      it("refuses a new addition without a point", async function () {
        const res = await create({
          coordinates: { type: "Point", points: [null, null] },
          meta: { additional: "Hinter der Sporthalle" },
        });

        expect(res.status).to.equal(400);
        expect(res.body.details.map((d) => d.field)).to.deep.equal([
          "location.coordinates",
        ]);
      });

      it("keeps an unchanged old location without a point, as stored", async function () {
        const stored = withoutPoint();
        // The client sends the keys in another order.
        const sent = {
          meta: {},
          coordinates: { points: [null, null], type: "Point" },
          address: { ...stored.address },
          display_address: stored.display_address,
        };

        const res = await update(stored, sent);

        expect(res.status).to.be.oneOf([200, 201]);
        expect(written).to.have.length(1);
        expect(JSON.stringify(written[0])).to.equal(JSON.stringify(stored));
      });

      it("keeps an unchanged old location given as text", async function () {
        const res = await update(
          "Rathausplatz 1, Kiel",
          "Rathausplatz 1, Kiel",
        );

        expect(res.status).to.be.oneOf([200, 201]);
        expect(written).to.deep.equal(["Rathausplatz 1, Kiel"]);
      });

      it("refuses a changed old location without a point", async function () {
        const changed = withoutPoint();
        changed.address.house_number = "5";

        const res = await update(withoutPoint(), changed);

        expect(res.status).to.equal(400);
        expect(res.body.details.map((d) => d.field)).to.deep.equal([
          "location.coordinates",
        ]);
        expect(written).to.deep.equal([]);
      });

      it("refuses an old location without a point when only the addition is new", async function () {
        const changed = withoutPoint();
        changed.meta.additional = "Halle 2";

        const res = await update(withoutPoint(), changed);

        expect(res.status).to.equal(400);
        expect(res.body.details.map((d) => d.field)).to.deep.equal([
          "location.coordinates",
        ]);
      });

      it("refuses a changed text location without a point", async function () {
        const res = await update(
          "Rathausplatz 1, Kiel",
          "Rathausplatz 2, Kiel",
        );

        expect(res.status).to.equal(400);
      });

      /** The fields a refusal names for a new location with `changes`. */
      const refusedFields = async (changes) => {
        const res = await create(changes(withPoint()));
        expect(res.status).to.equal(400);
        expect(written).to.deep.equal([]);
        return res.body.details.map((d) => d.field);
      };

      const INVALID_POINTS = {
        "a latitude above 90": [14.7, 90.1],
        "a latitude below -90": [14.7, -90.1],
        "a longitude above 180": [180.1, 51.9],
        "a longitude below -180": [-180.1, 51.9],
        "numbers as text": ["14.7", "51.9"],
        "half a point": [14.7, null],
        "a single number": [14.7],
      };
      for (const [what, points] of Object.entries(INVALID_POINTS)) {
        it(`refuses a point with ${what}`, async function () {
          const fields = await refusedFields((location) => ({
            ...location,
            coordinates: { type: "Point", points },
          }));

          expect(fields).to.deep.equal(["location.coordinates"]);
        });
      }

      it("stores a point on the edge of the valid range", async function () {
        const edge = {
          coordinates: { type: "Point", points: [-180, 90] },
          meta: { source: "manual" },
        };

        const res = await create(edge);

        expect(res.status).to.equal(201);
      });

      for (const source of ["photon", "manual", "nuki"]) {
        it(`stores the source ${source}`, async function () {
          const location = withPoint();
          location.meta.source = source;

          const res = await create(location);

          expect(res.status).to.equal(201);
        });
      }

      for (const source of ["google", "nominatim", "legacy", 7]) {
        it(`refuses the source ${source} on a new location`, async function () {
          const fields = await refusedFields((location) => ({
            ...location,
            meta: { ...location.meta, source },
          }));

          expect(fields).to.deep.equal(["location.meta.source"]);
        });
      }

      for (const source of ["nominatim", "legacy"]) {
        const old = () => {
          const location = withPoint();
          location.meta = { source };
          return location;
        };

        it(`keeps an unchanged old location with the source ${source}`, async function () {
          const res = await update(old(), old());

          expect(res.status).to.be.oneOf([200, 201]);
          expect(written).to.deep.equal([old()]);
        });

        it(`keeps the old source ${source} when only the addition is new`, async function () {
          const changed = old();
          changed.meta.additional = "Halle 2";

          const res = await update(old(), changed);

          expect(res.status).to.be.oneOf([200, 201]);
          expect(written).to.deep.equal([changed]);
        });
      }

      it("refuses an old source the stored location did not have", async function () {
        const changed = withPoint();
        changed.meta.source = "legacy";
        const stored = withPoint();
        stored.meta.source = "nominatim";

        const res = await update(stored, changed);

        expect(res.status).to.equal(400);
        expect(res.body.details.map((d) => d.field)).to.deep.equal([
          "location.meta.source",
        ]);
      });

      for (const code of ["PL", "pl", "De"]) {
        it(`stores the country code ${code}`, async function () {
          const location = withPoint();
          location.address.country_code = code;

          const res = await create(location);

          expect(res.status).to.equal(201);
        });
      }

      for (const code of ["POL", "D", "D1", 49]) {
        it(`refuses the country code ${code}`, async function () {
          const fields = await refusedFields((location) => ({
            ...location,
            address: { ...location.address, country_code: code },
          }));

          expect(fields).to.deep.equal(["location.address.country_code"]);
        });
      }

      const WRONG_TYPES = {
        location: () => 42,
        "location.display_address": (l) => ({ ...l, display_address: 4 }),
        "location.address": (l) => ({ ...l, address: "Gasstraße 4" }),
        "location.address.street": (l) => ({
          ...l,
          address: { ...l.address, street: ["Gasstraße"] },
        }),
        "location.address.house_number": (l) => ({
          ...l,
          address: { ...l.address, house_number: 4 },
        }),
        "location.address.postcode": (l) => ({
          ...l,
          address: { ...l.address, postcode: 3172 },
        }),
        "location.address.city": (l) => ({
          ...l,
          address: { ...l.address, city: {} },
        }),
        "location.coordinates": (l) => ({ ...l, coordinates: [14.7, 51.9] }),
        "location.coordinates.type": (l) => ({
          ...l,
          coordinates: { ...l.coordinates, type: "Polygon" },
        }),
        "location.meta": (l) => ({ ...l, meta: "photon" }),
        "location.meta.additional": (l) => ({
          ...l,
          meta: { ...l.meta, additional: true },
        }),
      };
      for (const [field, change] of Object.entries(WRONG_TYPES)) {
        it(`refuses ${field} of the wrong type`, async function () {
          expect(await refusedFields(change)).to.include(field);
        });
      }

      it("names every refused field at once", async function () {
        const fields = await refusedFields((location) => ({
          ...location,
          address: { ...location.address, country_code: "POL" },
          coordinates: { type: "Point", points: [14.7, 95] },
          meta: { source: "google" },
        }));

        expect(fields).to.have.members([
          "location.address.country_code",
          "location.coordinates",
          "location.meta.source",
        ]);
      });

      it("keeps unknown fields and does not check them", async function () {
        const location = withPoint();
        location.label = 7;
        location.address.suburb = 12;
        location.address.district = ["Mitte"];
        location.coordinates.crs = { name: "WGS84" };
        location.meta.address_source = 99;

        const res = await create(location);

        expect(res.status).to.equal(201);
        expect(written).to.deep.equal([location]);
      });
    });
  }
});
