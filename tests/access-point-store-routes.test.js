/**
 * Saving an access point over HTTP (`PUT /api/:tenant/accesspoints`, a
 * create without `id`, an update with it): Open Locker knows only the
 * Schließfachanlage (ECCdigital/tickets#1162). A `door` of Open Locker - the
 * former fixed Fach - is refused at `type`, from the API and from an old
 * client alike; a door of Nuki or Salto KS is stored as before. A Fach of
 * Open Locker stands in at most one Anlage of the tenant.
 *
 * The tenant has no access application switched on, so no provider is
 * asked and every save goes on without the listing; what is stored is read
 * off the access points the manager holds.
 */

const { expect } = require("chai");
const sinon = require("sinon");

const {
  installHarness,
  TENANT,
  OWNER,
  ROLE_HOLDER,
} = require("./helpers/booking-lifecycle-harness");
const { installRouteWorld } = require("./helpers/route-world");
const {
  installInMemoryLockerSystemHolds,
} = require("./helpers/in-memory-locker-system-holds");
const AccessPointManager = require("../src/commons/data-managers/access-point-manager");
const { AccessPoint } = require("../src/commons/entities/access/access-point");

const COMPARTMENT_ID = "9b2f6c1e-3d4a-4f5b-8c7d-1e2f3a4b5c6d";
const OTHER_COMPARTMENT_ID = "1b4e28ba-2fa1-11d2-883f-0016d3cca427";

/** A Fach of Open Locker as the Admin UI sends it. */
const compartment = (id, number) => ({
  id,
  number,
  lockerBank: { id: "bank-1", name: "Labor Fachbank 1" },
  outOfService: false,
});

/** A Schließfachanlage of Open Locker with the given Fächer. */
const lockerSystem = (label, compartments) => ({
  provider: "open-locker",
  type: "locker",
  mode: "remote",
  label,
  config: { compartments },
});

const LOCKER_ONLY = {
  field: "type",
  code: "open_locker_locker_only",
  params: {},
};

describe("saving an access point over HTTP", function () {
  this.timeout(20000);

  let h;
  /** The access points of the tenant, by id, as the manager stores them. */
  let stored;
  let nextId;

  before(async function () {
    h = await installHarness({});
    installRouteWorld({
      tenantId: TENANT,
      tenant: h.tenant,
      ownerUserId: ROLE_HOLDER,
      bookables: h.bookables,
    });
    installInMemoryLockerSystemHolds();

    const restub = (name, impl) => {
      AccessPointManager[name].restore();
      sinon.stub(AccessPointManager, name).callsFake(impl);
    };
    const entity = (record) => new AccessPoint({ ...record });
    restub("getAccessPoint", async (id, tenantId) =>
      tenantId === TENANT && stored[id] ? entity(stored[id]) : null,
    );
    restub("getAccessPoints", async (tenantId) =>
      tenantId === TENANT ? Object.values(stored).map(entity) : [],
    );
    restub("storeAccessPoint", async (accessPoint, tenantId) => {
      const id = accessPoint.id || `point-${nextId++}`;
      stored[id] = { ...accessPoint, id, tenantId };
      return entity(stored[id]);
    });
  });

  beforeEach(function () {
    stored = {};
    nextId = 1;
  });

  after(async function () {
    sinon.restore();
    await h.close();
  });

  const save = (body) =>
    h.api().put(`/api/${TENANT}/accesspoints`).set(h.as(OWNER)).send(body);

  /** Stores an access point before the test, as an earlier save left it. */
  const given = (id, fields) => {
    stored[id] = { id, tenantId: TENANT, validationRules: [], ...fields };
  };

  describe("Open Locker knows only the Schließfachanlage", function () {
    it("refuses a door of Open Locker on a create, at type, and stores nothing", async function () {
      const res = await save({
        provider: "open-locker",
        type: "door",
        mode: "remote",
        label: "Schlüssel Raum 1",
        externalId: COMPARTMENT_ID,
      });

      expect(res.status).to.equal(400);
      expect(res.body.details).to.deep.equal([LOCKER_ONLY]);
      expect(stored).to.deep.equal({});
    });

    it("refuses a door of Open Locker without a UUID at type alone", async function () {
      const res = await save({
        provider: "open-locker",
        type: "door",
        mode: "remote",
        label: "Fach",
      });

      expect(res.status).to.equal(400);
      expect(res.body.details).to.deep.equal([LOCKER_ONLY]);
    });

    it("refuses to turn an Anlage of Open Locker into a door on an update, and keeps it", async function () {
      const anlage = lockerSystem("Schlüssel Raum 1", [
        compartment(COMPARTMENT_ID, 1),
      ]);
      given("anlage-1", anlage);

      const res = await save({
        id: "anlage-1",
        type: "door",
        externalId: COMPARTMENT_ID,
      });

      expect(res.status).to.equal(400);
      expect(res.body.details).to.deep.equal([LOCKER_ONLY]);
      expect(stored["anlage-1"]).to.include({ type: "locker" });
    });

    it("refuses an update of a door of Open Locker stored before, even one that changes only its label", async function () {
      given("fach-1", {
        provider: "open-locker",
        type: "door",
        mode: "remote",
        label: "Fach",
        externalId: COMPARTMENT_ID,
      });

      const res = await save({ id: "fach-1", label: "Schlüssel" });

      expect(res.status).to.equal(400);
      expect(res.body.details).to.deep.equal([LOCKER_ONLY]);
      expect(stored["fach-1"]).to.include({ label: "Fach" });
    });

    it("stores an Anlage with a single Fach", async function () {
      const res = await save(
        lockerSystem("Schlüssel Raum 1", [compartment(COMPARTMENT_ID, 1)]),
      );

      expect(res.status).to.equal(201);
      expect(res.body).to.include({ type: "locker", provider: "open-locker" });
      expect(res.body.config.compartments.map((c) => c.id)).to.deep.equal([
        COMPARTMENT_ID,
      ]);
    });
  });

  describe("doors of other providers", function () {
    it("stores a door of Nuki", async function () {
      const res = await save({
        provider: "nuki",
        type: "door",
        mode: "authorization",
        label: "Haupteingang",
        externalId: "lock-1",
      });

      expect(res.status).to.equal(201);
      expect(res.body).to.include({ type: "door", provider: "nuki" });
    });

    it("stores a door of Salto KS", async function () {
      const res = await save({
        provider: "salto-ks",
        type: "door",
        mode: "remote",
        label: "Seiteneingang",
        externalId: "salto-lock-1",
      });

      expect(res.status).to.equal(201);
      expect(res.body).to.include({ type: "door", provider: "salto-ks" });
    });

    it("updates a door of Nuki", async function () {
      given("door-1", {
        provider: "nuki",
        type: "door",
        mode: "authorization",
        label: "Haupteingang",
        externalId: "lock-1",
      });

      const res = await save({ id: "door-1", label: "Vordereingang" });

      expect(res.status).to.equal(200);
      expect(stored["door-1"]).to.include({ label: "Vordereingang" });
    });
  });

  describe("a Fach in at most one Anlage", function () {
    it("refuses a Fach that already stands in another Anlage, naming it", async function () {
      given(
        "anlage-1",
        lockerSystem("Fahrradboxen", [compartment(COMPARTMENT_ID, 1)]),
      );

      const res = await save(
        lockerSystem("Geräte", [
          compartment(OTHER_COMPARTMENT_ID, 2),
          compartment(COMPARTMENT_ID, 1),
        ]),
      );

      expect(res.status).to.equal(400);
      expect(res.body.details).to.deep.equal([
        {
          field: "config.compartments.1",
          code: "compartment_in_locker_system",
          params: {
            compartmentId: COMPARTMENT_ID,
            accessPointId: "anlage-1",
            label: "Fahrradboxen",
          },
        },
      ]);
      expect(Object.keys(stored)).to.deep.equal(["anlage-1"]);
    });

    it("lets an Anlage keep its own Fächer on an update", async function () {
      given(
        "anlage-1",
        lockerSystem("Fahrradboxen", [compartment(COMPARTMENT_ID, 1)]),
      );

      const res = await save({ id: "anlage-1", label: "Fahrradgarage" });

      expect(res.status).to.equal(200);
      expect(stored["anlage-1"]).to.include({ label: "Fahrradgarage" });
    });

    it("takes a Fach whose UUID a stored door of Open Locker still names, for no door holds a Fach", async function () {
      given("fach-1", {
        provider: "open-locker",
        type: "door",
        mode: "remote",
        label: "Fach",
        externalId: COMPARTMENT_ID,
      });

      const res = await save(
        lockerSystem("Schlüssel Raum 1", [compartment(COMPARTMENT_ID, 1)]),
      );

      expect(res.status).to.equal(201);
    });
  });
});
