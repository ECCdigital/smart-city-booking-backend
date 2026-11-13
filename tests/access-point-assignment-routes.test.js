/**
 * The assignment of one access point to bookables (glossary "Zuordnung"),
 * set from the access points page (ECCdigital/tickets#1110):
 * `PUT /api/:tenant/accesspoints/:id/bookables` takes the bookables that
 * shall carry the access point and adds or removes its id at
 * `accessPointDetails.accessPointIds` of every bookable that changes,
 * under `bookable.update` with the reach of `PUT bookables`. A bookable
 * that gets its first access point has its access switched on. What is
 * stored afterwards is read off the harness' catalogue, which the
 * bookable manager's write changes.
 */

const { expect } = require("chai");
const sinon = require("sinon");

const {
  installHarness,
  bookable,
  TENANT,
  OWNER,
  ROLE_HOLDER,
  READ_OWN_HOLDER,
  CUSTOMER,
} = require("./helpers/booking-lifecycle-harness");
const { installRouteWorld } = require("./helpers/route-world");
const AccessPointManager = require("../src/commons/data-managers/access-point-manager");
const {
  BookableManager,
} = require("../src/commons/data-managers/bookable-manager");
const { AccessPoint } = require("../src/commons/entities/access/access-point");

const FORBIDDEN = {
  error: "ForbiddenError",
  code: "forbidden",
  statusCode: 403,
  params: {},
};

const DOOR = "door-1";
const OTHER_DOOR = "door-2";
const ANLAGE = "anlage-1";

/** The access points of the tenant: two doors and an Anlage with its own Fächer. */
const ACCESS_POINTS = {
  [DOOR]: { id: DOOR, type: "door", provider: "nuki", label: "Haupteingang" },
  [OTHER_DOOR]: {
    id: OTHER_DOOR,
    type: "door",
    provider: "nuki",
    label: "Hintereingang",
  },
  [ANLAGE]: {
    id: ANLAGE,
    type: "locker",
    provider: "open-locker",
    label: "Fahrradboxen",
    config: { compartments: [] },
  },
};

/**
 * The bookables of the test, by id: the role holder owns them, the
 * read-own holder (who holds `updateOwn`) owns `mine` alone.
 */
const BOOKABLES = {
  saal: { title: "Saal", ownerUserId: ROLE_HOLDER },
  foyer: { title: "Foyer", ownerUserId: ROLE_HOLDER },
  keller: { title: "Keller", ownerUserId: ROLE_HOLDER },
  mine: { title: "Eigenes", ownerUserId: READ_OWN_HOLDER },
};

describe("assignment of an access point to bookables over HTTP", function () {
  this.timeout(20000);

  let h;
  /** What the bookable manager wrote, as `[bookableId, details]`. */
  let writes;

  before(async function () {
    h = await installHarness({});
    installRouteWorld({
      tenantId: TENANT,
      tenant: h.tenant,
      ownerUserId: ROLE_HOLDER,
      bookables: h.bookables,
    });

    const restub = (Manager, name, impl) => {
      Manager[name].restore();
      sinon.stub(Manager, name).callsFake(impl);
    };
    restub(AccessPointManager, "getAccessPoint", async (id, tenantId) =>
      tenantId === TENANT && ACCESS_POINTS[id]
        ? new AccessPoint({ tenantId, ...ACCESS_POINTS[id] })
        : null,
    );
    // The bookable as the real manager writes it: the two fields of the
    // assignment, nothing else.
    restub(
      BookableManager,
      "storeAccessPointLinks",
      async (tenantId, id, { accessPointIds, active }) => {
        writes.push([id, { accessPointIds, active }]);
        const record = h.bookables[id];
        record.accessPointDetails = {
          ...record.accessPointDetails,
          accessPointIds: [...accessPointIds],
          active,
        };
      },
    );
  });

  beforeEach(function () {
    writes = [];
    for (const [id, fields] of Object.entries(BOOKABLES)) {
      h.bookables[id] = bookable({
        id,
        ...fields,
        accessPointDetails: {
          active: false,
          accessBuffer: { before: 15, after: 30 },
          accessPointIds: [],
        },
      });
    }
  });

  after(async function () {
    sinon.restore();
    await h.close();
  });

  const assign = (accessPointId, userId, body) => {
    let req = h
      .api()
      .put(`/api/${TENANT}/accesspoints/${accessPointId}/bookables`);
    if (userId) req = req.set(h.as(userId));
    return req.send(body);
  };
  /** The stored access point details of a bookable. */
  const details = (id) => h.bookables[id].accessPointDetails;
  /** Links a bookable to access points, as stored before the call. */
  const linked = (id, accessPointIds, active = true) => {
    h.bookables[id].accessPointDetails = {
      ...details(id),
      accessPointIds,
      active,
    };
  };

  it("adds the access point to the listed bookables and removes it from the others", async function () {
    linked("foyer", [DOOR]);
    linked("keller", [OTHER_DOOR, DOOR]);

    const res = await assign(DOOR, OWNER, { bookableIds: ["saal", "foyer"] });

    expect(res.status).to.equal(200);
    expect(res.body).to.deep.equal({
      accessPointId: DOOR,
      bookableIds: ["saal", "foyer"],
    });
    expect(details("saal").accessPointIds).to.deep.equal([DOOR]);
    expect(details("foyer").accessPointIds).to.deep.equal([DOOR]);
    expect(details("keller").accessPointIds).to.deep.equal([OTHER_DOOR]);
    expect(details("mine").accessPointIds).to.deep.equal([]);
    // Only the bookables that change are written.
    expect(writes.map(([id]) => id)).to.have.members(["saal", "keller"]);
  });

  it("switches the access on at a bookable that gets its first access point, and nowhere else", async function () {
    // `foyer` links another door with the access switched off.
    linked("foyer", [OTHER_DOOR], false);

    const res = await assign(DOOR, OWNER, { bookableIds: ["saal", "foyer"] });

    expect(res.status).to.equal(200);
    expect(details("saal")).to.deep.equal({
      active: true,
      accessBuffer: { before: 15, after: 30 },
      accessPointIds: [DOOR],
    });
    expect(details("foyer")).to.deep.equal({
      active: false,
      accessBuffer: { before: 15, after: 30 },
      accessPointIds: [OTHER_DOOR, DOOR],
    });
  });

  it("keeps the access switched on at a bookable that loses its last access point", async function () {
    linked("saal", [DOOR], true);

    const res = await assign(DOOR, OWNER, { bookableIds: [] });

    expect(res.status).to.equal(200);
    expect(details("saal")).to.include({ active: true });
    expect(details("saal").accessPointIds).to.deep.equal([]);
  });

  describe("rights", function () {
    it("is refused to the anonymous and to the customer in the one form", async function () {
      const body = { bookableIds: ["saal"] };

      expect((await assign(DOOR, null, body)).status).to.equal(401);

      const customer = await assign(DOOR, CUSTOMER, body);
      expect(customer.status).to.equal(403);
      expect(customer.body).to.deep.equal(FORBIDDEN);
      expect(writes).to.deep.equal([]);
    });

    it("is open to the holder of bookable.update at every bookable", async function () {
      const res = await assign(DOOR, ROLE_HOLDER, {
        bookableIds: ["saal", "mine"],
      });

      expect(res.status).to.equal(200);
      expect(details("mine").accessPointIds).to.deep.equal([DOOR]);
    });

    it("lets the holder of updateOwn change the own bookable", async function () {
      const res = await assign(DOOR, READ_OWN_HOLDER, {
        bookableIds: ["mine"],
      });

      expect(res.status).to.equal(200);
      expect(details("mine").accessPointIds).to.deep.equal([DOOR]);
    });

    it("refuses the holder of updateOwn a bookable out of reach that would change, and writes nothing", async function () {
      const added = await assign(DOOR, READ_OWN_HOLDER, {
        bookableIds: ["mine", "saal"],
      });
      expect(added.status).to.equal(403);
      expect(added.body).to.deep.equal(FORBIDDEN);

      linked("foyer", [DOOR]);
      const removed = await assign(DOOR, READ_OWN_HOLDER, {
        bookableIds: ["mine"],
      });
      expect(removed.status).to.equal(403);
      expect(removed.body).to.deep.equal(FORBIDDEN);

      expect(writes).to.deep.equal([]);
      expect(details("mine").accessPointIds).to.deep.equal([]);
    });

    it("does not ask about a bookable out of reach that keeps the access point", async function () {
      linked("foyer", [DOOR]);

      const res = await assign(DOOR, READ_OWN_HOLDER, {
        bookableIds: ["foyer", "mine"],
      });

      expect(res.status).to.equal(200);
      expect(details("mine").accessPointIds).to.deep.equal([DOOR]);
      expect(details("foyer").accessPointIds).to.deep.equal([DOOR]);
    });
  });

  describe("refusals", function () {
    it("answers 404 for an access point the tenant does not have", async function () {
      const res = await assign("door-x", OWNER, { bookableIds: ["saal"] });

      expect(res.status).to.equal(404);
      expect(res.body).to.include({
        error: "NotFoundError",
        code: "access_point_not_found",
      });
    });

    it("refuses a list that is no list of ids", async function () {
      for (const body of [{}, { bookableIds: "saal" }, { bookableIds: [""] }]) {
        const res = await assign(DOOR, OWNER, body);

        expect(res.status).to.equal(400);
        expect(res.body.details).to.deep.equal([
          { field: "bookableIds", code: "invalid_bookable_ids", params: {} },
        ]);
      }
      expect(writes).to.deep.equal([]);
    });

    it("refuses a bookable the tenant does not have and writes nothing", async function () {
      const res = await assign(DOOR, OWNER, {
        bookableIds: ["saal", "nirgends"],
      });

      expect(res.status).to.equal(400);
      expect(res.body.details).to.deep.equal([
        {
          field: "bookableIds",
          code: "unknown_bookable",
          params: { bookableId: "nirgends" },
        },
      ]);
      expect(writes).to.deep.equal([]);
    });

    it("hangs a Schließfachanlage with its own Fächer at one bookable at most", async function () {
      const res = await assign(ANLAGE, OWNER, {
        bookableIds: ["saal", "foyer"],
      });

      expect(res.status).to.equal(400);
      expect(res.body.details).to.deep.equal([
        {
          field: "bookableIds",
          code: "locker_system_one_bookable",
          params: { accessPointId: ANLAGE, label: "Fahrradboxen" },
        },
      ]);
      expect(writes).to.deep.equal([]);
    });
  });

  it("moves a Schließfachanlage with its own Fächer from one bookable to another", async function () {
    linked("foyer", [ANLAGE]);

    const res = await assign(ANLAGE, OWNER, { bookableIds: ["saal"] });

    expect(res.status).to.equal(200);
    expect(details("saal").accessPointIds).to.deep.equal([ANLAGE]);
    expect(details("foyer").accessPointIds).to.deep.equal([]);
  });

  it("writes nothing when the list is the stored assignment", async function () {
    linked("saal", [DOOR]);

    const res = await assign(DOOR, OWNER, { bookableIds: ["saal"] });

    expect(res.status).to.equal(200);
    expect(writes).to.deep.equal([]);
  });
});
